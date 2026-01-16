import express from 'express';
import pg from 'pg';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

const { Pool } = pg;
const app = express();
const PORT = 3003;

// 中介軟體
app.use(cors());
app.use(express.json());

// 處理 IIS 子目錄路徑：將 /WTCA/... 重定向到 /...
app.use((req, res, next) => {
    if (req.url.startsWith('/WTCA/')) {
        req.url = req.url.substring(5); // 移除 '/WTCA'
    }
    next();
});

// PostgreSQL 連線池
const pool = new Pool({
    user: 'pagesuser',
    host: 'localhost',
    database: 'WTCA',
    password: 'P@ssw0rd',
    port: 5432,
});

// MCP 連線儲存
const mcpTransports = new Map();
const mcpServers = new Map();

// ==================== 首頁與靜態檔案 ====================

// 提供前端構建後的靜態檔案
app.use(express.static('dist'));

// 根路徑 - 如果 dist/index.html 存在則提供，否則顯示 API 資訊頁面
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distIndexPath = join(__dirname, 'dist', 'index.html');

app.get('/', (req, res) => {
    // 檢查是否有構建的前端
    if (existsSync(distIndexPath)) {
        res.sendFile(distIndexPath);
        return;
    }

    // 否則顯示 API 資訊頁面
    res.send(`
        <!DOCTYPE html>
        <html lang="zh-TW">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>WTCA 化學品管理系統 API</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                .container {
                    background: white;
                    border-radius: 16px;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    max-width: 800px;
                    width: 100%;
                    padding: 40px;
                }
                h1 {
                    color: #667eea;
                    margin-bottom: 10px;
                    font-size: 2em;
                }
                .subtitle {
                    color: #666;
                    margin-bottom: 30px;
                    font-size: 1.1em;
                }
                .status {
                    display: inline-block;
                    background: #10b981;
                    color: white;
                    padding: 8px 16px;
                    border-radius: 20px;
                    font-size: 0.9em;
                    margin-bottom: 30px;
                }
                .section {
                    margin-bottom: 30px;
                }
                .section h2 {
                    color: #333;
                    margin-bottom: 15px;
                    font-size: 1.3em;
                    border-bottom: 2px solid #667eea;
                    padding-bottom: 10px;
                }
                .endpoint {
                    background: #f8f9fa;
                    padding: 12px 16px;
                    margin-bottom: 10px;
                    border-radius: 8px;
                    border-left: 4px solid #667eea;
                }
                .endpoint code {
                    color: #667eea;
                    font-family: 'Courier New', monospace;
                    font-weight: bold;
                }
                .endpoint .desc {
                    color: #666;
                    margin-top: 5px;
                    font-size: 0.9em;
                }
                .info-box {
                    background: #eff6ff;
                    border: 1px solid #bfdbfe;
                    border-radius: 8px;
                    padding: 15px;
                    margin-top: 20px;
                }
                .info-box strong {
                    color: #1e40af;
                }
                a {
                    color: #667eea;
                    text-decoration: none;
                }
                a:hover {
                    text-decoration: underline;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🧪 WTCA 化學品管理系統</h1>
                <div class="subtitle">Water Treatment Chemical Analysis System</div>
                <span class="status">✓ 系統運行中</span>
                
                <div class="section">
                    <h2>📡 API 端點</h2>
                    <div class="endpoint">
                        <code>GET /api/health</code>
                        <div class="desc">健康檢查與資料庫連線狀態</div>
                    </div>
                    <div class="endpoint">
                        <code>GET /api/tanks</code>
                        <div class="desc">取得所有儲槽資料</div>
                    </div>
                    <div class="endpoint">
                        <code>GET /api/readings</code>
                        <div class="desc">取得液位抄表紀錄</div>
                    </div>
                    <div class="endpoint">
                        <code>GET /api/supplies</code>
                        <div class="desc">取得藥劑合約資料</div>
                    </div>
                </div>

                <div class="section">
                    <h2>🔌 MCP Server</h2>
                    <p>本系統提供 Model Context Protocol (MCP) 介面，可透過 Antigravity 查詢資料庫。</p>
                    <div class="info-box">
                        <strong>連線端點:</strong> <code>/mcp-connect/[token]</code><br>
                        <strong>可用工具:</strong> query-tanks, query-readings, query-supplies, execute-sql, get-database-stats
                    </div>
                </div>

                <div class="section">
                    <h2>📚 文件</h2>
                    <p>
                        <a href="/api/health" target="_blank">測試 API 健康狀態</a>
                    </p>
                </div>
                
                <div style="margin-top: 40px; text-align: center; color: #999; font-size: 0.9em;">
                    WTCA Backend Server v1.0.0 | Port ${PORT}
                </div>
            </div>
        </body>
        </html>
    `);
});

