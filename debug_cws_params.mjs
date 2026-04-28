import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    user: 'pagesuser',
    host: 'localhost',
    database: 'WTCA',
    password: 'P@ssw0rd',
    port: 5432,
});

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const startTime = Date.UTC(2026, 3, 20) - TZ_OFFSET_MS; // 2026-04-19T16:00:00Z
const endTime   = Date.UTC(2026, 3, 27) - TZ_OFFSET_MS - 1;

console.log('=== 報告週期 ===');
console.log('startTime (UTC):', new Date(startTime).toISOString());
console.log('endTime   (UTC):', new Date(endTime).toISOString());

try {
    // 先看所有 tanks
    const tanksRes = await pool.query("SELECT id, name, system_type, description FROM tanks ORDER BY sort_order ASC");
    console.log('\n=== 所有 Tanks ===');
    for (const t of tanksRes.rows) {
        const isCt1 = t.name.includes('CWS-1') || t.name.includes('CT-1') || (t.description || '').includes('一階');
        const isCt2 = t.system_type && t.system_type.includes('冷卻') && !isCt1;
        if (isCt2 || t.name.includes('CT-2')) {
            console.log(`  [CT-2] ID: ${t.id}, 名稱: ${t.name}, 類型: ${t.system_type}`);
        }
    }

    // 查詢所有 cws_parameters
    const queryStart = startTime - (7 * 24 * 60 * 60 * 1000);
    const cwsRes = await pool.query(
        `SELECT p.tank_id, p.date, p.circulation_rate, p.temp_diff, p.cws_hardness, p.makeup_hardness, p.concentration_cycles, p.updated_at
         FROM cws_parameters p
         ORDER BY p.date DESC
         LIMIT 30`
    );

    console.log('\n=== 全部 CWS 參數最近 30 筆 ===');
    for (const r of cwsRes.rows) {
        const dateTs = Number(r.date);
        const dateTW = new Date(dateTs + TZ_OFFSET_MS);
        const dateStr = `${dateTW.getUTCFullYear()}/${dateTW.getUTCMonth()+1}/${dateTW.getUTCDate()}`;
        const inQueryRange = dateTs >= queryStart && dateTs <= endTime;
        
        const conc = Number(r.concentration_cycles) || 
            (r.cws_hardness && r.makeup_hardness && Number(r.makeup_hardness) > 0 
                ? Number(r.cws_hardness) / Number(r.makeup_hardness) : 8);
        
        const E1d = (Number(r.circulation_rate||0) * Number(r.temp_diff||0) * 1.8 * 24 * 1) / 1000;
        const BW1d = conc > 1 ? E1d / (conc - 1) : 0;
        const usage1d_30ppm = (BW1d * 30) / 1000;

        console.log(`  ${inQueryRange?'✅':'  '} [${dateStr}] tank_id=${r.tank_id.substring(0,8)}... circ=${r.circulation_rate} tempDiff=${r.temp_diff} cwsH=${r.cws_hardness} makeupH=${r.makeup_hardness} N=${conc.toFixed(2)} daily_30ppm=${usage1d_30ppm.toFixed(2)}KG updated=${r.updated_at}`);
    }

    // 逆推
    const R = 22975, dT = 6.9, targetPpm = 30, days = 7;
    const E7d = (R * dT * 1.8 * 24 * days) / 1000;
    const BW_n8n = 145.3 * 1000 / targetPpm;
    const N_n8n = E7d / (E7d - BW_n8n);
    const N_wtca = 8.07;
    
    console.log('\n=== 逆推分析 ===');
    console.log(`  E (7天蒸發) = ${E7d.toFixed(1)} m³`);
    console.log(`  n8n 報告 145.3 KG → BW = ${BW_n8n.toFixed(1)} m³ → 濃縮倍數 N ≈ ${N_n8n.toFixed(2)}`);
    console.log(`  WTCA 畫面 203.6 KG → BW = ${(203.6*1000/30).toFixed(1)} m³ → 濃縮倍數 N ≈ ${N_wtca}`);

} catch(e) {
    console.error('Error:', e.message, e.stack);
} finally {
    await pool.end();
}
