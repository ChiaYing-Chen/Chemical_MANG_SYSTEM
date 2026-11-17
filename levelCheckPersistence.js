import { fitCalibration, requiresPiLevelCheck, calibrationSourceKey } from './levelCheck.js';

/** 回歸與畫面共用相同有效樣本篩選條件。 */
export async function getCalibrationPairs(client, tank) {
    return (await client.query(`
        SELECT pi_level_cm, level_cm FROM readings
        WHERE tank_id = $1 AND pi_level_cm IS NOT NULL
          AND (
            (pi_check->'calibrationPair'->>'sourceKey' = $2
             AND pi_check->'calibrationPair'->>'basis' IN ('MIDNIGHT_WINDOW', 'TIMED_WINDOW'))
            OR (read_at IS NOT NULL AND pi_check->'calibrationPair' IS NULL
                AND COALESCE(pi_check->>'basis', '') NOT IN ('DAILY_USAGE', 'DECLINE_RATE')
                AND (pi_check IS NULL OR COALESCE(pi_check->>'status', '') NOT IN ('ERROR', 'NO_PI')))
          )
        ORDER BY timestamp DESC LIMIT 60`, [tank.id, calibrationSourceKey(tank)])).rows;
}

/** 呼叫端須在交易內執行，公式與歷程必須一起提交。 */
export async function recalculateTank(client, tank, reason) {
    if (!requiresPiLevelCheck(tank)) return { tankId: tank.id, tankName: tank.name, updated: false, reason: '此藥劑免 PI 液位比對' };
    const rows = await getCalibrationPairs(client, tank);
    const fit = fitCalibration(rows.map(r => ({ x: Number(r.pi_level_cm), y: Number(r.level_cm) })));
    if (fit.n < 3 || fit.mode === 'NONE') {
        return { tankId: tank.id, tankName: tank.name, updated: false, reason: `有效配對 ${fit.n} 筆，不足 3 筆；請先回補午夜時窗，穩定樣本不足時保留原公式`, fit };
    }
    const cur = (await client.query('SELECT slope, intercept FROM tank_calibrations WHERE tank_id = $1 FOR UPDATE', [tank.id])).rows[0];
    await client.query(`
        INSERT INTO tank_calibrations (tank_id, slope, intercept, r_squared, residual_std, sample_count, mode, note, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        ON CONFLICT (tank_id) DO UPDATE SET
            slope = EXCLUDED.slope, intercept = EXCLUDED.intercept,
            r_squared = EXCLUDED.r_squared, residual_std = EXCLUDED.residual_std,
            sample_count = EXCLUDED.sample_count, mode = EXCLUDED.mode,
            note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP`,
    [tank.id, fit.slope, fit.intercept, fit.rSquared ?? null, fit.residualStd ?? null, fit.n, fit.mode, reason]);
    await client.query(`
        INSERT INTO tank_calibration_logs (tank_id, old_slope, old_intercept, new_slope, new_intercept, action_type, reason)
        VALUES ($1, $2, $3, $4, $5, 'AUTO_RECALCULATE', $6)`,
    [tank.id, cur?.slope ?? null, cur?.intercept ?? null, fit.slope, fit.intercept, reason]);
    return { tankId: tank.id, tankName: tank.name, updated: true, fit };
}