// ==================== Tank APIs ====================

// 取得所有儲槽
app.get('/api/tanks', async (req, res) => {
    try {
        // 簡化查詢：先只讀取 tanks 表，避免 cws_params/bws_params 表不存在時出錯
        const result = await pool.query(`
      SELECT * FROM tanks ORDER BY sort_order ASC, name ASC
    `);

        // 嘗試為每個 tank 加載 CWS/BWS 參數（如果表存在）
        const tanksWithParams = await Promise.all(result.rows.map(async (tank) => {
            let cws_params = null;
            let bws_params = null;

            try {
                if (tank.calculation_method === 'CWS_BLOWDOWN') {
                    const cwsResult = await pool.query(
                        'SELECT * FROM cws_parameters WHERE tank_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1',
                        [tank.id]
                    );
                    cws_params = cwsResult.rows[0] || null;
                }
            } catch (e) {
                // cws_parameters 表可能不存在或欄位不存在，忽略錯誤
                console.error('CWS params fetch error:', e.message);
            }

            try {
                if (tank.calculation_method === 'BWS_STEAM') {
                    const bwsResult = await pool.query(
                        'SELECT * FROM bws_parameters WHERE tank_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1',
                        [tank.id]
                    );
                    bws_params = bwsResult.rows[0] || null;
                }
            } catch (e) {
                // bws_parameters 表可能不存在或欄位不存在，忽略錯誤
                console.error('BWS params fetch error:', e.message);
            }


            return { ...tank, cws_params, bws_params };
        }));

        res.json(tanksWithParams);
    } catch (err) {
        console.error('GET /api/tanks error:', err);
        res.status(500).json({ error: '取得儲槽資料失敗', details: err.message });
    }
});

// ... (GET /api/tanks/:id kept as is, user instruction implies just list order and update matters mostly, but consistency is good. Skipping single get update for brevity if not strictly needed, but let's stick to the plan)

// 批量更新排序
app.put('/api/tanks-reorder', async (req, res) => {
    const client = await pool.connect();
    try {
        const { updates } = req.body; // Array of { id, sort_order }
        await client.query('BEGIN');

        for (const item of updates) {
            await client.query(
                'UPDATE tanks SET sort_order = $1 WHERE id = $2',
                [item.sort_order, item.id]
            );
        }

        await client.query('COMMIT');
        res.json({ message: '排序更新成功' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: '排序更新失敗' });
    } finally {
        client.release();
    }
});

// 取得單一儲槽
app.get('/api/tanks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM tanks WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到此儲槽' });
        }

        const tank = result.rows[0];
        let cws_params = null;
        let bws_params = null;

        try {
            if (tank.calculation_method === 'CWS_BLOWDOWN') {
                const cwsResult = await pool.query(
                    'SELECT * FROM cws_parameters WHERE tank_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1',
                    [tank.id]
                );
                cws_params = cwsResult.rows[0] || null;
            }
        } catch (e) { /* ignore */ }

        try {
            if (tank.calculation_method === 'BWS_STEAM') {
                const bwsResult = await pool.query(
                    'SELECT * FROM bws_parameters WHERE tank_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1',
                    [tank.id]
                );
                bws_params = bwsResult.rows[0] || null;
            }
        } catch (e) { /* ignore */ }

        res.json({ ...tank, cws_params, bws_params });
    } catch (err) {
        console.error('GET /api/tanks/:id error:', err);
        res.status(500).json({ error: '取得儲槽資料失敗', details: err.message });
    }
});

