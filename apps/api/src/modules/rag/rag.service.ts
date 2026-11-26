import { Injectable, Logger } from '@nestjs/common';
import pg from 'pg';
import { RetrievalChunkResult } from '@devcore/shared';

export interface HybridSearchResult extends RetrievalChunkResult {
  bestCosine: number | null;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(private readonly pgPool: pg.Pool) {}

  /**
   * Executa a busca híbrida determinística com Reciprocal Rank Fusion (B.7)
   * Devolve chunks ordenados por RRF e a coluna best_cosine para validação de limiar.
   */
  async hybridSearch(params: {
    userId: string;
    query: string;
    queryEmbedding: number[];
    modelVersion: string;
    docIds?: string[] | null;
    topK?: number;
  }): Promise<{ chunks: HybridSearchResult[]; bestCosine: number | null }> {
    const { userId, query, queryEmbedding, modelVersion, docIds = null, topK = 10 } = params;
    const client = await this.pgPool.connect();

    try {
      await client.query('BEGIN');
      // Injeta tenant context para o PostgreSQL RLS
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const sqlQuery = `
        WITH vec AS (
          SELECT e.chunk_id, e.embedding <=> $1::vector AS dist
            FROM document_embeddings e
           WHERE e.user_id = app_user_id()
             AND e.model_version = $2
             AND e.is_active
             AND ($3::uuid[] IS NULL OR e.document_id = ANY($3::uuid[]))
           ORDER BY e.embedding <=> $1::vector
           LIMIT 20
        ),
        vec_ranked AS (
          SELECT chunk_id, dist, ROW_NUMBER() OVER (ORDER BY dist) AS rnk FROM vec
        ),
        fts AS (
          SELECT c.id AS chunk_id,
                 GREATEST(
                   ts_rank_cd(c.tsv_content, websearch_to_tsquery('portuguese', $4)),
                   ts_rank_cd(c.tsv_simple,  websearch_to_tsquery('simple',     $4))
                 ) AS score
            FROM document_chunks c
            JOIN documents d ON d.id = c.document_id AND d.user_id = c.user_id
           WHERE c.user_id = app_user_id()
             AND d.status = 'indexed'
             AND c.parser_version = d.active_parser_version
             AND ($3::uuid[] IS NULL OR c.document_id = ANY($3::uuid[]))
             AND (c.tsv_content @@ websearch_to_tsquery('portuguese', $4)
                  OR c.tsv_simple @@ websearch_to_tsquery('simple', $4))
           ORDER BY score DESC
           LIMIT 20
        ),
        fts_ranked AS (
          SELECT chunk_id, ROW_NUMBER() OVER (ORDER BY score DESC) AS rnk FROM fts
        ),
        fused AS (
          SELECT COALESCE(f.chunk_id, v.chunk_id) AS chunk_id,
                 COALESCE(1.0 / (60 + f.rnk), 0) + COALESCE(1.0 / (60 + v.rnk), 0) AS rrf_score,
                 v.dist
            FROM fts_ranked f
            FULL OUTER JOIN vec_ranked v ON v.chunk_id = f.chunk_id
        )
        SELECT c.id, 
               c.document_id AS "documentId", 
               c.content, 
               c.locator, 
               x.rrf_score AS "rrfScore",
               (CASE WHEN x.dist IS NOT NULL THEN (1 - x.dist) ELSE NULL END) AS "cosineSimilarity",
               (SELECT 1 - MIN(dist) FROM vec) AS "bestCosine"
          FROM fused x
          JOIN document_chunks c ON c.id = x.chunk_id
         ORDER BY x.rrf_score DESC
         LIMIT $5;
      `;

      const formattedVector = `[${queryEmbedding.join(',')}]`;
      const result = await client.query(sqlQuery, [
        formattedVector,
        modelVersion,
        docIds,
        query,
        topK,
      ]);

      await client.query('COMMIT');

      const chunks = result.rows.map((row: any) => ({
        id: row.id,
        documentId: row.documentId,
        content: row.content,
        locator: row.locator,
        rrfScore: parseFloat(row.rrfScore),
        cosineSimilarity: row.cosineSimilarity !== null ? parseFloat(row.cosineSimilarity) : 0,
        bestCosine: row.bestCosine !== null ? parseFloat(row.bestCosine) : null,
      }));

      const bestCosine = chunks[0]?.bestCosine ?? null;

      return { chunks, bestCosine };
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Erro na busca híbrida RRF v1.2 para usuário ${userId}`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Sanitiza a resposta contra prompt injection e valida citações server-side (RF17)
   */
  validateAndSanitizeCitations(
    responseContent: string,
    retrievedChunkIds: Set<string>
  ): { sanitizedContent: string; validCitations: string[] } {
    const validCitations: string[] = [];
    const citationRegex = /\[ref:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

    const sanitizedContent = responseContent.replace(citationRegex, (match, chunkId) => {
      const lowerChunkId = chunkId.toLowerCase();
      if (retrievedChunkIds.has(lowerChunkId)) {
        validCitations.push(lowerChunkId);
        return match;
      }
      this.logger.warn(`Citação inválida removida no interceptor: ${chunkId}`);
      return '';
    });

    return { sanitizedContent, validCitations };
  }
}
