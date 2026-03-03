import express from 'express';
import pg from 'pg';
import cors from 'cors';
import fetch from 'node-fetch';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import crypto from 'crypto';
// ... (skip down to proxy imports/setup if needed, but cleanest to add import at top)

// ...



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
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

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



// ==================== PI Data Import API ====================

const PI_BASE_URL = 'https://10.122.51.61/piwebapi';

const BWS_TAGS = [
    "W52_FI-MS27-A.PV",
    "W52_FI-MS27-B.PV",
    "W52_FI-MS27-C.PV",
    "W52_FI-MS27-D.PV"
];

const CWS_TAGS_CONFIG = {
    'CT-1': {
        flow: ['W52_FI-CW56-Z.PV', 'W52_FI-CW57-Z.PV'],
        tempOut: ['W52_TI-CW77-Z.PV'],
        tempRet: ['W52_TI-CW76-Z.PV']
    },
    'CT-2': {
        flow: ['W52_FI-CW56-Y.PV', 'W52_FI-CW57-Y.PV'],
        tempOut: ['W52_TI-AC77-Y.PV'],
        tempRet: ['W52_TI-CW76-Y.PV']
    }
};

/**
 * Batch fetch all PI tag values in a SINGLE PowerShell process.
 * Forces UTF-8 output encoding to avoid CJK mojibake.
 */