// 新增儲槽
app.post('/api/tanks', async (req, res) => {
    try {
        const { id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, target_daily_usage, calculation_method, sort_order } = req.body;
        const result = await pool.query(
            `INSERT INTO tanks (id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, target_daily_usage, calculation_method, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [id, name, system_type, capacity_liters, geo_factor, description, safe_min_level || 20.0, target_daily_usage, calculation_method, sort_order || 0]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '新增儲槽失敗' });
    }
});

// 更新儲槽
app.put('/api/tanks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, system_type, capacity_liters, geo_factor, description, safe_min_level, target_daily_usage, calculation_method, sort_order } = req.body;
        const result = await pool.query(
            `UPDATE tanks SET name=$2, system_type=$3, capacity_liters=$4, geo_factor=$5, description=$6, 
       safe_min_level=$7, target_daily_usage=$8, calculation_method=$9, sort_order=$10
       WHERE id=$1 RETURNING *`,
            [id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, target_daily_usage, calculation_method, sort_order || 0]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到此儲槽' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '更新儲槽失敗' });
    }
});

// 刪除儲槽
app.delete('/api/tanks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'DELETE FROM tanks WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到此儲槽' });
        }
        res.json({ message: '儲槽已刪除', deleted: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '刪除儲槽失敗' });
    }
});

// 批次儲槽更新/新增
app.post('/api/tanks/batch', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const tanks = req.body;
        const results = [];


        for (const tank of tanks) {
            const { id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, sort_order, calculation_method, cws_params, bws_params } = tank;

            // Upsert tank
            const tankResult = await client.query(
                `INSERT INTO tanks (id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, sort_order, calculation_method)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    system_type = EXCLUDED.system_type,
                    capacity_liters = EXCLUDED.capacity_liters,
                    geo_factor = EXCLUDED.geo_factor,
                    description = EXCLUDED.description,
                    safe_min_level = EXCLUDED.safe_min_level,
                    sort_order = EXCLUDED.sort_order,
                    calculation_method = EXCLUDED.calculation_method
                 RETURNING *`,
                [id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, sort_order, calculation_method]
            );

            // Handle params
            if (calculation_method === 'CWS_BLOWDOWN' && cws_params) {
                await client.query(
                    `INSERT INTO cws_parameters (tank_id, circulation_rate, temp_diff, concentration_cycles, target_ppm, date)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (tank_id) DO UPDATE SET
                        circulation_rate = EXCLUDED.circulation_rate,
                        temp_diff = EXCLUDED.temp_diff,
                        concentration_cycles = EXCLUDED.concentration_cycles,
                        target_ppm = EXCLUDED.target_ppm,
                        date = EXCLUDED.date`,
                    [id, cws_params.circulation_rate, cws_params.temp_diff, cws_params.concentration_cycles, cws_params.target_ppm, cws_params.date || Date.now()]
                );
            } else if (calculation_method === 'BWS_STEAM' && bws_params) {
                await client.query(
                    `INSERT INTO bws_parameters (tank_id, steam_production, target_ppm, date)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (tank_id) DO UPDATE SET
                        steam_production = EXCLUDED.steam_production,
                        target_ppm = EXCLUDED.target_ppm,
                        date = EXCLUDED.date`,
                    [id, bws_params.steam_production, bws_params.target_ppm, bws_params.date || Date.now()]
                );
            }
            results.push(tankResult.rows[0]);
        }

        await client.query('COMMIT');
        res.json({ message: `成功處理 ${results.length} 個儲槽`, results });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: '批次處理儲槽失敗' });
    } finally {
        client.release();
    }
});

// ==================== Reading APIs ====================

// 取得所有液位紀錄 (可選擇性依 tankId 篩選)
app.get('/api/readings', async (req, res) => {
    try {
        const { tankId } = req.query;
        let query = 'SELECT * FROM readings';
        const params = [];

        if (tankId) {
            query += ' WHERE tank_id = $1';
            params.push(tankId);
        }

        query += ' ORDER BY timestamp DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '取得液位紀錄失敗' });
    }
});

// 新增液位紀錄
app.post('/api/readings', async (req, res) => {
    try {
        const { id, tank_id, timestamp, level_cm, calculated_volume, calculated_weight_kg, applied_sg, supply_id, added_amount_liters, operator_name } = req.body;
        const result = await pool.query(
            `INSERT INTO readings (id, tank_id, timestamp, level_cm, calculated_volume, calculated_weight_kg, applied_sg, supply_id, added_amount_liters, operator_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [id, tank_id, timestamp, level_cm, calculated_volume, calculated_weight_kg, applied_sg, supply_id, added_amount_liters || 0, operator_name]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '新增液位紀錄失敗' });
    }
});

// 更新液位紀錄
app.put('/api/readings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { timestamp, level_cm, calculated_volume, calculated_weight_kg, applied_sg, supply_id, added_amount_liters, operator_name } = req.body;
        const result = await pool.query(
            `UPDATE readings SET 
                timestamp = $1, 
                level_cm = $2, 
                calculated_volume = $3, 
                calculated_weight_kg = $4, 
                applied_sg = $5, 
                supply_id = $6, 
                added_amount_liters = $7, 
                operator_name = $8
             WHERE id = $9 RETURNING *`,
            [timestamp, level_cm, calculated_volume, calculated_weight_kg, applied_sg, supply_id, added_amount_liters || 0, operator_name, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到該液位紀錄' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '更新液位紀錄失敗' });
    }
});

