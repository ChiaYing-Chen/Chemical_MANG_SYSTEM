import fs from 'fs';
import path from 'path';
import express from 'express';
import pg from 'pg';
import cors from 'cors';
import fetch from 'node-fetch';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import crypto from 'crypto';
import * as backendUtils from './backendUtils.js';

// 本地開發環境原生載入 .env 配置
try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        fs.readFileSync(envPath, 'utf-8')
            .split(/\r?\n/)
            .forEach(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const parts = trimmed.split('=');
                    if (parts.length >= 2) {
                        const key = parts[0].trim();
                        const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
                        process.env[key] = val;
                    }
                }
            });
    }
} catch (err) {}

const { Pool } = pg;
const app = express();
const PORT = 3003;

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

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const LIKELY_REFILL_RISE_DAYS = 16;

const normalizeTimestampToTaipeiDayStart = (ts) => {
    const d = new Date(Number(ts) + TAIPEI_OFFSET_MS);
    if (isNaN(d.getTime())) return 0;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - TAIPEI_OFFSET_MS;
};

const getActiveSupplyAt = (timestamp, supplies) => {
    return supplies
        .filter(s => Number(s.start_date) <= Number(timestamp))
        .sort((a, b) => Number(b.start_date) - Number(a.start_date))[0];
};

const calculateActualUsageKgFromLevel = (tank, periodReadings, supplies) => {
    const orderedReadings = [...periodReadings].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    if (orderedReadings.length < 2) return { value: 0, hasEnoughData: false };

    const getVolume = (reading) => {
        const volume = backendUtils.calculateTankVolume(tank, Number(reading.level_cm));
        if (Number.isFinite(volume) && volume >= 0) return volume;
        return Number(reading.calculated_volume || 0);
    };

    const toKg = (liters, readingForContract) => {
        if (liters <= 0) return 0;
        const activeSupply = getActiveSupplyAt(Number(readingForContract.timestamp), supplies);
        const sg = Number(activeSupply?.specific_gravity || readingForContract.applied_sg || 1);
        return liters * sg;
    };

    const intervals = orderedReadings.slice(1).map((curr, index) => {
        const prev = orderedReadings[index];
        const prevVolume = getVolume(prev);
        const currVolume = getVolume(curr);

        return {
            curr,
            prevVolume,
            currVolume,
            addedLiters: Number(curr.added_amount_liters || 0),
            decreaseLiters: Math.max(0, prevVolume - currVolume),
            riseLiters: Math.max(0, currVolume - prevVolume)
        };
    });

    const firstReading = orderedReadings[0];
    const lastReading = orderedReadings[orderedReadings.length - 1];
    const elapsedDays = Math.max(1, (Number(lastReading.timestamp) - Number(firstReading.timestamp)) / DAY_MS);
    const estimatedDailyUsageLiters = intervals.reduce((sum, interval) => sum + interval.decreaseLiters, 0) / elapsedDays;
    const likelyRefillRiseThresholdLiters = estimatedDailyUsageLiters * LIKELY_REFILL_RISE_DAYS;

    const hasRefill = intervals.some(interval => {
        if (interval.addedLiters > 0) return true;
        if (estimatedDailyUsageLiters <= 0) return false;
        return interval.riseLiters >= likelyRefillRiseThresholdLiters;
    });

    if (!hasRefill) {
        return {
            value: toKg(getVolume(firstReading) - getVolume(lastReading), lastReading),
            hasEnoughData: true
        };
    }

    const value = intervals.reduce((sum, interval) => {
        const isImplicitRefill = estimatedDailyUsageLiters > 0 && interval.riseLiters >= likelyRefillRiseThresholdLiters;
        const intervalUsageLiters = interval.addedLiters > 0
            ? Math.max(0, (interval.prevVolume + interval.addedLiters) - interval.currVolume)
            : isImplicitRefill
                ? 0
                : interval.decreaseLiters;

        return sum + toKg(intervalUsageLiters, interval.curr);
    }, 0);

    return { value, hasEnoughData: true };
};

const findWeeklyParamForDay = (paramsHistory, dayTimestamp) => {
    return paramsHistory.find(p => {
        const pDate = normalizeTimestampToTaipeiDayStart(p.date);
        return dayTimestamp >= pDate && dayTimestamp < pDate + 7 * DAY_MS;
    });
};

const calculateTheoreticalUsageKg = (tank, supplies, cwsHistory, bwsHistory, startTime, endTime) => {
    let total = 0;
    let hasMissingTheoretical = false;

    for (let dayTs = startTime; dayTs <= endTime; dayTs += DAY_MS) {
        const activeSupply = getActiveSupplyAt(dayTs, supplies);
        const targetPpm = Number(activeSupply?.target_ppm || 0);
        if (!targetPpm) {
            hasMissingTheoretical = true;
            continue;
        }

        if (tank.system_type && tank.system_type.includes('冷卻')) {
            const param = findWeeklyParamForDay(cwsHistory, dayTs);
            if (param && Number(param.circulation_rate || 0) > 0) {
                let concentrationCycles = 8;
                if (param.cws_hardness && param.makeup_hardness && Number(param.makeup_hardness) > 0) {
                    concentrationCycles = Number(param.cws_hardness) / Number(param.makeup_hardness);
                } else if (param.concentration_cycles && Number(param.concentration_cycles) > 1) {
                    concentrationCycles = Number(param.concentration_cycles);
                }

                total += backendUtils.calculateCWSUsage(
                    Number(param.circulation_rate || 0),
                    Number(param.temp_diff || 0),
                    concentrationCycles,
                    targetPpm,
                    1
                );
            } else {
                hasMissingTheoretical = true;
            }
        } else if (tank.system_type && tank.system_type.includes('鍋爐')) {
            const param = findWeeklyParamForDay(bwsHistory, dayTs);
            if (param && Number(param.steam_production || 0) > 0) {
                total += ((Number(param.steam_production) / 7) * targetPpm) / 1000;
            } else {
                hasMissingTheoretical = true;
            }
        } else {
            hasMissingTheoretical = true;
        }
    }

    return { value: total, hasMissingTheoretical };
};

const getTaipeiDateString = (date = new Date()) => {
    const taipeiDate = new Date(date.getTime() + TAIPEI_OFFSET_MS);
    return taipeiDate.toISOString().slice(0, 10);
};

const addDaysToDateString = (dateStr, days) => {
    const [year, month, day] = String(dateStr).split('-').map(Number);
    if (!year || !month || !day) return null;
    const utcDate = new Date(Date.UTC(year, month - 1, day) + Number(days || 0) * DAY_MS);
    return utcDate.toISOString().slice(0, 10);
};

const getLiteInventoryApiBaseUrl = (req) => {
    if (process.env.LITEINVENTORY_API_BASE_URL) {
        return process.env.LITEINVENTORY_API_BASE_URL.replace(/\/$/, '');
    }

    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();

    if (!host || host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
        return 'http://10.122.51.61/LiteInventory/api';
    }

    return `${proto}://${host}/LiteInventory/api`;
};

const buildLiteInventoryHeaders = (req) => {
    const headers = { 'Content-Type': 'application/json' };
    const userId = req.headers['x-user-id'];
    if (userId) {
        const normalizedUser = Array.isArray(userId) ? userId[0] : String(userId);
        headers['x-remote-user'] = normalizedUser;
        headers['x-auth-user'] = normalizedUser;
    }

    const passthroughHeaders = [
        'x-remote-user',
        'x-auth-user',
        'x-iisnode-auth_user',
        'x-iisnode-logon_user',
        'auth-user',
        'remote_user',
        'cookie'
    ];

    for (const name of passthroughHeaders) {
        const value = req.headers[name];
        if (value && !headers[name]) headers[name] = Array.isArray(value) ? value[0] : value;
    }

    if (!headers['x-remote-user']) {
        const user = typeof getAuthorName === 'function' ? getAuthorName(req) : null;
        if (user && user !== '匿名') {
            headers['x-remote-user'] = user;
            headers['x-auth-user'] = user;
        }
    }

    return headers;
};