/** 僅修復已確認的舊版錯配；在既有資料庫遷移交易中備份後執行一次。 */
export async function repairLevelCheckData(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS pi_level_repair_audit (
        repair_key TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
        original JSONB NOT NULL, repaired_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (repair_key, entity, entity_id))`);
    const key = '20261005-pi-level-v2';
    if ((await client.query("SELECT 1 FROM pi_level_repair_audit WHERE repair_key = $1 AND entity = 'completed'", [key])).rows.length) return;
    const bad = (await client.query(`SELECT * FROM tanks WHERE
        (id = 'tc1_7' AND name LIKE '%微生物分散劑%' AND pi_level_tag = 'W52_PH1-3_2.PV') OR
        (id = 'tc2_7' AND name LIKE '%微生物分散劑%' AND pi_level_tag = 'W52_PH2-3_4.PV')`)).rows;
    for (const tank of bad) {
        await client.query(`INSERT INTO pi_level_repair_audit VALUES ($1, 'tanks', $2, $3::jsonb, CURRENT_TIMESTAMP)`, [key, tank.id, JSON.stringify(tank)]);
        await client.query(`INSERT INTO pi_level_repair_audit (repair_key, entity, entity_id, original)
            SELECT $1, 'readings', id::text, to_jsonb(r) FROM readings r WHERE tank_id = $2`, [key, tank.id]);
        await client.query(`INSERT INTO pi_level_repair_audit (repair_key, entity, entity_id, original)
            SELECT $1, 'tank_calibrations', tank_id, to_jsonb(c) FROM tank_calibrations c WHERE tank_id = $2`, [key, tank.id]);
        await client.query('UPDATE tanks SET pi_level_tag = NULL WHERE id = $1', [tank.id]);
        await client.query(`UPDATE readings SET pi_level_cm = NULL,
            pi_check = '{"status":"NO_PI","messages":["舊版誤配其他槽 PI Tag，原查核已失效"]}'::jsonb
            WHERE tank_id = $1`, [tank.id]);
        await client.query(`INSERT INTO tank_calibration_logs
            (tank_id, old_slope, old_intercept, new_slope, new_intercept, action_type, reason)
            SELECT tank_id, slope, intercept, 1, 0, 'RESET_INVALID_TAG', '修復微生物分散劑錯配；原資料已備份'
            FROM tank_calibrations WHERE tank_id = $1`, [tank.id]);
        await client.query(`UPDATE tank_calibrations SET slope = 1, intercept = 0, mode = 'NONE',
            sample_count = 0, r_squared = NULL, residual_std = NULL,
            note = '錯配 Tag 已清除，待設定正確點位', updated_at = CURRENT_TIMESTAMP WHERE tank_id = $1`, [tank.id]);
    }
    // 只修復可由快照明確辨識的校正值錯存，不覆蓋後續已回補的原始值。
    const legacy = (await client.query(`SELECT * FROM readings
        WHERE jsonb_typeof(pi_check->'piRawCm') = 'number'
          AND jsonb_typeof(pi_check->'piRefCm') = 'number'
          AND ABS(pi_level_cm - (pi_check->>'piRefCm')::double precision) < 0.001
          AND ABS(pi_level_cm - (pi_check->>'piRawCm')::double precision) >= 0.001`)).rows;
    for (const row of legacy) {
        await client.query(`INSERT INTO pi_level_repair_audit (repair_key, entity, entity_id, original)
            VALUES ($1, 'readings', $2, $3::jsonb) ON CONFLICT DO NOTHING`, [key, String(row.id), JSON.stringify(row)]);
        await client.query('UPDATE readings SET pi_level_cm = $1 WHERE id = $2', [row.pi_check.piRawCm, row.id]);
    }
    // 舊快照未記錄查核時刻，無法證明 read_at 就是配對時刻；保留原值於備份供人工核對。
    await client.query(`INSERT INTO pi_level_repair_audit (repair_key, entity, entity_id, original)
        SELECT $1, 'readings', id::text, to_jsonb(r) FROM readings r
        WHERE pi_check IS NOT NULL AND NOT (pi_check ? 'readAt') AND read_at IS NOT NULL
        ON CONFLICT DO NOTHING`, [key]);
    await client.query(`UPDATE readings SET read_at = NULL
        WHERE pi_check IS NOT NULL AND NOT (pi_check ? 'readAt') AND read_at IS NOT NULL`);
    await client.query(`INSERT INTO pi_level_repair_audit (repair_key, entity, entity_id, original)
        VALUES ($1, 'completed', $1, '{}'::jsonb)`, [key]);
}