// 刪除液位紀錄
app.delete('/api/readings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM readings WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到該液位紀錄' });
        }
        res.json({ message: '液位紀錄已刪除' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '刪除液位紀錄失敗' });
    }
});

// 批次新增液位紀錄
app.post('/api/readings/batch', async (req, res) => {
    const client = await pool.connect();
    try {
        const { readings } = req.body;
        await client.query('BEGIN');

        const results = [];
        for (const reading of readings) {
            const { id, tank_id, timestamp, level_cm, calculated_volume, calculated_weight_kg, applied_sg, supply_id, added_amount_liters, operator_name } = reading;

            // 使用 upsert 邏輯: 如果 ID 存在則更新，否則新增
            const result = await client.query(
                `INSERT INTO readings (id, tank_id, timestamp, level_cm, calculated_volume, calculated_weight_kg, applied_sg, supply_id, added_amount_liters, operator_name)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 ON CONFLICT (id) DO UPDATE SET
                    timestamp = EXCLUDED.timestamp,
                    level_cm = EXCLUDED.level_cm,
                    calculated_volume = EXCLUDED.calculated_volume,
                    calculated_weight_kg = EXCLUDED.calculated_weight_kg,
                    applied_sg = EXCLUDED.applied_sg,
                    supply_id = EXCLUDED.supply_id,
                    added_amount_liters = EXCLUDED.added_amount_liters,
                    operator_name = EXCLUDED.operator_name
                 RETURNING *`,
                [id, tank_id, timestamp, level_cm, calculated_volume, calculated_weight_kg, applied_sg, supply_id, added_amount_liters || 0, operator_name]
            );
            results.push(result.rows[0]);
        }

        await client.query('COMMIT');
        res.status(201).json({ count: results.length, data: results });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: '批次新增液位紀錄失敗' });
    } finally {
        client.release();
    }
});

// ==================== Database Schema Migration ====================
const migrateDatabase = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log('Checking database schema for history support...');

        // 1. CWS Parameters Migration
        // Check if id column exists
        const cwsIdCheck = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'cws_parameters' AND column_name = 'id'
        `);
        if (cwsIdCheck.rows.length === 0) {
            console.log('Adding ID column to cws_parameters...');
            await client.query('ALTER TABLE cws_parameters ADD COLUMN id UUID DEFAULT gen_random_uuid() PRIMARY KEY');
        }

        // Drop UNIQUE constraint on tank_id if exists (to allow multiple records per tank)
        const cwsConstraint = await client.query(`
            SELECT conname FROM pg_constraint 
            WHERE conrelid = 'cws_parameters'::regclass AND contype = 'u'
        `);
        for (const row of cwsConstraint.rows) {
            console.log(`Dropping constraint ${row.conname} from cws_parameters...`);
            await client.query(`ALTER TABLE cws_parameters DROP CONSTRAINT "${row.conname}"`);
        }

        // Ensure date column exists (some old versions might use different name)
        await client.query('ALTER TABLE cws_parameters ADD COLUMN IF NOT EXISTS date BIGINT');
        // Ensure updated_at column exists for tie-breaking on same date
        await client.query('ALTER TABLE cws_parameters ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');


        // 2. BWS Parameters Migration
        // Check if id column exists
        const bwsIdCheck = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'bws_parameters' AND column_name = 'id'
        `);
        if (bwsIdCheck.rows.length === 0) {
            console.log('Adding ID column to bws_parameters...');
            await client.query('ALTER TABLE bws_parameters ADD COLUMN id UUID DEFAULT gen_random_uuid() PRIMARY KEY');
        }

        // Drop UNIQUE constraint on tank_id in bws_parameters
        const bwsConstraint = await client.query(`
            SELECT conname FROM pg_constraint 
            WHERE conrelid = 'bws_parameters'::regclass AND contype = 'u'
        `);
        for (const row of bwsConstraint.rows) {
            console.log(`Dropping constraint ${row.conname} from bws_parameters...`);
            await client.query(`ALTER TABLE bws_parameters DROP CONSTRAINT "${row.conname}"`);
        }

        // Ensure date column exists
        await client.query('ALTER TABLE bws_parameters ADD COLUMN IF NOT EXISTS date BIGINT');
        // Ensure updated_at column exists
        await client.query('ALTER TABLE bws_parameters ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

        await client.query('COMMIT');
        console.log('Database migration completed.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', err);
    } finally {
        client.release();
    }
};

