
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: 'postgres://pagesuser:P@ssw0rd@localhost:5432/WTCA',
});

async function cleanFutureData() {
    const now = Date.now();
    console.log(`Current Time: ${new Date(now).toLocaleString()} (Timestamp: ${now})`);
    console.log('Cleaning up records with dates in the future...');

    const tables = [
        { name: 'readings', col: 'timestamp' },
        { name: 'cws_parameters', col: 'date' },
        { name: 'bws_parameters', col: 'date' },
        { name: 'chemical_supplies', col: 'start_date' }
    ];

    for (const t of tables) {
        try {
            // Check count first
            const countRes = await pool.query(`SELECT count(*) FROM ${t.name} WHERE ${t.col} > $1`, [now]);
            const count = parseInt(countRes.rows[0].count);

            if (count > 0) {
                const res = await pool.query(`DELETE FROM ${t.name} WHERE ${t.col} > $1`, [now]);
                console.log(`[${t.name}] Deleted ${res.rowCount} future records.`);
            } else {
                console.log(`[${t.name}] No future records found.`);
            }
        } catch (e) {
            console.error(`Error processing table ${t.name}:`, e.message);
        }
    }

    await pool.end();
}

cleanFutureData();
