-- ============================================================================
-- DevCore — Limite global de cadastros (padrão 90 usuários) preservando RLS
-- Aplicável de forma idempotente em bancos novos ou já existentes.
-- ============================================================================

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

  -- 1. Usuário já existente pelo provider_user_id sempre pode entrar
  SELECT user_id INTO v_user
    FROM auth_identities
   WHERE provider = p_provider AND provider_user_id = p_sub;
  IF FOUND THEN
    RETURN v_user;
  END IF;

  -- 2. Usuário já existente pelo e-mail sempre pode entrar
  SELECT id INTO v_user
    FROM users
   WHERE email = lower(p_email);
  IF FOUND THEN
    INSERT INTO auth_identities (user_id, provider, provider_user_id)
    VALUES (v_user, p_provider, p_sub)
    ON CONFLICT (provider, provider_user_id) DO NOTHING;
    RETURN v_user;
  END IF;

  -- 3. Novo cadastro: serializa com advisory lock para evitar condição de corrida
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
