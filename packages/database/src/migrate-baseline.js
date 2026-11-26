const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function waitForPostgres(maxAttempts = 15, delayMs = 2000) {
  const adminUrl = process.env.DATABASE_ADMIN_URL || 'postgresql://devcore_admin:devcore_secure_password_dev@127.0.0.1:5433/devcore';
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = new Client({ connectionString: adminUrl });
    try {
      console.log(`[DB Migration] Conectando ao PostgreSQL (tentativa ${attempt}/${maxAttempts})...`);
      await client.connect();
      console.log('[DB Migration] Conexão estabelecida com sucesso!');
      return client;
    } catch (err) {
      console.warn(`[DB Migration] Tentativa ${attempt} falhou: ${err.message}`);
      await client.end().catch(() => {});
      if (attempt === maxAttempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function run() {
  const client = await waitForPostgres();
  try {
    const sqlPath = path.resolve(__dirname, '../migrations/0000_baseline_patch.sql');
    console.log(`[DB Migration] Lendo migration: ${sqlPath}`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('[DB Migration] Executando migration DDL baseline...');
    await client.query(sql);
    console.log('[DB Migration] Migration executada com sucesso!');

    // Testar se as roles existem
    const rolesRes = await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('devcore_app', 'devcore_auth');");
    console.log('[DB Migration] Roles configuradas:', rolesRes.rows.map(r => r.rolname));

    // Testar se a tabela users tem RLS ativo
    const rlsRes = await client.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'users';");
    console.log('[DB Migration] Status RLS na tabela users:', rlsRes.rows[0]);
  } catch (error) {
    console.error('[DB Migration] Erro na execução da migration:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
