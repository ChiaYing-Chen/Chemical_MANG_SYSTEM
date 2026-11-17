import { findPiStalls } from './piDataQuality.js';
export { findPiStalls } from './piDataQuality.js';
/**
 * 液位人工輸入 × PI 線上液位計 輔助查核（純函式模組，不依賴 DB / PI，方便單元測試）
 *
 * 核心概念：以「實際抄表時刻」為錨點，而非日曆日。
 *   ① 定點比對：PI(t_now) vs 人工(t_now)            → 抓 KEY 錯數字
 *   ② 錯欄位比對：人工值是否較吻合其他槽的 PI 值     → 抓 KEY 錯欄位
 *   ③ 區間比對：PI 在 [t_prev, t_now] 的消耗/補藥    → 判斷補藥、日用量（正規化為 24h）
 */

import { calculateTankVolume } from './backendUtils.js';
import { getDailyPiConversion, getPiRelationshipStatus } from './piDailyConversions.js';

export const DEFAULT_TOLERANCE_CM = 5;
export const DEFAULT_REFILL_MIN_RISE_CM = 5;
/** 指定藥劑不使用 PI 液位比對；所有系統與一、二階共用相同規則。 */
export function requiresPiLevelCheck(tank) {
    const name = String(tank?.name || '').replace(/\s+/g, '');
    return !['氨水', '消泡劑', '微生物分散劑', '非氧化型殺菌劑'].some(chemical => name.includes(chemical));
}
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 每 1% 對應的公分數（LIQUID_PERCENT 與 PI 百分比共用） */
export function percentFactor(tank) {
    if (isNum(tank.piPercentFactor) && tank.piPercentFactor > 0) return tank.piPercentFactor;
    const h = tank.dimensions?.height;
    return isNum(h) && h > 0 ? h / 100 : 1;
}

/** 使用者輸入值 → 公分（與前端 handleSubmitReadings 換算邏輯一致） */
export function inputToCm(tank, value) {
    if (!isNum(value)) return null;
    if (tank.inputUnit === 'PERCENT') return value * 100; // 公尺 → 公分
    if (tank.inputUnit === 'LIQUID_PERCENT') return value * percentFactor(tank);
    return value;
}

/** 公分 → 使用者輸入單位（顯示 PI 參考值給使用者對照用） */
export function cmToInput(tank, cm) {
    if (!isNum(cm)) return null;
    if (tank.inputUnit === 'PERCENT') return cm / 100;
    if (tank.inputUnit === 'LIQUID_PERCENT') return cm / percentFactor(tank);
    return cm;
}

/** PI 原始值 → 公分 */
export function piToCm(tank, v) {
    if (!isNum(v)) return null;
    return tank.piLevelUnit === 'CM' ? v : v * percentFactor(tank);
}

/**
 * 取得時刻 t 的 PI 值。
 * 優先取 t 前後 halfWindow 內的中位數（抑制攪拌/雜訊）；點數不足時改線性內插；
 * t 落在序列尾端之後（例如歸檔延遲）時，若最後一點距 t 不超過 maxGap 則採用最後一點。
 * series: [{ t: ms, v: number }]（已排序）
 */
export function piValueAt(series, t, { halfWindowMs = 15 * MIN, maxGapMs = 2 * HOUR } = {}) {
    if (!Array.isArray(series) || series.length === 0 || !isNum(t)) return null;
    const inWin = series.filter((p) => Math.abs(p.t - t) <= halfWindowMs).map((p) => p.v);
    if (inWin.length >= 3) return median(inWin);

    let before = null;
    let after = null;
    for (const p of series) {
        if (p.t <= t) before = p;
        else { after = p; break; }
    }
    if (before && after) {
        if (after.t - before.t > maxGapMs * 2) {
            // 兩點間隔過大，取較近的一點（仍需在 maxGap 內）
            const near = (t - before.t) <= (after.t - t) ? before : after;
            return Math.abs(near.t - t) <= maxGapMs ? near.v : null;
        }
        const r = (t - before.t) / (after.t - before.t);
        return before.v + r * (after.v - before.v);
    }
    const only = before || after;
    return only && Math.abs(only.t - t) <= maxGapMs ? only.v : null;
}

