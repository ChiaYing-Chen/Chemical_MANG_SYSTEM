import pg from 'pg';
const { Pool } = pg;

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
        console.log("Fetching recent cws_parameters...");
        const res = await pool.query(`
            SELECT p.*, t.name as tank_name 
            FROM cws_parameters p 
            JOIN tanks t ON p.tank_id = t.id 
            ORDER BY p.date DESC 
            LIMIT 20
        `);
        
        console.table(res.rows.map(r => ({
            ...r,
            date_str: new Date(Number(r.date)).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }),
            updated_at_str: r.updated_at ? new Date(r.updated_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '-'
        })));

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await pool.end();
    }
})();
