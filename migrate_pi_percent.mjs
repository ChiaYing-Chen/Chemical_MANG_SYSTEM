import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
    user: 'pagesuser',
    host: 'localhost',
    database: 'WTCA',
    password: 'P@ssw0rd',
    port: 5432
});

async function main() {
    try {
        await pool.query("ALTER TABLE tanks ADD COLUMN IF NOT EXISTS pi_percent_factor NUMERIC(10,4) DEFAULT NULL");
        console.log('OK: column added');

        const check = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='tanks' AND column_name='pi_percent_factor'");
        console.log('Verify:', JSON.stringify(check.rows));
    } catch (err) {
        console.error('Code:', err.code);
        console.error('Message:', err.message);
    } finally {
        await pool.end();
    }
}
main();
