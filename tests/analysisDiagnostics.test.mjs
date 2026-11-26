import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseWaterQualityNumber,
    normalizeMetricLabel,
    getWaterQualityContextForTank,
    pickDefaultWaterQualityMetric,
    normalizeDateKeyFromApi,
    buildDailyWaterQualityMap,
    computeWeeklyWaterQualityAverage,
    calculateCwsBlowdownM3,
    buildDailyEventMap,
    formatTooltipEvents,
    normalizeCmDecimalsInText,
    formatAlertTextForDisplay,
    getDailyAxisTickDisplay
} from '../analysisDiagnosticUtils.js';

test('parseWaterQualityNumber 與 normalizeMetricLabel 正確清洗數值與指標別名', () => {
    assert.equal(parseWaterQualityNumber(8.25), 8.25);
    assert.equal(parseWaterQualityNumber('5*10^3'), 5000);
    assert.equal(parseWaterQualityNumber('< 0.05 ppm'), 0.05);
    assert.equal(parseWaterQualityNumber('none'), null);
    assert.equal(parseWaterQualityNumber('-'), null);

    const aliasMap = new Map([['Specific Conductance      μs/㎝', '電導度 μs/cm']]);
    assert.equal(normalizeMetricLabel('Specific Conductance      μs/㎝', aliasMap), '電導度 μs/cm');
    assert.equal(normalizeMetricLabel('Total   Hardness    ppm', aliasMap), 'Total Hardness ppm');
});

test('getWaterQualityContextForTank 與 pickDefaultWaterQualityMetric 對應正確水質點位與預設指標', () => {
    const amineTank = { id: 'tb_2', name: '中和胺', system: '鍋爐水系統' };
    const amineCtx = getWaterQualityContextForTank(amineTank);
    assert.equal(amineCtx.waterType, 'BW');
    assert.equal(amineCtx.defaultPointGroup, 'CD');
    assert.equal(pickDefaultWaterQualityMetric(amineTank, ['Silica', 'pH at 25℃', 'NH3']), 'pH at 25℃');

    const ct2Bleach = { id: 'tc2_2', name: 'CT-2 漂白水', system: '冷卻水系統' };
    const ct2Ctx = getWaterQualityContextForTank(ct2Bleach);
    assert.equal(ct2Ctx.waterType, 'CW');
    assert.equal(ct2Ctx.defaultPointGroup, 'CW_2');
    assert.equal(pickDefaultWaterQualityMetric(ct2Bleach, ['pH', '殘餘氯 (R-Cl) ppm']), '殘餘氯 (R-Cl) ppm');

    const oxygenTank = { id: 'tb_3', name: '脫氧劑', system: '鍋爐水系統' };
    assert.equal(getWaterQualityContextForTank(oxygenTank).defaultPointGroup, 'BFW');
    assert.equal(pickDefaultWaterQualityMetric(oxygenTank, ['pH at 25℃', 'N2H4 ,ppb (聯胺)']), 'N2H4 ,ppb (聯胺)');
});

test('buildDailyWaterQualityMap 與 computeWeeklyWaterQualityAverage 正確聚合多爐平均與週平均', () => {
    const wqReadings = [
        { sample_point: 'BLR1_CD', test_date: '2026-10-05T08:00:00+08:00', data: { 'pH at 25℃': '8.8' } },
        { sample_point: 'BLR2_CD', test_date: '2026-10-05', data: { 'pH at 25℃': '9.2' } },
        { sample_point: 'BLR1_CD', test_date: '2026-10-07', data: { 'pH at 25℃': '8.6' } },
        { sample_point: 'BLR1_BFW', test_date: '2026-10-05', data: { 'pH at 25℃': '9.5' } }
    ];

    assert.equal(normalizeDateKeyFromApi('2026/10/5'), '2026-10-05');
    const dailyMap = buildDailyWaterQualityMap(wqReadings, ['BLR1_CD', 'BLR2_CD'], 'pH at 25℃');
    assert.equal(dailyMap.get('2026-10-05')?.value, 9);
    assert.equal(dailyMap.get('2026-10-05')?.sampleCount, 2);
    assert.equal(dailyMap.get('2026-10-07')?.value, 8.6);

    const weekly = computeWeeklyWaterQualityAverage(dailyMap, '2026-10-05', 7);
    assert.equal(weekly.sampleDays, 2);
    assert.equal(weekly.value, 8.8);
});