const piBatchFetch = (requests, piAuth) => {
    const fullUser = piAuth.domain ? `${piAuth.domain}\\${piAuth.username}` : piAuth.username;
    const escapedPwd = piAuth.password.replace(/'/g, "''");
    const baseUrl = PI_BASE_URL;

    const psScript = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
chcp 65001 | Out-Null

# SSL/TLS fixes
[Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
[Net.ServicePointManager]::Expect100Continue = $false
[Net.ServicePointManager]::DefaultConnectionLimit = 100
$ErrorActionPreference = 'Stop'

$secPwd = ConvertTo-SecureString '${escapedPwd}' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('${fullUser}', $secPwd)
$results = @{}
$tagWebIdCache = @{}
$debugLogs = @()

function PiGet($url) {
    $maxRetry = 3
    for ($attempt = 1; $attempt -le $maxRetry; $attempt++) {
        try {
            # Use HttpWebRequest for maximum control
            $req = [System.Net.HttpWebRequest]::Create($url)
            $req.Method = 'GET'
            $req.ContentType = 'application/json'
            $req.Accept = 'application/json'
            $req.KeepAlive = $false
            $req.PreAuthenticate = $true
            $req.Credentials = $cred
            $req.Timeout = 30000

            $resp = $req.GetResponse()
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $body = $reader.ReadToEnd()
            $reader.Close()
            $resp.Close()
            return ($body | ConvertFrom-Json)
        } catch {
            $errDetail = $_.Exception.Message
            if ($_.Exception.InnerException) {
                $errDetail += ' | Inner: ' + $_.Exception.InnerException.Message
                if ($_.Exception.InnerException.InnerException) {
                    $errDetail += ' | InnerInner: ' + $_.Exception.InnerException.InnerException.Message
                }
            }
            if ($attempt -eq $maxRetry) {
                throw [System.Exception]::new("Attempt $attempt failed for $url : $errDetail")
            }
            Start-Sleep -Milliseconds 500
        }
    }
}

try {
    $debugLogs += "Calling dataservers..."
    $servers = PiGet '${baseUrl}/dataservers'
    $serverId = $servers.Items[0].WebId
    $results['_serverWebId'] = $serverId
    $debugLogs += "DataServer OK: $serverId"

${requests.map((req, i) => `
    try {
        $tagName = '${req.tagName}'
        if ($tagWebIdCache.ContainsKey($tagName)) {
            $webId = $tagWebIdCache[$tagName]
        } else {
            $searchUrl = "${baseUrl}/dataservers/$serverId/points?nameFilter=$tagName"
            $debugLogs += "Search: $searchUrl"
            $search = PiGet $searchUrl
            if ($search.Items.Count -eq 0) {
                $results['${req.tagName}__${i}'] = @{ error = 'Tag Not Found'; value = 0 }
                $debugLogs += "Tag $tagName not found"
                continue
            }
            $webId = $search.Items[0].WebId
            $tagWebIdCache[$tagName] = $webId
            $debugLogs += "Tag $tagName WebId: $webId"
        }
        $summaryUrl = "${baseUrl}/streams/$webId/summary?startTime=${req.startTime}&endTime=${req.endTime}&summaryType=${req.summaryType}"
        $summary = PiGet $summaryUrl
        $item = $summary.Items[0]
        $val = $item.Value
        if ($val -is [PSCustomObject] -and $val.PSObject.Properties['Value']) { $val = $val.Value }
        $results['${req.tagName}__${i}'] = @{ value = [double]$val; error = $null }
    } catch {
        $errMsg = $_.Exception.Message
        $results['${req.tagName}__${i}'] = @{ error = $errMsg; value = 0 }
        $debugLogs += "ERROR ${req.tagName}: $errMsg"
    }
`).join('')}

    $results['_debug'] = ($debugLogs -join ' || ')
    $results | ConvertTo-Json -Depth 5 -Compress
} catch {
    $errDetail = $_.Exception.Message
    if ($_.Exception.InnerException) {
        $errDetail += ' | Inner: ' + $_.Exception.InnerException.Message
    }
    $errResults = @{ _authError = $errDetail; _debug = ($debugLogs -join ' || ') }
    $errResults | ConvertTo-Json -Compress
}
`;
    const tmpFile = join(tmpdir(), 'pi_batch_' + Date.now() + '.ps1');
    const resultMap = new Map();

    try {
        writeFileSync(tmpFile, psScript, { encoding: 'utf8', flag: 'w' });
        const stdout = execSync('powershell -NoProfile -ExecutionPolicy Bypass -File "' + tmpFile + '"', {
            encoding: 'utf8',
            timeout: 120000,
            maxBuffer: 50 * 1024 * 1024
        });

        const parsed = JSON.parse(stdout.trim());

        // Extract debug logs from PowerShell
        if (parsed._debug) {
            resultMap.set('_debug', parsed._debug);
        }

        if (parsed._authError) {
            for (let i = 0; i < requests.length; i++) {
                resultMap.set(requests[i].tagName + '__' + i, { value: 0, error: parsed._authError });
            }
        } else {
            for (let i = 0; i < requests.length; i++) {
                const key = requests[i].tagName + '__' + i;
                const r = parsed[key];
                if (r) {
                    resultMap.set(key, { value: Number(r.value) || 0, error: r.error || null });
                } else {
                    resultMap.set(key, { value: 0, error: 'No result returned' });
                }
            }
        }
    } catch (e) {
        const errMsg = (e.stderr || e.message || '').toString().trim().substring(0, 500);
        for (let i = 0; i < requests.length; i++) {
            resultMap.set(requests[i].tagName + '__' + i, { value: 0, error: errMsg.substring(0, 200) });
        }
    } finally {
        try { unlinkSync(tmpFile); } catch (_) { }
    }

    return resultMap;
};

const getMonday = (d) => {
    d = new Date(d);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d.setDate(diff));
    mon.setHours(0, 0, 0, 0);
    return mon;
};

app.post('/api/pi-import', async (req, res) => {
    const logs = [];
    try {
        const { weeks = 4, username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, error: "Missing 'username' or 'password' in request body." });
        }

        let domain = '';
        let plainUsername = username;
        if (username.includes('\\')) {
            const parts = username.split('\\');
            domain = parts[0];
            plainUsername = parts[1];
        }
        const piAuth = { username: plainUsername, password, domain };
        logs.push('Authenticating as: ' + (domain ? domain + '\\' : '') + plainUsername + ' (Kerberos)');

        const currentWeekMonday = getMonday(new Date());
        const targetWeeks = [];
        for (let i = 1; i <= weeks; i++) {
            const endDate = new Date(currentWeekMonday);
            endDate.setDate(currentWeekMonday.getDate() - (7 * (i - 1)));
            const startDate = new Date(endDate);
            startDate.setDate(endDate.getDate() - 7);
            targetWeeks.push({ start: startDate, end: endDate });
        }
        targetWeeks.reverse();

        const allRequests = [];

        for (const week of targetWeeks) {
            const startStr = week.start.toISOString().split('T')[0] + 'T00:00:00';
            const endStr = week.end.toISOString().split('T')[0] + 'T00:00:00';
            for (const tag of BWS_TAGS) {
                allRequests.push({ tagName: tag, startTime: startStr, endTime: endStr, summaryType: 'Total', _group: 'BWS', _weekStart: week.start });
            }
        }

        for (const week of targetWeeks) {
            const startStr = week.start.toISOString().split('T')[0] + 'T00:00:00';
            const endStr = week.end.toISOString().split('T')[0] + 'T00:00:00';
            for (const [areaKey, config] of Object.entries(CWS_TAGS_CONFIG)) {
                for (const tag of config.flow) {
                    allRequests.push({ tagName: tag, startTime: startStr, endTime: endStr, summaryType: 'Average', _group: 'CWS_' + areaKey + '_flow', _weekStart: week.start });
                }
                for (const tag of config.tempOut) {
                    allRequests.push({ tagName: tag, startTime: startStr, endTime: endStr, summaryType: 'Average', _group: 'CWS_' + areaKey + '_tempOut', _weekStart: week.start });
                }
                for (const tag of config.tempRet) {
                    allRequests.push({ tagName: tag, startTime: startStr, endTime: endStr, summaryType: 'Average', _group: 'CWS_' + areaKey + '_tempRet', _weekStart: week.start });
                }
            }
        }

        logs.push('  Total PI requests: ' + allRequests.length + ' (in single batch)');

        const results = piBatchFetch(allRequests, piAuth);

        // Output PowerShell debug logs
        const debugLog = results.get('_debug');
        if (debugLog) {
            logs.push('  [PS Debug] ' + debugLog);
        }

        const summary = [];
        const firstResult = results.values().next().value;
        if (firstResult && firstResult.error && String(firstResult.error).includes('Auth')) {
            const msg = '❌ Auth FAILED: ' + firstResult.error;
            logs.push('  [Auth Test] FAILED: ' + firstResult.error);
            summary.push(msg);
        } else {
            logs.push('  [Auth Test] OK (batch completed)');
            // summary.push('✅ Auth OK'); // Optional, implicit if success
        }

        // --- Process BWS results ---
        logs.push("Processing BWS data...");
        const boilerTanksRes = await pool.query("SELECT * FROM tanks WHERE system_type = '鍋爐水系統'");
        const boilerTanks = boilerTanksRes.rows;

        for (const week of targetWeeks) {
            let weekTotalSum = 0;
            let errorCount = 0;
            for (let i = 0; i < allRequests.length; i++) {
                const req = allRequests[i];
                if (req._group !== 'BWS' || req._weekStart.getTime() !== week.start.getTime()) continue;
                const key = req.tagName + '__' + i;
                const r = results.get(key);
                if (r && r.error) {
                    logs.push('    [BWS Error] ' + req.tagName + ': ' + r.error);
                    errorCount++;
                }
                weekTotalSum += (r ? r.value || 0 : 0);
            }
            const safeTotal = Math.round(weekTotalSum * 24);
            const dateTs = week.start.getTime();

            let saveCount = 0;
            for (const tank of boilerTanks) {
                let existing = null;
                try {
                    const checkRes = await pool.query("SELECT id FROM bws_parameters WHERE tank_id = $1 AND date = $2", [tank.id, dateTs]);
                    existing = checkRes.rows[0];
                } catch (e) { /* ignore */ }

                if (existing) {
                    await pool.query("UPDATE bws_parameters SET steam_production = $1, updated_at = NOW() WHERE id = $2", [safeTotal, existing.id]);
                } else {
                    await pool.query("INSERT INTO bws_parameters (id, tank_id, steam_production, date) VALUES ($1, $2, $3, $4)", [crypto.randomUUID(), tank.id, safeTotal, dateTs]);
                }
                saveCount++;
            }
            logs.push('  Week ' + week.start.toLocaleDateString() + ': Updated ' + saveCount + ' BWS tanks (Steam: ' + safeTotal + ')');
            if (errorCount > 0) {
                summary.push(`⚠️ BWS ${week.start.toLocaleDateString()}: ${errorCount} errors`);
            } else {
                summary.push(`🔥 BWS ${week.start.toLocaleDateString()}: Steam ${safeTotal}`);
            }
        }

        // --- Process CWS results ---
        logs.push("Processing CWS data...");
        const cwsTanksRes = await pool.query("SELECT * FROM tanks WHERE system_type = '冷卻水系統'");
        const cwsTanks = cwsTanksRes.rows;
        logs.push('  Found ' + cwsTanks.length + ' COOLING tanks');

        const ct1Tanks = cwsTanks.filter(function (t) { return t.name.includes('CWS-1') || t.name.includes('CT-1') || (t.description || '').includes('\u4e00\u968e'); });
        const ct2Tanks = cwsTanks.filter(function (t) { return !ct1Tanks.find(function (ct1) { return ct1.id === t.id; }); });

        const getAreaData = (areaKey, weekStart) => {
            let flowSum = 0, tOutSum = 0, tOutCount = 0, tRetSum = 0, tRetCount = 0;
            let errors = 0;
            for (let i = 0; i < allRequests.length; i++) {
                const req = allRequests[i];
                if (req._weekStart.getTime() !== weekStart.getTime()) continue;
                const key = req.tagName + '__' + i;
                const r = results.get(key);
                if (r && r.error) errors++;

                if (req._group === 'CWS_' + areaKey + '_flow') {
                    if (r && r.error) logs.push('  [CWS Warn] ' + req.tagName + ': ' + r.error);
                    flowSum += (r ? r.value || 0 : 0);
                } else if (req._group === 'CWS_' + areaKey + '_tempOut') {
                    if (r && r.error) { logs.push('  [CWS Warn] ' + req.tagName + ': ' + r.error); }
                    else { tOutSum += (r ? r.value || 0 : 0); tOutCount++; }
                } else if (req._group === 'CWS_' + areaKey + '_tempRet') {
                    if (r && r.error) { logs.push('  [CWS Warn] ' + req.tagName + ': ' + r.error); }
                    else { tRetSum += (r ? r.value || 0 : 0); tRetCount++; }
                }
            }
            const tOut = tOutCount > 0 ? tOutSum / tOutCount : 0;
            const tRet = tRetCount > 0 ? tRetSum / tRetCount : 0;
            return { circulationRate: flowSum, tempOutlet: tOut, tempReturn: tRet, tempDiff: tRet - tOut, errors };
        };

        for (const week of targetWeeks) {
            const dateTs = week.start.getTime();
            let totalErrors = 0;
            const saveCwsArea = async (tanks, areaKey) => {
                if (tanks.length === 0) return;
                const data = getAreaData(areaKey, week.start);
                totalErrors += data.errors;
                for (const tank of tanks) {
                    const existingRes = await pool.query("SELECT * FROM cws_parameters WHERE tank_id = $1 AND date = $2", [tank.id, dateTs]);
                    const existing = existingRes.rows[0];
                    const cwsHardness = existing ? existing.cws_hardness || 0 : 0;
                    const makeupHardness = existing ? existing.makeup_hardness || 0 : 0;
                    const cycles = makeupHardness > 0 ? cwsHardness / makeupHardness : (existing ? (existing.concentration_cycles || 8) : 8);
                    if (existing) {
                        await pool.query("UPDATE cws_parameters SET circulation_rate=$1, temp_outlet=$2, temp_return=$3, temp_diff=$4, concentration_cycles=$5, updated_at=NOW() WHERE id=$6",
                            [data.circulationRate, data.tempOutlet, data.tempReturn, data.tempDiff, cycles, existing.id]);
                    } else {
                        await pool.query("INSERT INTO cws_parameters (id, tank_id, date, circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
                            [crypto.randomUUID(), tank.id, dateTs, data.circulationRate, data.tempOutlet, data.tempReturn, data.tempDiff, cwsHardness, makeupHardness, cycles]);
                    }
                }
            };
            await saveCwsArea(ct1Tanks, 'CT-1');
            await saveCwsArea(ct2Tanks, 'CT-2');
            logs.push('  Week ' + week.start.toLocaleDateString() + ': Updated CWS data');
            if (totalErrors > 0) {
                summary.push(`⚠️ CWS ${week.start.toLocaleDateString()}: ${totalErrors} errors`);
            } else {
                summary.push(`💧 CWS ${week.start.toLocaleDateString()}: Updated OK`);
            }
        }

        const message = summary.length > 0 ? `✅ PI Import Success\n` + summary.join('\n') : `✅ PI Import Success (No data processed)`;
        res.json({ success: true, logs, message });
    } catch (error) {
        console.error('PI Import Error:', error);
        logs.push('CRITICAL ERROR: ' + error.message);
        res.status(500).json({ success: false, error: error.message, logs, message: `❌ PI Import Failed: ${error.message}` });
    }
});


// ==================== User Identity API ====================
app.get('/api/whoami', (req, res) => {
    // Check various headers that IIS or proxies might set
    // x-iisnode-auth_user is standard for iisnode with Windows Auth
    // remote_user, x-forwarded-user are common in other setups
    const rawUser = req.headers['x-iisnode-auth_user'] ||
        req.headers['auth-user'] ||
        req.headers['x-forwarded-user'] ||
        req.headers['remote_user'] ||
        '';

    let username = String(rawUser).trim();

    // If empty, we can't detect
    if (!username) {
        return res.json({ username: null });
    }

    // Remove domain prefix if present (e.g. "DOMAIN\User" -> "User")
    if (username.includes('\\')) {
        username = username.split('\\').pop();
    }

    res.json({ username });
});

// ==================== Weekly CWS Import API ====================
app.post('/api/import/cws-weekly', async (req, res) => {
    const { date, makeupHardness, ct1Hardness, ct2Hardness } = req.body;
    const logPrefix = `[API Import ${new Date(date).toLocaleDateString()}]`;
    const logs = [];

    if (!date || makeupHardness === undefined) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    try {
        logs.push(`${logPrefix} Starting import...`);

        // 1. Get Cooling Tanks
        const cwsTanksRes = await pool.query("SELECT * FROM tanks WHERE system_type = '冷卻水系統'");
        const cwsTanks = cwsTanksRes.rows;

        // 2. Split CT-1 / CT-2 (Logic matches App.tsx)
        const ct1Tanks = cwsTanks.filter(t => t.name.includes('CWS-1') || t.name.includes('CT-1') || (t.description || '').includes('一階'));
        const ct2Tanks = cwsTanks.filter(t => !ct1Tanks.find(ct1 => ct1.id === t.id));

        // 3. Helper to Upsert
        const upsertTank = async (tank, hardnessValue) => {
            const cycles = makeupHardness > 0 ? hardnessValue / makeupHardness : 8;
            const entryDateObj = new Date(Number(date));

            // Fetch all records for this tank to find same-day collisions
            const allRes = await pool.query("SELECT * FROM cws_parameters WHERE tank_id = $1", [tank.id]);
            const existingSameDay = allRes.rows.filter(r => {
                const rDate = new Date(Number(r.date));
                return rDate.getFullYear() === entryDateObj.getFullYear() &&
                    rDate.getMonth() === entryDateObj.getMonth() &&
                    rDate.getDate() === entryDateObj.getDate();
            });

            if (existingSameDay.length > 0) {
                // Update only hardness/cycles, keep others
                for (const existing of existingSameDay) {
                    await pool.query(
                        "UPDATE cws_parameters SET cws_hardness=$1, makeup_hardness=$2, concentration_cycles=$3, updated_at=NOW() WHERE id=$4",
                        [hardnessValue, makeupHardness, cycles, existing.id]
                    );
                }
                logs.push(`Updated ${tank.name}`);
            } else {
                // Insert new with 0 for others
                await pool.query(
                    "INSERT INTO cws_parameters (id, tank_id, date, circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles) VALUES ($1,$2,$3,0,0,0,0,$4,$5,$6)",
                    [crypto.randomUUID(), tank.id, date, hardnessValue, makeupHardness, cycles]
                );
                logs.push(`Inserted ${tank.name}`);
            }
        };

        // 4. Process
        for (const tank of ct1Tanks) await upsertTank(tank, ct1Hardness);
        for (const tank of ct2Tanks) await upsertTank(tank, ct2Hardness);

        res.json({ success: true, message: `Imported successfully for ${cwsTanks.length} tanks`, logs });

    } catch (error) {
        console.error('Import API Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== App Settings APIs ====================

// 取得所有設定
app.get('/api/settings', async (req, res) => {
    try {
        const result = await pool.query('SELECT key, value FROM app_settings');
        res.json(result.rows);
    } catch (err) {
        // 若 app_settings 資料表不存在，則回傳空陣列（避免 UI 初始化失敗）
        if (err.code === '42P01') {
            return res.json([]);
        }
        console.error('GET /api/settings error:', err.message);
        res.status(500).json({ error: '取得設定失敗', details: err.message });
    }
});

// 儲存設定（將整個 settings 物件寫入 app_settings 資料表）
app.post('/api/settings', async (req, res) => {
    const client = await pool.connect();
    try {
        const settings = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ error: '請求 body 須為 JSON 物件' });
        }

        // 確保 app_settings 資料表存在
        await client.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value JSONB,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        await client.query('BEGIN');
        for (const [key, value] of Object.entries(settings)) {
            await client.query(
                `INSERT INTO app_settings (key, value, updated_at)
                 VALUES ($1, $2::jsonb, NOW())
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
                [key, JSON.stringify(value)]
            );
        }
        await client.query('COMMIT');

        const rows = await client.query('SELECT key, value FROM app_settings');
        res.json(rows.rows);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /api/settings error:', err.message);
        res.status(500).json({ error: '儲存設定失敗', details: err.message });
    } finally {
        client.release();
    }
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

            // Load params based on logic...
            try {
                if (tank.calculation_method === 'CWS_BLOWDOWN') {
                    const cwsResult = await pool.query(
                        'SELECT * FROM cws_parameters WHERE tank_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1',
                        [tank.id]
                    );
                    cws_params = cwsResult.rows[0] || null;
                }
            } catch (e) {
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
                console.error('BWS params fetch error:', e.message);
            }

            // Ensure dimensions is parsed if it's a string (though pg usually parses json)
            let dimensions = tank.dimensions;
            if (typeof dimensions === 'string') {
                try { dimensions = JSON.parse(dimensions); } catch (e) { }
            }

            return { ...tank, cws_params, bws_params, dimensions };
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
        const { id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, target_daily_usage, calculation_method, sort_order, shape_type, dimensions, input_unit, validation_threshold, pi_percent_factor } = req.body;
        const result = await pool.query(
            `INSERT INTO tanks (id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, target_daily_usage, calculation_method, sort_order, shape_type, dimensions, input_unit, validation_threshold, sg_range_min, sg_range_max, pi_percent_factor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
            [id, name, system_type, capacity_liters, geo_factor, description, safe_min_level || 20.0, target_daily_usage, calculation_method, sort_order || 0, shape_type, dimensions, input_unit || 'CM', validation_threshold || 30, req.body.sg_range_min, req.body.sg_range_max, pi_percent_factor ?? null]
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
        const { name, system_type, capacity_liters, geo_factor, description, safe_min_level, target_daily_usage, calculation_method, sort_order, shape_type, dimensions, input_unit, validation_threshold, pi_percent_factor } = req.body;

        // DEBUG LOG
        console.log('=== PUT /api/tanks/:id DEBUG ===');
        console.log('Tank ID:', id);
        console.log('Received validation_threshold:', validation_threshold);
        console.log('Received pi_percent_factor:', pi_percent_factor);
        console.log('Full request body:', JSON.stringify(req.body, null, 2));

        const result = await pool.query(
            `UPDATE tanks SET name=$2, system_type=$3, capacity_liters=$4, geo_factor=$5, description=$6, 
       safe_min_level=$7, target_daily_usage=$8, calculation_method=$9, sort_order=$10, shape_type=$11, dimensions=$12, input_unit=$13, validation_threshold=$14, sg_range_min=$15, sg_range_max=$16, pi_percent_factor=$17
       WHERE id=$1 RETURNING *`,
            [id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, target_daily_usage, calculation_method, sort_order || 0, shape_type, dimensions, input_unit || 'CM', validation_threshold || 30, req.body.sg_range_min, req.body.sg_range_max, pi_percent_factor ?? null]
        );

        console.log('Update result:', result.rows[0]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到此儲槽' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('PUT /api/tanks/:id ERROR:', err);
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
            const { id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, sort_order, calculation_method, cws_params, bws_params, shape_type, dimensions, sg_range_min, sg_range_max } = tank;

            // Upsert tank
            const tankResult = await client.query(
                `INSERT INTO tanks (id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, sort_order, calculation_method, shape_type, dimensions, sg_range_min, sg_range_max)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                 ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    system_type = EXCLUDED.system_type,
                    capacity_liters = EXCLUDED.capacity_liters,
                    geo_factor = EXCLUDED.geo_factor,
                    description = EXCLUDED.description,
                    safe_min_level = EXCLUDED.safe_min_level,
                    sort_order = EXCLUDED.sort_order,
                    calculation_method = EXCLUDED.calculation_method,
                    shape_type = EXCLUDED.shape_type,
                    dimensions = EXCLUDED.dimensions,
                    sg_range_min = EXCLUDED.sg_range_min,
                    sg_range_max = EXCLUDED.sg_range_max
                 RETURNING *`,
                [id, name, system_type, capacity_liters, geo_factor, description, safe_min_level, sort_order, calculation_method, shape_type, dimensions, sg_range_min, sg_range_max]
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
                    `INSERT INTO bws_parameters (tank_id, steam_production, date)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (tank_id) DO UPDATE SET
                        steam_production = EXCLUDED.steam_production,
                        date = EXCLUDED.date`,
                    [id, bws_params.steam_production, bws_params.date || Date.now()]
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

        // 3. Tanks table - validation_threshold column
        console.log('Ensuring validation_threshold column in tanks table...');
        await client.query('ALTER TABLE tanks ADD COLUMN IF NOT EXISTS validation_threshold NUMERIC DEFAULT 30');

        // 4. Tanks table - sg_range columns
        console.log('Ensuring sg_range columns in tanks table...');
        await client.query('ALTER TABLE tanks ADD COLUMN IF NOT EXISTS sg_range_min NUMERIC');
        await client.query('ALTER TABLE tanks ADD COLUMN IF NOT EXISTS sg_range_max NUMERIC');

        // 5. Fluctuation Alerts table
        console.log('Ensuring fluctuation_alerts table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluctuation_alerts (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                tank_id TEXT REFERENCES tanks(id) ON DELETE CASCADE,
                tank_name TEXT,
                date_str TEXT,
                reason TEXT,
                current_value NUMERIC,
                prev_value NUMERIC,
                next_value NUMERIC,
                is_possible_refill BOOLEAN DEFAULT false,
                source TEXT DEFAULT 'MANUAL',
                note TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 6. Important Notes table
        console.log('Ensuring important_notes table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS important_notes (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                date_str TEXT,
                area TEXT,
                chemical_name TEXT,
                note TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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
        const { id, tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes, target_ppm } = req.body;
        const result = await pool.query(
            `INSERT INTO chemical_supplies (id, tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes, target_ppm)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [id || crypto.randomUUID(), tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes, target_ppm]
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
        const { supplier_name, chemical_name, specific_gravity, price, start_date, notes, target_ppm } = req.body;
        const result = await pool.query(
            `UPDATE chemical_supplies SET 
                supplier_name = $1, 
                chemical_name = $2, 
                specific_gravity = $3, 
                price = $4, 
                start_date = $5, 
                notes = $6,
                target_ppm = $7
             WHERE id = $8 RETURNING *`,
            [supplier_name, chemical_name, specific_gravity, price, start_date, notes, target_ppm, id]
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
            const { id, tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes, target_ppm } = supply;
            const result = await client.query(
                `INSERT INTO chemical_supplies (id, tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes, target_ppm)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [id || crypto.randomUUID(), tank_id, supplier_name, chemical_name, specific_gravity, price, start_date, notes, target_ppm]
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
        let query = 'SELECT * FROM cws_parameters ORDER BY updated_at DESC NULLS LAST';
        let params = [];
        if (tankId && tankId !== 'all') {
            query = 'SELECT * FROM cws_parameters WHERE tank_id = $1 ORDER BY updated_at DESC NULLS LAST';
            params = [tankId];
        }
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '取得冷卻水參數歷史失敗' });
    }
});

// 新增冷卻水參數 (Create New History Record)
app.post('/api/cws-params', async (req, res) => {
    try {
        const { tank_id, circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles, date } = req.body;
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
            `INSERT INTO cws_parameters (id, tank_id, circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles, date)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
            [tank_id, circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles, entryDate]
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
        const { circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles, date } = req.body;
        const result = await pool.query(
            `UPDATE cws_parameters SET 
                circulation_rate = $1, 
                temp_outlet = $2, 
                temp_return = $3, 
                temp_diff = $4, 
                cws_hardness = $5, 
                makeup_hardness = $6, 
                concentration_cycles = $7, 
                date = $8
             WHERE id = $9 RETURNING *`,
            [circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles, date, id]
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
        const { tank_id, steam_production, date } = req.body;
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
            `INSERT INTO bws_parameters (id, tank_id, steam_production, date)
       VALUES (gen_random_uuid(), $1, $2, $3)
       RETURNING *`,
            [tank_id, steam_production, entryDate]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '儲存鍋爐水參數失敗', details: err.message });
    }
});

