-- ============================================================================
-- DevCore — Baseline Database Migration (PostgreSQL 15+ com pgvector)
-- Consolidado com SRS_PATCH_v1.2.md e ARCHITECTURE_DECISIONS.md (D1–D21)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ----------------------------------------------------------------------------
-- 1. PAPÉIS E FUNÇÃO DE CONTEXTO MULTITENANT (B.1 & B.2)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcore_app') THEN
    CREATE ROLE devcore_app LOGIN NOBYPASSRLS NOSUPERUSER PASSWORD 'devcore_app_password_dev';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcore_auth') THEN
    CREATE ROLE devcore_auth NOLOGIN NOBYPASSRLS NOSUPERUSER;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO devcore_app, devcore_auth;

-- Padrão para objetos criados daqui em diante pelo papel dono do schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO devcore_app;

-- Função estável para leitura do contexto de tenant
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

-- ----------------------------------------------------------------------------
-- 2. IDENTIDADE E SEGURANÇA
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    job_title VARCHAR(150),
    company VARCHAR(150),
    github_handle VARCHAR(100),
    linkedin_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- 'google'
    provider_user_id VARCHAR(255) NOT NULL,
    profile_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_provider_user UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS user_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type VARCHAR(100) NOT NULL,
    version VARCHAR(20) NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address VARCHAR(45)
);

-- Políticas especiais para devcore_auth provisionar login sem quebrar RLS (B.2)
GRANT SELECT, INSERT ON users, auth_identities TO devcore_auth;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users
  USING (id = app_user_id()) WITH CHECK (id = app_user_id());

DROP POLICY IF EXISTS auth_fn_users ON users;
CREATE POLICY auth_fn_users ON users
  TO devcore_auth USING (true) WITH CHECK (true);

ALTER TABLE auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_identities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON auth_identities;
CREATE POLICY tenant_isolation ON auth_identities
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());

DROP POLICY IF EXISTS auth_fn_identities ON auth_identities;
CREATE POLICY auth_fn_identities ON auth_identities
  TO devcore_auth USING (true) WITH CHECK (true);

