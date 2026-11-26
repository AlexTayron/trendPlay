# DevCore — Patch do SRS/TDD v1.0

Corrige os bloqueadores encontrados na revisão. O SQL é uma migration incremental sobre o DDL do SRS e **não foi executado** em nenhum banco: rode num PostgreSQL 16 com pgvector antes de adotar. Decisões relacionadas estão em `ARCHITECTURE_DECISIONS.md` (D13–D18), todas ainda `Proposta`.

---

## Parte A — Correções de texto no SRS

| Onde | Problema | Correção |
|---|---|---|
| Cabeçalho | «Aprovado com base na Auditoria D1–D12» | Trocar por «Rascunho. Pendente da Fase 0 e da aprovação das decisões D2–D18». Só D1 está aprovada. |
| §4 introdução | «31 entidades» | O DDL tem 36 tabelas. |
| RF19 / RNF10 | Fallback para iframe do Drive | Registrar a limitação: o iframe provavelmente não expõe a posição de reprodução [verificar no spike C2]. No modo iframe, `positionSeconds` do tutor, clique-para-minuto nas notas e progresso por limiar ficam indisponíveis. |
| RF21 e Fase 4 | `code_snapshots` | O DDL usa `lesson_code_anchors`. Padronizar um nome. |
| RF25–RF28 e Fase 5 | Certificados, badges, avaliações e Career Advisor no escopo | Conflita com D4. Mover para «pós-MVP» e tirar as tabelas da migration inicial. |
| RF26 | Endpoint público de autenticidade do certificado | Conflita com o RLS por usuário. Se voltar ao escopo, exige consulta por hash com papel dedicado e dados mínimos. |
| RNF01 | «Todas as tabelas» com RLS | Só era verdade para 9. Ver Parte B. |
| RNF02 | Worker sem superuser | Acrescentar: o papel da aplicação não pode ter `BYPASSRLS` nem ser dono das tabelas, e as tabelas usam `FORCE ROW LEVEL SECURITY`. |
| RNF05, RNF06, RNF11, RNF10 | Metas numéricas (40 ms em 500 mil chunks, TTFT p95 < 1,8 s, Faithfulness ≥ 95%, erro < 0,1%) | Rotular como «hipóteses a calibrar na Fase 0/3». Não são medições. |
| RN04 | Limiar em score RRF | RRF é relativo. Usar cosseno do melhor candidato ou score do reranker (D18). |
| RN06 | Preserva notas, mas o DDL apaga em cascata | Ver B.3. |
| §4 DDL | `instructor_name DEFAULT 'Instrutor Titular'`, `tier DEFAULT 'pro'`, `pgp_fingerprint`, extensões `uuid-ossp` e `pg_trgm` | Remover: vêm de dados demonstrativos do Stitch ou não são usados. |
| §4 DDL | `VECTOR(1536)` e modelo OpenAI no comentário | Placeholder até o benchmark (D14). |
| §4 DDL | `ingestion_jobs` | O `pg-boss` já mantém sua fila. Manter `ingestion_jobs` só como espelho de status para a tela de erros, ou removê-la. |
| §6 | Camadas de defesa | Anunciadas «4», descritas 3. Acrescentar a 4ª: rate limit por usuário no endpoint de IA e testes com documentos maliciosos. |
| RNF08 | Purga em «até 30 dias» | Marcar como prazo a definir com base na política de privacidade. |
| §7 Fase 0 | Spikes | Acrescentar «medir EXPLAIN do HNSW com filtro por usuário» e «benchmark de embeddings (D14)». |

---

## Parte B — Patch SQL

### B.1 Papéis e função de contexto

```sql
-- Executar como dono do schema (role de migração).
-- A aplicação e o worker conectam com devcore_app: não é dono, não tem BYPASSRLS.
CREATE ROLE devcore_app LOGIN NOBYPASSRLS NOSUPERUSER;
GRANT USAGE ON SCHEMA public TO devcore_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO devcore_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO devcore_app;

-- Retorna NULL (e não erra) quando a variável não foi definida.
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;
```

Uso em cada transação (API e worker):

```sql
BEGIN;
SELECT set_config('app.current_user_id', :userId, true);  -- true = local à transação
-- consultas...
COMMIT;
```

Observação: se houver pooler em modo transação, `set_config(..., true)` dentro da transação funciona; não use `SET` de sessão.

