import test from 'node:test';
import assert from 'node:assert/strict';
import {
    computeDailyPiWindow,
    enumerateTaipeiDates,
    integrateRecordedTotal,
    computeRecordedAverage,
    resolveConcentrationCycles,
    calculateCondensateRecoveryRate,
    aggregateWeeklyCondensateRecovery
} from '../dailyParamsUtils.js';

const HOUR_MS = 60 * 60 * 1000;

test('computeDailyPiWindow: 11/25 23:00 輸入時採用滾動 24 小時並使用 RECORDED', () => {
    const nowMs = Date.parse('2026-11-25T23:00:00+08:00');
    const win = computeDailyPiWindow('2026-11-25', nowMs);

    assert.equal(win.valid, true);
    assert.equal(win.windowMode, 'ROLLING_24H');
    assert.equal(win.isFinal, false);
    assert.equal(win.useRecorded, true);
    assert.equal(win.fetchMethod, 'RECORDED');
    assert.equal(win.startIso, '2026-11-24T23:00:00+08:00');
    assert.equal(win.endIso, '2026-11-25T23:00:00+08:00');
    assert.equal(win.windowEndMs - win.windowStartMs, 24 * HOUR_MS);
});

test('computeDailyPiWindow: 11/26 00:30 輸入 11/25 時採用完整 00:00~24:00 且使用 RECORDED 避開歸檔延遲', () => {
    const nowMs = Date.parse('2026-11-26T00:30:00+08:00');
    const win = computeDailyPiWindow('2026-11-25', nowMs);

    assert.equal(win.valid, true);
    assert.equal(win.windowMode, 'FULL_DAY');
    assert.equal(win.isFinal, true);
    assert.equal(win.useRecorded, true);
    assert.equal(win.fetchMethod, 'RECORDED');
    assert.equal(win.startIso, '2026-11-25T00:00:00+08:00');
    assert.equal(win.endIso, '2026-11-26T00:00:00+08:00');
});

test('computeDailyPiWindow: 結束時間超過 8 小時後採用 SUMMARY', () => {
    const nowMs = Date.parse('2026-11-26T09:00:00+08:00');
    const win = computeDailyPiWindow('2026-11-25', nowMs);

    assert.equal(win.valid, true);
    assert.equal(win.windowMode, 'FULL_DAY');
    assert.equal(win.isFinal, true);
    assert.equal(win.useRecorded, false);
    assert.equal(win.fetchMethod, 'SUMMARY');
    assert.equal(win.startIso, '2026-11-25T00:00:00+08:00');
    assert.equal(win.endIso, '2026-11-26T00:00:00+08:00');
});

test('computeDailyPiWindow: 未來日期應標記無效', () => {
    const nowMs = Date.parse('2026-11-25T13:00:00+08:00');
    const win = computeDailyPiWindow('2026-11-26', nowMs);

    assert.equal(win.valid, false);
    assert.equal(win.reason, 'FUTURE_DATE');
});

test('integrateRecordedTotal: 梯形積分與邊界裁切、異常值過濾', () => {
    const start = Date.parse('2026-11-25T00:00:00+08:00');
    const end = start + 24 * HOUR_MS;

    assert.equal(integrateRecordedTotal([], start, end), 0);
    assert.equal(integrateRecordedTotal([{ t: start, v: 10 }], start, end), 240);

    // Unsorted + non-finite + linear ramp from 10 to 20 over 24h -> avg 15 * 24 = 360
    const pts = [
        { t: start + 12 * HOUR_MS, v: 15 },
        { t: end, v: 20 },
        { t: start, v: 10 },
        { t: start + 6 * HOUR_MS, v: Number.NaN }
    ];
    assert.equal(integrateRecordedTotal(pts, start, end), 360);
});

test('computeRecordedAverage: 時間加權平均與邊界情況', () => {
    const start = Date.parse('2026-11-25T00:00:00+08:00');
    const end = start + 24 * HOUR_MS;

    assert.equal(computeRecordedAverage([], start, end), null);
    assert.equal(computeRecordedAverage([{ t: start, v: 32.5 }], start, end), 32.5);

    // 0h->12h: constant 10; 12h->24h: constant 20 => avg 15
    const pts = [
        { t: start, v: 10 },
        { t: start + 12 * HOUR_MS, v: 10 },
        { t: start + 12 * HOUR_MS, v: 20 },
        { t: end, v: 20 }
    ];
    assert.equal(computeRecordedAverage(pts, start, end), 15);
});