-- Função de provisionamento seguro em primeiro login (D19)
CREATE OR REPLACE FUNCTION get_or_create_user(
  p_provider text, p_sub text, p_email text,
  p_email_verified boolean, p_name text, p_avatar text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF NOT p_email_verified THEN
    RAISE EXCEPTION 'email_not_verified' USING ERRCODE = '28000';
  END IF;

  SELECT user_id INTO v_user
    FROM auth_identities
   WHERE provider = p_provider AND provider_user_id = p_sub;
  IF FOUND THEN
    RETURN v_user;
  END IF;

  INSERT INTO users (email, full_name, avatar_url)
  VALUES (lower(p_email), COALESCE(NULLIF(p_name, ''), p_email), p_avatar)
  ON CONFLICT (email) DO NOTHING
  RETURNING id INTO v_user;

  IF v_user IS NULL THEN
    SELECT id INTO v_user FROM users WHERE email = lower(p_email);
  END IF;

  INSERT INTO auth_identities (user_id, provider, provider_user_id)
  VALUES (v_user, p_provider, p_sub)
  ON CONFLICT (provider, provider_user_id) DO NOTHING;

  RETURN v_user;
END $$;

ALTER FUNCTION get_or_create_user(text, text, text, boolean, text, text) OWNER TO devcore_auth;
REVOKE ALL ON FUNCTION get_or_create_user(text, text, text, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_or_create_user(text, text, text, boolean, text, text) TO devcore_app;

-- Contagem global e provisionamento com limite de novos usuários (preservando RLS)
CREATE OR REPLACE FUNCTION get_registered_users_count() RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::int FROM users;
$$;

ALTER FUNCTION get_registered_users_count() OWNER TO devcore_auth;
REVOKE ALL ON FUNCTION get_registered_users_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_registered_users_count() TO devcore_app;

CREATE OR REPLACE FUNCTION get_or_create_user_with_limit(
  p_provider text,
  p_sub text,
  p_email text,
  p_email_verified boolean,
  p_name text,
  p_avatar text,
  p_max_users integer DEFAULT 90
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_total integer;
BEGIN
  IF NOT p_email_verified THEN
    RAISE EXCEPTION 'email_not_verified' USING ERRCODE = '28000';
  END IF;

  SELECT user_id INTO v_user
    FROM auth_identities
   WHERE provider = p_provider AND provider_user_id = p_sub;
  IF FOUND THEN
    RETURN v_user;
  END IF;

  SELECT id INTO v_user
    FROM users
   WHERE email = lower(p_email);
  IF FOUND THEN
    INSERT INTO auth_identities (user_id, provider, provider_user_id)
    VALUES (v_user, p_provider, p_sub)
    ON CONFLICT (provider, provider_user_id) DO NOTHING;
    RETURN v_user;
  END IF;

  PERFORM pg_advisory_xact_lock(74291090);

  IF p_max_users > 0 THEN
    SELECT COUNT(*)::int INTO v_total FROM users;
    IF v_total >= p_max_users THEN
      RAISE EXCEPTION 'registration_limit_reached' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO users (email, full_name, avatar_url)
  VALUES (lower(p_email), COALESCE(NULLIF(p_name, ''), p_email), p_avatar)
  ON CONFLICT (email) DO NOTHING
  RETURNING id INTO v_user;

  IF v_user IS NULL THEN
    SELECT id INTO v_user FROM users WHERE email = lower(p_email);
  END IF;

  INSERT INTO auth_identities (user_id, provider, provider_user_id)
  VALUES (v_user, p_provider, p_sub)
  ON CONFLICT (provider, provider_user_id) DO NOTHING;

  RETURN v_user;
END $$;

ALTER FUNCTION get_or_create_user_with_limit(text, text, text, boolean, text, text, integer) OWNER TO devcore_auth;
REVOKE ALL ON FUNCTION get_or_create_user_with_limit(text, text, text, boolean, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_or_create_user_with_limit(text, text, text, boolean, text, text, integer) TO devcore_app;

-- ----------------------------------------------------------------------------
-- 3. GOOGLE DRIVE CONNECTION & INGESTION
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS google_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT NOT NULL,
    token_scope TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_gc_status CHECK (status IN ('active', 'revoked', 'expired'))
);

CREATE TABLE IF NOT EXISTS drive_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drive_file_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(150) NOT NULL,
    is_folder BOOLEAN NOT NULL DEFAULT false,
    parent_drive_id VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_drive_file UNIQUE (user_id, drive_file_id),
    CONSTRAINT uq_drive_sources_id_user UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS drive_sync_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    start_page_token VARCHAR(255),
    last_synced_at TIMESTAMPTZ,
    sync_status VARCHAR(50) NOT NULL DEFAULT 'idle',
    error_message TEXT,
    CONSTRAINT ck_sync_status CHECK (sync_status IN ('idle', 'syncing', 'error'))
);

CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drive_source_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    mime_type VARCHAR(150) NOT NULL,
    drive_revision_id VARCHAR(255),
    content_hash VARCHAR(64) NOT NULL,
    byte_size BIGINT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    active_parser_version VARCHAR(20),
    error_message TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_documents_status CHECK (status IN ('pending', 'processing', 'indexed', 'inactive', 'failed')),
    CONSTRAINT uq_documents_id_user UNIQUE (id, user_id),
    CONSTRAINT fk_documents_source 
      FOREIGN KEY (drive_source_id, user_id) REFERENCES drive_sources (id, user_id) ON DELETE CASCADE
);

-- ----------------------------------------------------------------------------
-- 4. CHUNKS & EMBEDDINGS (HNSW PARCIAL COM WHERE IS_ACTIVE)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    locator JSONB NOT NULL,
    parser_version VARCHAR(20) NOT NULL,
    tsv_content TSVECTOR GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED,
    tsv_simple TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_chunks_document_user 
      FOREIGN KEY (document_id, user_id) REFERENCES documents(id, user_id) ON DELETE CASCADE,
    CONSTRAINT uq_doc_chunk_version UNIQUE (document_id, chunk_index, parser_version),
    CONSTRAINT uq_chunks_id_user UNIQUE (id, user_id),
    CONSTRAINT uq_chunks_full UNIQUE (id, user_id, document_id, parser_version)
);

CREATE TABLE IF NOT EXISTS document_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chunk_id UUID NOT NULL,
    document_id UUID NOT NULL,
    parser_version VARCHAR(20) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    embedding VECTOR(1536) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_embeddings_chunk 
      FOREIGN KEY (chunk_id, user_id, document_id, parser_version)
      REFERENCES document_chunks (id, user_id, document_id, parser_version) ON DELETE CASCADE,
    CONSTRAINT uq_chunk_model UNIQUE (chunk_id, model_version)
);

