// 液位 PI 查核單元測試：node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    inputToCm, cmToInput, piToCm, piValueAt, fitCalibration, detectRefills, evaluate,
} from '../levelCheck.js';

const MIN = 60000, H = 3600000;
const T0 = Date.parse('2026-10-04T23:00:00+08:00');

// 液位 % 型儲槽（高度 300cm → 每 1% = 3cm），PI 也是 %
const tankA = { id: 'A', name: 'CT-1 漂白水', inputUnit: 'LIQUID_PERCENT', piLevelUnit: 'PERCENT', piPercentFactor: 3, factor: 10 };
const tankB = { id: 'B', name: 'CT-2 漂白水', inputUnit: 'LIQUID_PERCENT', piLevelUnit: 'PERCENT', piPercentFactor: 3, factor: 10 };
const noCalib = { slope: 1, intercept: 0, residualStd: null, n: 0, mode: 'NONE' };

/** 產生每 5 分鐘一點、線性下降的序列（% 單位），可插入補藥階躍 */
function makeSeries({ start, hours, v0, ratePerH, refillAt, refillPct = 0 }) {
    const s = [];
    let v = v0;
    for (let t = start; t <= start + hours * H; t += 5 * MIN) {
        if (refillAt && t >= refillAt && t < refillAt + 20 * MIN) v += refillPct / 4; // 20 分鐘內補完
        s.push({ t, v });
        v -= ratePerH / 12;
    }
    return s;
}

test('單位換算', () => {
    assert.equal(inputToCm(tankA, 20), 60);
    assert.equal(cmToInput(tankA, 60), 20);
    assert.equal(inputToCm({ inputUnit: 'PERCENT' }, 1.5), 150);
    assert.equal(inputToCm({ inputUnit: 'CM' }, 42), 42);
    assert.equal(piToCm({ piLevelUnit: 'CM' }, 42), 42);
    assert.equal(piToCm({ piLevelUnit: 'PERCENT', dimensions: { height: 200 } }, 50), 100);
});

test('piValueAt：中位數 / 內插 / 尾端容忍', () => {
    const s = [{ t: 0, v: 10 }, { t: 10 * MIN, v: 10 }, { t: 20 * MIN, v: 100 }, { t: 30 * MIN, v: 10 }];
    assert.equal(piValueAt(s, 15 * MIN), 10); // 中位數抑制突波
    const sparse = [{ t: 0, v: 0 }, { t: 2 * H, v: 20 }];
    assert.equal(piValueAt(sparse, H), 10);
    assert.equal(piValueAt(sparse, 3 * H), 20);
    assert.equal(piValueAt(sparse, 5 * H), null);
});

test('定點比對：吻合 → OK，3 倍容許 → ERROR', () => {
    const series = makeSeries({ start: T0 - H, hours: 2, v0: 30, ratePerH: 0 });
    const ok = evaluate({ tank: tankA, inputValue: 30.5, tNow: T0, prev: null, series, calib: noCalib });
    assert.equal(ok.status, 'OK');
    const bad = evaluate({ tank: tankA, inputValue: 35, tNow: T0, prev: null, series, calib: noCalib }); // 偏差 15cm
    assert.equal(bad.status, 'ERROR');
});

test('小數點錯位提示', () => {
    const series = makeSeries({ start: T0 - H, hours: 2, v0: 22.5, ratePerH: 0 });
    const r = evaluate({ tank: tankA, inputValue: 225, tNow: T0, prev: null, series, calib: noCalib });
    assert.equal(r.status, 'ERROR');
    assert.ok(r.messages.some((m) => m.includes('小數點')));
});

test('一階/二階對調 → swapSuspect', () => {
    const sA = makeSeries({ start: T0 - H, hours: 2, v0: 31.5, ratePerH: 0 });
    const r = evaluate({
        tank: tankA, inputValue: 19.9, tNow: T0, prev: null, series: sA, calib: noCalib,
        others: [{ tank: tankB, refCm: 19.9 * 3, tol: 5 }],
    });
    assert.equal(r.status, 'ERROR');
    assert.equal(r.swapSuspect?.tankId, 'B');
});

