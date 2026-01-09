import express from 'express';
import pg from 'pg';
import cors from 'cors';

const { Pool } = pg;
const app = express();
const PORT = 3000;

// 中介軟體
app.use(cors());
app.use(express.json());

// PostgreSQL 連線池
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'wtca_db',
    password: 'password',
    port: 5432,
});

// ==================== Tank APIs ====================

// 取得所有儲槽
app.get('/api/tanks', async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT t.*, 
             row_to_json(cws.*) as cws_params,
             row_to_json(bws.*) as bws_params
      FROM tanks t
      LEFT JOIN cws_parameters cws ON t.id = cws.tank_id
      LEFT JOIN bws_parameters bws ON t.id = bws.tank_id
      ORDER BY t.name
    `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '取得儲槽資料失敗' });
    }
});

// 取得單一儲槽
app.get('/api/tanks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
      SELECT t.*, 
             row_to_json(cws.*) as cws_params,
             row_to_json(bws.*) as bws_params
      FROM tanks t
      LEFT JOIN cws_parameters cws ON t.id = cws.tank_id
      LEFT JOIN bws_parameters bws ON t.id = bws.tank_id
      WHERE t.id = $1
    `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到此儲槽' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '取得儲槽資料失敗' });
    }
});

// 新增儲槽
app.post('/api/tanks', async (req, res) => {
    try {
        const { id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, target_daily_usage, calculation_method } = req.body;
        const result = await pool.query(
            `INSERT INTO tanks (id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, target_daily_usage, calculation_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [id, name, system_type, capacity_liters, geo_factor, description, safe_min_level || 20.0, target_daily_usage, calculation_method]
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
        const { name, system_type, capacity_liters, geo_factor, description, safe_min_level, target_daily_usage, calculation_method } = req.body;
        const result = await pool.query(
            `UPDATE tanks SET name=$2, system_type=$3, capacity_liters=$4, geo_factor=$5, description=$6, 
       safe_min_level=$7, target_daily_usage=$8, calculation_method=$9
       WHERE id=$1 RETURNING *`,
            [id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, target_daily_usage, calculation_method]
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

// 批次新增液位紀錄
app.post('/api/readings/batch', async (req, res) => {
    const client = await pool.connect();
    try {
        const { readings } = req.body;
        await client.query('BEGIN');

        const results = [];
        for (const reading of readings) {
            const { id, tank_id, timestamp, level_cm, calculated_volume, calculated_weight_kg, applied_sg, supply_id, added_amount_liters, operator_name } = reading;
            const result = await client.query(
                `INSERT INTO readings (id, tank_id, timestamp, level_cm, calculated_volume, calculated_weight_kg, applied_sg, supply_id, added_amount_liters, operator_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
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
            [id, tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '新增藥劑合約失敗' });
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
                [id, tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes]
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

// ==================== CWS Parameter APIs ====================

// 取得/更新冷卻水參數
app.get('/api/cws-params/:tankId', async (req, res) => {
    try {
        const { tankId } = req.params;
        const result = await pool.query('SELECT * FROM cws_parameters WHERE tank_id = $1', [tankId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到此儲槽的冷卻水參數' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '取得冷卻水參數失敗' });
    }
});

app.post('/api/cws-params', async (req, res) => {
    try {
        const { tank_id, circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles, target_ppm } = req.body;
        const result = await pool.query(
            `INSERT INTO cws_parameters (tank_id, circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles, target_ppm)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tank_id) DO UPDATE SET
         circulation_rate = EXCLUDED.circulation_rate,
         temp_outlet = EXCLUDED.temp_outlet,
         temp_return = EXCLUDED.temp_return,
         temp_diff = EXCLUDED.temp_diff,
         cws_hardness = EXCLUDED.cws_hardness,
         makeup_hardness = EXCLUDED.makeup_hardness,
         concentration_cycles = EXCLUDED.concentration_cycles,
         target_ppm = EXCLUDED.target_ppm,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
            [tank_id, circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles, target_ppm]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '儲存冷卻水參數失敗' });
    }
});

// ==================== BWS Parameter APIs ====================

app.get('/api/bws-params/:tankId', async (req, res) => {
    try {
        const { tankId } = req.params;
        const result = await pool.query('SELECT * FROM bws_parameters WHERE tank_id = $1', [tankId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到此儲槽的鍋爐水參數' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '取得鍋爐水參數失敗' });
    }
});

app.post('/api/bws-params', async (req, res) => {
    try {
        const { tank_id, steam_production, target_ppm } = req.body;
        const result = await pool.query(
            `INSERT INTO bws_parameters (tank_id, steam_production, target_ppm)
       VALUES ($1, $2, $3)
       ON CONFLICT (tank_id) DO UPDATE SET
         steam_production = EXCLUDED.steam_production,
         target_ppm = EXCLUDED.target_ppm,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
            [tank_id, steam_production, target_ppm]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '儲存鍋爐水參數失敗' });
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