/**
 * 線性校正：y(人工 cm) ≈ slope * x(PI cm) + intercept
 * - n < 3：不校正（slope=1, intercept=0）
 * - 3 ≤ n < 7 或 x 變化範圍 < 20cm：僅修正偏移（slope=1, intercept=中位數差）
 * - 其餘：最小平方法，並剔除 |殘差| > 3σ 的離群點後重算一次
 * pairs: [{ x, y }]
 */
export function fitCalibration(pairs) {
    const pts = (pairs || []).filter((p) => isNum(p.x) && isNum(p.y));
    const n = pts.length;
    if (n < 3) return { slope: 1, intercept: 0, residualStd: null, n, mode: 'NONE' };

    const offsetOnly = (ps) => {
        const intercept = median(ps.map((p) => p.y - p.x));
        const res = ps.map((p) => p.y - (p.x + intercept));
        return { slope: 1, intercept, residualStd: std(res), n: ps.length, mode: 'OFFSET' };
    };
    const xs = pts.map((p) => p.x);
    if (n < 7 || Math.max(...xs) - Math.min(...xs) < 20) return offsetOnly(pts);

    const ls = (ps) => {
        const mx = ps.reduce((a, p) => a + p.x, 0) / ps.length;
        const my = ps.reduce((a, p) => a + p.y, 0) / ps.length;
        let sxy = 0, sxx = 0, syy = 0;
        for (const p of ps) {
            sxy += (p.x - mx) * (p.y - my);
            sxx += (p.x - mx) ** 2;
            syy += (p.y - my) ** 2;
        }
        const slope = sxx > 0 ? sxy / sxx : 1;
        const intercept = my - slope * mx;
        const rSquared = (sxx > 0 && syy > 0) ? Math.min(1, Math.max(0, (sxy ** 2) / (sxx * syy))) : 1;
        const res = ps.map((p) => p.y - (slope * p.x + intercept));
        return { slope, intercept, rSquared, residualStd: std(res), n: ps.length, mode: 'LINEAR', res };
    };
    let fit = ls(pts);
    const sigma = fit.residualStd || 0;
    if (sigma > 0) {
        const kept = pts.filter((_, i) => Math.abs(fit.res[i]) <= 3 * sigma);
        if (kept.length >= 7 && kept.length < pts.length) fit = ls(kept);
    }
    // 斜率異常（換算係數設定錯誤或資料污染）時退回偏移校正，避免放大誤差
    if (!(fit.slope > 0.7 && fit.slope < 1.3)) return offsetOnly(pts);
    const { res, ...rest } = fit;
    return rest;
}

function std(arr) {
    if (arr.length < 2) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}

export const applyCalib = (calib, cm) => (isNum(cm) ? calib.slope * cm + calib.intercept : null);

/** 容許誤差（cm）：校正資料充足時取 max(固定值, 3σ)，否則用固定值 */
export function toleranceCm(tank, calib) {
    const base = isNum(tank.piCheckToleranceCm) && tank.piCheckToleranceCm > 0 ? tank.piCheckToleranceCm : DEFAULT_TOLERANCE_CM;
    // 舊資料將擬合模式存成 AUTO；有 R² 且至少七筆才代表曾完成線性回歸。
    const linear = calib?.mode === 'LINEAR' || (calib?.mode === 'AUTO' && calib.n >= 7 && isNum(calib.rSquared));
    if (linear && isNum(calib.residualStd)) return Math.max(base, 3 * calib.residualStd);
    return base;
}

/**
 * 補藥偵測：在 maxRiseDuration 內上升 ≥ minRise 視為補藥，並延伸到峰值。
 * seriesCm: [{ t, v(cm) }]
 * 回傳 [{ startT, at(峰值時刻), riseCm }]
 */
