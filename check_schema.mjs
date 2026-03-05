import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    user: 'pagesuser',
    host: 'localhost',
    database: 'WTCA',
    password: 'P@ssw0rd',
    port: 5432
});

(async () => {
    try {
        const client = await pool.connect();
        const res = await client.query("SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_name = 'fluctuation_alerts'");
        console.table(res.rows);
        client.release();
    } catch (e) {
        console.error('Insert Error:', e);
    } finally {
        pool.end();
    }
})();
