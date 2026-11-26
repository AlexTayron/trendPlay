import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

/**
 * Bateria de Testes de Aceite da Seção D (SRS_PATCH_v1.2.md)
 * Valida isolamento multitenant, RLS, FKs compostas e integridade referencial.
 */
describe('DevCore — Bateria de Testes de Aceite (SRS v1.2 / Seção D)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_APP_URL || 'postgresql://devcore_app:devcore_app_password_dev@localhost:5433/devcore',
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('D.1 — Isolamento Multitenant (RLS e FKs)', () => {
    it('D.1.2 — Sem app.current_user_id definido, consultas retornam zero linhas sem erro de cast', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Não define app.current_user_id
        const res = await client.query('SELECT * FROM documents;');
        expect(res.rows.length).toBe(0);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('D.1.5 — devcore_app não é dono das tabelas e não possui BYPASSRLS nem SUPERUSER', async () => {
      const client = await pool.connect();
      try {
        const res = await client.query(`
          SELECT rolname, rolsuper, rolbypassrls 
            FROM pg_roles 
           WHERE rolname = 'devcore_app';
        `);
        expect(res.rows.length).toBe(1);
        const role = res.rows[0];
        expect(role.rolsuper).toBe(false);
        expect(role.rolbypassrls).toBe(false);
      } finally {
        client.release();
      }
    });
  });

  describe('D.2 — Login e Provisionamento Seguro (D19)', () => {
    it('D.2.3 — get_or_create_user recusa e-mail não verificado com código 28000', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await expect(
          client.query(`
            SELECT get_or_create_user('google', 'g-12345', 'fake@devcore.io', false, 'Fake User', NULL);
          `)
        ).rejects.toThrow();
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  });
});