export function detectRefills(seriesCm, minRise = DEFAULT_REFILL_MIN_RISE_CM, { maxRiseDurationMs = 60 * MIN, extendMs = 3 * HOUR } = {}) {
    const s = seriesCm || [];
    const events = [];
    let i = 0;
    while (i < s.length) {
        let found = -1;
        for (let j = i + 1; j < s.length && s[j].t - s[i].t <= maxRiseDurationMs; j++) {
            if (s[j].v - s[i].v >= minRise) { found = j; break; }
        }
        if (found < 0) { i++; continue; }
        // 起點取 [i, found] 內的最低點（避免把上升前的自然下降算進來而低估補藥量）
        let start = i;
        for (let j = i; j < found; j++) if (s[j].v < s[start].v) start = j;
        let peak = found;
        let k = found;
        const noise = minRise * 0.2;
        while (k + 1 < s.length && s[k + 1].t - s[found].t <= extendMs && s[k + 1].v >= s[peak].v - noise) {
            k++;
            if (s[k].v > s[peak].v) peak = k;
        }
        events.push({ startT: s[start].t, at: s[peak].t, riseCm: s[peak].v - s[start].v });
        i = peak + 1;
    }
    return events;
}

const round = (v, d = 1) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

/** 業務日期代表台北時間該日全天；日期格式錯誤不得自動猜測。 */
export function dailyPeriod(value) {
    let date;
    if (typeof value === 'number' && Number.isFinite(value)) date = new Date(value + 8 * HOUR).toISOString().slice(0, 10);
    else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) date = value;
    else return null;
    const start = Date.parse(`${date}T00:00:00+08:00`);
    if (!Number.isFinite(start) || new Date(start + 8 * HOUR).toISOString().slice(0, 10) !== date) return null;
    return { start, end: start + 24 * HOUR };
}

/** 綁定配對來源；Tag 或換算設定改動後，不沿用舊配對。 */
export function calibrationSourceKey(tank) {
    return JSON.stringify([tank.piLevelTag, tank.piLevelUnit, tank.piPercentFactor ?? null, tank.dimensions?.height ?? null]);
}

/** 日報採次日午夜估計時窗，僅穩定且完整的 PI 資料可加入回歸，不偽造 read_at。 */
export function makeCalibrationPair(tank, reading, series, now = Date.now()) {
    if (!requiresPiLevelCheck(tank)) return { error: '此藥劑免 PI 比對' };
    if (tank.piLevelUnit !== 'CM' && !(isNum(tank.piPercentFactor) && tank.piPercentFactor > 0)) return { error: 'PI 百分比換算係數尚未確認' };
    const exact = reading.read_at ? new Date(reading.read_at).getTime() : null;
    const target = exact ?? dailyPeriod(Number(reading.timestamp))?.end;
    const halfWindow = exact ? 15 * MIN : 2 * HOUR;
    if (!isNum(target) || target + halfWindow > now) return { error: '配對時窗尚未結束' };
    const points = (series || []).filter(p => isNum(p.t) && isNum(p.v) && Math.abs(p.t - target) <= halfWindow).sort((a, b) => a.t - b.t);
    const edge = exact ? 5 * MIN : 30 * MIN;
    if (points.length < 3 || points[0].t > target - halfWindow + edge || points.at(-1).t < target + halfWindow - edge || points.some((p, i) => i && p.t - points[i - 1].t > HOUR)) return { error: '午夜或抄表時窗的 PI 資料不完整' };
    const values = points.map(p => piToCm(tank, p.v));
    const spread = Math.max(...values) - Math.min(...values);
    if (spread > 2) return { error: '配對時窗液位變動超過 2 cm，可能耗藥或補藥，略過估計配對' };
    const piRawCm = median(values);
    return { piRawCm, calibrationPair: { basis: exact ? 'TIMED_WINDOW' : 'MIDNIGHT_WINDOW', target, halfWindowMs: halfWindow, spreadCm: round(spread, 3), sourceKey: calibrationSourceKey(tank), estimated: !exact } };
}

/** 全天消耗比對；不使用送出時刻、跨日平均或其他槽的液位猜測錯欄。 */
export function radarDailySeries(points, period, minutes) {
    const step = minutes * MIN;
    // 稀疏序列保留原始邊界與覆蓋檢查，不從少數點製造中位數。
    if (points.length < (period.end - period.start) / (5 * MIN)) return null;
    const filtered = [];
    for (let t = period.start; t <= period.end; t += step) {
        const window = points.filter(p => Math.abs(p.t - t) <= step / 2);
        if (window.length < 5 || window[0].t > t - step / 3 || window.at(-1).t < t + step / 3 || window.some((p, i) => i > 0 && p.t - window[i - 1].t > step / 3)) return [];
        filtered.push({ t, v: median(window.map(p => p.v)) });
    }
    return filtered;
}

