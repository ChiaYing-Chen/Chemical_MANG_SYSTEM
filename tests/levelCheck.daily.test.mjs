import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyPeriod, evaluateDaily, makeCalibrationPair } from '../levelCheck.js';
import { calculateTankVolume } from '../backendUtils.js';
import { DAILY_PI_CONVERSIONS } from '../piDailyConversions.js';

test('啟用的週期固定模型正確換算，桶槽與 Tag 必須一致', () => {
    for (const [id, model] of Object.entries(DAILY_PI_CONVERSIONS)) {
        const mapped = { ...tank, id, piLevelUnit: model.unit || 'PERCENT', piLevelTag: model.tag };
        const raw = series.map(p => ({ ...p, v: (p.v - model.intercept) / model.slope }));
        const r = evaluateDaily({ ...fixture, tank: mapped, series: raw });
        assert.equal(r.status, 'OK', id);
        assert.equal(r.piUsagePer24h, 240, id);
        assert.ok(r.messages.some(m => m.includes('經驗換算')));
        const mismatched = evaluateDaily({ ...fixture, tank: { ...mapped, piLevelTag: 'OTHER' }, series: raw });
        assert.ok(!mismatched.messages.some(m => m.includes('經驗換算')));
        if (mapped.piLevelUnit !== 'CM') assert.equal(mismatched.status, 'NO_PI');
    }
});

test('CT-1 硫酸經驗換算包含零點偏移，避免臥式槽容積誤算', () => {
    const model = DAILY_PI_CONVERSIONS.tc1_1;
    const horizontal = { ...tank, id: 'tc1_1', piLevelUnit: 'PERCENT', piLevelTag: model.tag, factor: 0, shape_type: 'HORIZONTAL_CYLINDER', dimensions: { diameter: 300, length: 400 } };
    const raw = series.map(p => ({ ...p, v: (p.v - model.intercept) / model.slope }));
    const r = evaluateDaily({ ...fixture, tank: horizontal, series: raw });
    assert.equal(r.status, 'OK');
    assert.equal(r.piUsagePer24h, r.manualUsagePer24h);
});

test('量程設定不能繞過待驗證模型，APP 補藥欄位不影響日判定', () => {
    const pending = { ...tank, id: 'unregistered', piLevelUnit: 'PERCENT', piLevelTag:'W52_PH1-3_3.PV', piPercentFactor: 2 };
    assert.equal(evaluateDaily({ ...fixture, tank:pending }).status,'NO_PI');
    assert.deepEqual(evaluateDaily({...fixture,addedLiters:99999}),evaluateDaily(fixture));
});

test('雷達高頻波動不累加成補藥，真正持續階躍仍保留', () => {
    const model = DAILY_PI_CONVERSIONS.tc1_1;
    const mapped = { ...tank, id: 'tc1_1', piLevelUnit: 'PERCENT', piLevelTag: model.tag };
    const noisy = Array.from({ length: 9361 }, (_, i) => {
        const t = period.start - H + i * 10000;
        const cm = 100 - (t - period.start) / H + [-4, -2, 0, 2, 4][i % 5];
        return { t, v: (cm - model.intercept) / model.slope };
    });
    const r = evaluateDaily({ ...fixture, tank: mapped, series: noisy });
    assert.equal(r.refill.count, 0);
    assert.ok(r.piUsagePer24h > 220 && r.piUsagePer24h < 260);
    const refilled = noisy.map(p => ({ ...p, v: p.v + (p.t >= period.start + 12 * H ? 30 / model.slope : 0) }));
    const refill = evaluateDaily({ ...fixture, tank: mapped, series: refilled, inputValue: 106, addedLiters: 300 });
    assert.equal(refill.refill.count, 1);
    assert.equal(refill.status, 'NO_PI');
    const broken = noisy.filter(p => Math.abs(p.t - period.start - 6 * H) > 7 * 60000);
    assert.equal(evaluateDaily({ ...fixture, tank: mapped, series: broken }).status, 'NO_PI');
});

const H = 3600000;
const period = dailyPeriod('2026-10-05');
const tank = { piLevelUnit: 'CM', inputUnit: 'CM', factor: 10 };
const series = Array.from({ length: 25 }, (_, i) => ({ t: period.start + i * H, v: 100 - i }));
const fixture = { tank, period, prev: { levelCm: 100 }, inputValue: 76, series };

test('台北業務日跨月跨年邊界固定 24 小時', () => {
    assert.equal(new Date(period.start).toISOString(), '2026-10-04T16:00:00.000Z');
    assert.equal(new Date(dailyPeriod('2026-12-31').end).toISOString(), '2026-12-31T16:00:00.000Z');
    assert.equal(dailyPeriod('2026-02-29'), null);
});

test('全天用量相符即通過，不拿絕對液位偏移判錯欄位', () => {
    const r = evaluateDaily({ ...fixture, prev: { levelCm: 150 }, inputValue: 126 });
    assert.equal(r.status, 'OK');
    assert.equal(r.manualUsagePer24h, 240);
    assert.equal(r.piUsagePer24h, 240);
    assert.equal(r.swapSuspect, undefined);
    assert.equal(r.readAt, undefined);
    assert.equal(r.piRawCm, undefined);
});

test('用量差異確實超標仍提醒，沒有全面關閉 double check', () => {
    const r = evaluateDaily({ ...fixture, inputValue: 40 });
    assert.equal(r.status, 'WARN');
    assert.equal(r.usageDeviationLiters, -360);
});