test('calculateCwsBlowdownM3 正確計算冷卻水排放水量', () => {
    // E = (20000 * 5 * 1.8 * 24 * 1) / 1000 = 4320; C = 7 => BW = 4320 / 6 = 720 m3
    assert.equal(calculateCwsBlowdownM3(20000, 5, 7, 1), 720);
    assert.equal(calculateCwsBlowdownM3(20000, 5, 1, 1), null);
    assert.equal(calculateCwsBlowdownM3(0, 5, 7, 1), null);
});

test('buildDailyEventMap 正確聚合補藥、異常、紀事與換約，並隔離一二階', () => {
    const tank = { id: 'tc1_2', name: 'CT-1 漂白水', system: '冷卻水系統', description: '一階' };
    const readings = [
        { tankId: 'tc1_2', timestamp: Date.parse('2026-10-14T00:00:00+08:00'), addedAmountLiters: 500, operatorName: 'OP' },
        { tankId: 'tc2_2', timestamp: Date.parse('2026-10-14T00:00:00+08:00'), addedAmountLiters: 800 }
    ];
    const alerts = [
        { tankId: 'tc1_2', dateStr: '2026-10-14', reason: '變動異常', note: '已補藥' }
    ];
    const notes = [
        { dateStr: '2026-10-14', area: '冷卻水系統', chemicalName: 'CT-1 漂白水', note: '加藥測試', markedWaterType: 'CW' },
        { dateStr: '2026-10-14', area: '冷卻水系統', chemicalName: 'CT-2 漂白水', note: '二階清洗', markedWaterType: 'CW' }
    ];
    const supplies = [
        { tankId: 'tc1_2', startDate: Date.parse('2026-10-10T00:00:00+08:00'), chemicalName: '漂白水', specificGravity: 1.15, targetPpm: 2 }
    ];

    const map = buildDailyEventMap({
        tank,
        readings,
        alerts,
        notes,
        supplies,
        startDate: '2026-10-01',
        endDate: '2026-10-31'
    });

    const oct14 = map.get('2026-10-14') || [];
    assert.equal(oct14.length, 3);
    assert.deepEqual(oct14.map(e => e.type), ['REFILL', 'ALERT', 'NOTE']);
    assert.ok(!oct14.some(e => e.detail.includes('二階清洗')));

    const oct10 = map.get('2026-10-10') || [];
    assert.equal(oct10.length, 1);
    assert.equal(oct10[0].type, 'SUPPLY');
});

test('formatTooltipEvents 正確精簡長事件與計算隱藏數量', () => {
    assert.deepEqual(formatTooltipEvents([]), {
        items: [],
        hiddenCount: 0,
        hasMoreDetail: false,
        totalCount: 0
    });
    assert.deepEqual(formatTooltipEvents(null), {
        items: [],
        hiddenCount: 0,
        hasMoreDetail: false,
        totalCount: 0
    });

    const shortRes = formatTooltipEvents([
        { type: 'REFILL', icon: '🚚', label: '補藥', detail: '補藥 200 L' }
    ]);
    assert.equal(shortRes.items.length, 1);
    assert.equal(shortRes.items[0].shortDetail, '補藥 200 L');
    assert.equal(shortRes.items[0].truncated, false);
    assert.equal(shortRes.hasMoreDetail, false);
    assert.equal(shortRes.totalCount, 1);

    const longDetail = '異常警報：人工日使用量 9.3 L；PI 日使用量 11 L；差距 19.24%（以人工用量為分母，須小於 17%）；PI 期初／期末液位 49.632 / 48.439 cm';
    const longRes = formatTooltipEvents([
        { type: 'ALERT', icon: '⚠️', label: '異常警報', detail: longDetail }
    ], 2, 42);
    assert.equal(longRes.items.length, 1);
    assert.equal(Array.from(longRes.items[0].shortDetail).length, 43);
    assert.ok(longRes.items[0].shortDetail.endsWith('…'));
    assert.equal(longRes.items[0].truncated, true);
    assert.equal(longRes.hasMoreDetail, true);

    const multiRes = formatTooltipEvents([
        { type: 'REFILL', icon: '🚚', label: '補藥', detail: '補藥 100 L' },
        { type: 'ALERT', icon: '⚠️', label: '異常警報', detail: '備註 A' },
        { type: 'NOTE', icon: '📝', label: '重要紀事', detail: '紀事 B' },
        { type: 'SUPPLY', icon: '🔄', label: '合約切換', detail: '切換 C' }
    ], 2, 42);
    assert.equal(multiRes.items.length, 2);
    assert.equal(multiRes.hiddenCount, 2);
    assert.equal(multiRes.totalCount, 4);
    assert.equal(multiRes.hasMoreDetail, true);
});

