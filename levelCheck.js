/**
 * 液位人工輸入 × PI 線上液位計 輔助查核（純函式模組，不依賴 DB / PI，方便單元測試）
 *
 * 核心概念：以「實際抄表時刻」為錨點，而非日曆日。
 *   ① 定點比對：PI(t_now) vs 人工(t_now)            → 抓 KEY 錯數字
 *   ② 錯欄位比對：人工值是否較吻合其他槽的 PI 值     → 抓 KEY 錯欄位
 *   ③ 區間比對：PI 在 [t_prev, t_now] 的消耗/補藥    → 判斷補藥、日用量（正規化為 24h）
 */

export const DEFAULT_TOLERANCE_CM = 5;
export const DEFAULT_REFILL_MIN_RISE_CM = 5;
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
    if (calib && calib.mode === 'LINEAR' && isNum(calib.residualStd)) return Math.max(base, 3 * calib.residualStd);
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
    const result = { status: 'OK', manualCm: round(manualCm, 2), messages };

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
            if (manualRise >= minRise && !result.refill.detected && addedCm === 0) {
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