CREATE INDEX IF NOT EXISTS idx_chunks_user ON document_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON document_chunks USING GIN(tsv_content);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv_simple ON document_chunks USING GIN(tsv_simple);
CREATE INDEX IF NOT EXISTS idx_emb_filter ON document_embeddings (user_id, model_version, is_active, document_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw_active ON document_embeddings 
    USING hnsw (embedding vector_cosine_ops) 
    WITH (m = 16, ef_construction = 64)
    WHERE is_active;

-- ----------------------------------------------------------------------------
-- 5. ESTRUTURA EDUCACIONAL (VÍNCULOS COM O DRIVE E ROLES)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drive_source_id UUID,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    instructor_name VARCHAR(150),
    thumbnail_url TEXT,
    total_hours NUMERIC(6, 2) DEFAULT 0,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_courses_id_user UNIQUE (id, user_id),
    CONSTRAINT fk_courses_source 
      FOREIGN KEY (drive_source_id, user_id) REFERENCES drive_sources (id, user_id)
      ON DELETE SET NULL (drive_source_id)
);

CREATE TABLE IF NOT EXISTS modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    course_id UUID NOT NULL,
    drive_source_id UUID,
    title VARCHAR(255) NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_modules_id_user UNIQUE (id, user_id),
    CONSTRAINT fk_modules_course 
      FOREIGN KEY (course_id, user_id) REFERENCES courses(id, user_id) ON DELETE CASCADE,
    CONSTRAINT fk_modules_source 
      FOREIGN KEY (drive_source_id, user_id) REFERENCES drive_sources (id, user_id)
      ON DELETE SET NULL (drive_source_id)
);

CREATE TABLE IF NOT EXISTS lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    module_id UUID NOT NULL,
    media_source_id UUID,
    title VARCHAR(255) NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 1,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_lessons_id_user UNIQUE (id, user_id),
    CONSTRAINT fk_lessons_module 
      FOREIGN KEY (module_id, user_id) REFERENCES modules(id, user_id) ON DELETE CASCADE,
    CONSTRAINT fk_lessons_media 
      FOREIGN KEY (media_source_id, user_id) REFERENCES drive_sources (id, user_id)
      ON DELETE SET NULL (media_source_id)
);