/** 午夜前後兩小時，固定每小時取樣後取中位數，避免歸檔點密度影響權重。 */
export function estimateMidnightLevel(points, target, convert, minRise = 5) {
    if(target+2*HOUR>Date.now())return {error:'午夜前後兩小時的 PI 時窗尚未結束'};
    const sampled=[];
    for(let offset=-2;offset<=2;offset++) {
        const t=target+offset*HOUR;
        const exact=points.find(p=>p.t===t);
        const a=exact || points.filter(p=>p.t<t).at(-1), b=exact || points.find(p=>p.t>t);
        if(!a||!b||b.t-a.t>1.5*HOUR)return {error:'午夜前後兩小時的 PI 資料不完整'};
        const raw=a.t===b.t?a.v:a.v+(b.v-a.v)*(t-a.t)/(b.t-a.t);
        sampled.push({t,v:convert(raw)});
    }
    if(sampled.some(p=>!isNum(p.v)||p.v<0))return {error:'午夜時窗換算液位無效'};
    const window=points.filter(p=>Math.abs(p.t-target)<=2*HOUR).map(p=>({t:p.t,v:convert(p.v)}));
    if(detectRefills(window,minRise).length || sampled.some((p,i)=>i&&Math.abs(p.v-sampled[i-1].v)>=minRise))return {error:'午夜時窗疑似補藥或液位明顯跳變，無法可靠估計'};
    return {value:median(sampled.map(p=>p.v)),sampleCount:sampled.length,spreadCm:Math.max(...sampled.map(p=>p.v))-Math.min(...sampled.map(p=>p.v))};
}

/** 固定整點的半小時鄰域中位數，辨識六小時內持續回升；不是補藥量估算。 */
export function findSustainedRises(points, period, minRise=5) {
    const samples=[];
    for(let t=period.start-6*HOUR;t<=period.end+HOUR;t+=HOUR){
        const w=points.filter(p=>Math.abs(p.t-t)<=HOUR/2&&isNum(p.v));
        samples.push({t,v:w.length?median(w.map(p=>p.v)):null});
    }
    for(let i=0;i<samples.length;i++){
        if(!isNum(samples[i].v))continue;
        for(let j=i+1;j<samples.length-1&&samples[j].t-samples[i].t<=6*HOUR;j++){
            if(!isNum(samples[j].v))break;
            const next=samples[j+1],rise=samples[j].v-samples[i].v;
            if(rise>=minRise&&isNum(next.v)&&next.v>=samples[i].v+rise*.8){
                if(samples[j].t<=period.start)break;
                if(samples[j].t>period.end)break;
                if(samples[i].t>=period.end)break;
                return [{startT:samples[i].t,at:samples[j].t,confirmedAt:next.t,riseCm:round(rise,3)}];
            }
        }
    }
    return [];
}

