import pg from 'pg';
const { Pool } = pg;
const hosts = ['localhost', '127.0.0.1', '10.122.51.61'];
let connected = false;

(async () => {
    for (const host of hosts) {
        if (connected) break;
        console.log(`Trying to connect to ${host}...`);
        const pool = new Pool({
            user: 'pagesuser',
            host: host,
            database: 'WTCA',
            password: 'P@ssw0rd',
            port: 5432,
            connectionTimeoutMillis: 2000
        });

        try {
            const client = await pool.connect();
            connected = true;
            console.log(`Connected successfully to ${host}`);
        
        console.log("=== Tanks Information ===");
        const tanksRes = await client.query("SELECT id, name, system_type, description, calculation_method FROM tanks ORDER BY name");
        console.table(tanksRes.rows);

        console.log("\n=== Active Supplies for problem tanks ===");
        const problemTanks = ['CT-1 分散劑', 'CT-1 銅腐蝕抑制劑', 'CT-2 腐蝕結垢抑制劑', 'CT-2 銅腐蝕抑制劑'];
        for (const name of problemTanks) {
            const tank = tanksRes.rows.find(t => t.name === name);
            if (tank) {
                const suppliesRes = await client.query("SELECT * FROM chemical_supplies WHERE tank_id = $1 ORDER BY start_date DESC LIMIT 1", [tank.id]);
                console.log(`Tank: ${name} (ID: ${tank.id})`);
                if (suppliesRes.rows.length > 0) {
                    console.table(suppliesRes.rows.map(s => ({
                        id: s.id,
                        target_ppm: s.target_ppm,
                        start_date: new Date(Number(s.start_date)).toLocaleDateString()
                    })));
                } else {
                    console.log("No supplies found.");
                }
            } else {
                console.log(`Tank ${name} not found in database.`);
            }
        }

        console.log("\n=== Parameters Check ===");
        for (const name of problemTanks) {
            const tank = tanksRes.rows.find(t => t.name === name);
            if (tank) {
                const cwsRes = await client.query("SELECT count(*) FROM cws_parameters WHERE tank_id = $1", [tank.id]);
                const bwsRes = await client.query("SELECT count(*) FROM bws_parameters WHERE tank_id = $1", [tank.id]);
                console.log(`Tank: ${name} | CWS entries: ${cwsRes.rows[0].count} | BWS entries: ${bwsRes.rows[0].count}`);
            }
        }

        } catch (e) {
            console.error(`Failed to connect to ${host}: ${e.message}`);
        } finally {
            await pool.end();
        }
    }
    if (!connected) {
        console.error("Could not connect to any database host.");
    }
})();