CREATE TABLE IF NOT EXISTS lesson_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    lesson_id UUID NOT NULL,
    document_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'resource',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_ld_role CHECK (role IN ('transcript', 'resource', 'code')),
    CONSTRAINT fk_ld_lesson 
      FOREIGN KEY (lesson_id, user_id) REFERENCES lessons(id, user_id) ON DELETE CASCADE,
    CONSTRAINT fk_ld_document 
      FOREIGN KEY (document_id, user_id) REFERENCES documents(id, user_id) ON DELETE CASCADE,
    CONSTRAINT uq_lesson_doc UNIQUE (lesson_id, document_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_transcript_per_lesson
  ON lesson_documents (lesson_id) WHERE role = 'transcript';

CREATE TABLE IF NOT EXISTS lesson_code_anchors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    lesson_id UUID NOT NULL,
    time_seconds INTEGER NOT NULL,
    title VARCHAR(150) NOT NULL,
    code_content TEXT NOT NULL,
    language VARCHAR(50) NOT NULL,
    file_path VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_lca_lesson 
      FOREIGN KEY (lesson_id, user_id) REFERENCES lessons(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS course_tags (
    course_id UUID NOT NULL,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    PRIMARY KEY (course_id, tag_id),
    CONSTRAINT fk_ct_course 
      FOREIGN KEY (course_id, user_id) REFERENCES courses(id, user_id) ON DELETE CASCADE
);

-- ----------------------------------------------------------------------------
-- 6. APRENDIZAGEM DO USUÁRIO & NOTAS PRESERVADAS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT fk_enrollments_course 
      FOREIGN KEY (course_id, user_id) REFERENCES courses(id, user_id) ON DELETE CASCADE,
    CONSTRAINT uq_user_course UNIQUE (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS favorites (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL,
    favorited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, course_id),
    CONSTRAINT fk_favorites_course 
      FOREIGN KEY (course_id, user_id) REFERENCES courses(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lesson_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL,
    last_position_seconds INTEGER NOT NULL DEFAULT 0,
    is_completed BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_lp_lesson 
      FOREIGN KEY (lesson_id, user_id) REFERENCES lessons(id, user_id) ON DELETE CASCADE,
    CONSTRAINT uq_user_lesson UNIQUE (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS lesson_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id UUID,
    time_seconds INTEGER,
    content TEXT NOT NULL,
    lesson_title_snapshot TEXT,
    course_title_snapshot TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_notes_time CHECK (time_seconds IS NULL OR time_seconds >= 0),
    CONSTRAINT fk_notes_lesson 
      FOREIGN KEY (lesson_id, user_id) REFERENCES lessons(id, user_id)
      ON DELETE SET NULL (lesson_id)
);

CREATE TABLE IF NOT EXISTS study_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    study_date DATE NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    events_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_study_date UNIQUE (user_id, study_date)
);

CREATE TABLE IF NOT EXISTS learning_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 7. TRILHAS DE APRENDIZAGEM
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS learning_paths (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    target_role VARCHAR(100) DEFAULT 'Staff / Principal Engineer',
    description TEXT,
    total_hours INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_paths_id_user UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS path_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    learning_path_id UUID NOT NULL,
    milestone_index INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    course_id UUID,
    prerequisite_item_id UUID,
    hours INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_path_items_id_user UNIQUE (id, user_id),
    CONSTRAINT fk_pi_path 
      FOREIGN KEY (learning_path_id, user_id) REFERENCES learning_paths(id, user_id) ON DELETE CASCADE,
    CONSTRAINT fk_pi_course 
      FOREIGN KEY (course_id, user_id) REFERENCES courses(id, user_id)
      ON DELETE SET NULL (course_id),
    CONSTRAINT fk_pi_prereq 
      FOREIGN KEY (prerequisite_item_id, user_id) REFERENCES path_items(id, user_id)
);

CREATE TABLE IF NOT EXISTS path_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    learning_path_id UUID NOT NULL,
    progress_percent NUMERIC(5, 2) DEFAULT 0,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT fk_pe_path 
      FOREIGN KEY (learning_path_id, user_id) REFERENCES learning_paths(id, user_id) ON DELETE CASCADE,
    CONSTRAINT uq_user_path UNIQUE (user_id, learning_path_id)
);

-- ----------------------------------------------------------------------------
-- 8. INTERAÇÕES DE IA & RAG
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id UUID,
    title VARCHAR(255) DEFAULT 'Nova Consulta Técnica',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_conversations_id_user UNIQUE (id, user_id),
    CONSTRAINT fk_conversations_lesson 
      FOREIGN KEY (lesson_id, user_id) REFERENCES lessons(id, user_id)
      ON DELETE SET NULL (lesson_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    conversation_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_messages_id_user UNIQUE (id, user_id),
    CONSTRAINT fk_messages_conversation 
      FOREIGN KEY (conversation_id, user_id) REFERENCES conversations(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS retrieval_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID NOT NULL,
    chunk_id UUID,
    similarity_score NUMERIC(5, 4) NOT NULL,
    rank_position INTEGER NOT NULL,
    cited BOOLEAN NOT NULL DEFAULT false,
    locator_snapshot JSONB,
    document_title_snapshot TEXT,
    drive_revision_id_snapshot TEXT,
    CONSTRAINT fk_rr_message 
      FOREIGN KEY (message_id, user_id) REFERENCES messages(id, user_id) ON DELETE CASCADE,
    CONSTRAINT fk_rr_chunk 
      FOREIGN KEY (chunk_id, user_id) REFERENCES document_chunks(id, user_id)
      ON DELETE SET NULL (chunk_id)
);

CREATE TABLE IF NOT EXISTS lesson_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    lesson_id UUID NOT NULL,
    summary_text TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_ls_lesson 
      FOREIGN KEY (lesson_id, user_id) REFERENCES lessons(id, user_id) ON DELETE CASCADE,
    CONSTRAINT uq_lesson_summary_hash UNIQUE (lesson_id, content_hash)
);

-- ----------------------------------------------------------------------------
-- 9. ÍNDICES DE FK E DESEMPENHO (B.6)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_modules_course        ON modules (course_id);
CREATE INDEX IF NOT EXISTS idx_lessons_module        ON lessons (module_id);
CREATE INDEX IF NOT EXISTS idx_ld_lesson             ON lesson_documents (lesson_id);
CREATE INDEX IF NOT EXISTS idx_ld_document           ON lesson_documents (document_id);
CREATE INDEX IF NOT EXISTS idx_lca_lesson_time       ON lesson_code_anchors (lesson_id, time_seconds);
CREATE INDEX IF NOT EXISTS idx_notes_user_lesson     ON lesson_notes (user_id, lesson_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv         ON messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rr_message            ON retrieval_results (message_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_status ON documents (user_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_source      ON documents (drive_source_id);
CREATE INDEX IF NOT EXISTS idx_pi_path               ON path_items (learning_path_id, milestone_index);

-- ----------------------------------------------------------------------------
-- 10. POLÍTICAS DE ROW LEVEL SECURITY (RLS) COM FORCE
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_consents','google_connections','drive_sources',
    'drive_sync_states','documents','document_chunks','document_embeddings',
    'courses','modules','lessons','lesson_documents','lesson_code_anchors',
    'course_tags','learning_paths','path_items','path_enrollments',
    'enrollments','favorites','lesson_progress','lesson_notes',
    'study_sessions','learning_events','conversations','messages',
    'retrieval_results','lesson_summaries'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id())', t);
  END LOOP;
END $$;

REVOKE INSERT, UPDATE, DELETE ON tags FROM devcore_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO devcore_app;
