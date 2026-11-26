import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

const { Pool } = pg;

export interface DbConfig {
  connectionString: string;
}

export function createDatabasePool(connectionString: string): pg.Pool {
  return new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

/**
 * Cria cliente Drizzle sob o pool fornecido.
 */
export function createDrizzleClient(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

export type DevCoreDb = NodePgDatabase<typeof schema>;

/**
 * Executa uma operação garantindo o contexto multitenant (RLS) dentro de transação.
 * Executa `SELECT set_config('app.current_user_id', $1, true)` de forma segura.
 */
export async function withTenantContext<T>(
  pool: pg.Pool,
  userId: string,
  callback: (db: DevCoreDb) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    const tenantDb = drizzle(client, { schema });
    const result = await callback(tenantDb);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