test('缺前日、未結束、缺午夜、斷線、缺換算或舊公式不得誤判通過或輸入異常', () => {
    for (const overrides of [
        { prev: null }, { period: { start: Date.now(), end: Date.now() + 24 * H } },
        { series: series.slice(1) }, { series: [series[0], series.at(-1)] },
        { tank: { ...tank, piLevelUnit: 'PERCENT' } },
        { tank: { ...tank, dimensions: { diameter: 200, length: 300 }, shape_type: 'HORIZONTAL_CYLINDER' }, calib: { slope: 1, intercept: 86, n: 3, mode: 'AUTO' } },
    ]) assert.equal(evaluateDaily({ ...fixture, ...overrides }).status, 'NO_PI');
});

test('正確百分比倍率套用在期初期末液位', () => {
    const r = evaluateDaily({ ...fixture, tank: { ...tank, piLevelUnit: 'PERCENT', piPercentFactor: 2 }, series: series.map(p => ({ ...p, v: p.v / 2 })) });
    assert.equal(r.status, 'OK');
    assert.equal(r.piUsagePer24h, 240);
});

test('水平槽偵測補藥時暫停日判定，不依賴 APP 補藥量', () => {
    const horizontal = { ...tank, factor: 0, shape_type: 'HORIZONTAL_CYLINDER', dimensions: { diameter: 200, length: 300, headType: 'FLAT' } };
    const refillSeries = series.map((p, i) => ({ ...p, v: p.v + (i >= 12 ? 30 : 0) }));
    const added = calculateTankVolume(horizontal, 118) - calculateTankVolume(horizontal, 89);
    const r = evaluateDaily({ ...fixture, tank: horizontal, series: refillSeries, inputValue: 106, addedLiters: added });
    assert.equal(r.status, 'NO_PI');
    assert.equal(r.refill.count, 1);
    assert.equal(r.usageDeviationPercent, undefined);
});

test('日界外的補藥不計入當日', () => {
    const r = evaluateDaily({ ...fixture, series: [{t: period.start - H, v: 20}, ...series, {t: period.end + H, v: 150}] });
    assert.equal(r.refill.count, 0);
    assert.equal(r.piUsagePer24h, 240);
});









test('固定 L/cm 的消耗差不受舊固定偏移影響，保留有效 double check', () => {
    const r = evaluateDaily({ ...fixture, calib: { slope: 1, intercept: 90, n: 3, mode: 'AUTO' } });
    assert.equal(r.status, 'OK');
    assert.equal(r.piUsagePer24h, 240);
});







const midnightSeries = Array.from({length: 9}, (_, i) => ({t: period.end + (i - 4) * H / 2, v: 50 + i / 10}));
test('已確認的午夜估計配對保留來源，不填造實際抄表時間', () => {
    const result = makeCalibrationPair(tank, {timestamp: period.start}, midnightSeries, period.end + 3 * H);
    assert.equal(result.calibrationPair.target, period.end);
    assert.equal(result.calibrationPair.basis, 'MIDNIGHT_WINDOW');
    assert.equal(result.calibrationPair.estimated, true);
    assert.equal(result.piRawCm, 50.4);
    assert.equal(result.readAt, undefined);
});
test('午夜變動過大、缺資料、未完成時窗及未知百分比換算不進回歸', () => {
    for (const [t, points, now] of [
        [tank, midnightSeries.map((p,i)=>({...p,v:i*3})), period.end + 3*H],
        [tank, midnightSeries.slice(2), period.end + 3*H],
        [tank, midnightSeries, period.end],
        [{...tank,piLevelUnit:'PERCENT'}, midnightSeries, period.end + 3*H],
    ]) assert.ok(makeCalibrationPair(t,{timestamp:period.start},points,now).error);
});




test('日用量以人工為分母，超過17%才提醒，不疊加時間或公分容差', () => {
    const manual = { ...fixture, prev: { levelCm: 100 }, inputValue: 90 };
    for (const [drop,status] of [[8.301,'OK'],[8.3,'OK'],[8.299,'WARN'],[11.699,'OK'],[11.7,'OK'],[11.701,'WARN']]) {
        const r = evaluateDaily({...manual, series: series.map((p,i)=>({...p,v:100-drop*i/24}))});
        assert.equal(r.status,status);
        assert.equal(r.basis,'DAILY_USAGE');
        assert.equal(r.piRateMin,undefined);
        assert.equal(r.readingToleranceLiters,undefined);
    }
});
test('零用量不除以零；兩邊零才通過', () => {
    const zero = {...fixture,inputValue:100};
    const r=evaluateDaily({...zero,series:series.map(p=>({...p,v:100}))});
    assert.equal(r.status,'OK');assert.equal(r.usageDeviationPercent,0);
    const mismatch=evaluateDaily(zero);assert.equal(mismatch.status,'WARN');assert.equal(mismatch.usageDeviationPercent,null);
    const stored=evaluateDaily({...zero,prev:{levelCm:100,volumeLiters:1000.004}});
    assert.equal(stored.usageDeviationPercent,null);
});
test('相同下降高度在臥式槽不同液位有不同用量，依容積差判斷', () => {
    const t={...tank,factor:0,shape_type:'HORIZONTAL_CYLINDER',dimensions:{diameter:200,length:300,headType:'FLAT'}};
    const r=evaluateDaily({...fixture,tank:t,prev:{levelCm:40},inputValue:16});
    assert.notEqual(r.manualUsagePer24h,r.piUsagePer24h);
    assert.equal(r.status,'WARN');
});