### B.2 `user_id` nas tabelas filhas, com consistência garantida

Sem `user_id`, `modules`, `lessons`, `lesson_documents` e `lesson_code_anchors` ficam fora do RLS e expostas a acesso por ID (IDOR).

```sql
-- Chaves únicas compostas para as FKs compostas
ALTER TABLE courses   ADD CONSTRAINT uq_courses_id_user   UNIQUE (id, user_id);
ALTER TABLE documents ADD CONSTRAINT uq_documents_id_user UNIQUE (id, user_id);

-- modules
ALTER TABLE modules ADD COLUMN user_id uuid;
UPDATE modules m SET user_id = c.user_id FROM courses c WHERE c.id = m.course_id;
ALTER TABLE modules ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE modules ADD CONSTRAINT uq_modules_id_user UNIQUE (id, user_id);
ALTER TABLE modules DROP CONSTRAINT modules_course_id_fkey;
ALTER TABLE modules ADD CONSTRAINT fk_modules_course
  FOREIGN KEY (course_id, user_id) REFERENCES courses (id, user_id) ON DELETE CASCADE;

-- lessons
ALTER TABLE lessons ADD COLUMN user_id uuid;
UPDATE lessons l SET user_id = m.user_id FROM modules m WHERE m.id = l.module_id;
ALTER TABLE lessons ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE lessons ADD CONSTRAINT uq_lessons_id_user UNIQUE (id, user_id);
ALTER TABLE lessons DROP CONSTRAINT lessons_module_id_fkey;
ALTER TABLE lessons ADD CONSTRAINT fk_lessons_module
  FOREIGN KEY (module_id, user_id) REFERENCES modules (id, user_id) ON DELETE CASCADE;

-- lesson_documents
ALTER TABLE lesson_documents ADD COLUMN user_id uuid;
UPDATE lesson_documents ld SET user_id = l.user_id FROM lessons l WHERE l.id = ld.lesson_id;
ALTER TABLE lesson_documents ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE lesson_documents DROP CONSTRAINT lesson_documents_lesson_id_fkey;
ALTER TABLE lesson_documents DROP CONSTRAINT lesson_documents_document_id_fkey;
ALTER TABLE lesson_documents ADD CONSTRAINT fk_ld_lesson
  FOREIGN KEY (lesson_id, user_id) REFERENCES lessons (id, user_id) ON DELETE CASCADE;
ALTER TABLE lesson_documents ADD CONSTRAINT fk_ld_document
  FOREIGN KEY (document_id, user_id) REFERENCES documents (id, user_id) ON DELETE CASCADE;

-- lesson_code_anchors, lesson_summaries, course_tags, path_items, assessments,
-- messages: repetir o mesmo padrão (ADD COLUMN user_id, backfill pelo pai,
-- SET NOT NULL, FK composta). Exemplo mínimo para messages e course_tags:
ALTER TABLE messages ADD COLUMN user_id uuid;
UPDATE messages m SET user_id = c.user_id FROM conversations c WHERE c.id = m.conversation_id;
ALTER TABLE messages ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE course_tags ADD COLUMN user_id uuid;
UPDATE course_tags ct SET user_id = c.user_id FROM courses c WHERE c.id = ct.course_id;
ALTER TABLE course_tags ALTER COLUMN user_id SET NOT NULL;
```

Os nomes de constraint `*_fkey` acima são os padrões do PostgreSQL. Confira com `\d <tabela>` antes de rodar.

### B.3 Notas e histórico de citações preservados (RN06, D17)

