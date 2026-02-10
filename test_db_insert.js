import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    user: 'pagesuser',
    host: '::1',
    database: 'WTCA',
    password: 'P@ssw0rd',
    port: 5432
});

(async () => {
    try {
        const client = await pool.connect();
        console.log('Connected');
        const insertRes = await client.query(
            "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value RETURNING *",
            ['test_key', { foo: "bar" }]
        );
        console.log('Insert success:', insertRes.rows[0]);
        client.release();
    } catch (e) {
        console.error('Insert Error:', e);
    } finally {
        pool.end();
    }
})();
