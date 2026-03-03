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
        // 1. 確認資料表是否存在
        const tableCheck = await pool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('fluctuation_alerts', 'important_notes')
        `);
        console.log('=== 存在的資料表 ===');
        console.log(JSON.stringify(tableCheck.rows));

        // 2. 確認 fluctuation_alerts 欄位結構
        const colCheck = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'fluctuation_alerts' 
            ORDER BY ordinal_position
        `);
        console.log('\n=== fluctuation_alerts 欄位 ===');
        colCheck.rows.forEach(r => console.log(JSON.stringify(r)));

        // 3. 嘗試一筆測試插入
        const crypto = (await import('crypto')).default;
        const testInsert = await pool.query(
            `INSERT INTO fluctuation_alerts (id, tank_id, tank_name, date_str, reason, current_value, prev_value, next_value, is_possible_refill, source, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [crypto.randomUUID(), 'TEST_TANK', 'TEST', '2026-02-26', 'TEST_REASON', 50.0, 60.0, null, false, 'IMPORT', '']
        );
        console.log('\n=== 測試插入成功 ===', testInsert.rows[0]);

        // 刪除測試資料
        await pool.query(`DELETE FROM fluctuation_alerts WHERE tank_id = 'TEST_TANK'`);
        console.log('測試資料已刪除');
    } catch (err) {
        console.error('\n=== 錯誤 ===');
        console.error('Code:', err.code);
        console.error('Message:', err.message);
        console.error('Detail:', err.detail);
    } finally {
        await pool.end();
    }
}

main();
