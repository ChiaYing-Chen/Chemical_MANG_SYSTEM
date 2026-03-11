const { Pool } = require('pg');
const pool = new Pool({
    user: 'pagesuser',
    host: 'localhost',
    database: 'WTCA',
    password: 'P@ssw0rd',
    port: 5432,
});

async function check() {
    try {
        const res = await pool.query(`
      SELECT
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
      FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name='chemical_supplies';
    `);
        console.log("===== CONSTRAINTS =====");
        console.log(JSON.stringify(res.rows, null, 2));

        // Attempt delete to see exact error
        console.log("\n===== TEST DELETE =====");
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const supply = await client.query('SELECT id FROM chemical_supplies LIMIT 1');
            if (supply.rows.length > 0) {
                try {
                    await client.query('DELETE FROM chemical_supplies WHERE id = $1', [supply.rows[0].id]);
                    console.log("Delete succeeded?! (Rolling back...)");
                } catch (delErr) {
                    console.log("Delete error message:", delErr.message);
                }
            } else {
                console.log("No supplies found to delete.");
            }
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    } catch (e) { console.error(e); } finally { pool.end(); }
}
check();
