import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;

// 根據您的伺服器配置修改帳號密碼
const pool = new Pool({
    user: 'pagesuser',
    host: 'localhost', // 或伺服器的 DB 位址
    database: 'WTCA',
    password: 'P@ssw0rd',
    port: 5432
});

(async () => {
    try {
        const client = await pool.connect();

        // 為了避免測試污染資料庫，使用 Transaction 並在最後 ROLLBACK
        await client.query("BEGIN");

        console.log("=== 測試 1: 傳送 undefined 值 (導致之前報錯的原因) ===");
        try {
            await client.query(
                `INSERT INTO fluctuation_alerts (id, tank_id, tank_name, date_str, reason, current_value) 
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [crypto.randomUUID(), null, 'Test Tank', '2026-03-04', '測試用', undefined] // 帶入 undefined
            );
            console.log("✅ 測試 1 成功");
        } catch (e) {
            console.error("❌ 測試 1 發生錯誤:");
            console.error(e.message);
            console.error("-> 說明: node-postgres(pg) 函式庫嚴格禁止參數傳入 undefined (會拋錯)");
        }

        console.log("\n=== 測試 2: 將 undefined 改為傳送 null 值 (修復後的情況) ===");
        try {
            await client.query(
                `INSERT INTO fluctuation_alerts (id, tank_id, tank_name, date_str, reason, current_value) 
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [crypto.randomUUID(), null, 'Test Tank', '2026-03-04', '測試用', null] // 帶入 null
            );
            console.log("✅ 測試 2 成功 (無錯誤發生，可正常新增紀錄)");
        } catch (e) {
            console.error("❌ 測試 2 發生錯誤:", e.message);
        }

        // 復原所有測試資料，不儲存進資料庫
        await client.query("ROLLBACK");
        client.release();

    } catch (e) {
        console.error('資料庫連線錯誤:', e);
    } finally {
        pool.end();
    }
})();