test('區間內補藥偵測 + 24h 正規化（14.5h 區間）', () => {
    const tPrev = T0;
    const tNow = T0 + 14.5 * H;
    // 每小時降 0.5%（1.5cm），中間補 +15%（45cm）
    const series = makeSeries({ start: tPrev - H, hours: 16, v0: 20.5, ratePerH: 0.5, refillAt: tPrev + 4 * H, refillPct: 15 });
    const piNow = piValueAt(series, tNow);
    const prevCm = piValueAt(series, tPrev) * 3;
    const r = evaluate({ tank: tankA, inputValue: piNow, tNow, prev: { levelCm: prevCm, readAt: tPrev }, series, calib: noCalib });
    assert.equal(r.status, 'OK');
    assert.equal(r.refill.detected, true);
    assert.ok(Math.abs(r.refill.riseCm - 45) < 3, `riseCm=${r.refill.riseCm}`);
    // PI 日用量 ≈ 1.5cm/h × 24 × 10 L/cm = 360 L/24h
    assert.ok(Math.abs(r.piUsagePer24h - 360) < 25, `piUsagePer24h=${r.piUsagePer24h}`);
    assert.ok(r.messages.some((m) => m.includes('補藥')));
});

test('38h 區間的 24h 正規化一致', () => {
    const tPrev = T0;
    const tNow = T0 + 38 * H;
    const series = makeSeries({ start: tPrev - H, hours: 40, v0: 60, ratePerH: 0.5 });
    const r = evaluate({ tank: tankA, inputValue: piValueAt(series, tNow), tNow, prev: { levelCm: piValueAt(series, tPrev) * 3, readAt: tPrev }, series, calib: noCalib });
    assert.equal(r.intervalHours, 38);
    assert.ok(Math.abs(r.piUsagePer24h - 360) < 25);
    assert.ok(Math.abs(r.manualUsagePer24h - 360) < 25);
});

test('人工液位上升但 PI 無補藥 → ERROR', () => {
    const tPrev = T0, tNow = T0 + 14 * H;
    const series = makeSeries({ start: tPrev - H, hours: 16, v0: 30, ratePerH: 0.2 });
    const r = evaluate({ tank: tankA, inputValue: 45, tNow, prev: { levelCm: 30 * 3, readAt: tPrev }, series, calib: noCalib });
    assert.equal(r.status, 'ERROR');
    assert.ok(r.messages.some((m) => m.includes('無補藥跡象')));
});

test('detectRefills 忽略小雜訊', () => {
    const s = [];
    for (let i = 0; i < 100; i++) s.push({ t: i * 5 * MIN, v: 50 + (i % 2 ? 1.5 : -1.5) });
    assert.equal(detectRefills(s, 5).length, 0);
});

test('fitCalibration 可還原 slope/intercept', () => {
    const pairs = [];
    let seed = 1;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280 - 0.5);
    for (let i = 0; i < 30; i++) {
        const x = 20 + i * 8;
        pairs.push({ x, y: 0.97 * x + 2 + rnd() * 2 });
    }
    pairs.push({ x: 100, y: 300 }); // 離群點
    const c = fitCalibration(pairs);
    assert.equal(c.mode, 'LINEAR');
    assert.ok(Math.abs(c.slope - 0.97) < 0.02, `slope=${c.slope}`);
    assert.ok(Math.abs(c.intercept - 2) < 2, `intercept=${c.intercept}`);
    const off = fitCalibration([{ x: 10, y: 13 }, { x: 11, y: 14 }, { x: 12, y: 15 }]);
    assert.equal(off.mode, 'OFFSET');
    assert.equal(off.intercept, 3);
});
