import pg from 'pg';
const { Client } = pg;

// 設定資料庫連線資訊
// 請修改以下的連線設定以符合您的環境
const client = new Client({
    user: 'pagesuser',      // 資料庫使用者名稱
    host: 'localhost',     // 資料庫主機 (通常是 localhost)
    database: 'WTCA',   // 資料庫名稱 (請先手動建立此資料庫: CREATE DATABASE wtca_db;)
    password: 'P@ssw0rd',  // 資料庫密碼
    port: 5432,            // PostgreSQL預設埠號
});

const createTablesSQL = `
-- A. 儲槽基本資料 (Tanks)
CREATE TABLE IF NOT EXISTS tanks (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    system_type VARCHAR(50) NOT NULL,
    capacity_liters NUMERIC(10, 2) NOT NULL,
    geo_factor NUMERIC(10, 4) NOT NULL,
    description TEXT,
    safe_min_level NUMERIC(5, 2) DEFAULT 20.0,
    target_daily_usage NUMERIC(10, 2),
    calculation_method VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_tanks_system ON tanks(system_type);

-- B. 藥劑合約/供應商 (Chemical Supplies)
CREATE TABLE IF NOT EXISTS chemical_supplies (
    id VARCHAR(50) PRIMARY KEY,
    tank_id VARCHAR(50) NOT NULL REFERENCES tanks(id),
    supplier_name VARCHAR(100) NOT NULL,
    chemical_name VARCHAR(100),
    specific_gravity NUMERIC(6, 4) NOT NULL,
    price NUMERIC(10, 2),
    start_date BIGINT NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplies_tank ON chemical_supplies(tank_id);

-- C. 液位抄表紀錄 (Readings)
CREATE TABLE IF NOT EXISTS readings (
    id VARCHAR(50) PRIMARY KEY,
    tank_id VARCHAR(50) NOT NULL REFERENCES tanks(id),
    timestamp BIGINT NOT NULL,
    level_cm NUMERIC(10, 2) NOT NULL,
    calculated_volume NUMERIC(10, 2) NOT NULL,
    calculated_weight_kg NUMERIC(10, 2) NOT NULL,
    applied_sg NUMERIC(6, 4) NOT NULL,
    supply_id VARCHAR(50) REFERENCES chemical_supplies(id),
    added_amount_liters NUMERIC(10, 2) DEFAULT 0,
    operator_name VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_readings_tank_time ON readings(tank_id, timestamp DESC);

-- D. 冷卻水參數 (CWS Parameters)
CREATE TABLE IF NOT EXISTS cws_parameters (
    tank_id VARCHAR(50) PRIMARY KEY REFERENCES tanks(id),
    circulation_rate NUMERIC(10, 2),
    temp_outlet NUMERIC(5, 2),
    temp_return NUMERIC(5, 2),
    temp_diff NUMERIC(5, 2),
    cws_hardness NUMERIC(10, 2),
    makeup_hardness NUMERIC(10, 2),
    concentration_cycles NUMERIC(5, 2),
    target_ppm NUMERIC(10, 2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- E. 鍋爐水參數 (BWS Parameters)
CREATE TABLE IF NOT EXISTS bws_parameters (
    tank_id VARCHAR(50) PRIMARY KEY REFERENCES tanks(id),
    steam_production NUMERIC(10, 2),
    target_ppm NUMERIC(10, 2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

async function initDB() {
    try {
        await client.connect();
        console.log('成功連線至資料庫...');

        console.log('開始建立表格...');
        await client.query(createTablesSQL);

        console.log('所有表格建立完成！');
    } catch (err) {
        console.error('資料庫初始化失敗:', err);
    } finally {
        await client.end();
    }
}

initDB();