test('resolveConcentrationCycles: 硬度比值優先，其次手動倍數，最後預設 8', () => {
    const dayEnd = Date.parse('2026-11-26T00:00:00+08:00');
    const rows = [
        { date: Date.parse('2026-11-10T00:00:00+08:00'), cws_hardness: 0, makeup_hardness: 0, concentration_cycles: 6.5 },
        { date: Date.parse('2026-11-20T00:00:00+08:00'), cws_hardness: 375, makeup_hardness: 50, concentration_cycles: 7 },
        { date: Date.parse('2026-11-30T00:00:00+08:00'), cws_hardness: 500, makeup_hardness: 50, concentration_cycles: 10 }
    ];

    const fromHardness = resolveConcentrationCycles(rows, dayEnd);
    assert.equal(fromHardness.cycles, 7.5);
    assert.equal(fromHardness.sourceDate, Date.parse('2026-11-20T00:00:00+08:00'));

    const manualOnly = resolveConcentrationCycles([rows[0]], dayEnd);
    assert.equal(manualOnly.cycles, 6.5);

    const fallback = resolveConcentrationCycles([], dayEnd);
    assert.equal(fallback.cycles, 8);
    assert.equal(fallback.sourceDate, null);
});

test('enumerateTaipeiDates: 月份邊界、上限截斷與無效範圍', () => {
    const oct = enumerateTaipeiDates('2026-10-01', '2026-10-31');
    assert.equal(oct.length, 31);
    assert.equal(oct[0], '2026-10-01');
    assert.equal(oct[30], '2026-10-31');

    const capped = enumerateTaipeiDates('2026-01-01', '2026-12-31', 10);
    assert.equal(capped.length, 10);
    assert.equal(capped[9], '2026-01-10');

    assert.deepEqual(enumerateTaipeiDates('2026-10-10', '2026-10-01'), []);
    assert.deepEqual(enumerateTaipeiDates('invalid', '2026-10-01'), []);
});

test('calculateCondensateRecoveryRate: 2026-11-24 實測數據驗證與停爐保護', () => {
    const withSpray = calculateCondensateRecoveryRate({
        feedwaterFlow: 18173.78,
        sprayWaterFlow: 3680.29,
        makeupWaterFlow: 3162.43,
        blowdownFlow: 211.03,
        steamProduction: 20982.20,
        includeSprayWater: true
    });
    assert.equal(withSpray, 88.08);

    const withoutSpray = calculateCondensateRecoveryRate({
        feedwaterFlow: 18173.78,
        sprayWaterFlow: 3680.29,
        makeupWaterFlow: 3162.43,
        blowdownFlow: 211.03,
        steamProduction: 20982.20,
        includeSprayWater: false
    });
    assert.equal(withoutSpray, 70.54);

    assert.equal(
        calculateCondensateRecoveryRate({
            feedwaterFlow: 100,
            sprayWaterFlow: 10,
            makeupWaterFlow: 20,
            blowdownFlow: 5,
            steamProduction: 0
        }),
        null
    );
    assert.equal(
        calculateCondensateRecoveryRate({
            feedwaterFlow: 100,
            sprayWaterFlow: 10,
            makeupWaterFlow: 20,
            blowdownFlow: 5,
            steamProduction: 0.5
        }),
        null
    );
    assert.equal(
        calculateCondensateRecoveryRate({
            feedwaterFlow: null,
            sprayWaterFlow: 10,
            makeupWaterFlow: 20,
            blowdownFlow: 5,
            steamProduction: 1000
        }),
        null
    );
});

test('aggregateWeeklyCondensateRecovery: 總流量加權週回收率與缺值過濾', () => {
    const weekStart = Date.parse('2026-11-23T00:00:00+08:00');
    const weekEnd = weekStart + 7 * 24 * HOUR_MS;

    const rows = [
        // Day 1: high steam load (20000), recovery = (21000 - 3000 - 200) / 20000 = 89.00%
        {
            date: weekStart,
            feedwaterFlow: 17500,
            sprayWaterFlow: 3500,
            makeupWaterFlow: 3000,
            blowdownFlow: 200,
            steamProduction: 20000
        },
        // Day 2: low steam load (10000), recovery = (9500 - 2000 - 100) / 10000 = 74.00%
        {
            date: weekStart + 24 * HOUR_MS,
            feedwaterFlow: 8000,
            sprayWaterFlow: 1500,
            makeupWaterFlow: 2000,
            blowdownFlow: 100,
            steamProduction: 10000
        },
        // Day 3: missing feedwaterFlow -> should be skipped
        {
            date: weekStart + 48 * HOUR_MS,
            feedwaterFlow: null,
            sprayWaterFlow: 1500,
            makeupWaterFlow: 2000,
            blowdownFlow: 100,
            steamProduction: 10000
        }
    ];

    const agg = aggregateWeeklyCondensateRecovery(rows, weekStart, weekEnd, true);
    assert.ok(agg);
    assert.equal(agg.coveredDays, 2);
    // Flow-weighted: (17800 + 7400) / 30000 = 25200 / 30000 = 84.00% (simple avg would be 81.50%)
    assert.equal(agg.condensateRecoveryRate, 84.0);
    assert.equal(agg.steamProduction, 30000);

    // No eligible rows -> null
    assert.equal(aggregateWeeklyCondensateRecovery([rows[2]], weekStart, weekEnd, true), null);
});
