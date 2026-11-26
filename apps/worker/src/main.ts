import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_APP_URL || 'postgresql://devcore_app:devcore_app_password_dev@localhost:5433/devcore',
});

export interface IngestionJobData {
  userId: string;
  documentId: string;
  driveFileId: string;
  newVersion: string;
}

/**
 * Worker assíncrono para processamento de ingestão do Google Drive.
 * RNF02: O worker conecta com devcore_app (sem superuser e sem bypass de RLS)
 * e define obrigatoriamente `set_config('app.current_user_id', userId, true)`.
 */
export async function processDocumentIngestion(job: IngestionJobData) {
  const { userId, documentId, newVersion } = job;
  console.log(`[Worker] Iniciando ingestão do documento ${documentId} para o usuário ${userId}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Injeção de isolamento multitenant
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

    // 1. Simulação do processo de extração e gravação de novos chunks sob a nova versão
    // (Em produção, o parser extrai o texto e calcula os chunks com locators)
    console.log(`[Worker] Gravando chunks sob versão ${newVersion}...`);

    // 2. Troca atômica de versão (B.4 / D16):
    // Desativa versões antigas e ativa a nova versão em transação única
    await client.query(`
      UPDATE document_embeddings 
         SET is_active = false
       WHERE document_id = $1 AND parser_version <> $2;
    `, [documentId, newVersion]);

    await client.query(`
      UPDATE document_embeddings 
         SET is_active = true
       WHERE document_id = $1 AND parser_version = $2;
    `, [documentId, newVersion]);

    await client.query(`
      UPDATE documents 
         SET active_parser_version = $1, 
             status = 'indexed', 
             updated_at = now()
       WHERE id = $2;
    `, [newVersion, documentId]);

    await client.query('COMMIT');
    console.log(`[Worker] Troca atômica de versão concluída com sucesso para doc ${documentId}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[Worker] Falha no processamento do documento ${documentId}`, error);
    throw error;
  } finally {
    client.release();
  }
}

async function startWorker() {
  console.log('[Worker] DevCore Background Worker inicializado.');
  console.log('[Worker] Bootstrap concluído; integração pg-boss ainda pendente.');
}

startWorker().catch(console.error);

