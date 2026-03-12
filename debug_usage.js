
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: "postgresql://postgres:postgres@localhost:5432/WTCA_DB"
});

async function debug() {
    try {
        // 1. 找出 清罐劑 的 tank
        const tankRes = await pool.query("SELECT id, name, system_type, calculation_method FROM tanks WHERE name LIKE '%清罐劑%'");
        const tank = tankRes.rows[0];
        console.log('Tank:', tank);

        if (!tank) return;

        // 2. 查詢 3/2 ~ 3/8 的 readings
        const startTime = new Date('2026-03-02T00:00:00').getTime();
        const endTime = new Date('2026-03-08T23:59:59').getTime();
        const readStart = startTime - (7 * 24 * 60 * 60 * 1000);

        const readingsRes = await pool.query(
            "SELECT id, timestamp, level_cm, calculated_volume, added_amount_liters FROM readings WHERE tank_id = $1 AND timestamp >= $2 AND timestamp <= $3 ORDER BY timestamp ASC",
            [tank.id, readStart, endTime]
        );
        const allReadings = readingsRes.rows;
        const weekReadings = allReadings.filter(r => Number(r.timestamp) >= startTime);

        console.log(`Total readings in range: ${allReadings.length}`);
        console.log(`Week readings: ${weekReadings.length}`);

        let totalUsage = 0;
        let details = [];

        for (let i = 0; i < weekReadings.length; i++) {
            const curr = weekReadings[i];
            const currIdxInAll = allReadings.findIndex(r => r.id === curr.id);
            const prev = currIdxInAll > 0 ? allReadings[currIdxInAll - 1] : null;

            if (prev) {
                const prevVol = Number(prev.calculated_volume || 0);
                const currVol = Number(curr.calculated_volume || 0);
                const added = Number(curr.added_amount_liters || 0);
                const usage = prevVol - currVol + added;
                if (usage > 1e-6) totalUsage += usage; // Use small eps to avoid negative sum or tiny noise

                if (added > 0 || Math.abs(usage) > 10) {
                    details.push({
                        time: new Date(Number(curr.timestamp)).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
                        prev: prevVol,
                        curr: currVol,
                        added: added,
                        usage: usage
                    });
                }
            }
        }

        console.log('Total Usage Liters (Week):', totalUsage);
        console.log('Significant calculation events:', JSON.stringify(details, null, 2));

        // 3. 檢查 CWS 參數
        const cwsTankRes = await pool.query("SELECT id, name FROM tanks WHERE name LIKE '%CT-1%腐蝕%'");
        if (cwsTankRes.rows[0]) {
            const ct1Tank = cwsTankRes.rows[0];
            const cwsParams = await pool.query("SELECT * FROM cws_parameters WHERE tank_id = $1 AND date >= $2 AND date <= $3", [ct1Tank.id, startTime, endTime]);
            console.log('CWS Params for CT-1 Tank:', cwsParams.rows);
        }

    } catch (e) {
        console.log('Error:', e);
    } finally {
        await pool.end();
    }
}

debug();