test('normalizeCmDecimalsInText 與 buildDailyEventMap 將公分數據精簡至小數點後兩位', () => {
    const rawAlert = '人工日使用量 9.3 L；PI 日使用量 11 L；差距 19.24%（以人工用量為分母，須小於 17%）；PI 期初／期末液位 49.632 / 48.439 cm，依桶槽形狀換算存量 458.89 / 447.86 L；以非補藥日存量差比較，不使用 APP 補藥紀錄。；採用歷史驗證的經驗換算：液位 cm＝1.0158 × PI 原始值＋2.51；非儀表原廠量程。獨立週期驗證液位誤差中位數 0.41998627659839816 cm、90 百分位 1.1032527214009678 cm。';
    const normalized = normalizeCmDecimalsInText(rawAlert);

    assert.ok(normalized.includes('49.63 / 48.44 cm'));
    assert.ok(normalized.includes('0.42 cm'));
    assert.ok(normalized.includes('1.1 cm'));
    // 非公分數值不應被改寫
    assert.ok(normalized.includes('1.0158 × PI'));
    assert.ok(normalized.includes('19.24%'));
    assert.ok(normalized.includes('458.89 / 447.86 L'));
    // 整數與兩位以內公分維持原樣
    assert.equal(normalizeCmDecimalsInText('不得低於 28 cm 或誤差 1.25 cm'), '不得低於 28 cm 或誤差 1.25 cm');

    const eventMap = buildDailyEventMap({
        tank: { id: 'tb_2', name: '中和胺', system: '鍋爐水系統' },
        alerts: [{ tankId: 'tb_2', dateStr: '2026-10-05', reason: rawAlert }],
        supplies: [
            { tankId: 'tb_2', startDate: Date.parse('2025-07-01T00:00:00+08:00'), supplierName: '蘇伊士', chemicalName: '中和胺NA0640', specificGravity: 0.98, targetPpm: 0.4 },
            { tankId: 'tb_2', startDate: Date.parse('2026-07-01T00:00:00+08:00'), supplierName: '開廣', chemicalName: '中和胺B-1462', specificGravity: 0.98, targetPpm: 0.4 },
            { tankId: 'tb_2', startDate: Date.parse('2026-10-01T00:00:00+08:00'), supplierName: '開廣', chemicalName: '中和胺B-1462', specificGravity: 0.99, targetPpm: 0.4 }
        ],
        startDate: '2025-01-01',
        endDate: '2026-10-31'
    });
    const events = eventMap.get('2026-10-05') || [];
    assert.equal(events.length, 1);
    assert.ok(events[0].detail.includes('人工液位抄表與線上液位計(PI)換算差距過大'));
    assert.ok(events[0].detail.includes('49.63 → 48.44 cm'));
    assert.ok(!events[0].detail.includes('獨立週期驗證'));

    const oct01 = eventMap.get('2026-10-01') || [];
    assert.equal(oct01.length, 1);
    assert.equal(oct01[0].icon, '⚖️');
    assert.equal(oct01[0].label, '比重調整');
    assert.ok(oct01[0].detail.includes('0.98 → 0.99'));

    const jul01 = eventMap.get('2026-07-01') || [];
    assert.equal(jul01.length, 1);
    assert.equal(jul01[0].icon, '🔄');
    assert.equal(jul01[0].label, '合約切換');

    // formatAlertTextForDisplay preserves trailing operator notes & non-PI alerts
    const withNote = formatAlertTextForDisplay(`${rawAlert} 檢查原因為 : 泵浦行程偏高`);
    assert.ok(withNote.includes('備註說明：檢查原因為 : 泵浦行程偏高'));
    assert.equal(formatAlertTextForDisplay('液位變化異常(15 kg)，超過閾值12 kg'), '液位變化異常(15 kg)，超過閾值12 kg');
});

test('getDailyAxisTickDisplay 確保 31 天單月完整顯示所有日期，並保留跨月事件顯示', () => {
    for (let i = 0; i < 31; i++) {
        const res = getDailyAxisTickDisplay(31, i);
        assert.equal(res.showDateText, true);
        assert.equal(res.fontSize, 10);
    }
    assert.equal(getDailyAxisTickDisplay(14, 3).fontSize, 11);
    assert.equal(getDailyAxisTickDisplay(45, 0).showDateText, true);
    assert.equal(getDailyAxisTickDisplay(45, 1).showDateText, false);
    assert.equal(getDailyAxisTickDisplay(45, 44).showDateText, true);
});
