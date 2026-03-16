import pg from 'pg';
const { Pool } = pg;

// Use the host IP that was seen in check_settings.mjs
const pool = new Pool({
    user: 'pagesuser',
    host: '10.122.51.61',
    database: 'WTCA',
    password: 'P@ssw0rd',
    port: 5432,
    connectionTimeoutMillis: 5000
});

(async () => {
    try {
        console.log("Connecting to database for standardization...");
        const client = await pool.connect();
        
        console.log("1. Standardizing Cooling System...");
        const res1 = await client.query(
            "UPDATE tanks SET system_type = '冷卻水系統' WHERE system_type LIKE '%冷卻%' AND (system_type IS NULL OR system_type != '冷卻水系統')"
        );
        console.log(`Updated ${res1.rowCount} tanks to '冷卻水系統'`);

        console.log("2. Standardizing Boiler System...");
        const res2 = await client.query(
            "UPDATE tanks SET system_type = '鍋爐水系統' WHERE system_type LIKE '%鍋爐%' AND (system_type IS NULL OR system_type != '鍋爐水系統')"
        );
        console.log(`Updated ${res2.rowCount} tanks to '鍋爐水系統'`);

        client.release();
    } catch (e) {
        console.error('Standardization Error:', e.message);
    } finally {
        await pool.end();
    }
})();
