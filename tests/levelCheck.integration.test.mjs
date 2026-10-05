import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import * as levelCheck from '../levelCheck.js';
import { recalculateTank, repairLevelCheckData } from '../levelCheckPersistence.js';

// 載入實際處理函式，僅替換外部 I/O；不啟動正式伺服器或連線資料庫。
const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const parse = (s, jsx = false) => ts.createSourceFile('review.' + (jsx ? 'tsx' : 'js'), s, ts.ScriptTarget.Latest, true, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
function find(root, predicate) {
    if (predicate(root)) return root;
    let found;
    ts.forEachChild(root, child => { if (!found) found = find(child, predicate); });
    return found;
}
function bind(code, dependencies) {
    const js = ts.transpileModule('const target = ' + code + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    return new Function(...Object.keys(dependencies), js + '\nreturn target;')(...Object.values(dependencies));
}
function route(path, dependencies) {
    const root = parse(source);
    const node = find(root, n => ts.isCallExpression(n) && n.expression.getText(root) === 'app.post' && n.arguments[0]?.text === path);
    assert.ok(node, path);
    return bind(node.arguments[1].getText(root), { levelCheck, recalculateTank, LC_HOUR_MS: 3600000, toTaipeiIso: ms => new Date(ms + 8 * 3600000).toISOString().replace('Z', '+08:00'), mapTankForLevelCheck: r => r, ...dependencies });
}
function response() {
    return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
}
const H = 3600000;
const day = Date.parse('2026-10-04T00:00:00+08:00');
const tank = { id: 'A', name: '測試槽', piLevelTag: 'TEST.PV', piLevelUnit: 'CM', inputUnit: 'CM', factor: 10 };

test('API 使用實際前次時間、嚴格排除當日覆寫，24 小時用量與擷取範圍一致', async () => {
    const tNow = day + 14 * H, tPrev = tNow - 24 * H;
    const pool = { query: async (sql, params) => {
        if (sql === 'SELECT * FROM tanks') return { rows: [tank] };
        if (sql === 'SELECT * FROM tank_calibrations') return { rows: [{ tank_id: 'A', slope: 1, intercept: 0, mode: 'OFFSET' }] };
        assert.ok(sql.includes('timestamp < $2'));
        assert.equal(params[1], day);
        assert.equal(params[2], tNow);
        return { rows: [{ level_cm: 100, timestamp: day - 24 * H, read_at_ms: tPrev }] };
    } };
    const handler = route('/api/level-check', { pool, piRecordedFetch: async requests => {
        assert.ok(requests[0].startMs <= tPrev - H);
        return new Map([['TEST.PV', { series: [{ t: tPrev, v: 100 }, { t: tNow, v: 76 }], error: null }]]);
    } });
    const res = response();
    await handler({ body: { businessDate: '2026-10-04', readAt: tNow, entries: { A: 76 } } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.results.A.intervalHours, 24);
    assert.equal(res.body.results.A.manualUsagePer24h, 240);
    assert.equal(res.body.results.A.piUsagePer24h, 240);
    assert.equal(res.body.results.A.readAt, tNow);
});

test('缺少實際抄表時間時 API 拒絕猜測午夜', async () => {
    const handler = route('/api/level-check', { pool: { query() { throw new Error('不應查資料庫'); } } });
    for (const readAt of [undefined, null, '', NaN, Date.now() + H]) {
        const res = response();
        await handler({ body: { businessDate: '2026-10-04', readAt } }, res);
        assert.equal(res.statusCode, 400);
    }
});

test('回補 PI 全失敗時不得寫入、重算或回報成功', async () => {
    const pool = { query: async sql => ({ rows: sql.includes('FROM tanks') ? [tank] : [{ id: 'r1', tank_id: 'A', timestamp: day, read_at: new Date(day + H).toISOString() }] }), connect() { throw new Error('PI 失敗不應開啟寫入交易'); } };
    const handler = route('/api/admin/backfill-pi-levels', { pool, piRecordedFetch: async () => new Map([['TEST.PV', { series: [], error: '模擬 PI 離線' }]]) });
    const res = response();
    await handler({ body: { days: 35 } }, res);
    assert.equal(res.body.success, false);
    assert.equal(res.body.totalUpdated, 0);
    assert.match(res.body.details[0].error, /PI 離線/);
    assert.equal(res.body.calibrations.length, 0);
});

test('缺少歷史抄表時間時回補略過，不以業務日期午夜配對', async () => {
    const pool = { query: async sql => ({ rows: sql.includes('FROM tanks') ? [tank] : [{ id: 'r1', tank_id: 'A', timestamp: day, read_at: null }] }), connect() { throw new Error('不應寫入'); } };
    const handler = route('/api/admin/backfill-pi-levels', { pool, piRecordedFetch: async requests => { assert.equal(requests.length, 0); return new Map(); } });
    const res = response();
    await handler({ body: {} }, res);
    assert.equal(res.body.success, false);
    assert.equal(res.body.details[0].skipped, 1);
});

test('有效樣本不足時保留既有人工公式，沒有寫入或異動日誌', async () => {
    let count = 0;
    const client = { query: async sql => { count++; assert.match(sql, /SELECT pi_level_cm/); return { rows: [{ pi_level_cm: 10, level_cm: 100 }] }; } };
    const result = await recalculateTank(client, tank, '測試');
    assert.equal(result.updated, false);
    assert.equal(count, 1);
});

test('線性公式保存擬合模式，讀回後仍保留 3σ 容差', async () => {
    let saved;
    const client = { query: async (sql, values) => {
        if (sql.includes('FROM readings')) return { rows: Array.from({ length: 12 }, (_, i) => ({ pi_level_cm: i * 10, level_cm: i * 10 + 30 + (i % 2 ? 4 : -4) })) };
        if (sql.startsWith('SELECT slope')) return { rows: [] };
        if (sql.includes('INSERT INTO tank_calibrations')) saved = values;
        return { rows: [] };
    } };
    const result = await recalculateTank(client, tank, '測試');
    assert.equal(result.updated, true);
    assert.equal(saved[6], 'LINEAR');
    assert.ok(levelCheck.toleranceCm({}, { mode: saved[6], residualStd: saved[4] }) > 5);
    assert.equal(levelCheck.toleranceCm({}, { mode: 'AUTO', n: 12, rSquared: 0.9, residualStd: 4 }), 12);
    assert.equal(levelCheck.toleranceCm({}, { mode: 'AUTO', n: 3, residualStd: 4 }), 5);
});

function submitHandler(checkLevels, confirmed = true) {
    const root = parse(appSource, true);
    const node = find(root, n => ts.isVariableDeclaration(n) && n.name.getText(root) === 'handleSubmitReadings');
    const calls = { saved: [], alerts: [], checks: [] };
    const handler = bind(node.initializer.getText(root), {
        date: '2026-10-04', readAtInput: '2026-10-04T14:00', batchLevels: { A: '100' }, readings: [], tanks: [tank], operator: '測試',
        window: { confirm: () => confirmed }, alert: text => calls.alerts.push(text),
        getNormalizedTimestamp: () => day, onLoading() {}, setPiChecking() {}, setPiLiveChecks() {},
        API: { checkLevels: async payload => { calls.checks.push(payload); return checkLevels(payload); } },
        StorageService: { getActiveSupply: async () => null }, calculateTankVolume: (_t, cm) => cm * 10,
        generateUUID: () => 'new-reading', checkAnomalies: () => [], onBatchSave: async rs => calls.saved.push(...rs), setBatchLevels() {},
    });
    return { handler, calls };
}

test('實際前端提交保存原始 PI 值，並使用相同的歷史抄表時間', async () => {
    const { handler, calls } = submitHandler(async () => ({ results: { A: { status: 'OK', piRawCm: 10, piRefCm: 100, messages: [] } } }));
    await handler({ preventDefault() {} });
    assert.equal(calls.saved.length, 1);
    assert.equal(calls.saved[0].piLevelCm, 10);
    assert.equal(calls.saved[0].readAt, day + 14 * H);
    assert.equal(calls.checks[0].readAt, calls.saved[0].readAt);
});

test('前端 NO_PI 必須明示未查核；使用者取消則不得保存', async () => {
    const result = async () => ({ results: { A: { status: 'NO_PI', messages: ['PI 離線'] } } });
    const cancel = submitHandler(result, false);
    await cancel.handler({ preventDefault() {} });
    assert.equal(cancel.calls.saved.length, 0);
    const accept = submitHandler(result, true);
    await accept.handler({ preventDefault() {} });
    assert.equal(accept.calls.saved[0].piCheck.status, 'NO_PI');
    assert.ok(accept.calls.alerts.some(t => t.includes('未完成 PI 查核')));
});

test('一次性修復完成後不得重新改動資料', async () => {
    const client = { query: async sql => {
        if (sql.startsWith('CREATE TABLE')) return { rows: [] };
        assert.match(sql, /SELECT 1 FROM pi_level_repair_audit/);
        return { rows: [{ '?column?': 1 }] };
    } };
    await repairLevelCheckData(client);
});

test('錯配修復先備份儲槽、讀值與公式，再移除錯配；完成標記最後寫入', async () => {
    const queries = [];
    const client = { query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.startsWith('SELECT * FROM tanks')) return { rows: [{ id: 'tc1_7', name: 'CT-1 微生物分散劑', pi_level_tag: 'W52_PH1-3_2.PV' }] };
        return { rows: [] };
    } };
    await repairLevelCheckData(client);
    const firstUpdate = queries.findIndex(q => q.sql.startsWith('UPDATE tanks'));
    const backups = queries.slice(0, firstUpdate).filter(q => q.sql.startsWith('INSERT INTO pi_level_repair_audit'));
    assert.equal(backups.length, 3);
    assert.ok(queries.some(q => q.sql.includes("'RESET_INVALID_TAG'")));
    assert.ok(queries.at(-1).sql.includes("'completed'"));
});

test('校正日誌寫入失敗時，實際重算 API 回滾公式交易', async () => {
    const queries = [];
    const client = { release() {}, query: async sql => {
        queries.push(sql);
        if (sql.includes('FROM readings')) return { rows: [10, 20, 30].map(x => ({ pi_level_cm: x, level_cm: x + 80 })) };
        if (sql.includes('INSERT INTO tank_calibration_logs')) throw new Error('模擬日誌寫入失敗');
        return { rows: [] };
    } };
    const pool = { query: async () => ({ rows: [tank] }), connect: async () => client };
    const handler = route('/api/tank-calibrations/recalculate', { pool, console: { error() {} } });
    const res = response();
    await handler({ body: { tankId: 'A' } }, res);
    assert.equal(res.statusCode, 500);
    assert.ok(queries.includes('ROLLBACK'));
    assert.ok(!queries.includes('COMMIT'));
});

test('前端查核拋出例外時仍需明示未查核，保存快照不得偽裝通過', async () => {
    const { handler, calls } = submitHandler(async () => { throw new Error('模擬離線'); });
    await handler({ preventDefault() {} });
    assert.equal(calls.saved[0].piCheck.status, 'NO_PI');
    assert.equal(calls.saved[0].piLevelCm, undefined);
    assert.ok(calls.alerts.some(t => t.includes('未完成 PI 查核')));
});

test('實際預設映射迴圈不再將微生物分散劑配到分散劑 Tag', async () => {
    const start = source.indexOf('        const defaultTagRules = [');
    const end = source.indexOf('        // 5. Fluctuation Alerts', start);
    const writes = [];
    const client = { query: async (sql, params) => {
        if (sql.startsWith('SELECT')) return { rows: [
            { id: 'tc1_7', name: 'CT-1 微生物分散劑' }, { id: 'tc2_7', name: 'CT-2 微生物分散劑' }, { id: 'tc1_4', name: 'CT-1 分散劑' },
        ] };
        writes.push(params);
        return { rows: [] };
    } };
    await new Function('client', 'return (async () => {' + source.slice(start, end) + '})();')(client);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][2], 'tc1_4');
});