const callLiteInventoryApi = async (req, endpoint, options = {}) => {
    const baseUrl = getLiteInventoryApiBaseUrl(req);
    const response = await fetch(`${baseUrl}${endpoint}`, {
        method: options.method || 'GET',
        headers: { ...buildLiteInventoryHeaders(req), ...(options.headers || {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = { status: 'error', message: text || response.statusText };
    }

    if (!response.ok) {
        const err = new Error(data?.message || data?.error || `LiteInventory API ${response.status}`);
        err.status = response.status;
        err.payload = data;
        throw err;
    }

    return data;
};

const normalizeInventoryItem = (item) => ({
    key: item?.key || '',
    partNo: item?.partNo || '',
    name: item?.name || '',
    binCode: item?.binCode || '',
    quantity: Number(item?.quantity || 0),
    safetyStock: Number(item?.safetyStock || 0),
    area: item?.area || '',
    section: item?.section || '',
    note: item?.note || '',
    attribute: item?.attribute || '',
    y6InstrumentId: item?.y6InstrumentId || '',
    isControlled: Boolean(item?.isControlled)
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

// ==================== Debug APIs ====================
app.get('/api/debug/usage-report-data', async (req, res) => {
    try {
        const tanksRes = await pool.query('SELECT id, name, system_type, description FROM tanks');
        const tanks = tanksRes.rows;
        const details = [];
        
        for (const tank of tanks) {
            const suppliesRes = await pool.query('SELECT * FROM chemical_supplies WHERE tank_id = $1 ORDER BY start_date DESC LIMIT 1', [tank.id]);
            const activeSupply = suppliesRes.rows[0];
            
            const cwsRes = await pool.query('SELECT * FROM cws_parameters WHERE tank_id = $1 ORDER BY date DESC LIMIT 1', [tank.id]);
            const bwsRes = await pool.query('SELECT * FROM bws_parameters WHERE tank_id = $1 ORDER BY date DESC LIMIT 1', [tank.id]);
            
            details.push({
                id: tank.id,
                name: tank.name,
                system_type: tank.system_type,
                description: tank.description,
                activeSupply: activeSupply ? {
                    chemical_name: activeSupply.chemical_name,
                    target_ppm: activeSupply.target_ppm
                } : null,
                latestCwsParam: cwsRes.rows[0],
                latestBwsParam: bwsRes.rows[0]
            });
        }
        res.json(details);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
const piBatchFetch = (requests) => {
    const baseUrl = PI_BASE_URL;

    // 從環境變數讀取 PI 憑證（在伺服器一次性設定，不需使用者重複輸入）
    const piUser = process.env.PI_USERNAME || '';
    const piPass = process.env.PI_PASSWORD || '';
    const piDomain = process.env.PI_DOMAIN || '';
    const useEnvCred = piUser && piPass;

    const fullUser = useEnvCred
        ? (piDomain ? `${piDomain}\\${piUser}` : piUser)
        : '';
    const escapedPwd = useEnvCred ? piPass.replace(/'/g, "''") : '';

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

${useEnvCred
            ? `# 使用環境變數設定的 PI 帳號驗證
$secPwd = ConvertTo-SecureString '${escapedPwd}' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('${fullUser}', $secPwd)`
            : `# 環境變數未設定，使用目前 Windows 登入帳號自動驗證
$cred = $null`
        }
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
            $req.KeepAlive = $true
            $req.PreAuthenticate = $true
            if ($null -ne $cred) {
                $req.Credentials = $cred
            } else {
                $req.UseDefaultCredentials = $true
            }
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
    $servers = PiGet '${baseUrl}/dataservers'
    if ($null -eq $servers -or $null -eq $servers.Items -or $servers.Items.Count -eq 0) {
        throw "No data server found. Check permissions."
    }
    $serverId = $servers.Items[0].WebId
    $results['_serverWebId'] = $serverId

${requests.map((req, i) => `
    try {
        $tagName = '${req.tagName}'
        if ($tagWebIdCache.ContainsKey($tagName)) {
            $webId = $tagWebIdCache[$tagName]
        } else {
            $searchUrl = "${baseUrl}/dataservers/$serverId/points?nameFilter=$tagName"
            $search = PiGet $searchUrl
            if ($search.Items.Count -eq 0) {
                $results['${req.tagName}__${i}'] = @{ error = 'Tag Not Found'; value = 0 }
                continue
            }
            $webId = $search.Items[0].WebId
            $tagWebIdCache[$tagName] = $webId
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
        const { weeks = 4 } = req.body;

        logs.push('自動驗證 PI Web API，同時匯入 CWS 冷卻水與 BWS 鍋爐水數據...');

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

        const results = piBatchFetch(allRequests);

        const summary = [];
        // 驗證是否有驗證錯誤
        const firstResult = results.values().next().value;
        if (firstResult && firstResult.error && String(firstResult.error).includes('Auth')) {
            const msg = '❌ 驗證失敗: ' + firstResult.error;
            logs.push(msg);
            summary.push(msg);
        }

        // --- Process BWS results ---
        logs.push("Processing BWS data...");
        const boilerTanksRes = await pool.query("SELECT * FROM tanks WHERE system_type LIKE '%鍋爐%'");
        const boilerTanks = boilerTanksRes.rows;

        for (const week of targetWeeks) {
            let weekTotalSum = 0;
            let errorCount = 0;
            for (let i = 0; i < allRequests.length; i++) {
                const req = allRequests[i];
                if (req._group !== 'BWS' || req._weekStart.getTime() !== week.start.getTime()) continue;
                const key = req.tagName + '__' + i;
                const r = results.get(key);
                if (r && r.error) errorCount++;
                weekTotalSum += (r ? r.value || 0 : 0);
            }
            const safeTotal = Math.round(weekTotalSum * 24);
            const dateTs = week.start.getTime();

            let saveCount = 0;
            for (const tank of boilerTanks) {
                let existingSameDay = [];
                try {
                    const checkRes = await pool.query("SELECT id, date FROM bws_parameters WHERE tank_id = $1", [tank.id]);
                    const targetDate = new Date(dateTs);
                    existingSameDay = checkRes.rows.filter(r => {
                        const rDate = new Date(Number(r.date));
                        return rDate.getFullYear() === targetDate.getFullYear() &&
                               rDate.getMonth() === targetDate.getMonth() &&
                               rDate.getDate() === targetDate.getDate();
                    });
                } catch (e) { /* ignore */ }

                if (existingSameDay.length > 0) {
                    for (const existing of existingSameDay) {
                        await pool.query("UPDATE bws_parameters SET steam_production = $1, updated_at = NOW() WHERE id = $2", [safeTotal, existing.id]);
                    }
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

        // --- Process BWS/CWS results ---
        const cwsTanksRes = await pool.query("SELECT * FROM tanks WHERE system_type LIKE '%冷卻%'");
        const cwsTanks = cwsTanksRes.rows;

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
                    if (r && r.error) errors++;
                    flowSum += (r ? r.value || 0 : 0);
                } else if (req._group === 'CWS_' + areaKey + '_tempOut') {
                    if (r && r.error) errors++;
                    else { tOutSum += (r ? r.value || 0 : 0); tOutCount++; }
                } else if (req._group === 'CWS_' + areaKey + '_tempRet') {
                    if (r && r.error) errors++;
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
                    const existingRes = await pool.query("SELECT * FROM cws_parameters WHERE tank_id = $1", [tank.id]);
                    const targetDate = new Date(dateTs);
                    const existingSameDay = existingRes.rows.filter(r => {
                        const rDate = new Date(Number(r.date));
                        return rDate.getFullYear() === targetDate.getFullYear() &&
                               rDate.getMonth() === targetDate.getMonth() &&
                               rDate.getDate() === targetDate.getDate();
                    });
                    
                    if (existingSameDay.length > 0) {
                        for (const existing of existingSameDay) {
                            const cwsHardness = existing.cws_hardness || 0;
                            const makeupHardness = existing.makeup_hardness || 0;
                            const cycles = makeupHardness > 0 ? cwsHardness / makeupHardness : (existing.concentration_cycles || 8);
                            
                            await pool.query("UPDATE cws_parameters SET circulation_rate=$1, temp_outlet=$2, temp_return=$3, temp_diff=$4, concentration_cycles=$5, updated_at=NOW() WHERE id=$6",
                                [data.circulationRate, data.tempOutlet, data.tempReturn, data.tempDiff, cycles, existing.id]);
                        }
                    } else {
                        const cycles = 8;
                        await pool.query("INSERT INTO cws_parameters (id, tank_id, date, circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
                            [crypto.randomUUID(), tank.id, dateTs, data.circulationRate, data.tempOutlet, data.tempReturn, data.tempDiff, 0, 0, cycles]);
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
        const cwsTanksRes = await pool.query("SELECT * FROM tanks WHERE system_type LIKE '%冷卻%'");
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
                // Find the latest existing parameters to inherit circulation and temperatures
                const latestRes = await pool.query("SELECT * FROM cws_parameters WHERE tank_id = $1 ORDER BY date DESC LIMIT 1", [tank.id]);
                const latest = latestRes.rows[0];
                const circ = latest ? (latest.circulation_rate || 0) : 0;
                const tOut = latest ? (latest.temp_outlet || 0) : 0;
                const tRet = latest ? (latest.temp_return || 0) : 0;
                const tempDiff = latest ? (latest.temp_diff || 0) : 0;

                // Insert new with inherited values for others
                await pool.query(
                    "INSERT INTO cws_parameters (id, tank_id, date, circulation_rate, temp_outlet, temp_return, temp_diff, cws_hardness, makeup_hardness, concentration_cycles) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
                    [crypto.randomUUID(), tank.id, date, circ, tOut, tRet, tempDiff, hardnessValue, makeupHardness, cycles]
                );
                logs.push(`Inserted ${tank.name} with inherited params`);
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

        // 為舊版資料庫加入 updated_at 欄位
        await client.query(`
            ALTER TABLE app_settings 
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
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
    let client;
    try {
        client = await pool.connect();
    } catch (dbErr) {
        console.warn('⚠️ [PostgreSQL] 開發環境無法連線資料庫，跳過 Migration 流程。錯誤原因:', dbErr.message);
        return;
    }
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
        await client.query(`
            ALTER TABLE important_notes ADD COLUMN IF NOT EXISTS marked_water_type VARCHAR(10) DEFAULT NULL;
        `);
 
        // 7. Manual Water Quality Readings table
        console.log('Ensuring manual_water_quality_readings table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS manual_water_quality_readings (
                id UUID PRIMARY KEY,
                water_type VARCHAR(10) NOT NULL,
                test_date DATE NOT NULL,
                sample_point VARCHAR(50) NOT NULL,
                data JSONB NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT uq_type_date_point UNIQUE (water_type, test_date, sample_point)
            )
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_mwqr_type_date ON manual_water_quality_readings(water_type, test_date)
        `);
 
        // 8. Manual Water Quality Limits table
        console.log('Ensuring manual_water_quality_limits table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS manual_water_quality_limits (
                id SERIAL PRIMARY KEY,
                water_type VARCHAR(10) NOT NULL,
                sample_point VARCHAR(50) NOT NULL,
                metric_name VARCHAR(100) NOT NULL,
                min_value DOUBLE PRECISION,
                max_value DOUBLE PRECISION,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT uq_limit_type_point_metric UNIQUE (water_type, sample_point, metric_name)
            )
        `);

        // 9. Manual Water Quality Metric Aliases table
        console.log('Ensuring manual_water_quality_metric_aliases table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS manual_water_quality_metric_aliases (
                id SERIAL PRIMARY KEY,
                water_type VARCHAR(10) NOT NULL,
                original_name VARCHAR(100) NOT NULL,
                display_name VARCHAR(100) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT uq_alias_type_original UNIQUE (water_type, original_name)
            )
        `);

        // 10. Instrument Management tables
        console.log('Ensuring instrument management tables...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS instrument_management_configs (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                water_type VARCHAR(10) NOT NULL CHECK (water_type IN ('CW', 'BW')),
                test_item_key TEXT,
                instrument_item_key TEXT,
                note TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS instrument_management_consumables (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                config_id UUID NOT NULL REFERENCES instrument_management_configs(id) ON DELETE CASCADE,
                consumable_item_key TEXT NOT NULL,
                usage_type VARCHAR(20) NOT NULL DEFAULT 'general' CHECK (usage_type IN ('calibration', 'general')),
                shelf_life_days INTEGER,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS instrument_consumable_openings (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                config_id UUID REFERENCES instrument_management_configs(id) ON DELETE SET NULL,
                consumable_id UUID REFERENCES instrument_management_consumables(id) ON DELETE SET NULL,
                consumable_item_key TEXT NOT NULL,
                opened_date DATE NOT NULL,
                expires_date DATE,
                status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
                adjusted_inventory BOOLEAN DEFAULT FALSE,
                inventory_adjust_log_id TEXT,
                created_by TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS instrument_consumable_notifications (
                id SERIAL PRIMARY KEY,
                opening_id UUID NOT NULL REFERENCES instrument_consumable_openings(id) ON DELETE CASCADE,
                notify_date DATE NOT NULL,
                notification_key TEXT NOT NULL UNIQUE,
                sent_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_im_configs_water_type ON instrument_management_configs(water_type, sort_order)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_im_consumables_config ON instrument_management_consumables(config_id, sort_order)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_im_openings_expiry ON instrument_consumable_openings(expires_date, status)
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
    const client = await pool.connect();
    try {
        const { id } = req.params;
        await client.query('BEGIN');

        // 1. 取得即將刪除合約的資訊 (包含所屬儲槽與生效日期)
        const targetSupplyRes = await client.query('SELECT tank_id, start_date FROM chemical_supplies WHERE id = $1', [id]);

        if (targetSupplyRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: '找不到此合約紀錄' });
        }

        const { tank_id, start_date } = targetSupplyRes.rows[0];

        // 2. 尋找「前一筆」合約 (該儲槽在被刪除合約的生效日之前的最新一筆紀錄)
        const prevSupplyRes = await client.query(`
            SELECT id, specific_gravity 
            FROM chemical_supplies 
            WHERE tank_id = $1 AND start_date < $2 
            ORDER BY start_date DESC 
            LIMIT 1
        `, [tank_id, start_date]);

        // 3. 重新計算並換綁歷史紀錄
        if (prevSupplyRes.rows.length > 0) {
            // 有前一筆合約，將綁定在此合約的 readings 轉移至前一筆，並用前一筆的比重重新計算重量
            const prevSupply = prevSupplyRes.rows[0];
            await client.query(`
                UPDATE readings 
                SET supply_id = $1, 
                    applied_sg = $2, 
                    calculated_weight_kg = calculated_volume * $2 
                WHERE supply_id = $3
            `, [prevSupply.id, prevSupply.specific_gravity, id]);
        } else {
            // 找不到前一筆合約 (這是該儲槽最舊的第一份合約)，則解除綁定並將比重退回 1.0 (水)
            await client.query(`
                UPDATE readings 
                SET supply_id = NULL, 
                    applied_sg = 1.0, 
                    calculated_weight_kg = calculated_volume * 1.0 
                WHERE supply_id = $1
            `, [id]);
        }

        // 4. 安全刪除合約 (關聯已被移除)
        const result = await client.query(
            'DELETE FROM chemical_supplies WHERE id = $1 RETURNING *',
            [id]
        );

        await client.query('COMMIT');
        res.json({ message: '合約紀錄已刪除，且關聯歷史紀錄已溯源重新計算', deleted: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('刪除合約失敗 (Transaction Rolled Back):', err);
        res.status(500).json({ error: '刪除藥劑合約失敗，發生系統層級錯誤' });
    } finally {
        client.release();
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

const sanitizeAuthor = (name) => {
  if (!name || typeof name !== 'string') return null;
  if (name.includes('\uFFFD')) return null;
  const qMarks = (name.match(/\?/g) || []).length;
  if (qMarks > 0 && qMarks >= name.length / 2) return null;
  if (name.includes('?踹?')) return null;
  return name.trim();
};

const getAuthorName = (req) => {
  const rawUser = req.headers['x-remote-user'] ||
    req.headers['x-auth-user'] ||
    req.headers['x-iisnode-logon_user'] ||
    '';

  const sanitized = sanitizeAuthor(rawUser);
  if (!sanitized) return '匿名';

  const parts = sanitized.split('\\');
  return parts.length > 1 ? parts[parts.length - 1] : sanitized;
};

const checkMcpAccess = async (req) => {
  const iisUser = getAuthorName(req) || '匿名';

  let rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (Array.isArray(rawIp)) rawIp = rawIp[0];

  let clientIp = String(rawIp || "").replace(/^::ffff:/, '');
  if (clientIp.includes(':') && !clientIp.includes('[')) {
    const parts = clientIp.split(':');
    if (parts.length === 2) {
      clientIp = parts[0];
    }
  }

  const PIMCP_URL = process.env.PIMCP_API_URL || 'http://localhost:3011';
  try {
    const response = await fetch(`${PIMCP_URL}/api/agent/check-permission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: iisUser,
        clientIp: clientIp,
        requestedTool: 'connect' // 連線階段特殊 IP 放行檢驗
      })
    });

    if (response.ok) {
      const result = await response.json();
      if (result.allowed) {
        return { allowed: true, identity: iisUser, clientIp, source: 'PIMCP-IPFilter' };
      } else {
        return { allowed: false, identity: '匿名', source: 'PIMCP', message: result.message };
      }
    }
  } catch (err) {
    console.error('[WTCA PIMCP Connect Check Error]', err.message);
  }

  return { allowed: false, identity: '匿名', source: 'None', message: '無法連接權限伺服器。' };
};

// MCP SSE 連線端點 (IIS 相容版本)
app.get('/mcp-connect/:token', async (req, res) => {
    const token = req.params.token;

    // ACCESS CONTROL CHECK
    const access = await checkMcpAccess(req);
    if (!access.allowed) {
        return res.status(403).send(`Access Denied: ${access.message || "Your IP is not authorized."}`);
    }

    const mcpUserIdentity = access.identity;
    const mcpClientIp = access.clientIp || '127.0.0.1';
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

    const checkToolPermission = async (toolName) => {
        const PIMCP_URL = process.env.PIMCP_API_URL || 'http://localhost:3011';
        try {
            const response = await fetch(`${PIMCP_URL}/api/agent/check-permission`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: mcpUserIdentity,
                    clientIp: mcpClientIp,
                    requestedTool: toolName
                })
            });
            if (response.ok) {
                return await response.json();
            }
        } catch (err) {
            console.error(`[checkToolPermission Error]`, err.message);
        }
        return { allowed: false, message: '無法連接權限伺服器，出於安全考量已阻斷請求。' };
    };

    // ==================== MCP Tools 定義 ====================

    // Tool 1: 查詢儲槽資料
    server.tool(
        'query-tanks',
        {
            tankId: z.string().optional().describe('儲槽 ID (選填，留空則回傳所有儲槽)')
        },
        async ({ tankId }) => {
            try {
                const checkRes = await checkToolPermission('WTCA/query-tanks');
                if (!checkRes.allowed) {
                    return {
                        content: [{
                            type: 'text',
                            text: `錯誤: 權限遭拒。${checkRes.message}`
                        }],
                        isError: true
                    };
                }
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
                const checkRes = await checkToolPermission('WTCA/query-readings');
                if (!checkRes.allowed) {
                    return {
                        content: [{
                            type: 'text',
                            text: `錯誤: 權限遭拒。${checkRes.message}`
                        }],
                        isError: true
                    };
                }
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
                const checkRes = await checkToolPermission('WTCA/query-supplies');
                if (!checkRes.allowed) {
                    return {
                        content: [{
                            type: 'text',
                            text: `錯誤: 權限遭拒。${checkRes.message}`
                        }],
                        isError: true
                    };
                }
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
                const checkRes = await checkToolPermission('WTCA/execute-sql');
                if (!checkRes.allowed) {
                    return {
                        content: [{
                            type: 'text',
                            text: `錯誤: 權限遭拒。${checkRes.message}`
                        }],
                        isError: true
                    };
                }
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
                const checkRes = await checkToolPermission('WTCA/get-database-stats');
                if (!checkRes.allowed) {
                    return {
                        content: [{
                            type: 'text',
                            text: `錯誤: 權限遭拒。${checkRes.message}`
                        }],
                        isError: true
                    };
                }
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

// ==================== Manual Water Quality Readings APIs ====================

// 取得人工檢驗水質數據 (可選 query 參數 waterType = 'CW' | 'BW')
app.get('/api/manual-water-quality', async (req, res) => {
    try {
        const { waterType } = req.query;
        let query = "SELECT id, water_type, TO_CHAR(test_date, 'YYYY-MM-DD') AS test_date, sample_point, data, created_at FROM manual_water_quality_readings";
        let params = [];
        
        if (waterType) {
            query += ' WHERE water_type = $1';
            params.push(waterType);
        }
        
        query += ' ORDER BY test_date DESC, sample_point ASC';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/manual-water-quality error:', err);
        if (err.code === '42P01') {
            res.json([]);
        } else {
            res.status(500).json({ error: '取得水質數據失敗', details: err.message });
        }
    }
});

// PIMCP SSO 管理者權限判定 Helper
const checkIsAdminByPimcp = async (req) => {
    // 優先從前端傳入的 Query 參數、Body 或是 Header 獲取 userId
    let user = req.query.userId || req.body?.userId || req.headers['x-user-id'];
    
    // 若前端未帶，則 fallback 嘗試使用與 checkMcpAccess 相同的 IIS 網域帳號提取邏輯
    if (!user) {
        user = getAuthorName(req) || '匿名';
    }

    if (user === '匿名' || !user) {
        return { isAdmin: false, username: '匿名' };
    }

    let rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (Array.isArray(rawIp)) rawIp = rawIp[0];
    let clientIp = String(rawIp || "").replace(/^::ffff:/, '');
    if (clientIp.includes(':') && !clientIp.includes('[')) {
        const parts = clientIp.split(':');
        if (parts.length === 2) {
            clientIp = parts[0];
        }
    }

    const PIMCP_URL = process.env.PIMCP_API_URL || 'http://localhost:3011';
    try {
        const response = await fetch(`${PIMCP_URL}/api/agent/check-permission`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: user,
                clientIp: clientIp,
                requestedTool: 'WTCA/manage-limits' // 利用 PIMCP Admin 可任意呼叫該 requestedTool 的特性進行 Admin 身份判定
            })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.allowed) {
                return { isAdmin: true, username: user };
            }
        }
    } catch (err) {
        console.error('[WTCA PIMCP Admin Check Error]', err.message);
    }
    return { isAdmin: false, username: user };
};

const toInstrumentConfigDto = (row, consumables = []) => ({
    id: row.id,
    waterType: row.water_type,
    testItemKey: row.test_item_key || '',
    instrumentItemKey: row.instrument_item_key || '',
    note: row.note || '',
    sortOrder: Number(row.sort_order || 0),
    consumables: consumables.map(c => ({
        id: c.id,
        configId: c.config_id,
        consumableItemKey: c.consumable_item_key,
        usageType: c.usage_type,
        shelfLifeDays: c.shelf_life_days === null || c.shelf_life_days === undefined ? null : Number(c.shelf_life_days),
        sortOrder: Number(c.sort_order || 0)
    }))
});

const toOpeningDto = (row) => ({
    id: row.id,
    configId: row.config_id,
    consumableId: row.consumable_id,
    consumableItemKey: row.consumable_item_key,
    openedDate: typeof row.opened_date === 'string' ? row.opened_date.slice(0, 10) : getTaipeiDateString(new Date(row.opened_date)),
    expiresDate: row.expires_date ? (typeof row.expires_date === 'string' ? row.expires_date.slice(0, 10) : getTaipeiDateString(new Date(row.expires_date))) : null,
    status: row.status,
    adjustedInventory: Boolean(row.adjusted_inventory),
    inventoryAdjustLogId: row.inventory_adjust_log_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

const validateInstrumentConfigPayload = (payload) => {
    const waterType = payload.waterType || payload.water_type;
    const testItemKey = payload.testItemKey ?? payload.test_item_key ?? '';
    const instrumentItemKey = payload.instrumentItemKey ?? payload.instrument_item_key ?? '';
    const consumables = Array.isArray(payload.consumables) ? payload.consumables : [];

    if (!['CW', 'BW'].includes(waterType)) {
        return { error: 'waterType 必須為 CW 或 BW' };
    }

    const normalizedConsumables = consumables
        .map((item, index) => ({
            id: item.id,
            consumableItemKey: item.consumableItemKey || item.consumable_item_key || '',
            usageType: item.usageType || item.usage_type || 'general',
            shelfLifeDays: item.shelfLifeDays === '' || item.shelfLifeDays === undefined ? null : item.shelfLifeDays,
            sortOrder: Number(item.sortOrder ?? item.sort_order ?? index)
        }))
        .filter(item => item.consumableItemKey);

    for (const item of normalizedConsumables) {
        if (!['calibration', 'general'].includes(item.usageType)) {
            return { error: '耗材用途必須為 calibration 或 general' };
        }
        if (item.shelfLifeDays !== null) {
            const days = Number(item.shelfLifeDays);
            if (!Number.isInteger(days) || days < 0) {
                return { error: '保存期限必須為 0 以上整數天數' };
            }
            item.shelfLifeDays = days;
        }
    }

    if (!testItemKey && !instrumentItemKey && normalizedConsumables.length === 0) {
        return { error: '至少需設定測試項目、手持儀器或耗材其中一項' };
    }

    if (instrumentItemKey && !normalizedConsumables.some(item => item.usageType === 'calibration')) {
        return { error: '有設定手持儀器時，必須設定至少一項校正耗材' };
    }

    return {
        value: {
            waterType,
            testItemKey,
            instrumentItemKey,
            note: payload.note || '',
            sortOrder: Number(payload.sortOrder ?? payload.sort_order ?? 0),
            consumables: normalizedConsumables
        }
    };
};

const fetchInstrumentConfigs = async (client = pool) => {
    const configsRes = await client.query('SELECT * FROM instrument_management_configs ORDER BY water_type, sort_order, created_at');
    const consumablesRes = await client.query('SELECT * FROM instrument_management_consumables ORDER BY config_id, sort_order, created_at');
    const consumablesByConfig = new Map();

    for (const item of consumablesRes.rows) {
        if (!consumablesByConfig.has(item.config_id)) consumablesByConfig.set(item.config_id, []);
        consumablesByConfig.get(item.config_id).push(item);
    }

    return configsRes.rows.map(row => toInstrumentConfigDto(row, consumablesByConfig.get(row.id) || []));
};

const replaceInstrumentConsumables = async (client, configId, consumables) => {
    await client.query('DELETE FROM instrument_management_consumables WHERE config_id = $1', [configId]);
    for (const item of consumables) {
        await client.query(
            `INSERT INTO instrument_management_consumables
             (config_id, consumable_item_key, usage_type, shelf_life_days, sort_order)
             VALUES ($1, $2, $3, $4, $5)`,
            [configId, item.consumableItemKey, item.usageType, item.shelfLifeDays, item.sortOrder]
        );
    }
};

app.get('/api/instrument-management/inventory-items', async (req, res) => {
    try {
        const items = await callLiteInventoryApi(req, '/inventory');
        const query = String(req.query.q || '').trim().toLowerCase();
        const normalized = Array.isArray(items) ? items.map(normalizeInventoryItem) : [];
        const filtered = query
            ? normalized.filter(item =>
                [item.key, item.partNo, item.name, item.binCode, item.area, item.section]
                    .some(value => String(value || '').toLowerCase().includes(query))
            )
            : normalized;
        res.json(filtered.slice(0, 200));
    } catch (err) {
        console.error('GET /api/instrument-management/inventory-items error:', err.message);
        res.status(err.status || 500).json(err.payload || { error: '取得 LiteInventory 物料失敗', details: err.message });
    }
});

app.get('/api/instrument-management/configs', async (_req, res) => {
    try {
        res.json(await fetchInstrumentConfigs());
    } catch (err) {
        console.error('GET /api/instrument-management/configs error:', err);
        res.status(500).json({ error: '取得儀器管理設定失敗', details: err.message });
    }
});

app.post('/api/instrument-management/configs', async (req, res) => {
    const parsed = validateInstrumentConfigPayload(req.body || {});
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const item = parsed.value;
        const result = await client.query(
            `INSERT INTO instrument_management_configs
             (water_type, test_item_key, instrument_item_key, note, sort_order)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [item.waterType, item.testItemKey || null, item.instrumentItemKey || null, item.note, item.sortOrder]
        );
        await replaceInstrumentConsumables(client, result.rows[0].id, item.consumables);
        await client.query('COMMIT');
        const configs = await fetchInstrumentConfigs();
        res.status(201).json(configs.find(config => config.id === result.rows[0].id));
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /api/instrument-management/configs error:', err);
        res.status(500).json({ error: '新增儀器管理設定失敗', details: err.message });
    } finally {
        client.release();
    }
});

app.put('/api/instrument-management/configs/:id', async (req, res) => {
    const parsed = validateInstrumentConfigPayload(req.body || {});
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const item = parsed.value;
        const result = await client.query(
            `UPDATE instrument_management_configs
             SET water_type = $1, test_item_key = $2, instrument_item_key = $3, note = $4, sort_order = $5, updated_at = NOW()
             WHERE id = $6 RETURNING *`,
            [item.waterType, item.testItemKey || null, item.instrumentItemKey || null, item.note, item.sortOrder, req.params.id]
        );
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: '找不到儀器管理設定' });
        }
        await replaceInstrumentConsumables(client, req.params.id, item.consumables);
        await client.query('COMMIT');
        const configs = await fetchInstrumentConfigs();
        res.json(configs.find(config => config.id === req.params.id));
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`PUT /api/instrument-management/configs/${req.params.id} error:`, err);
        res.status(500).json({ error: '更新儀器管理設定失敗', details: err.message });
    } finally {
        client.release();
    }
});

app.delete('/api/instrument-management/configs/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM instrument_management_configs WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '找不到儀器管理設定' });
        res.json({ success: true });
    } catch (err) {
        console.error(`DELETE /api/instrument-management/configs/${req.params.id} error:`, err);
        res.status(500).json({ error: '刪除儀器管理設定失敗', details: err.message });
    }
});

app.get('/api/instrument-management/openings', async (_req, res) => {
    try {
        const result = await pool.query('SELECT * FROM instrument_consumable_openings ORDER BY opened_date DESC, created_at DESC');
        res.json(result.rows.map(toOpeningDto));
    } catch (err) {
        console.error('GET /api/instrument-management/openings error:', err);
        res.status(500).json({ error: '取得耗材開封紀錄失敗', details: err.message });
    }
});

app.post('/api/instrument-management/openings', async (req, res) => {
    const openedDate = req.body?.openedDate || getTaipeiDateString();
    const createdBy = getAuthorName(req);
    let configId = req.body?.configId || null;
    let consumableId = req.body?.consumableId || null;
    let consumableItemKey = req.body?.consumableItemKey || '';
    let shelfLifeDays = req.body?.shelfLifeDays;

    try {
        if (consumableId) {
            const lookup = await pool.query(
                `SELECT c.config_id, c.consumable_item_key, c.shelf_life_days
                 FROM instrument_management_consumables c
                 WHERE c.id = $1`,
                [consumableId]
            );
            if (lookup.rows.length === 0) return res.status(404).json({ error: '找不到耗材設定' });
            configId = configId || lookup.rows[0].config_id;
            consumableItemKey = consumableItemKey || lookup.rows[0].consumable_item_key;
            shelfLifeDays = shelfLifeDays ?? lookup.rows[0].shelf_life_days;
        }

        if (!consumableItemKey) return res.status(400).json({ error: '缺少耗材物料' });
        const expiresDate = req.body?.expiresDate || (shelfLifeDays === null || shelfLifeDays === undefined || shelfLifeDays === ''
            ? null
            : addDaysToDateString(openedDate, Number(shelfLifeDays)));

        const result = await pool.query(
            `INSERT INTO instrument_consumable_openings
             (config_id, consumable_id, consumable_item_key, opened_date, expires_date, status, created_by)
             VALUES ($1, $2, $3, $4, $5, 'OPEN', $6) RETURNING *`,
            [configId, consumableId, consumableItemKey, openedDate, expiresDate, createdBy]
        );
        res.status(201).json(toOpeningDto(result.rows[0]));
    } catch (err) {
        console.error('POST /api/instrument-management/openings error:', err);
        res.status(500).json({ error: '新增耗材開封紀錄失敗', details: err.message });
    }
});

app.patch('/api/instrument-management/openings/:id', async (req, res) => {
    try {
        const current = await pool.query('SELECT * FROM instrument_consumable_openings WHERE id = $1', [req.params.id]);
        if (current.rows.length === 0) return res.status(404).json({ error: '找不到耗材開封紀錄' });
        const row = current.rows[0];
        const result = await pool.query(
            `UPDATE instrument_consumable_openings
             SET status = $1, adjusted_inventory = $2, inventory_adjust_log_id = $3, updated_at = NOW()
             WHERE id = $4 RETURNING *`,
            [
                req.body?.status || row.status,
                req.body?.adjustedInventory ?? req.body?.adjusted_inventory ?? row.adjusted_inventory,
                req.body?.inventoryAdjustLogId ?? req.body?.inventory_adjust_log_id ?? row.inventory_adjust_log_id,
                req.params.id
            ]
        );
        res.json(toOpeningDto(result.rows[0]));
    } catch (err) {
        console.error(`PATCH /api/instrument-management/openings/${req.params.id} error:`, err);
        res.status(500).json({ error: '更新耗材開封紀錄失敗', details: err.message });
    }
});

app.post('/api/instrument-management/inventory-adjust', async (req, res) => {
    try {
        const result = await callLiteInventoryApi(req, '/inventory/adjust', {
            method: 'POST',
            body: {
                itemKey: req.body?.itemKey,
                diff: req.body?.diff,
                note: req.body?.note || 'WTCA 儀器管理庫存調整',
                source: 'WTCA_INSTRUMENT_MANAGEMENT',
                refId: req.body?.refId
            }
        });
        res.json(result);
    } catch (err) {
        console.error('POST /api/instrument-management/inventory-adjust error:', err.message);
        res.status(err.status || 500).json(err.payload || { error: '調整 LiteInventory 庫存失敗', message: err.message });
    }
});

const fetchLiteInventoryItemsForServer = async () => {
    const baseUrl = (process.env.LITEINVENTORY_API_BASE_URL || 'http://10.122.51.61/LiteInventory/api').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/inventory`);
    if (!response.ok) return [];
    const items = await response.json();
    return Array.isArray(items) ? items.map(normalizeInventoryItem) : [];
};

const sendInstrumentExpiryNotifications = async () => {
    const subscriptionId = process.env.PIMCP_INSTRUMENT_EXPIRY_SUBSCRIPTION_ID
        ? parseInt(process.env.PIMCP_INSTRUMENT_EXPIRY_SUBSCRIPTION_ID, 10)
        : null;
    if (!subscriptionId) {
        return { sent: false, reason: 'missing_subscription', count: 0 };
    }

    const today = getTaipeiDateString();
    const dueRes = await pool.query(
        `SELECT o.*, c.water_type
         FROM instrument_consumable_openings o
         LEFT JOIN instrument_management_configs c ON c.id = o.config_id
         WHERE o.status = 'OPEN'
           AND o.expires_date = $1
           AND NOT EXISTS (
               SELECT 1 FROM instrument_consumable_notifications n
               WHERE n.opening_id = o.id AND n.notify_date = $1
           )
         ORDER BY o.expires_date, o.created_at`,
        [today]
    );

    if (dueRes.rows.length === 0) return { sent: false, reason: 'no_due_items', count: 0 };

    const inventoryItems = await fetchLiteInventoryItemsForServer();
    const itemMap = new Map(inventoryItems.map(item => [item.key, item]));
    const lines = dueRes.rows.map(row => {
        const item = itemMap.get(row.consumable_item_key);
        const waterType = row.water_type === 'CW' ? '冷卻水' : row.water_type === 'BW' ? '鍋爐水' : '未分類';
        return `- ${waterType}｜${item?.name || row.consumable_item_key}，開封日 ${toOpeningDto(row).openedDate}`;
    });

    const PIMCP_URL = process.env.PIMCP_API_URL || 'http://localhost:3011';
    const response = await fetch(`${PIMCP_URL}/api/notifications/external-api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            subscriptionId,
            title: 'WTCA 儀器耗材到期提醒',
            message: `${today} 有 ${dueRes.rows.length} 筆儀器耗材已到期：\n${lines.join('\n')}`,
            status: 'warning'
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`PIMCP notification failed: ${response.status} ${text}`);
    }

    for (const row of dueRes.rows) {
        await pool.query(
            `INSERT INTO instrument_consumable_notifications (opening_id, notify_date, notification_key)
             VALUES ($1, $2, $3)
             ON CONFLICT (notification_key) DO NOTHING`,
            [row.id, today, `${row.id}:${today}`]
        );
    }

    return { sent: true, count: dueRes.rows.length, date: today };
};

app.post('/api/instrument-management/expiry-check', async (_req, res) => {
    try {
        res.json(await sendInstrumentExpiryNotifications());
    } catch (err) {
        console.error('POST /api/instrument-management/expiry-check error:', err);
        res.status(500).json({ error: '儀器耗材到期檢查失敗', details: err.message });
    }
});

// 取得當前登入者是否為網站管理者 (對接 PIMCP SSO)
app.get('/api/manual-water-quality/is-admin', async (req, res) => {
    try {
        const auth = await checkIsAdminByPimcp(req);
        res.json(auth);
    } catch (err) {
        console.error('GET /api/manual-water-quality/is-admin error:', err);
        res.status(500).json({ isAdmin: false, error: err.message });
    }
});

// 預設控制限值定義 (基於最新一週 0623 工作表標準)
const PRESET_WATER_LIMITS = [
    // CW: 冷卻水
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2'], metric_name: 'pH', min_value: 7.4, max_value: 7.8 },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2'], metric_name: 'Calcium Hardness                             as CaCO3  ppm (鈣硬度)', min_value: 900.0, max_value: 1000.0 },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2'], metric_name: 'Chloride                                   as Cl ppm(氯)', min_value: null, max_value: 300.0 },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2'], metric_name: 'Silica                                        as SiO2 ppm (矽酸鹽)', min_value: null, max_value: 150.0 },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2'], metric_name: 'Organic Phosphate                as  PO4  ppm (有機磷)', min_value: 1.0, max_value: 5.0 },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2'], metric_name: 'Ortho Phosphate                           as  PO4  ppm (正磷酸鹽)', min_value: 1.0, max_value: 5.0 },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2', 'TW'], metric_name: 'Total Iron as Fe, ppm (鐵)', min_value: null, max_value: 1.0 },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2'], metric_name: 'Zinc as Zn+2, ppm (鋅)', min_value: 1.0, max_value: null },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2'], metric_name: 'ppm TKC-3635', min_value: 45.0, max_value: 55.0 },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2'], metric_name: 'ppm 阻垢劑', min_value: 1.5, max_value: null },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2', 'TW'], metric_name: 'SS, ppm (懸浮物)', min_value: null, max_value: 10.0 },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2', 'TW'], metric_name: '殘留氯 (R-Cl) ppm', min_value: 0.02, max_value: 0.15 },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2'], metric_name: '細菌數 (colonies/mL)', min_value: null, max_value: 10000.0 },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2', 'TW'], metric_name: 'Turbidity, NTU  (渾濁度)', min_value: null, max_value: 10.0 },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2'], metric_name: 'LSI', min_value: null, max_value: 2.5 },
    { water_type: 'CW', sample_points: ['CW_1', 'CW_2'], metric_name: 'RSI', min_value: 5.5, max_value: 7.0 },

    // BW: 鍋爐水
    // 1. DMP (除礦水)
    { water_type: 'BW', sample_points: ['DMP'], metric_name: 'pH at 25°C', min_value: 6.5, max_value: 7.5 },
    { water_type: 'BW', sample_points: ['DMP'], metric_name: 'Specific Conductance                     μs/cm 25°C(電導度)', min_value: null, max_value: 0.2 },
    { water_type: 'BW', sample_points: ['DMP'], metric_name: 'Silica as SiO2 ,ppb (矽)', min_value: null, max_value: 10.0 },
    { water_type: 'BW', sample_points: ['DMP'], metric_name: 'Total iron as Fe ,ppb (鐵)', min_value: null, max_value: 10.0 },
    { water_type: 'BW', sample_points: ['DMP'], metric_name: 'Na+  ,ppb (鈉)', min_value: null, max_value: 10.0 },
    { water_type: 'BW', sample_points: ['DMP'], metric_name: 'Copper as Cu, ppb (銅)', min_value: null, max_value: 10.0 },

    // 2. LP (低壓)
    { water_type: 'BW', sample_points: ['BLR1_LP', 'BLR2_LP', 'BLR3_LP', 'BLR4_LP'], metric_name: 'pH at 25°C', min_value: 8.8, max_value: 9.2 },
    { water_type: 'BW', sample_points: ['BLR1_LP', 'BLR2_LP', 'BLR3_LP', 'BLR4_LP'], metric_name: 'Specific Conductance                     μs/cm 25°C(電導度)', min_value: null, max_value: 5.0 },
    { water_type: 'BW', sample_points: ['BLR1_LP', 'BLR2_LP', 'BLR3_LP', 'BLR4_LP'], metric_name: 'Silica as SiO2 ,ppb (矽)', min_value: null, max_value: 20.0 },
    { water_type: 'BW', sample_points: ['BLR1_LP', 'BLR2_LP', 'BLR3_LP', 'BLR4_LP'], metric_name: 'Total iron as Fe ,ppb (鐵)', min_value: null, max_value: 10.0 },

    // 3. DEA (脫氣)
    { water_type: 'BW', sample_points: ['BLR1_DEA', 'BLR2_DEA', 'BLR3_DEA', 'BLR4_DEA'], metric_name: 'pH at 25°C', min_value: 8.8, max_value: 9.2 },
    { water_type: 'BW', sample_points: ['BLR1_DEA', 'BLR2_DEA', 'BLR3_DEA', 'BLR4_DEA'], metric_name: 'Specific Conductance                     μs/cm 25°C(電導度)', min_value: null, max_value: 5.0 },
    { water_type: 'BW', sample_points: ['BLR1_DEA', 'BLR2_DEA', 'BLR3_DEA', 'BLR4_DEA'], metric_name: 'Silica as SiO2 ,ppb (矽)', min_value: null, max_value: 20.0 },
    { water_type: 'BW', sample_points: ['BLR1_DEA', 'BLR2_DEA', 'BLR3_DEA', 'BLR4_DEA'], metric_name: 'Total iron as Fe ,ppb (鐵)', min_value: null, max_value: 10.0 },
    { water_type: 'BW', sample_points: ['BLR1_DEA', 'BLR2_DEA', 'BLR3_DEA', 'BLR4_DEA'], metric_name: 'OS5613, ppm (脫氧劑)', min_value: 0.1, max_value: 0.5 },
    { water_type: 'BW', sample_points: ['BLR1_DEA', 'BLR2_DEA', 'BLR3_DEA', 'BLR4_DEA'], metric_name: 'DO ,ppb (溶氧)', min_value: null, max_value: 7.0 },

    // 4. SS (飽和蒸汽)
    { water_type: 'BW', sample_points: ['BLR1_SS', 'BLR2_SS', 'BLR3_SS', 'BLR4_SS'], metric_name: 'pH at 25°C', min_value: 8.8, max_value: 9.2 },
    { water_type: 'BW', sample_points: ['BLR1_SS', 'BLR2_SS', 'BLR3_SS', 'BLR4_SS'], metric_name: 'Specific Conductance                     μs/cm 25°C(電導度)', min_value: null, max_value: 5.0 },
    { water_type: 'BW', sample_points: ['BLR1_SS', 'BLR2_SS', 'BLR3_SS', 'BLR4_SS'], metric_name: 'Silica as SiO2 ,ppb (矽)', min_value: null, max_value: 20.0 },
    { water_type: 'BW', sample_points: ['BLR1_SS', 'BLR2_SS', 'BLR3_SS', 'BLR4_SS'], metric_name: 'Total iron as Fe ,ppb (鐵)', min_value: null, max_value: 10.0 },
    { water_type: 'BW', sample_points: ['BLR1_SS', 'BLR2_SS', 'BLR3_SS', 'BLR4_SS'], metric_name: 'Na+  ,ppb (鈉)', min_value: null, max_value: 10.0 },

    // 5. BFW (給水)
    { water_type: 'BW', sample_points: ['BLR1_BFW', 'BLR2_BFW', 'BLR3_BFW', 'BLR4_BFW'], metric_name: 'pH at 25°C', min_value: 8.8, max_value: 9.2 },
    { water_type: 'BW', sample_points: ['BLR1_BFW', 'BLR2_BFW', 'BLR3_BFW', 'BLR4_BFW'], metric_name: 'Specific Conductance                     μs/cm 25°C(電導度)', min_value: null, max_value: 5.0 },
    { water_type: 'BW', sample_points: ['BLR1_BFW', 'BLR2_BFW', 'BLR3_BFW', 'BLR4_BFW'], metric_name: 'Silica as SiO2 ,ppb (矽)', min_value: null, max_value: 20.0 },
    { water_type: 'BW', sample_points: ['BLR1_BFW', 'BLR2_BFW', 'BLR3_BFW', 'BLR4_BFW'], metric_name: 'Total iron as Fe ,ppb (鐵)', min_value: null, max_value: 20.0 },

    // 6. MS (主蒸汽)
    { water_type: 'BW', sample_points: ['BLR1_MS', 'BLR2_MS', 'BLR3_MS', 'BLR4_MS'], metric_name: 'pH at 25°C', min_value: 8.8, max_value: 9.2 },
    { water_type: 'BW', sample_points: ['BLR1_MS', 'BLR2_MS', 'BLR3_MS', 'BLR4_MS'], metric_name: 'Specific Conductance                     μs/cm 25°C(電導度)', min_value: null, max_value: 5.0 },
    { water_type: 'BW', sample_points: ['BLR1_MS', 'BLR2_MS', 'BLR3_MS', 'BLR4_MS'], metric_name: 'Silica as SiO2 ,ppb (矽)', min_value: null, max_value: 20.0 },
    { water_type: 'BW', sample_points: ['BLR1_MS', 'BLR2_MS', 'BLR3_MS', 'BLR4_MS'], metric_name: 'Total iron as Fe ,ppb (鐵)', min_value: null, max_value: 10.0 },
    { water_type: 'BW', sample_points: ['BLR1_MS', 'BLR2_MS', 'BLR3_MS', 'BLR4_MS'], metric_name: 'Na+  ,ppb (鈉)', min_value: null, max_value: 10.0 },

    // 7. CBD (爐水)
    { water_type: 'BW', sample_points: ['BLR1_CBD', 'BLR2_CBD', 'BLR3_CBD', 'BLR4_CBD'], metric_name: 'pH at 25°C', min_value: 9.0, max_value: 9.5 },
    { water_type: 'BW', sample_points: ['BLR1_CBD', 'BLR2_CBD', 'BLR3_CBD', 'BLR4_CBD'], metric_name: 'Specific Conductance                     μs/cm 25°C(電導度)', min_value: 5.0, max_value: 20.0 },
    { water_type: 'BW', sample_points: ['BLR1_CBD', 'BLR2_CBD', 'BLR3_CBD', 'BLR4_CBD'], metric_name: 'Silica as SiO2 ,ppb (矽)', min_value: null, max_value: 300.0 },
    { water_type: 'BW', sample_points: ['BLR1_CBD', 'BLR2_CBD', 'BLR3_CBD', 'BLR4_CBD'], metric_name: 'OPO4 as PO4 ,ppm (磷酸鹽)', min_value: 1.0, max_value: 4.0 },
    { water_type: 'BW', sample_points: ['BLR1_CBD', 'BLR2_CBD', 'BLR3_CBD', 'BLR4_CBD'], metric_name: 'Total iron as Fe ,ppb (鐵)', min_value: null, max_value: 10.0 },

    // 8. CD (冷凝水)
    { water_type: 'BW', sample_points: ['BLR1_CD', 'BLR2_CD', 'BLR3_CD', 'BLR4_CD'], metric_name: 'pH at 25°C', min_value: 8.8, max_value: 9.2 },
    { water_type: 'BW', sample_points: ['BLR1_CD', 'BLR2_CD', 'BLR3_CD', 'BLR4_CD'], metric_name: 'Specific Conductance                     μs/cm 25°C(電導度)', min_value: null, max_value: 5.0 },
    { water_type: 'BW', sample_points: ['BLR1_CD', 'BLR2_CD', 'BLR3_CD', 'BLR4_CD'], metric_name: 'Silica as SiO2 ,ppb (矽)', min_value: null, max_value: 20.0 },
    { water_type: 'BW', sample_points: ['BLR1_CD', 'BLR2_CD', 'BLR3_CD', 'BLR4_CD'], metric_name: 'Total iron as Fe ,ppb (鐵)', min_value: null, max_value: 10.0 },
    { water_type: 'BW', sample_points: ['BLR1_CD', 'BLR2_CD', 'BLR3_CD', 'BLR4_CD'], metric_name: 'NH3 ,ppm (氨)', min_value: null, max_value: 0.3 },
    { water_type: 'BW', sample_points: ['BLR1_CD', 'BLR2_CD', 'BLR3_CD', 'BLR4_CD'], metric_name: 'Copper as Cu, ppb (銅)', min_value: null, max_value: 10.0 },
    { water_type: 'BW', sample_points: ['BLR1_CD', 'BLR2_CD', 'BLR3_CD', 'BLR4_CD'], metric_name: 'Total Hardness as CaCO3 ppb (總硬度)', min_value: null, max_value: 20.0 },
    { water_type: 'BW', sample_points: ['BLR1_CD', 'BLR2_CD', 'BLR3_CD', 'BLR4_CD'], metric_name: 'DO ,ppb (溶氧)', min_value: null, max_value: 7.0 }
];

// 取得控制標準 (若為空，後端會自動讀取 0623 預設限值進行寫入初始化)
app.get('/api/manual-water-quality/limits', async (req, res) => {
    try {
        const result = await pool.query('SELECT water_type, sample_point, metric_name, min_value, max_value FROM manual_water_quality_limits');
        
        // 若資料表為空，執行預設值批次寫入初始化
        if (result.rows.length === 0) {
            console.log('manual_water_quality_limits is empty. Initializing default preset limits from 0623 sheet...');
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                for (const item of PRESET_WATER_LIMITS) {
                    for (const sp of item.sample_points) {
                        await client.query(`
                            INSERT INTO manual_water_quality_limits (water_type, sample_point, metric_name, min_value, max_value)
                            VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT (water_type, sample_point, metric_name) DO UPDATE
                            SET min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value
                        `, [item.water_type, sp, item.metric_name, item.min_value, item.max_value]);
                    }
                }
                await client.query('COMMIT');
                
                // 再次讀取寫入後的結果
                const updatedResult = await pool.query('SELECT water_type, sample_point, metric_name, min_value, max_value FROM manual_water_quality_limits');
                return res.json(updatedResult.rows);
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        }
        
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/manual-water-quality/limits error:', err);
        res.status(500).json({ error: '取得水質控制標準失敗', details: err.message });
    }
});

// 寫入/更新控制標準 (限網站管理者權限，整合 PIMCP SSO)
app.post('/api/manual-water-quality/limits', async (req, res) => {
    const auth = await checkIsAdminByPimcp(req);
    if (!auth.isAdmin) {
        return res.status(403).json({ error: '拒絕存取：您不具備網站管理者權限，無法變更水質控制標準！' });
    }

    const limits = req.body;
    if (!Array.isArray(limits)) {
        return res.status(400).json({ error: '請求 body 須為陣列' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const limit of limits) {
            const { water_type, sample_point, metric_name, min_value, max_value } = limit;
            if (!water_type || !sample_point || !metric_name) {
                continue;
            }
            await client.query(`
                INSERT INTO manual_water_quality_limits (water_type, sample_point, metric_name, min_value, max_value, updated_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (water_type, sample_point, metric_name) DO UPDATE
                SET min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value, updated_at = NOW()
            `, [water_type, sample_point, metric_name, min_value !== undefined ? min_value : null, max_value !== undefined ? max_value : null]);
        }
        await client.query('COMMIT');
        res.json({ success: true, message: '成功更新水質控制標準！' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /api/manual-water-quality/limits error:', err);
        res.status(500).json({ error: '儲存水質控制標準失敗', details: err.message });
    } finally {
        client.release();
    }
});

// 取得指標名稱顯示別名
app.get('/api/manual-water-quality/metric-aliases', async (req, res) => {
    try {
        const result = await pool.query('SELECT water_type, original_name, display_name FROM manual_water_quality_metric_aliases');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/manual-water-quality/metric-aliases error:', err);
        res.status(500).json({ error: '取得水質指標名稱別名失敗', details: err.message });
    }
});

// 寫入/更新指標名稱顯示別名 (限網站管理者權限，整合 PIMCP SSO)
app.post('/api/manual-water-quality/metric-aliases', async (req, res) => {
    const auth = await checkIsAdminByPimcp(req);
    if (!auth.isAdmin) {
        return res.status(403).json({ error: '拒絕存取：您不具備網站管理者權限，無法變更水質指標名稱！' });
    }

    const aliases = req.body;
    if (!Array.isArray(aliases)) {
        return res.status(400).json({ error: '請求 body 須為陣列' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const aliasItem of aliases) {
            const { water_type, original_name, display_name } = aliasItem;
            if (!water_type || !original_name || !display_name) {
                continue;
            }
            await client.query(`
                INSERT INTO manual_water_quality_metric_aliases (water_type, original_name, display_name, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (water_type, original_name) DO UPDATE
                SET display_name = EXCLUDED.display_name, updated_at = NOW()
            `, [water_type, original_name, display_name.trim()]);
        }
        await client.query('COMMIT');
        res.json({ success: true, message: '成功更新水質指標名稱別名！' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /api/manual-water-quality/metric-aliases error:', err);
        res.status(500).json({ error: '儲存水質指標名稱別名失敗', details: err.message });
    } finally {
        client.release();
    }
});

// 批次寫入/更新人工檢驗水質數據 (陣列 Upsert)
app.post('/api/manual-water-quality/batch', async (req, res) => {
    const client = await pool.connect();
    try {
        const items = req.body;
        if (!Array.isArray(items)) {
            return res.status(400).json({ error: '請求 body 須為陣列' });
        }
        
        await client.query('BEGIN');
        const inserted = [];
        
        for (const item of items) {
            const { id, water_type, test_date, sample_point, data } = item;
            if (!water_type || !test_date || !sample_point || !data) {
                console.warn('跳過無效的水質數據項目:', item);
                continue;
            }
            
            const itemId = id || crypto.randomUUID();
            const resItem = await client.query(
                `INSERT INTO manual_water_quality_readings (id, water_type, test_date, sample_point, data)
                 VALUES ($1, $2, $3, $4, $5::jsonb)
                 ON CONFLICT (water_type, test_date, sample_point) 
                 DO UPDATE SET data = EXCLUDED.data, created_at = NOW()
                 RETURNING *`,
                [itemId, water_type, test_date, sample_point, typeof data === 'string' ? data : JSON.stringify(data)]
            );
            inserted.push(resItem.rows[0]);
        }
        
        await client.query('COMMIT');
        res.status(200).json({ success: true, count: inserted.length, data: inserted });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /api/manual-water-quality/batch error:', err);
        res.status(500).json({ error: '批次上傳水質數據失敗', details: err.message });
    } finally {
        client.release();
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
            [id || crypto.randomUUID(), tank_id ?? null, tank_name ?? null, date_str ?? null, reason ?? null, current_value ?? null, prev_value ?? null, next_value ?? null, is_possible_refill || false, source || 'MANUAL', note || '']
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
                [id || crypto.randomUUID(), tank_id ?? null, tank_name ?? null, date_str ?? null, reason ?? null, current_value ?? null, prev_value ?? null, next_value ?? null, is_possible_refill || false, source || 'MANUAL', note || '']
            );
            results.push(result.rows[0]);
        }

        await client.query('COMMIT');
        console.log(`[POST /api/alerts/batch] 成功插入 ${results.length} 筆`);

        // 💡 自動同步推送警報至訊息中心 (PIMCP)
        if (results.length > 0) {
            try {
                // 1. 優先使用警報資料本身的日期，避免跨日匯入時顯示成推送當天
                const alertDates = [...new Set(results.map(r => r.date_str).filter(Boolean))];
                const reportDateStr = alertDates.length === 1
                    ? alertDates[0]
                    : new Date(Date.now() + TAIPEI_OFFSET_MS).toISOString().split('T')[0];

                // 2. 格式化警報內容
                const detailsStr = results
                    .map(r => `· ${r.tank_name || '未知儲槽'}：${r.reason || '液位變動異常'}`)
                    .join('\n');

                const title = "WTCA液位變動檢查";
                const message = `${reportDateStr} 液位變動警報查詢\n共 ${results.length} 筆警報 (未處理 ${results.length} 筆，已備註 0 筆)\n\n【未處理】\n${detailsStr}`;

                // 3. 向同台伺服器上的訊息中心 (PIMCP) 發送 Webhook 請求
                // 透過傳入 subscriptionId，實現「公用警報廣播」，讓大家自由訂閱
                const pimcpSubscriptionId = process.env.PIMCP_SUBSCRIPTION_ID
                    ? parseInt(process.env.PIMCP_SUBSCRIPTION_ID, 10)
                    : 5;

                fetch('http://localhost:3011/api/notifications/external-api', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        subscriptionId: pimcpSubscriptionId,
                        title,
                        message,
                        status: 'warning'
                    })
                })
                .then(response => response.json())
                .then(data => console.log(`[PIMCP Push success] 已成功透過公用訂閱 #${pimcpSubscriptionId} 廣播警報:`, data))
                .catch(fetchErr => console.error('[PIMCP Push failed] 發送 HTTP 請求失敗:', fetchErr.message));

            } catch (formatErr) {
                console.error('[PIMCP Push error] 格式化或發送警報失敗:', formatErr.message);
            }
        }
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
            INSERT INTO important_notes (id, date_str, area, chemical_name, note, marked_water_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;

        const result = await client.query(sql, [
            note.id || crypto.randomUUID(),
            note.date_str,
            note.area,
            note.chemical_name,
            note.note,
            note.marked_water_type || null
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
            INSERT INTO important_notes (id, date_str, area, chemical_name, note, marked_water_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET
                date_str = EXCLUDED.date_str,
                area = EXCLUDED.area,
                chemical_name = EXCLUDED.chemical_name,
                note = EXCLUDED.note,
                marked_water_type = EXCLUDED.marked_water_type
        `;

        for (const note of notes) {
            await client.query(sql, [
                note.id,
                note.date_str,
                note.area,
                note.chemical_name,
                note.note,
                note.marked_water_type || null
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
            SET date_str = $1, area = $2, chemical_name = $3, note = $4, marked_water_type = $5
            WHERE id = $6
            RETURNING *
        `;

        const result = await client.query(sql, [
            note.date_str,
            note.area,
            note.chemical_name,
            note.note,
            note.marked_water_type || null,
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

// ==================== Weekly Usage Report ====================
app.get('/api/weekly-usage-report', async (req, res) => {
    try {
        // === 時區修正：所有日期計算改用台北時間 (UTC+8) ===
        const refDate = req.query.date ? new Date(req.query.date) : new Date();
        // 取得台北時間今天的「週一 00:00 台北」的 UTC timestamp
        const refDateTaipei = new Date(Number(refDate) + TAIPEI_OFFSET_MS);
        const dayOfWeekTW = refDateTaipei.getUTCDay(); // 0=Sun, 1=Mon...
        const diffToMondayTW = dayOfWeekTW === 0 ? -6 : 1 - dayOfWeekTW;

        // 台北時間「本週週一 00:00」= (refDate 台北日午夜) + diffToMonday 天
        const refDayStartTaipei = Date.UTC(
            refDateTaipei.getUTCFullYear(),
            refDateTaipei.getUTCMonth(),
            refDateTaipei.getUTCDate()
        ) - TAIPEI_OFFSET_MS; // 換回 UTC
        const thisMondayUTC = refDayStartTaipei + diffToMondayTW * DAY_MS;
        const lastMondayUTC = thisMondayUTC - 7 * DAY_MS;
        const lastSundayEndUTC = thisMondayUTC - 1; // 週日最後一毫秒

        const startTime = lastMondayUTC;
        const endTime = lastSundayEndUTC;

        // 顯示用日期（台北時間）
        const lastMonday = new Date(lastMondayUTC);
        const lastSunday = new Date(lastSundayEndUTC);


        const reportData = [];
        const missingActualTanks = [];
        const missingTheoreticalTanks = [];

        // Fetch ALL tanks, we will filter them by active supply's target_ppm later
        const tanksRes = await pool.query(
            "SELECT * FROM tanks ORDER BY sort_order ASC, name ASC"
        );
        const tanks = tanksRes.rows;

        for (const tank of tanks) {
            // Check valid JSON dimensions
            if (typeof tank.dimensions === 'string') {
                try { tank.dimensions = JSON.parse(tank.dimensions); } catch (e) { }
            }

            const suppliesRes = await pool.query('SELECT * FROM chemical_supplies WHERE tank_id = $1 ORDER BY start_date DESC', [tank.id]);
            const activeSupply = getActiveSupplyAt(startTime, suppliesRes.rows);

            // Only process tanks that have an active supply WITH a target_ppm defined
            if (!activeSupply || !activeSupply.target_ppm || Number(activeSupply.target_ppm) === 0) continue;
            if (!(tank.system_type && (tank.system_type.includes('冷卻') || tank.system_type.includes('鍋爐')))) continue;

            const weekReadingsRes = await pool.query(
                "SELECT * FROM readings WHERE tank_id = $1 AND timestamp >= $2 AND timestamp <= $3 ORDER BY timestamp ASC",
                [tank.id, startTime, endTime]
            );
            const periodReadings = [...weekReadingsRes.rows]
                .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)
                .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
            const lastReading = periodReadings[periodReadings.length - 1];
            if (lastReading && normalizeTimestampToTaipeiDayStart(lastReading.timestamp) !== normalizeTimestampToTaipeiDayStart(endTime)) {
                const nextReadingRes = await pool.query(
                    "SELECT * FROM readings WHERE tank_id = $1 AND timestamp > $2 ORDER BY timestamp ASC LIMIT 1",
                    [tank.id, endTime]
                );
                if (nextReadingRes.rows[0]) {
                    periodReadings.push(nextReadingRes.rows[0]);
                }
            }
            const actualResult = calculateActualUsageKgFromLevel(tank, periodReadings, suppliesRes.rows);
            const actualUsageKg = actualResult.value;
            if (!actualResult.hasEnoughData) missingActualTanks.push(tank.name);

            const cwsRes = await pool.query(
                "SELECT * FROM cws_parameters WHERE tank_id = $1 AND date >= $2 AND date <= $3 ORDER BY date ASC",
                [tank.id, startTime - DAY_MS * 7, endTime]
            );
            const bwsRes = await pool.query(
                "SELECT * FROM bws_parameters WHERE tank_id = $1 AND date >= $2 AND date <= $3 ORDER BY date ASC",
                [tank.id, startTime - DAY_MS * 7, endTime]
            );
            const theoreticalResult = calculateTheoreticalUsageKg(tank, suppliesRes.rows, cwsRes.rows, bwsRes.rows, startTime, endTime);
            const theoreticalUsageKg = theoreticalResult.value;
            if (theoreticalResult.hasMissingTheoretical) missingTheoreticalTanks.push(tank.name);

            const diff = actualUsageKg - theoreticalUsageKg;
            const diffPercent = theoreticalUsageKg > 0 ? (Math.abs(diff) / theoreticalUsageKg) * 100 : 0;

            reportData.push({
                tankName: tank.name,
                theoretical: theoreticalUsageKg,
                actual: actualUsageKg,
                diff: diff,
                diffPercent: (diff > 0 ? diffPercent : -diffPercent), // signed
                unit: 'KG'
            });
        }

        const periodStr = `${lastMonday.toLocaleDateString()} ~ ${lastSunday.toLocaleDateString()}`;
        let htmlMessage = `<h2>中龍W521 每週藥劑用量檢查報告 (${periodStr})</h2>`;
        htmlMessage += `<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%; font-family: sans-serif;">`;
        htmlMessage += `<tr style="background-color: #f2f2f2;"><th>藥劑名稱</th><th>理論用量 (KG)</th><th>實際用量 (KG)</th><th>誤差 (KG)</th><th>誤差百分比 (%)</th></tr>`;

        for (const r of reportData) {
            const isWarning = r.diffPercent > 5;  // 實際 > 理論 5% 以上才標紅
            const rowStyle = isWarning ? 'style="color: red; font-weight: bold;"' : '';
            const diffSign = r.diff > 0 ? '+' : '';
            htmlMessage += `
                <tr ${rowStyle}>
                    <td>${r.tankName}</td>
                    <td>${r.theoretical.toFixed(1)}</td>
                    <td>${r.actual.toFixed(1)}</td>
                    <td>${diffSign}${r.diff.toFixed(1)}</td>
                    <td>${diffSign}${r.diffPercent.toFixed(1)}%</td>
                </tr>
            `;
        }
        htmlMessage += `</table>`;
        htmlMessage += `<p style="font-size: 0.9em; color: #666; margin-top: 20px;">提示：紅色標示表示實際用量超過理論用量 5% 以上。本報告為系統自動寄送。</p>`;

        const isDataComplete = missingActualTanks.length === 0 && missingTheoreticalTanks.length === 0;
        const missingDetails = [];
        if (missingActualTanks.length > 0) missingDetails.push(`缺液位讀數: ${missingActualTanks.join(', ')}`);
        if (missingTheoreticalTanks.length > 0) missingDetails.push(`缺生產參數: ${missingTheoreticalTanks.join(', ')}`);

        res.json({
            success: true,
            isDataComplete,
            missingDetails: missingDetails.join('; '),
            period: periodStr,
            data: reportData,
            htmlMessage: htmlMessage,
            textMessage: `中龍W521 每週藥劑用量檢查 (${periodStr})\n` + reportData.map(r => `${r.tankName}: 理論 ${r.theoretical.toFixed(1)} KG, 實際 ${r.actual.toFixed(1)} KG (誤差 ${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1)} KG, ${r.diff > 0 ? '+' : ''}${r.diffPercent.toFixed(1)}%)`).join('\n')
        });

    } catch (err) {
        console.error('Weekly usage report error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== Monthly Usage Report ====================
app.get('/api/monthly-usage-report', async (req, res) => {
    try {
        // === 時區修正：所有日期計算改用台北時間 (UTC+8) ===
        const refDate = req.query.date ? new Date(req.query.date) : new Date();
        // 計算「上個月」的台北時間起迄（1日00:00 ~ 月底23:59:59.999）
        const refDateTaipei = new Date(Number(refDate) + TAIPEI_OFFSET_MS);
        const thisYear = refDateTaipei.getUTCFullYear();
        const thisMonth = refDateTaipei.getUTCMonth(); // 0-indexed，當月

        // 上個月
        const targetYear = thisMonth === 0 ? thisYear - 1 : thisYear;
        const targetMonth = thisMonth === 0 ? 11 : thisMonth - 1; // 0-indexed

        // 上個月 1 日 00:00 台北時間 → UTC
        const startTime = Date.UTC(targetYear, targetMonth, 1) - TAIPEI_OFFSET_MS;
        // 上個月最後一天 23:59:59.999 台北時間 → UTC
        const endTime = Date.UTC(targetYear, targetMonth + 1, 1) - TAIPEI_OFFSET_MS - 1;

        // 顯示用字串
        const startDisplay = `${targetYear}/${targetMonth + 1}/1`;
        const endDay = new Date(endTime + TAIPEI_OFFSET_MS).getUTCDate();
        const endDisplay = `${targetYear}/${targetMonth + 1}/${endDay}`;
        const periodStr = `${startDisplay} ~ ${endDisplay}`;

        const reportData = [];
        const missingActualTanks = [];
        const missingTheoreticalTanks = [];

        const tanksRes = await pool.query(
            "SELECT * FROM tanks ORDER BY sort_order ASC, name ASC"
        );
        const tanks = tanksRes.rows;

        for (const tank of tanks) {
            if (typeof tank.dimensions === 'string') {
                try { tank.dimensions = JSON.parse(tank.dimensions); } catch (e) { }
            }

            const suppliesRes = await pool.query('SELECT * FROM chemical_supplies WHERE tank_id = $1 ORDER BY start_date DESC', [tank.id]);
            const activeSupply = getActiveSupplyAt(startTime, suppliesRes.rows);

            if (!activeSupply || !activeSupply.target_ppm || Number(activeSupply.target_ppm) === 0) continue;
            if (!(tank.system_type && (tank.system_type.includes('冷卻') || tank.system_type.includes('鍋爐')))) continue;

            const monthReadingsRes = await pool.query(
                "SELECT * FROM readings WHERE tank_id = $1 AND timestamp >= $2 AND timestamp <= $3 ORDER BY timestamp ASC",
                [tank.id, startTime, endTime]
            );
            const periodReadings = monthReadingsRes.rows
                .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)
                .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
            const actualResult = calculateActualUsageKgFromLevel(tank, periodReadings, suppliesRes.rows);
            const actualUsageKg = actualResult.value;
            if (!actualResult.hasEnoughData) missingActualTanks.push(tank.name);

            const lookbackStart = startTime - DAY_MS * 35; // 多回溯 5 週，讓月初可套用前一週資料
            const cwsRes = await pool.query(
                "SELECT * FROM cws_parameters WHERE tank_id = $1 AND date >= $2 AND date <= $3 ORDER BY date ASC",
                [tank.id, lookbackStart, endTime]
            );
            const bwsRes = await pool.query(
                "SELECT * FROM bws_parameters WHERE tank_id = $1 AND date >= $2 AND date <= $3 ORDER BY date ASC",
                [tank.id, lookbackStart, endTime]
            );
            const theoreticalResult = calculateTheoreticalUsageKg(tank, suppliesRes.rows, cwsRes.rows, bwsRes.rows, startTime, endTime);
            const theoreticalUsageKg = theoreticalResult.value;
            if (theoreticalResult.hasMissingTheoretical) missingTheoreticalTanks.push(tank.name);

            const diff = actualUsageKg - theoreticalUsageKg;
            const diffPercent = theoreticalUsageKg > 0 ? (Math.abs(diff) / theoreticalUsageKg) * 100 : 0;
            reportData.push({
                tankName: tank.name,
                theoretical: theoreticalUsageKg,
                actual: actualUsageKg,
                diff: diff,
                diffPercent: (diff > 0 ? diffPercent : -diffPercent),
                unit: 'KG'
            });
        }

        // 組成 HTML 報表
        let htmlMessage = `<h2>中龍W521 每月藥劑用量檢查報告 (${periodStr})</h2>`;
        htmlMessage += `<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%; font-family: sans-serif;">`;
        htmlMessage += `<tr style="background-color: #f2f2f2;"><th>藥劑名稱</th><th>理論用量 (KG)</th><th>實際用量 (KG)</th><th>誤差 (KG)</th><th>誤差百分比 (%)</th></tr>`;
        for (const r of reportData) {
            const isWarning = r.diffPercent > 5;
            const rowStyle = isWarning ? 'style="color: red; font-weight: bold;"' : '';
            const diffSign = r.diff > 0 ? '+' : '';
            htmlMessage += `
                <tr ${rowStyle}>
                    <td>${r.tankName}</td>
                    <td>${r.theoretical.toFixed(1)}</td>
                    <td>${r.actual.toFixed(1)}</td>
                    <td>${diffSign}${r.diff.toFixed(1)}</td>
                    <td>${diffSign}${r.diffPercent.toFixed(1)}%</td>
                </tr>
            `;
        }
        htmlMessage += `</table>`;
        htmlMessage += `<p style="font-size: 0.9em; color: #666; margin-top: 20px;">提示：紅色標示表示實際用量超過理論用量 5% 以上。本報告為系統自動寄送。</p>`;

        const isDataComplete = missingActualTanks.length === 0 && missingTheoreticalTanks.length === 0;
        const missingDetails = [];
        if (missingActualTanks.length > 0) missingDetails.push(`缺液位讀數: ${missingActualTanks.join(', ')}`);
        if (missingTheoreticalTanks.length > 0) missingDetails.push(`缺生產參數: ${missingTheoreticalTanks.join(', ')}`);

        res.json({
            success: true,
            isDataComplete,
            missingDetails: missingDetails.join('; '),
            period: periodStr,
            data: reportData,
            htmlMessage,
            textMessage: `中龍W521 每月藥劑用量檢查 (${periodStr})\n` + reportData.map(r => `${r.tankName}: 理論 ${r.theoretical.toFixed(1)} KG, 實際 ${r.actual.toFixed(1)} KG (誤差 ${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1)} KG, ${r.diff > 0 ? '+' : ''}${r.diffPercent.toFixed(1)}%)`).join('\n')
        });

    } catch (err) {
        console.error('Monthly usage report error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== Daily Fluctuation Alerts ====================
app.get('/api/daily-alerts', async (req, res) => {
    try {
        const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

        // 若有指定日期則用之，否則預設為台北時間的前一日
        let queryDate;
        if (req.query.date) {
            queryDate = req.query.date; // 格式需為 YYYY-MM-DD
        } else {
            // 台北時間今日 - 1 天
            const nowTaipei = new Date(Date.now() + TZ_OFFSET_MS);
            nowTaipei.setUTCDate(nowTaipei.getUTCDate() - 1);
            const Y = nowTaipei.getUTCFullYear();
            const M = String(nowTaipei.getUTCMonth() + 1).padStart(2, '0');
            const D = String(nowTaipei.getUTCDate()).padStart(2, '0');
            queryDate = `${Y}-${M}-${D}`;
        }

        // 查詢指定日期的所有警報
        const alertsRes = await pool.query(
            "SELECT * FROM fluctuation_alerts WHERE date_str = $1 ORDER BY created_at DESC",
            [queryDate]
        );
        const rows = alertsRes.rows;

        // 格式化回傳資料
        const alerts = rows.map(a => {
            const hasNote = a.note && a.note.trim().length > 0;
            return {
                tankName: a.tank_name,
                dateStr: a.date_str,
                reason: a.reason,
                isPossibleRefill: a.is_possible_refill,
                source: a.source,
                // 有備註者只顯示「已備註」，無備註者完整回傳備註欄位（null）
                note: hasNote ? `[已備註] ${a.note}` : null,
                hasNote
            };
        });

        // 組成摘要文字（供 Pushbullet 通知使用）
        const unhandled = alerts.filter(a => !a.hasNote);
        const handled = alerts.filter(a => a.hasNote);
        let summaryText = `${queryDate} 液位變動警報查詢\n`;
        summaryText += `共 ${alerts.length} 筆警報（未處理 ${unhandled.length} 筆，已備註 ${handled.length} 筆）\n`;
        if (unhandled.length > 0) {
            summaryText += `\n【未處理】\n`;
            summaryText += unhandled.map(a => `・${a.tankName}：${a.reason}`).join('\n');
        }
        if (handled.length > 0) {
            summaryText += `\n【已備註】\n`;
            summaryText += handled.map(a => `・${a.tankName}：${a.note}`).join('\n');
        }

        res.json({
            success: true,
            queryDate,
            count: alerts.length,
            hasAlerts: alerts.length > 0,
            hasUnhandled: unhandled.length > 0,
            unhandledCount: unhandled.length,
            handledCount: handled.length,
            alerts,
            summaryText
        });

    } catch (err) {
        console.error('Daily alerts error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

const instrumentExpiryTimer = setInterval(() => {
    sendInstrumentExpiryNotifications()
        .then(result => {
            if (result.sent) {
                console.log(`[Instrument Expiry] 已推送 ${result.count} 筆到期提醒`);
            }
        })
        .catch(err => console.error('[Instrument Expiry] 到期提醒檢查失敗:', err.message));
}, 60 * 60 * 1000);
instrumentExpiryTimer.unref?.();

// 啟動伺服器
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`📊 API 文件: http://localhost:${PORT}/api/health`);
});
