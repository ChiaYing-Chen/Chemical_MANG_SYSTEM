import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
    user: 'pagesuser',
    host: '10.122.51.61',
    database: 'WTCA',
    password: 'P@ssw0rd',
    port: 5432,
});
async function run() {
    try {
        const createRes = await pool.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value JSONB,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log("Create table OK", createRes.command);

        console.log("Adding updated_at column to app_settings...");
        await pool.query(`
            ALTER TABLE app_settings 
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
        `);
        console.log("Column updated_at added or already exists.");

        const insertRes = await pool.query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            ['testKey', JSON.stringify({ a: 1 })]
        );
        console.log("Insert OK", insertRes.command);
    } catch (e) {
        console.error("Caught error:", e);
    } finally {
        await pool.end();
    }
}
run();