// 更新鍋爐水參數
app.put('/api/bws-params/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { steam_production, date } = req.body;
        const result = await pool.query(
            `UPDATE bws_parameters SET 
                steam_production = $1, 
                date = $2
             WHERE id = $3 RETURNING *`,
            [steam_production, date, id]
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

// ==================== PI Web API Proxy ====================
// Allow HTTP frontend to call HTTPS PI API via Backend to avoid Mixed Content / CORS
app.post('/api/pi-proxy', async (req, res) => {
    try {
        const { url, method = 'GET', headers = {}, body } = req.body;

        // Basic security check: Only allow PI Web API target
        // if (!url.toLowerCase().includes('/piwebapi/')) {
        //     return res.status(403).json({ error: 'Blocked: Only PI Web API is allowed' });
        // }

        console.log(`[Proxy] ${method} ${url}`);

        // Forward credentials if present
        // Note: Client should send 'Authorization' in body.headers or we rely on backend-side auth if configured.
        // Here we passthrough what client sent.

        // Need to handle https agent if using self-signed certs in internal network
        // const httpsAgent = new https.Agent({ rejectUnauthorized: false }); // Use with caution

        const response = await fetch(url, {
            method,
            headers: {
                ...headers,
                // Ensure we don't leak host headers that might confuse target
                host: undefined
            },
            body: body ? JSON.stringify(body) : undefined,
            // agent: httpsAgent // Only if using node-fetch with custom agent, but global fetch is different
        });

        const responseText = await response.text();
        let json;
        try {
            json = JSON.parse(responseText);
        } catch {
            json = null; // not json
        }

        res.status(response.status).json(json || { text: responseText });

    } catch (err) {
        console.error('[Proxy] Error:', err);
        res.status(500).json({ error: err.message });
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

// ==================== Fluctuation Alerts APIs ====================

// 取得所有警報
app.get('/api/alerts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM fluctuation_alerts ORDER BY date_str DESC, created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/alerts error:', err);
        if (err.code === '42P01') {
            res.json([]);
        } else {
            res.status(500).json({ error: '取得警報失敗', details: err.message });
        }
    }
});

// 新增警報
app.post('/api/alerts', async (req, res) => {
    try {
        const { id, tank_id, tank_name, date_str, reason, current_value, prev_value, next_value, is_possible_refill, source, note } = req.body;
        const result = await pool.query(
            `INSERT INTO fluctuation_alerts (id, tank_id, tank_name, date_str, reason, current_value, prev_value, next_value, is_possible_refill, source, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [id || crypto.randomUUID(), tank_id, tank_name, date_str, reason, current_value, prev_value, next_value, is_possible_refill || false, source || 'MANUAL', note]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('POST /api/alerts error:', err);
        res.status(500).json({ error: '新增警報失敗', details: err.message });
    }
});

// 批次新增警報
app.post('/api/alerts/batch', async (req, res) => {
    const client = await pool.connect();
    try {
        const { alerts } = req.body;

        // === 詳細日誌：印出收到的資料 ===
        console.log(`[POST /api/alerts/batch] 收到 ${alerts?.length ?? 'undefined'} 筆資料`);
        if (!alerts || !Array.isArray(alerts) || alerts.length === 0) {
            return res.status(400).json({ error: '請求 body 中缺少 alerts 陣列，或陣列為空' });
        }

        await client.query('BEGIN');

        const results = [];
        for (const alert of alerts) {
            const { id, tank_id, tank_name, date_str, reason, current_value, prev_value, next_value, is_possible_refill, source, note } = alert;

            // 逐筆印出插入參數，協助診斷
            console.log(`[Batch Insert Alert] tank_id="${tank_id}", date_str="${date_str}", reason="${reason}", source="${source}"`);

            const result = await client.query(
                `INSERT INTO fluctuation_alerts (id, tank_id, tank_name, date_str, reason, current_value, prev_value, next_value, is_possible_refill, source, note)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                [id || crypto.randomUUID(), tank_id, tank_name, date_str, reason, current_value, prev_value, next_value, is_possible_refill || false, source || 'MANUAL', note || '']
            );
            results.push(result.rows[0]);
        }

        await client.query('COMMIT');
        console.log(`[POST /api/alerts/batch] 成功插入 ${results.length} 筆`);
        res.status(201).json({ count: results.length, data: results });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /api/alerts/batch error:', err.message);
        console.error('  code:', err.code);
        console.error('  detail:', err.detail);
        console.error('  hint:', err.hint);
        console.error('  stack:', err.stack);
        res.status(500).json({ error: '批次新增警報失敗', details: err.message, code: err.code });
    } finally {
        client.release();
    }
});

// 更新警報備註
app.put('/api/alerts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { note } = req.body;
        const result = await pool.query(
            'UPDATE fluctuation_alerts SET note = $1 WHERE id = $2 RETURNING *',
            [note, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到該警報' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`PUT /api/alerts/${req.params.id} error:`, err);
        res.status(500).json({ error: '更新警報失敗', details: err.message });
    }
});

// 刪除單筆警報
app.delete('/api/alerts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM fluctuation_alerts WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到該警報' });
        }
        res.json({ success: true, id });
    } catch (err) {
        console.error(`DELETE /api/alerts/${req.params.id} error:`, err);
        res.status(500).json({ error: '刪除警報失敗', details: err.message });
    }
});

