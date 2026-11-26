import test from 'node:test';
import assert from 'node:assert/strict';
import {
    computeDailyPiWindow,
    enumerateTaipeiDates,
    integrateRecordedTotal,
    computeRecordedAverage,
    resolveConcentrationCycles,
    calculateCondensateRecoveryRate,
    aggregateWeeklyCondensateRecovery,
    calculateCondensateLossRate,
    calculateActualDosingPpm,
    computePeriodReadings,
    computePeriodActualUsage
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

test('computeDailyPiWindow: 當日 22:00 前選今日應回傳 DAY_NOT_READY，22:00 起才允許滾動 24 小時', () => {
    const morning = computeDailyPiWindow('2026-11-26', Date.parse('2026-11-26T10:00:00+08:00'));
    assert.equal(morning.valid, false);
    assert.equal(morning.reason, 'DAY_NOT_READY');
    assert.equal(morning.allowedAfterIso, '2026-11-26T22:00:00+08:00');

    const beforeCutoff = computeDailyPiWindow('2026-11-26', Date.parse('2026-11-26T21:59:59+08:00'));
    assert.equal(beforeCutoff.valid, false);
    assert.equal(beforeCutoff.reason, 'DAY_NOT_READY');

    const atCutoff = computeDailyPiWindow('2026-11-26', Date.parse('2026-11-26T22:00:00+08:00'));
    assert.equal(atCutoff.valid, true);
    assert.equal(atCutoff.windowMode, 'ROLLING_24H');
    assert.equal(atCutoff.isFinal, false);
    assert.equal(atCutoff.useRecorded, true);
    assert.equal(atCutoff.startIso, '2026-11-25T22:00:00+08:00');
    assert.equal(atCutoff.endIso, '2026-11-26T22:00:00+08:00');
});

test('computeDailyPiWindow: 隔日 07:30 與 08:00 補登昨日時皆取完整 00:00~24:00，並依 8 小時規則切換 RECORDED/SUMMARY', () => {
    const earlyMorning = computeDailyPiWindow('2026-11-25', Date.parse('2026-11-26T07:30:00+08:00'));
    assert.equal(earlyMorning.valid, true);
    assert.equal(earlyMorning.windowMode, 'FULL_DAY');
    assert.equal(earlyMorning.isFinal, true);
    assert.equal(earlyMorning.useRecorded, true);

    const afterEight = computeDailyPiWindow('2026-11-25', Date.parse('2026-11-26T08:00:00+08:00'));
    assert.equal(afterEight.valid, true);
    assert.equal(afterEight.windowMode, 'FULL_DAY');
    assert.equal(afterEight.isFinal, true);
    assert.equal(afterEight.useRecorded, false);
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

test('calculateCondensateLossRate 與 calculateActualDosingPpm: 正確計算未回收率與實際單耗', () => {
    assert.equal(calculateCondensateLossRate(88.08), 11.92);
    assert.equal(calculateCondensateLossRate('85.76'), 14.24);
    assert.equal(calculateCondensateLossRate(null), null);

    // 65.9 kg / 133784.6 ton = 0.49258... -> 0.493 ppm
    assert.equal(calculateActualDosingPpm(65.9, 133784.6), 0.493);
    assert.equal(calculateActualDosingPpm(0, 1000), 0);
    assert.equal(calculateActualDosingPpm(10, 0), null);
    assert.equal(calculateActualDosingPpm(10, 0.5), null);
    assert.equal(calculateActualDosingPpm(null, 1000), null);
});

test('computePeriodReadings 與 computePeriodActualUsage: 日結束歸屬（方向A）、完整7天、換約比重切換、跨區間分攤與補藥偵測', () => {
    const dayTs = (d) => Date.parse(`${d}T00:00:00+08:00`);
    const weekStart = dayTs('2026-09-28');
    const weekEndExcl = dayTs('2026-10-05'); // Mon 10/5 00:00

    // Direction A: 9/27 reading = start of 9/28 (end of 9/27), ..., 10/4 reading = end of 10/4 (start of 10/5)
    // Daily readings from 9/27 to 10/04 (10 L decrease each day, so 7 days = 70 L)
    const readings = [];
    const seqStart = dayTs('2026-09-27');
    for (let i = 0; i <= 7; i++) {
        const d = new Date(seqStart + i * 24 * HOUR_MS);
        const yyyy = new Date(d.getTime() + 8 * HOUR_MS).getUTCFullYear();
        const mm = String(new Date(d.getTime() + 8 * HOUR_MS).getUTCMonth() + 1).padStart(2, '0');
        const dd = String(new Date(d.getTime() + 8 * HOUR_MS).getUTCDate()).padStart(2, '0');
        readings.push({
            id: `r-${yyyy}-${mm}-${dd}`,
            tankId: 'tb_2',
            timestamp: seqStart + i * 24 * HOUR_MS,
            levelCm: 60 - i,
            calculatedVolume: 500 - i * 10,
            addedAmountLiters: 0,
            appliedSpecificGravity: i < 4 ? 0.98 : 0.99
        });
    }

    const periodReadings = computePeriodReadings(readings, 'tb_2', weekStart, weekEndExcl);
    assert.equal(periodReadings.length, 8); // 9/27 through 10/4 inclusive => 7 intervals covering 9/28..10/4

    const supplies = [
        { tankId: 'tb_2', startDate: dayTs('2026-10-01'), specificGravity: 0.99, price: 50 },
        { tankId: 'tb_2', startDate: dayTs('2026-07-01'), specificGravity: 0.98, price: 40 }
    ];

    const weekL = computePeriodActualUsage({
        readings,
        tankId: 'tb_2',
        periodStartMs: weekStart,
        periodEndExclusiveMs: weekEndExcl,
        metric: 'L',
        suppliesHistory: supplies,
        getVolume: (r) => r.calculatedVolume
    });
    assert.equal(Math.round(weekL * 100) / 100, 70);

    // 9/28, 9/29, 9/30 (3 days * 10L * 0.98 = 29.4 kg) + 10/1..10/4 (4 days * 10L * 0.99 = 39.6 kg) = 69.0 kg
    const weekKg = computePeriodActualUsage({
        readings,
        tankId: 'tb_2',
        periodStartMs: weekStart,
        periodEndExclusiveMs: weekEndExcl,
        metric: 'KG',
        suppliesHistory: supplies,
        getVolume: (r) => r.calculatedVolume
    });
    assert.equal(Math.round(weekKg * 100) / 100, 69.0);

    // Verify 9/30 -> 10/1 interval is attributed strictly to 10/1 (at SG 0.99 = 9.9 kg), not 9/30
    const oct01Kg = computePeriodActualUsage({
        readings,
        tankId: 'tb_2',
        periodStartMs: dayTs('2026-10-01'),
        periodEndExclusiveMs: dayTs('2026-10-02'),
        metric: 'KG',
        suppliesHistory: supplies,
        getVolume: (r) => r.calculatedVolume
    });
    assert.equal(Math.round(oct01Kg * 100) / 100, 9.9);

    // 29.4 * 40 + 39.6 * 50 = 1176 + 1980 = 3156
    const weekCost = computePeriodActualUsage({
        readings,
        tankId: 'tb_2',
        periodStartMs: weekStart,
        periodEndExclusiveMs: weekEndExcl,
        metric: '$',
        suppliesHistory: supplies,
        getVolume: (r) => r.calculatedVolume
    });
    assert.equal(Math.round(weekCost * 100) / 100, 3156);

    // Cross-boundary multi-day gap: reading at 10/28 end (500L) and 11/1 end (460L) -> 10 L/day across 10/29..11/1
    // Oct 29..31 = 3 days inside [10/1, 11/1) -> 30L * 0.99 = 29.7 kg
    const crossReadings = [
        { id: 'c1', tankId: 'tb_2', timestamp: dayTs('2026-10-28'), calculatedVolume: 500, addedAmountLiters: 0, appliedSpecificGravity: 0.99 },
        { id: 'c2', tankId: 'tb_2', timestamp: dayTs('2026-11-01'), calculatedVolume: 460, addedAmountLiters: 0, appliedSpecificGravity: 0.99 }
    ];
    const octEndUsageKg = computePeriodActualUsage({
        readings: crossReadings,
        tankId: 'tb_2',
        periodStartMs: dayTs('2026-10-01'),
        periodEndExclusiveMs: dayTs('2026-11-01'),
        metric: 'KG',
        suppliesHistory: supplies,
        getVolume: (r) => r.calculatedVolume
    });
    assert.equal(Math.round(octEndUsageKg * 100) / 100, 29.7);

    // Unrecorded large refill (>= 5 days of daily usage) is skipped while small fluctuation (< 5 days) cancels net usage
    const refillReadings = [
        { id: 'f1', tankId: 'tb_2', timestamp: dayTs('2026-10-09'), calculatedVolume: 400, addedAmountLiters: 0 },
        { id: 'f2', tankId: 'tb_2', timestamp: dayTs('2026-10-10'), calculatedVolume: 390, addedAmountLiters: 0 }, // 10/10: -10L
        { id: 'f3', tankId: 'tb_2', timestamp: dayTs('2026-10-11'), calculatedVolume: 490, addedAmountLiters: 0 }, // 10/11: +100L implicit refill
        { id: 'f4', tankId: 'tb_2', timestamp: dayTs('2026-10-12'), calculatedVolume: 480, addedAmountLiters: 0 }  // 10/12: -10L
    ];
    const refillWeekL = computePeriodActualUsage({
        readings: refillReadings,
        tankId: 'tb_2',
        periodStartMs: dayTs('2026-10-10'),
        periodEndExclusiveMs: dayTs('2026-10-13'),
        metric: 'L',
        suppliesHistory: supplies,
        getVolume: (r) => r.calculatedVolume
    });
    assert.equal(Math.round(refillWeekL * 100) / 100, 20);
});