export function evaluateDaily({ tank, inputValue, period, prev, series = [], calib = { slope: 1, intercept: 0, mode: 'NONE' }, addedLiters = 0, boundaryMode = 'POINT' }) {
    const result = { status: 'NO_PI', basis: 'DAILY_USAGE', periodStart: period.start, periodEnd: period.end, intervalHours: 24, messages: [] };
    const unavailable = text => { result.messages.push(text); return result; };
    if (period.end > Date.now()) return unavailable('所選日期尚未結束，無法查核全天用量');
    if (!prev || !isNum(prev.levelCm)) return unavailable('缺少前一日的期末液位，無法計算本日人工用量');
    const manualCm = inputToCm(tank, inputValue);
    if (!isNum(manualCm) || manualCm < 0 || prev.levelCm < 0) return unavailable('液位無效');
    // 缺設定時只接受桶槽與 Tag 均相符的固定驗證模型，禁止假設 1% = 1cm。
    const conversion = getDailyPiConversion(tank);
    if (tank.id && !conversion) return unavailable(`固定關係式待驗證：${getPiRelationshipStatus(tank).reason}`);
    if (conversion) { result.relationshipVersion = conversion.version; result.relationshipValidationGrade = conversion.validationGrade || 'VERIFIED'; }
    if (tank.piLevelUnit !== 'CM' && !(isNum(tank.piPercentFactor) && tank.piPercentFactor > 0) && !conversion) return unavailable('PI 百分比換算係數尚未確認，無法查核全天用量');
    if (calib && calib.mode !== 'NONE' && calib.mode !== 'MANUAL' && !((calib.mode === 'LINEAR' && calib.n >= 7) || (calib.mode === 'OFFSET' && calib.n >= 3))) {
        // 固定 L/cm 的桶槽只比消耗差，斜率為 1 時固定偏移會抵消；不使用不可靠的舊截距。
        if (calib.slope === 1 && !tank.dimensions && isNum(tank.factor) && tank.factor > 0) calib = { slope: 1, intercept: 0, mode: 'NONE' };
        else return unavailable('舊校正公式樣本不足或來源未確認，請確認公式後再查核');
    }
    if (!isNum(calib.slope) || calib.slope <= 0 || !isNum(calib.intercept)) return unavailable('校正公式無效，無法查核全天用量');
    const points = series.filter(p => isNum(p.t) && isNum(p.v)).sort((a, b) => a.t - b.t);
    const stalls=tank.piLevelTag?findPiStalls(points,period):[];
    if(stalls.length){result.dataQuality={status:'SUSPECTED_STALL',stalls};return unavailable('PI 原始數值連續至少 12 小時不變，疑似無線傳輸停滯或設備停止；本日涉及停滯或恢復跳變，暫不判定日用量差距（Good 標記不能排除停滯）');}
    if(tank.id==='tc2_4'&&(prev.levelCm<=28||manualCm<=28)){
        result.dataQuality={status:'MANUAL_BELOW_READABLE_RANGE',minimumCm:28};
        return unavailable('CT-2 分散劑人工液位任一端不高於 28 cm，已達現場液位計可讀下限；不能當成精確液位或零用量，暫不判定差距');
    }
    // 邊界只能內插，不能以數小時前後的單點替代午夜。
    const boundary = t => {
        const exact = points.find(p => p.t === t);
        if (exact) return exact.v;
        const before = points.filter(p => p.t < t).at(-1), after = points.find(p => p.t > t);
        if (!before || !after || t - before.t > HOUR || after.t - t > HOUR) return null;
        return before.v + (after.v - before.v) * (t - before.t) / (after.t - before.t);
    };
    const first = boundary(period.start), last = boundary(period.end);
    if (!isNum(first) || !isNum(last)) return unavailable('所選日期午夜邊界的 PI 資料不足，無法查核全天用量');
    const raw = [{ t: period.start, v: first }, ...points.filter(p => p.t > period.start && p.t < period.end), { t: period.end, v: last }];
    if (raw.some((p, i) => i && p.t - raw[i - 1].t > 2 * HOUR)) return unavailable('當日 PI 資料間隔超過兩小時，無法確認完整消耗與補藥');
    const stable = conversion?.smoothingMinutes ? radarDailySeries(points, period, conversion.smoothingMinutes) : null;
    if (stable && !stable.length) return unavailable('雷達 PI 中位數時窗覆蓋不足，無法可靠區分波動與補藥');
    const cm = (stable || raw).map(p => ({ t: p.t, v: conversion ? p.v * conversion.slope + conversion.intercept : applyCalib(calib, piToCm(tank, p.v)) }));
    if (cm.some(p => !isNum(p.v) || p.v < 0)) return unavailable('PI 換算液位無效，請確認量程與校正公式');
    const volume = h => calculateTankVolume(tank, h);
    if (!(volume(100) > volume(0))) return unavailable('缺少有效的桶槽容積換算設定');
    const events = detectRefills(cm, tank.piRefillMinRiseCm || DEFAULT_REFILL_MIN_RISE_CM);
    if (events.length) {
        result.refill = {detected:true,count:events.length};
        return unavailable('PI 偵測到液位上升／疑似補藥，跨補藥日不判定日用量差距；不使用 APP 補藥紀錄');
    }
    const qualityCm=points.map(p=>({t:p.t,v:conversion?p.v*conversion.slope+conversion.intercept:applyCalib(calib,piToCm(tank,p.v))}));
    const slowRises=findSustainedRises(qualityCm,period,tank.piRefillMinRiseCm || DEFAULT_REFILL_MIN_RISE_CM);
    if(slowRises.length){
        result.dataQuality={status:'SUSTAINED_RISE',events:slowRises};
        return unavailable('PI 液位在六小時內持續回升達 '+(tank.piRefillMinRiseCm || DEFAULT_REFILL_MIN_RISE_CM)+' cm，且後續讀值維持高位；可能補藥或訊號異常，暫不以午夜存量差判定日用量，請核對現場。');
    }
    const refillLiters = events.reduce((sum, e) => {
        const start = cm.find(p => p.t === e.startT), end = cm.find(p => p.t === e.at);
        return sum + volume(end.v) - volume(start.v);
    }, 0);
    let startCm=cm[0].v,endCm=cm.at(-1).v;
    if(boundaryMode==='WINDOW') {
        const convert=v=>conversion?v*conversion.slope+conversion.intercept:applyCalib(calib,piToCm(tank,v));
        const estimates=[period.start,period.end].map(t=>estimateMidnightLevel(points,t,convert,tank.piRefillMinRiseCm || DEFAULT_REFILL_MIN_RISE_CM));
        const failed=estimates.find(e=>e.error);
        if(failed)return unavailable(failed.error);
        [startCm,endCm]=estimates.map(e=>e.value);
        result.boundaryMethod='MIDNIGHT_WINDOW_2H';
        result.boundaryEstimates=estimates;
        result.messages.push('PI 期初與期末均採台北午夜前後兩小時固定取樣中位數；業務日仍為 24 小時，未增加用量容差。');
    }
    const manualStartVolume = isNum(prev.volumeLiters) && prev.volumeLiters >= 0 ? prev.volumeLiters : volume(prev.levelCm);
    // 與 APP 儲存的公升精度一致，避免資料庫小數截位讓零用量變成極小分母。
    const manual = round(manualStartVolume - volume(manualCm), 2);
    const pi = round(volume(startCm) - volume(endCm), 2);
    if (manual < 0) return unavailable('人工紀錄存量上升且補藥資料不足，無法確認全天用量');
    if (pi < 0) return unavailable(`PI 期末換算液位高於期初，當日淨下降量為 ${round(pi, 1)} L；可能為儀表波動或補藥資料不足，無法確認日使用量${conversion ? '（已套用歷史驗證的經驗換算，非缺少係數）' : ''}`);
    // 先依各槽形狀換算兩端容積，再比較同日用量；以人工用量為分母。
    const deviation = Math.abs(pi - manual);
    const percentage = manual === 0 ? (pi === 0 ? 0 : null) : deviation / manual * 100;
    const withinLimit = manual === 0 ? pi === 0 : deviation <= manual * 0.17 + 1e-9;
    Object.assign(result, {
        basis: 'DAILY_USAGE', status: withinLimit ? 'OK' : 'WARN',
        manualCm, manualUsagePer24h: round(manual, 1), piUsagePer24h: round(pi, 1),
        usageDeviationLiters: round(pi - manual, 1), usageDeviationPercent: percentage === null ? null : round(percentage, 2),
        usageThresholdPercent: 17,
        manualStartVolumeLiters: round(manualStartVolume, 2), manualEndVolumeLiters: round(volume(manualCm), 2),
        piStartCm: round(startCm, 3), piEndCm: round(endCm, 3),
        piStartVolumeLiters: round(volume(startCm), 2), piEndVolumeLiters: round(volume(endCm), 2),
        addedLiters: 0,
        refill: { detected: events.length > 0, count: events.length, riseCm: round(events.reduce((sum, e) => sum + e.riseCm, 0)), estLiters: round(refillLiters, 1) }
    });
    result.messages.push(`人工日使用量 ${result.manualUsagePer24h} L；PI 日使用量 ${result.piUsagePer24h} L；差距 ${percentage === null ? '人工為零，無法計算百分比' : result.usageDeviationPercent + '%'}（以人工用量為分母，超過 17% 才異常）`);
    result.messages.push(`PI 期初／期末液位 ${result.piStartCm}／${result.piEndCm} cm，依桶槽形狀換算存量 ${result.piStartVolumeLiters}／${result.piEndVolumeLiters} L；以非補藥日存量差比較，不使用 APP 補藥紀錄。`);
    if (conversion) result.messages.push(`採用${conversion.validationGrade === 'LIMITED' ? '有限驗證' : '歷史驗證'}的經驗換算：液位 cm＝${conversion.slope.toFixed(4)} × PI 原始值＋${conversion.intercept.toFixed(2)}；非儀表原廠量程。${conversion.validationMode === 'WITHIN_CYCLE' ? '同週期後段驗證（尚未跨週期）' : '獨立週期驗證'}液位誤差中位數 ${conversion.validationMedianErrorCm} cm、90 百分位 ${conversion.validationP90ErrorCm} cm。`);
    if (stable) result.messages.push('雷達 PI 採 15 分鐘時窗中位數抑制高頻波動，再計算當日下降量與補藥；短於時窗的事件可能無法辨識。');
    if (events.length) result.messages.push('PI 偵測到液位上升；日用量僅採已登錄補藥量，請核對補藥紀錄');
    return result;
}