test('實際 PowerShell 分段函式可完整讀取 35 天每分鐘一點的 50,401 點', { skip: process.platform !== 'win32' }, () => {
    const start = source.indexOf('function ReadRecordedRange(');
    const end = source.indexOf('$out = @{}', start);
    const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function PiGet($url) {
    $from = [datetimeoffset][uri]::UnescapeDataString(([regex]::Match($url, 'startTime=([^&]+)')).Groups[1].Value)
    $to = [datetimeoffset][uri]::UnescapeDataString(([regex]::Match($url, 'endTime=([^&]+)')).Groups[1].Value)
    $items = [Collections.Generic.List[object]]::new()
    for ($t = $from; $t -le $to -and $items.Count -lt 20000; $t = $t.AddMinutes(1)) {
        $items.Add(@{Timestamp=$t.ToString('o'); Value=1; Good=$true})
    }
    return @{Items=$items; Links=@{}}
}
${source.slice(start, end).replaceAll('${baseUrl}', 'http://mock')}
$from = [datetimeoffset]'2026-09-01T00:00:00+08:00'
$data = @(ReadRecordedRange 'TEST' $from ($from.AddDays(35)))
($data | ForEach-Object { $_.Timestamp } | Sort-Object -Unique | Measure-Object).Count
`;
    const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 60000 });
    assert.equal(Number(output.trim()), 50401);
});