// 批次刪除警報
app.post('/api/alerts/batch-delete', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: '無效的 ids' });
        }
        await pool.query('DELETE FROM fluctuation_alerts WHERE id = ANY($1)', [ids]);
        res.json({ success: true, count: ids.length });
    } catch (err) {
        console.error('POST /api/alerts/batch-delete error:', err);
        res.status(500).json({ error: '批次刪除警報失敗', details: err.message });
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

//
// ==================== Important Notes APIs ====================

// 取得所有重要紀事
app.get('/api/notes', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM important_notes ORDER BY date_str DESC, created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/notes error:', err);
        // Table might not exist yet, return empty array instead of 500 to avoid breaking UI on first load
        if (err.code === '42P01') { // undefined_table
            res.json([]);
        } else {
            res.status(500).json({ error: '取得重要紀事失敗', details: err.message });
        }
    }
});

// 新增重要紀事
app.post('/api/notes', async (req, res) => {
    const note = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const sql = `
            INSERT INTO important_notes (id, date_str, area, chemical_name, note)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;

        const result = await client.query(sql, [
            note.id,
            note.date_str,
            note.area,
            note.chemical_name,
            note.note
        ]);

        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /api/notes error:', err);
        res.status(500).json({ error: '新增重要紀事失敗', details: err.message });
    } finally {
        client.release();
    }
});

// 批量新增重要紀事 (用於 Excel 匯入)
app.post('/api/notes/batch', async (req, res) => {
    const { notes } = req.body;

    if (!notes || !Array.isArray(notes) || notes.length === 0) {
        return res.status(400).json({ error: '無效的資料' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const sql = `
            INSERT INTO important_notes (id, date_str, area, chemical_name, note)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE SET
                date_str = EXCLUDED.date_str,
                area = EXCLUDED.area,
                chemical_name = EXCLUDED.chemical_name,
                note = EXCLUDED.note
        `;

        for (const note of notes) {
            await client.query(sql, [
                note.id,
                note.date_str,
                note.area,
                note.chemical_name,
                note.note
            ]);
        }

        await client.query('COMMIT');
        res.json({ success: true, count: notes.length });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /api/notes/batch error:', err);
        res.status(500).json({ error: '批量新增失敗', details: err.message });
    } finally {
        client.release();
    }
});

// 更新重要紀事
app.put('/api/notes/:id', async (req, res) => {
    const { id } = req.params;
    const note = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const sql = `
            UPDATE important_notes 
            SET date_str = $1, area = $2, chemical_name = $3, note = $4
            WHERE id = $5
            RETURNING *
        `;

        const result = await client.query(sql, [
            note.date_str,
            note.area,
            note.chemical_name,
            note.note,
            id
        ]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: '找不到該筆紀事' });
        }

        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`PUT /api/notes/${id} error:`, err);
        res.status(500).json({ error: '更新重要紀事失敗', details: err.message });
    } finally {
        client.release();
    }
});

// 刪除重要紀事
app.delete('/api/notes/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('DELETE FROM important_notes WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '找不到該筆紀事' });
        }

        res.json({ success: true, id });
    } catch (err) {
        console.error(`DELETE /api/notes/${id} error:`, err);
        res.status(500).json({ error: '刪除重要紀事失敗', details: err.message });
    }
});

// 啟動伺服器
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`📊 API 文件: http://localhost:${PORT}/api/health`);
});