// Run migration on startup
migrateDatabase();


// ==================== Chemical Supply APIs ====================

// 取得所有藥劑合約
app.get('/api/supplies', async (req, res) => {
    try {
        const { tankId } = req.query;
        let query = 'SELECT * FROM chemical_supplies';
        const params = [];

        if (tankId) {
            query += ' WHERE tank_id = $1';
            params.push(tankId);
        }

        query += ' ORDER BY start_date DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '取得藥劑合約失敗' });
    }
});

// 新增藥劑合約
app.post('/api/supplies', async (req, res) => {
    try {
        const { id, tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes } = req.body;
        const result = await pool.query(
            `INSERT INTO chemical_supplies (id, tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [id || crypto.randomUUID(), tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '新增藥劑合約失敗' });
    }
});

// 更新藥劑合約 (新增)
app.put('/api/supplies/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { supplier_name, chemical_name, specific_gravity, price, start_date, notes } = req.body;
        const result = await pool.query(
            `UPDATE chemical_supplies SET 
                supplier_name = $1, 
                chemical_name = $2, 
                specific_gravity = $3, 
                price = $4, 
                start_date = $5, 
                notes = $6
             WHERE id = $7 RETURNING *`,
            [supplier_name, chemical_name, specific_gravity, price, start_date, notes, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到此合約紀錄' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '更新藥劑合約失敗' });
    }
});

// 批次新增藥劑合約
app.post('/api/supplies/batch', async (req, res) => {
    const client = await pool.connect();
    try {
        const { supplies } = req.body;
        await client.query('BEGIN');

        const results = [];
        for (const supply of supplies) {
            const { id, tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes } = supply;
            const result = await client.query(
                `INSERT INTO chemical_supplies (id, tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                [id || crypto.randomUUID(), tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes]
            );
            results.push(result.rows[0]);
        }

        await client.query('COMMIT');
        res.status(201).json({ count: results.length, data: results });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: '批次新增藥劑合約失敗' });
    } finally {
        client.release();
    }
});

// 刪除藥劑合約
app.delete('/api/supplies/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'DELETE FROM chemical_supplies WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到此合約紀錄' });
        }
        res.json({ message: '合約紀錄已刪除', deleted: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '刪除藥劑合約失敗' });
    }
});

// ==================== CWS Parameter APIs ====================