/**
 * 單槽綜合判斷
 * @param {object} p
 * @param {object} p.tank           儲槽（含 inputUnit/piLevelUnit/piPercentFactor/factor/...）
 * @param {number} p.inputValue     使用者輸入原始值（輸入單位）
 * @param {number} p.tNow           抄表時刻 (ms)
 * @param {object|null} p.prev      前次人工紀錄 { levelCm, readAt(ms), estimated, addedAmountLiters }
 * @param {Array}  p.series         PI 原始序列 [{t, v}]（PI 原始單位）
 * @param {object} p.calib          fitCalibration 結果
 * @param {Array}  p.others         其他槽在 tNow 的參考 [{ tank, refCm, tol }]
 * @param {number} [p.addedLiters]  本次已登記補藥量（公升）
 */
export function evaluate({ tank, inputValue, tNow, prev, series, calib, others = [], addedLiters = 0 }) {
    const messages = [];
    const manualCm = inputToCm(tank, inputValue);
    const result = { status: 'OK', readAt: tNow, manualCm: round(manualCm, 2), messages };

    const rawNow = piValueAt(series, tNow);
    if (!isNum(rawNow) || !isNum(manualCm)) {
        result.status = 'NO_PI';
        messages.push(isNum(manualCm) ? '抄表時刻附近無 PI 資料，無法比對' : '輸入值無法解析');
        return result;
    }

    const piRawCm = piToCm(tank, rawNow);
    const refCm = applyCalib(calib, piRawCm);
    const tol = toleranceCm(tank, calib);
    const dev = manualCm - refCm;
    Object.assign(result, {
        piRawCm: round(piRawCm, 2),
        piRefCm: round(refCm, 2),
        piRefInputUnit: round(cmToInput(tank, refCm), tank.inputUnit === 'PERCENT' ? 3 : 1),
        deviationCm: round(dev, 1),
        toleranceCm: round(tol, 1),
        calibMode: calib?.mode || 'NONE',
        calibN: calib?.n || 0,
    });

    // ① 定點比對
    const absDev = Math.abs(dev);
    if (absDev > 2 * tol) {
        result.status = 'ERROR';
        messages.push(`請確認是否KEY錯欄位或數字：與線上液位計差距 ${round(dev, 1)} cm（容許 ±${round(tol, 1)} cm）`);
    } else if (absDev > tol) {
        result.status = 'WARN';
        messages.push(`請確認是否KEY錯欄位或數字：與線上液位計差距 ${round(dev, 1)} cm，請再確認`);
    }

    if (result.status === 'ERROR') {
        // 小數點錯位
        for (const k of [10, 0.1, 100, 0.01]) {
            const alt = inputToCm(tank, inputValue / k);
            if (Math.abs(alt - refCm) <= tol) {
                messages.push(`疑似小數點錯位（輸入值 ÷ ${k} 即吻合）`);
                break;
            }
        }
        // ② 錯欄位：以「其他槽的輸入單位」解讀此輸入值
        let best = null;
        for (const o of others) {
            if (!o || !isNum(o.refCm) || o.tank.id === tank.id) continue;
            const asOther = inputToCm(o.tank, inputValue);
            const d = Math.abs(asOther - o.refCm);
            if (d <= o.tol && (!best || d < best.d)) best = { d, o };
        }
        if (best) {
            result.swapSuspect = { tankId: best.o.tank.id, tankName: best.o.tank.name, deviationCm: round(best.d, 1) };
            messages.push(`數值較吻合「${best.o.tank.name}」的線上液位，疑似 KEY 錯欄位`);
        }
    }

    // ③ 區間比對（需前次抄表時刻）
    if (prev && isNum(prev.readAt) && isNum(prev.levelCm) && prev.readAt < tNow) {
        const intervalH = (tNow - prev.readAt) / HOUR;
        result.intervalHours = round(intervalH, 1);
        result.prevEstimated = !!prev.estimated;
        if (prev.estimated) messages.push('前次未記錄實際抄表時間，區間用量僅為估算');

        const seg = (series || [])
            .filter((p) => p.t >= prev.readAt - 30 * MIN && p.t <= tNow + 15 * MIN)
            .map((p) => ({ t: p.t, v: piToCm(tank, p.v) }));
        const minRise = isNum(tank.piRefillMinRiseCm) && tank.piRefillMinRiseCm > 0 ? tank.piRefillMinRiseCm : DEFAULT_REFILL_MIN_RISE_CM;
        const refills = detectRefills(seg, minRise).filter((e) => e.at >= prev.readAt && e.startT <= tNow);
        const riseCm = refills.reduce((a, e) => a + e.riseCm, 0) * (calib?.slope || 1);
        const lpc = isNum(tank.factor) && tank.factor > 0 ? tank.factor : null; // 公升/公分
        result.refill = {
            detected: refills.length > 0,
            count: refills.length,
            riseCm: round(riseCm, 1),
            at: refills.length ? refills[refills.length - 1].at : undefined,
            estLiters: lpc ? Math.round(riseCm * lpc) : undefined,
        };

        const rawPrev = piValueAt(series, prev.readAt);
        const pointOk = result.status === 'OK';
        const addedCm = lpc && addedLiters > 0 ? addedLiters / lpc : 0;
        // 人工推算消耗（cm）：補藥量以「已登記」優先，未登記則採 PI 偵測到的補藥量
        const refillCm = addedCm > 0 ? addedCm : riseCm;
        const manualCons = prev.levelCm - manualCm + refillCm;
        if (lpc && intervalH > 0) result.manualUsagePer24h = Math.round((manualCons * lpc / intervalH) * 24);

        if (isNum(rawPrev)) {
            const piCons = (calib?.slope || 1) * (piToCm(tank, rawPrev) - piRawCm) + riseCm;
            if (lpc && intervalH > 0) result.piUsagePer24h = Math.round((piCons * lpc / intervalH) * 24);

            // 人工液位明顯上升，但 PI 無補藥跡象
            const manualRise = manualCm - prev.levelCm;
            if (!prev.estimated && manualRise >= minRise && !result.refill.detected && addedCm === 0) {
                if (pointOk) {
                    // 本次值吻合線上 → 問題多半在前次紀錄
                    result.status = 'WARN';
                    messages.push(`人工液位較前次上升 ${round(manualRise, 1)} cm 但線上無補藥跡象；本次值吻合線上，前次紀錄可能有誤`);
                } else {
                    result.status = 'ERROR';
                    messages.push(`人工液位較前次上升 ${round(manualRise, 1)} cm，但線上無補藥跡象`);
                }
            } else if (!prev.estimated && pointOk && Math.abs(manualCons - piCons) > 2 * tol) {
                // 端點皆在容許內但區間消耗差距大 → 多半是前次紀錄有誤
                result.status = 'WARN';
                messages.push(`區間消耗與線上差距 ${round(manualCons - piCons, 1)} cm，前次紀錄可能有誤`);
            }
        }
        if (result.refill.detected) {
            const when = new Date(result.refill.at + 8 * HOUR).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/');
            messages.push(`線上偵測補藥 ${when} 約 +${result.refill.riseCm} cm${isNum(result.refill.estLiters) ? `（≈${result.refill.estLiters.toLocaleString()} L）` : ''}，請確認是否已登記補藥`);
        }
    }

    return result;
}