```sql
-- Notas sobrevivem à exclusão da aula, com contexto guardado
ALTER TABLE lesson_notes ALTER COLUMN lesson_id DROP NOT NULL;
ALTER TABLE lesson_notes DROP CONSTRAINT lesson_notes_lesson_id_fkey;
ALTER TABLE lesson_notes ADD CONSTRAINT lesson_notes_lesson_id_fkey
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE SET NULL;
ALTER TABLE lesson_notes
  ADD COLUMN lesson_title_snapshot text,
  ADD COLUMN course_title_snapshot text,
  ADD CONSTRAINT ck_notes_time CHECK (time_seconds IS NULL OR time_seconds >= 0);

-- Citações sobrevivem à troca de versão dos chunks
ALTER TABLE retrieval_results ADD COLUMN user_id uuid;
UPDATE retrieval_results r SET user_id = m.user_id FROM messages m WHERE m.id = r.message_id;
ALTER TABLE retrieval_results ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE retrieval_results ALTER COLUMN chunk_id DROP NOT NULL;
ALTER TABLE retrieval_results DROP CONSTRAINT retrieval_results_chunk_id_fkey;
ALTER TABLE retrieval_results ADD CONSTRAINT retrieval_results_chunk_id_fkey
  FOREIGN KEY (chunk_id) REFERENCES document_chunks(id) ON DELETE SET NULL;
ALTER TABLE retrieval_results
  ADD COLUMN locator_snapshot jsonb,
  ADD COLUMN document_title_snapshot text,
  ADD COLUMN drive_revision_id_snapshot text;
```

A aplicação preenche os snapshots no momento em que grava o resultado da recuperação.

### B.4 Versão ativa e status de documentos (D16)

```sql
ALTER TABLE documents ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE documents
  ADD COLUMN active_parser_version varchar(20),
  ADD CONSTRAINT ck_documents_status
    CHECK (status IN ('pending','indexed','inactive','failed'));

-- Embeddings carregam o necessário para filtrar sem JOIN (busca HNSW numa tabela só)
ALTER TABLE document_embeddings
  ADD COLUMN document_id uuid,
  ADD COLUMN parser_version varchar(20),
  ADD COLUMN is_active boolean NOT NULL DEFAULT false;

UPDATE document_embeddings e
   SET document_id = c.document_id, parser_version = c.parser_version
  FROM document_chunks c WHERE c.id = e.chunk_id;

ALTER TABLE document_embeddings
  ALTER COLUMN document_id SET NOT NULL,
  ALTER COLUMN parser_version SET NOT NULL;

CREATE INDEX idx_emb_filter ON document_embeddings (user_id, model_version, is_active, document_id);

-- Segunda configuração de FTS (identificadores de código)
ALTER TABLE document_chunks
  ADD COLUMN tsv_simple tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;
CREATE INDEX idx_chunks_tsv_simple ON document_chunks USING GIN (tsv_simple);
```

Troca atômica de versão (uma transação, depois que todos os chunks e embeddings novos foram gravados):

```sql
BEGIN;
SELECT set_config('app.current_user_id', :userId, true);

UPDATE document_embeddings SET is_active = false
 WHERE document_id = :docId AND parser_version <> :newVersion;
UPDATE document_embeddings SET is_active = true
 WHERE document_id = :docId AND parser_version = :newVersion;
UPDATE documents SET active_parser_version = :newVersion, status = 'indexed', updated_at = now()
 WHERE id = :docId;
COMMIT;
-- Um job posterior apaga chunks e embeddings das versões antigas.
```

Documento removido ou acesso revogado:

```sql
UPDATE documents SET status = 'inactive' WHERE id = :docId;
UPDATE document_embeddings SET is_active = false WHERE document_id = :docId;
```

### B.5 RLS completo

```sql
-- Tabelas com user_id (as originais e as que ganharam a coluna acima)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'auth_identities','user_consents','google_connections','drive_sources',
    'drive_sync_states','documents','ingestion_jobs','document_chunks',
    'document_embeddings','courses','modules','lessons','lesson_documents',
    'lesson_code_anchors','course_tags','learning_paths','path_items',
    'path_enrollments','assessments','attempts','enrollments','favorites',
    'lesson_progress','lesson_notes','study_sessions','learning_events',
    'user_badges','conversations','messages','retrieval_results',
    'lesson_summaries','ai_recommendations','certificates'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id())', t);
  END LOOP;
END $$;

-- users: cada usuário só vê a própria linha
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (id = app_user_id()) WITH CHECK (id = app_user_id());

-- badges e tags são catálogos globais: sem RLS, apenas leitura para a aplicação
REVOKE INSERT, UPDATE, DELETE ON badges, tags FROM devcore_app;
```

Antes de `lesson_code_anchors`, `lesson_summaries`, `path_items`, `assessments` entrarem na lista, aplique B.2 a elas. Caso contrário o loop falha por falta da coluna `user_id`.