// 取得冷卻水參數 (取得最新的一筆，維持向後兼容)
app.get('/api/cws-params/:tankId', async (req, res) => {
    try {
        const { tankId } = req.params;
        // Modified to get latest by date
        const result = await pool.query('SELECT * FROM cws_parameters WHERE tank_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1', [tankId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到此儲槽的冷卻水參數' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '取得冷卻水參數失敗' });
    }
});

// 取得冷卻水參數歷史列表 (新 API)
app.get('/api/cws-params/history/:tankId', async (req, res) => {
    try {
        const { tankId } = req.params;
        const result = await pool.query('SELECT * FROM cws_parameters WHERE tank_id = $1 ORDER BY updated_at DESC NULLS LAST', [tankId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '取得冷卻水參數歷史失敗' });
    }
});

// 新增冷卻水參數 (Create New History Record)
app.post('/api/cws-params', async (req, res) => {
    try {
        const { tank_id, circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles, target_ppm, date } = req.body;
        const entryDate = date || Date.now();

        // Fetch all dates for this tank to find same-day collisions
        // Because timestamps might differ slightly (ms), we check calendar day in JS
        const existing = await pool.query('SELECT id, date FROM cws_parameters WHERE tank_id = $1', [tank_id]);

        const entryDateObj = new Date(Number(entryDate));
        const sameDayIds = existing.rows.filter(r => {
            const rDate = new Date(Number(r.date));
            return rDate.getFullYear() === entryDateObj.getFullYear() &&
                rDate.getMonth() === entryDateObj.getMonth() &&
                rDate.getDate() === entryDateObj.getDate();
        }).map(r => r.id);

        // Delete ALL existing records for this day (Clean up duplicates and Prepare for Overwrite)
        if (sameDayIds.length > 0) {
            await pool.query('DELETE FROM cws_parameters WHERE id = ANY($1)', [sameDayIds]);
        }

        // Always Insert new record
        const result = await pool.query(
            `INSERT INTO cws_parameters (id, tank_id, circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles, target_ppm, date)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
            [tank_id, circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles, target_ppm, entryDate]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '儲存冷卻水參數失敗' });
    }
});

// 更新單筆冷卻水參數
app.put('/api/cws-params/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles, target_ppm, date } = req.body;
        const result = await pool.query(
            `UPDATE cws_parameters SET 
                circulation_rate = $1, 
                temp_outlet = $2, 
                temp_return = $3, 
                temp_diff = $4, 
                cws_hardness = $5, 
                makeup_hardness = $6, 
                concentration_cycles = $7, 
                target_ppm = $8,
                date = $9
             WHERE id = $10 RETURNING *`,
            [circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles, target_ppm, date, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '找不到紀錄' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '更新冷卻水參數失敗' });
    }
});

// 刪除冷卻水參數
app.delete('/api/cws-params/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM cws_parameters WHERE id = $1', [id]);
        res.json({ message: '已刪除' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '刪除失敗' });
    }
});


// ==================== BWS Parameter APIs ====================

// 取得鍋爐水參數 (最新)
app.get('/api/bws-params/:tankId', async (req, res) => {
    try {
        const { tankId } = req.params;
        const result = await pool.query('SELECT * FROM bws_parameters WHERE tank_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1', [tankId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到此儲槽的鍋爐水參數' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '取得鍋爐水參數失敗' });
    }
});

// 取得鍋爐水參數歷史 (列表)
app.get('/api/bws-params/history/:tankId', async (req, res) => {
    try {
        const { tankId } = req.params;
        const result = await pool.query('SELECT * FROM bws_parameters WHERE tank_id = $1 ORDER BY updated_at DESC NULLS LAST', [tankId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '取得鍋爐水參數歷史失敗' });
    }
});

// 新增鍋爐水參數
app.post('/api/bws-params', async (req, res) => {
    try {
        const { tank_id, steam_production, target_ppm, date } = req.body;
        const entryDate = date || Date.now();

        // Fetch all dates for this tank to find same-day collisions
        const existing = await pool.query('SELECT id, date FROM bws_parameters WHERE tank_id = $1', [tank_id]);

        const entryDateObj = new Date(Number(entryDate));
        const sameDayIds = existing.rows.filter(r => {
            const rDate = new Date(Number(r.date));
            return rDate.getFullYear() === entryDateObj.getFullYear() &&
                rDate.getMonth() === entryDateObj.getMonth() &&
                rDate.getDate() === entryDateObj.getDate();
        }).map(r => r.id);

        // Delete ALL existing records for this day (Clean up duplicates and Prepare for Overwrite)
        if (sameDayIds.length > 0) {
            await pool.query('DELETE FROM bws_parameters WHERE id = ANY($1)', [sameDayIds]);
        }

        // Always Insert new record
        const result = await pool.query(
            `INSERT INTO bws_parameters (id, tank_id, steam_production, target_ppm, date)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       RETURNING *`,
            [tank_id, steam_production, target_ppm, entryDate]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '儲存鍋爐水參數失敗' });
    }
});

// 更新鍋爐水參數
app.put('/api/bws-params/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { steam_production, target_ppm, date } = req.body;
        const result = await pool.query(
            `UPDATE bws_parameters SET 
                steam_production = $1, 
                target_ppm = $2,
                date = $3
             WHERE id = $4 RETURNING *`,
            [steam_production, target_ppm, date, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '找不到紀錄' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '更新鍋爐水參數失敗' });
    }
});

// 刪除鍋爐水參數
app.delete('/api/bws-params/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM bws_parameters WHERE id = $1', [id]);
        res.json({ message: '已刪除' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '刪除失敗' });
    }
});

// ==================== MCP Server Endpoints ====================

// MCP SSE 連線端點 (IIS 相容版本)
app.get('/mcp-connect/:token', async (req, res) => {
    const token = req.params.token;
    console.log(`[MCP] 連接請求: ${token}`);

    // 1. 立即設置 SSE Headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    // 2. 發送 4KB Padding (強制 IIS 沖刷緩衝)
    res.write(":" + " ".repeat(4096) + "\n\n");

    // 3. Monkey Patch res.writeHead (防止 SDK 重複調用)
    const originalWriteHead = res.writeHead;
    res.writeHead = (statusCode, headers) => {
        return res;
    };

    // 4. Monkey Patch res.write (每個事件後加 padding)
    const originalWrite = res.write;
    res.write = function (chunk, ...args) {
        let strChunk = chunk.toString();
        if (strChunk.endsWith("\n\n")) {
            strChunk += ":" + " ".repeat(100) + "\n\n";
        }
        return originalWrite.apply(res, [strChunk, ...args]);
    };

    // ==================== Important Notes APIs ====================

    // 取得所有重要紀事
    app.get('/api/notes', async (req, res) => {
        try {
            const query = 'SELECT * FROM important_notes ORDER BY date_str DESC, created_at DESC';
            const result = await pool.query(query);
            res.json(result.rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: '取得重要紀事失敗' });
        }
    });

    // 新增重要紀事
    app.post('/api/notes', async (req, res) => {
        try {
            const { date_str, area, chemical_name, note } = req.body;
            const result = await pool.query(
                `INSERT INTO important_notes (date_str, area, chemical_name, note)
             VALUES ($1, $2, $3, $4) RETURNING *`,
                [date_str, area, chemical_name, note]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: '新增重要紀事失敗' });
        }
    });

    // 更新重要紀事
    app.put('/api/notes/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { date_str, area, chemical_name, note } = req.body;
            const result = await pool.query(
                `UPDATE important_notes 
             SET date_str = $1, area = $2, chemical_name = $3, note = $4
             WHERE id = $5 RETURNING *`,
                [date_str, area, chemical_name, note, id]
            );
            if (result.rowCount === 0) {
                return res.status(404).json({ error: '找不到該紀事' });
            }
            res.json(result.rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: '更新重要紀事失敗' });
        }
    });

    // 刪除重要紀事
    app.delete('/api/notes/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const result = await pool.query('DELETE FROM important_notes WHERE id = $1 RETURNING *', [id]);
            if (result.rowCount === 0) {
                return res.status(404).json({ error: '找不到該紀事' });
            }
            res.json({ message: '已刪除', deleted: result.rows[0] });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: '刪除重要紀事失敗' });
        }
    });

    // 批次新增重要紀事 (用於匯入)
    app.post('/api/notes/batch', async (req, res) => {
        const client = await pool.connect();
        try {
            const { notes } = req.body;
            await client.query('BEGIN');

            const results = [];
            for (const record of notes) {
                const { date_str, area, chemical_name, note } = record;
                const result = await client.query(
                    `INSERT INTO important_notes (date_str, area, chemical_name, note)
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                    [date_str, area, chemical_name, note]
                );
                results.push(result.rows[0]);
            }

            await client.query('COMMIT');
            res.status(201).json({ count: results.length, data: results });
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(err);
            res.status(500).json({ error: '批次新增重要紀事失敗' });
        } finally {
            client.release();
        }
    });

    // 5. 創建 Transport
    const messageEndpoint = `/messages/${token}`;
    const transport = new SSEServerTransport(messageEndpoint, res);
    mcpTransports.set(token, transport);

    // 6. 初始化 MCP Server
    const server = new McpServer({
        name: "WTCA-Chemical-Management",
        version: "1.0.0"
    });

    // ==================== MCP Tools 定義 ====================

    // Tool 1: 查詢儲槽資料
    server.tool(
        'query-tanks',
        {
            tankId: z.string().optional().describe('儲槽 ID (選填，留空則回傳所有儲槽)')
        },
        async ({ tankId }) => {
            try {
                let query = `
                    SELECT t.*, 
                           row_to_json(cws.*) as cws_params,
                           row_to_json(bws.*) as bws_params
                    FROM tanks t
                    LEFT JOIN cws_parameters cws ON t.id = cws.tank_id
                    LEFT JOIN bws_parameters bws ON t.id = bws.tank_id
                `;
                const params = [];

                if (tankId) {
                    query += ' WHERE t.id = $1';
                    params.push(tankId);
                }

                query += ' ORDER BY t.name';

                const result = await pool.query(query, params);

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(result.rows, null, 2)
                    }]
                };
            } catch (err) {
                return {
                    content: [{
                        type: 'text',
                        text: `錯誤: ${err.message}`
                    }],
                    isError: true
                };
            }
        }
    );

    // Tool 2: 查詢液位紀錄
    server.tool(
        'query-readings',
        {
            tankId: z.string().optional().describe('儲槽 ID (選填)'),
            limit: z.number().optional().default(50).describe('回傳筆數限制 (預設50)')
        },
        async ({ tankId, limit }) => {
            try {
                let query = 'SELECT * FROM readings';
                const params = [];

                if (tankId) {
                    query += ' WHERE tank_id = $1';
                    params.push(tankId);
                }

                query += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1);
                params.push(limit);

                const result = await pool.query(query, params);

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(result.rows, null, 2)
                    }]
                };
            } catch (err) {
                return {
                    content: [{
                        type: 'text',
                        text: `錯誤: ${err.message}`
                    }],
                    isError: true
                };
            }
        }
    );

    // Tool 3: 查詢藥劑合約
    server.tool(
        'query-supplies',
        {
            tankId: z.string().optional().describe('儲槽 ID (選填)')
        },
        async ({ tankId }) => {
            try {
                let query = 'SELECT * FROM chemical_supplies';
                const params = [];

                if (tankId) {
                    query += ' WHERE tank_id = $1';
                    params.push(tankId);
                }

                query += ' ORDER BY start_date DESC';

                const result = await pool.query(query, params);

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(result.rows, null, 2)
                    }]
                };
            } catch (err) {
                return {
                    content: [{
                        type: 'text',
                        text: `錯誤: ${err.message}`
                    }],
                    isError: true
                };
            }
        }
    );

    // Tool 4: 執行自訂 SQL 查詢 (僅限 SELECT)
    server.tool(
        'execute-sql',
        {
            sql: z.string().describe('SQL SELECT 查詢語句')
        },
        async ({ sql }) => {
            try {
                // 安全檢查：僅允許 SELECT
                const trimmedSql = sql.trim().toUpperCase();
                if (!trimmedSql.startsWith('SELECT')) {
                    return {
                        content: [{
                            type: 'text',
                            text: '錯誤: 僅允許 SELECT 查詢'
                        }],
                        isError: true
                    };
                }

                const result = await pool.query(sql);

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            rowCount: result.rowCount,
                            rows: result.rows
                        }, null, 2)
                    }]
                };
            } catch (err) {
                return {
                    content: [{
                        type: 'text',
                        text: `SQL 執行錯誤: ${err.message}`
                    }],
                    isError: true
                };
            }
        }
    );

    // Tool 5: 取得資料庫統計資訊
    server.tool(
        'get-database-stats',
        {},
        async () => {
            try {
                const tanksCount = await pool.query('SELECT COUNT(*) FROM tanks');
                const readingsCount = await pool.query('SELECT COUNT(*) FROM readings');
                const suppliesCount = await pool.query('SELECT COUNT(*) FROM chemical_supplies');

                const stats = {
                    tanks: parseInt(tanksCount.rows[0].count),
                    readings: parseInt(readingsCount.rows[0].count),
                    supplies: parseInt(suppliesCount.rows[0].count)
                };

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(stats, null, 2)
                    }]
                };
            } catch (err) {
                return {
                    content: [{
                        type: 'text',
                        text: `錯誤: ${err.message}`
                    }],
                    isError: true
                };
            }
        }
    );

    mcpServers.set(token, server);

    // 7. Keep-Alive 心跳
    const keepAlive = setInterval(() => {
        if (res.writableEnded) {
            clearInterval(keepAlive);
            return;
        }
        res.write(":" + " ".repeat(100) + "\n\n");
    }, 15000); // 每 15 秒

    // 8. 清理機制
    req.on('close', () => {
        clearInterval(keepAlive);
        setTimeout(() => {
            if (mcpTransports.get(token) === transport) {
                mcpTransports.delete(token);
                mcpServers.delete(token);
                console.log(`[MCP] 連接已清理: ${token}`);
            }
        }, 1000);
    });

    // 9. 連接 Transport
    try {
        await server.connect(transport);
        console.log(`[MCP] 連接成功: ${token}`);
    } catch (err) {
        console.error("[MCP] 連接錯誤:", err);
    }
});

// MCP 訊息接收端點
app.post('/messages/:token', async (req, res) => {
    const token = req.params.token;
    const transport = mcpTransports.get(token);

    if (!transport) {
        return res.status(404).json({ error: "Session not found" });
    }

    try {
        await transport.handleMessage(req.body);
        res.status(202).json({});
    } catch (e) {
        console.error('[MCP] Message handling error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ==================== Health Check ====================

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', message: '資料庫連線正常' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '資料庫連線失敗' });
    }
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`🚀 後端伺服器運行於 http://localhost:${PORT}`);
    console.log(`📊 API 文件: http://localhost:${PORT}/api/health`);
});
