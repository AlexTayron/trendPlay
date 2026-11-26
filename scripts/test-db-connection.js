const { Client } = require('pg');

async function testConnection() {
  const adminUrl = process.env.DATABASE_ADMIN_URL || 'postgresql://devcore_admin:devcore_secure_password_dev@127.0.0.1:5433/devcore';
  console.log('[Test DB] Testando conexão com:', adminUrl.replace(/:[^:]*@/, ':****@'));
  
  for (let i = 1; i <= 20; i++) {
    const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 2000 });
    try {
      await client.connect();
      console.log(`[Test DB] Conectado com sucesso na tentativa ${i}!`);
      const res = await client.query('SELECT version();');
      console.log('[Test DB] PostgreSQL Version:', res.rows[0].version);
      
      // Checar tabelas existentes
      const tables = await client.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' ORDER BY table_name;
      `);
      console.log(`[Test DB] Tabelas encontradas (${tables.rows.length}):`, tables.rows.map(t => t.table_name).join(', '));
      
      await client.end();
      return true;
    } catch (e) {
      console.log(`[Test DB] Tentativa ${i}/20: ${e.code || e.message}`);
      await client.end().catch(() => {});
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

testConnection().then(ok => {
  if (!ok) process.exit(1);
});