Fluxo de login: a criação do usuário no primeiro acesso precisa definir `app.current_user_id` com o novo id antes do `INSERT` em `users`, ou usar uma função `SECURITY DEFINER` restrita para provisionamento.

### B.6 Busca híbrida corrigida

Mudanças em relação ao SRS: filtra documento ativo e versão ativa; a busca vetorial fica numa tabela só (permite o índice HNSW); numera o ranking depois do `LIMIT`; aceita escopo por documentos; usa `websearch_to_tsquery`; combina as duas configurações de FTS.

```sql
-- Parâmetros: :q (texto), :qEmb (vector), :model, :docIds (uuid[] ou NULL), :topK
WITH vec AS (
  SELECT e.chunk_id,
         e.embedding <=> :qEmb AS dist
    FROM document_embeddings e
   WHERE e.user_id = app_user_id()
     AND e.model_version = :model
     AND e.is_active
     AND (:docIds::uuid[] IS NULL OR e.document_id = ANY(:docIds::uuid[]))
   ORDER BY e.embedding <=> :qEmb
   LIMIT 20
),
vec_ranked AS (
  SELECT chunk_id, dist, ROW_NUMBER() OVER (ORDER BY dist) AS rnk FROM vec
),
fts AS (
  SELECT c.id AS chunk_id,
         GREATEST(
           ts_rank_cd(c.tsv_content, websearch_to_tsquery('portuguese', :q)),
           ts_rank_cd(c.tsv_simple,  websearch_to_tsquery('simple',     :q))
         ) AS score
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
   WHERE c.user_id = app_user_id()
     AND d.status = 'indexed'
     AND c.parser_version = d.active_parser_version
     AND (:docIds::uuid[] IS NULL OR c.document_id = ANY(:docIds::uuid[]))
     AND (c.tsv_content @@ websearch_to_tsquery('portuguese', :q)
          OR c.tsv_simple @@ websearch_to_tsquery('simple', :q))
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
SELECT c.id, c.document_id, c.content, c.locator, x.rrf_score,
       1 - x.dist AS cosine_similarity   -- usar este (ou o reranker) no limiar «não encontrei», não o RRF
  FROM fused x
  JOIN document_chunks c ON c.id = x.chunk_id
 ORDER BY x.rrf_score DESC
 LIMIT :topK;
```

Pontos a validar na Fase 0:
- Rode `EXPLAIN (ANALYZE, BUFFERS)` na CTE `vec` com dados reais. Com filtro por `user_id`/`is_active`, o planejador pode preferir varredura em vez do HNSW, ou o HNSW devolver menos de 20 linhas [verificar o suporte a iterative scan na sua versão do pgvector].
- Os escopos de aula e de curso entram via `:docIds` (documentos ligados à aula, ao curso, ou `NULL` para o acervo global). O tutor expande o escopo se o melhor `cosine_similarity` ficar abaixo do limiar.
- `plainto_tsquery` foi trocado por `websearch_to_tsquery`, que tolera perguntas longas. Compare os dois no conjunto de avaliação.

### B.7 Testes automatizados que o patch exige

1. Com `app.current_user_id` = A, `SELECT` em qualquer tabela de usuário nunca retorna linhas de B (inclusive `document_chunks` e `document_embeddings` por ID direto).
2. Sem `app.current_user_id` definido, toda consulta retorna zero linhas e nenhuma dá erro de cast.
3. `INSERT` com `user_id` de outro usuário falha (`WITH CHECK`).
4. O papel `devcore_app` não tem `BYPASSRLS` nem é dono das tabelas.
5. Excluir uma aula deixa a nota do aluno com `lesson_id NULL` e o título preservado.
6. Durante a troca de versão, a busca nunca retorna chunks de duas versões do mesmo documento.
7. Busca com documento `inactive` não retorna nada dele.
8. Prompt injection: documento com «ignore as instruções anteriores» não altera o comportamento do tutor; citação com UUID fora do conjunto recuperado é removida.

---

## O que este patch não resolve

- D2 (vídeo) e D5 (escopo OAuth) dependem dos spikes C2 e C4.
- A qualidade dos parsers em Node (D6) e a escolha do modelo de embeddings (D14) dependem de benchmark com seus documentos.
- O SRS ainda não é um TDD completo: faltam contratos REST, diagramas C4, estrutura de diretórios, interfaces dos parsers e casos de aceite por requisito.
