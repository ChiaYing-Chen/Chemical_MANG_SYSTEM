export const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const ARCHIVE_BACKFILL_MS = 8 * 60 * 60 * 1000;
export const ROLLING_WINDOW_START_HOUR = 22;
export const ROLLING_WINDOW_START_MS = ROLLING_WINDOW_START_HOUR * 60 * 60 * 1000;

/**
 * Format epoch milliseconds as an ISO-8601 timestamp in Taipei time (UTC+8).
 * @param {number} ms
 * @returns {string}
 */
export function formatTaipeiIso(ms) {
    const taipeiDate = new Date(Number(ms) + TAIPEI_OFFSET_MS);
    const yyyy = taipeiDate.getUTCFullYear();
    const mm = String(taipeiDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(taipeiDate.getUTCDate()).padStart(2, '0');
    const hh = String(taipeiDate.getUTCHours()).padStart(2, '0');
    const mi = String(taipeiDate.getUTCMinutes()).padStart(2, '0');
    const ss = String(taipeiDate.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+08:00`;
}

/**
 * Enumerate Taipei YYYY-MM-DD dates from startDate to endDate inclusive, capped at maxDays.
 * @param {string} startDate
 * @param {string} endDate
 * @param {number} [maxDays]
 * @returns {string[]}
 */
export function enumerateTaipeiDates(startDate, endDate, maxDays = 62) {
    if (
        typeof startDate !== 'string' ||
        typeof endDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ) {
        return [];
    }
    const startMs = Date.parse(`${startDate}T00:00:00+08:00`);
    const endMs = Date.parse(`${endDate}T00:00:00+08:00`);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
        return [];
    }
    const dates = [];
    for (let t = startMs; t <= endMs && dates.length < maxDays; t += DAY_MS) {
        dates.push(formatTaipeiIso(t).slice(0, 10));
    }
    return dates;
}

/**
 * Compute the 24-hour PI query window and fetch strategy for a given Taipei date.
 * - Completed days (nowMs >= dayEndMs): 00:00~24:00 of dateStr (isFinal = true).
 * - In-progress day (nowMs < dayEndMs, e.g. 11/25 23:00): rolling 24h ending at nowMs (isFinal = false).
 * - Uses RECORDED values whenever windowEndMs is within 8h of nowMs to avoid PI Archive backfill lag.
 *
 * @param {string} dateStr YYYY-MM-DD
 * @param {number} [nowMs]
 */
export function computeDailyPiWindow(dateStr, nowMs = Date.now()) {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return { valid: false, reason: 'INVALID_DATE' };
    }
    const dayStartMs = Date.parse(`${dateStr}T00:00:00+08:00`);
    if (!Number.isFinite(dayStartMs)) {
        return { valid: false, reason: 'INVALID_DATE' };
    }
    const dayEndMs = dayStartMs + DAY_MS;

    if (nowMs < dayStartMs) {
        return { valid: false, reason: 'FUTURE_DATE' };
    }

    const rollingStartMs = dayStartMs + ROLLING_WINDOW_START_MS;

    let windowStartMs;
    let windowEndMs;
    let isFinal;
    let windowMode;

    if (nowMs >= dayEndMs) {
        windowStartMs = dayStartMs;
        windowEndMs = dayEndMs;
        isFinal = true;
        windowMode = 'FULL_DAY';
    } else if (nowMs >= rollingStartMs) {
        windowEndMs = nowMs;
        windowStartMs = nowMs - DAY_MS;
        isFinal = false;
        windowMode = 'ROLLING_24H';
    } else {
        return {
            valid: false,
            reason: 'DAY_NOT_READY',
            allowedAfterIso: formatTaipeiIso(rollingStartMs)
        };
    }

    const useRecorded = (nowMs - windowEndMs) < ARCHIVE_BACKFILL_MS;

    return {
        valid: true,
        dateStr,
        dayStartMs,
        dayEndMs,
        windowStartMs,
        windowEndMs,
        startIso: formatTaipeiIso(windowStartMs),
        endIso: formatTaipeiIso(windowEndMs),
        isFinal,
        windowMode,
        useRecorded,
        fetchMethod: useRecorded ? 'RECORDED' : 'SUMMARY'
    };
}

function normalizeWindowPoints(points, windowStartMs, windowEndMs) {
    if (!Array.isArray(points) || points.length === 0) return [];
    const sorted = points
        .filter(p => p && Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.v)))
        .map(p => ({ t: Number(p.t), v: Number(p.v) }))
        .sort((a, b) => a.t - b.t);

    if (sorted.length === 0) return [];

    // Clip points to [windowStartMs, windowEndMs] using linear interpolation at boundaries if points cross them
    const clipped = [];
    for (let i = 0; i < sorted.length; i++) {
        const curr = sorted[i];
        if (curr.t < windowStartMs) {
            const next = sorted[i + 1];
            if (next && next.t >= windowStartMs) {
                const ratio = next.t === curr.t ? 0 : (windowStartMs - curr.t) / (next.t - curr.t);
                clipped.push({ t: windowStartMs, v: curr.v + ratio * (next.v - curr.v) });
            }
            continue;
        }
        if (curr.t > windowEndMs) {
            const prev = sorted[i - 1];
            if (prev && prev.t <= windowEndMs) {
                const ratio = curr.t === prev.t ? 0 : (windowEndMs - prev.t) / (curr.t - prev.t);
                clipped.push({ t: windowEndMs, v: prev.v + ratio * (curr.v - prev.v) });
            }
            break;
        }
        clipped.push(curr);
    }

    if (clipped.length > 0) return clipped;

    // Fallback: all points lie strictly before or after the window; use nearest single boundary point
    if (sorted[sorted.length - 1].t < windowStartMs) return [sorted[sorted.length - 1]];
    if (sorted[0].t > windowEndMs) return [sorted[0]];
    return [];
}

/**
 * Trapezoidal integration of recorded rate samples (e.g. ton/hr) over [windowStartMs, windowEndMs].
 * Returns total quantity (e.g. tons) over the elapsed hours.
 * @param {Array<{t: number, v: number}>} points
 * @param {number} windowStartMs
 * @param {number} windowEndMs
 * @returns {number}
 */
export function integrateRecordedTotal(points, windowStartMs, windowEndMs) {
    if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
        return 0;
    }
    const pts = normalizeWindowPoints(points, windowStartMs, windowEndMs);
    if (pts.length === 0) return 0;
    if (pts.length === 1) {
        return pts[0].v * ((windowEndMs - windowStartMs) / 3600000);
    }

    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const dtHours = (pts[i + 1].t - pts[i].t) / 3600000;
        if (dtHours > 0) {
            total += ((pts[i].v + pts[i + 1].v) / 2) * dtHours;
        }
    }
    return total;
}

/**
 * Time-weighted trapezoidal average of recorded samples over [windowStartMs, windowEndMs].
 * @param {Array<{t: number, v: number}>} points
 * @param {number} windowStartMs
 * @param {number} windowEndMs
 * @returns {number|null}
 */
export function computeRecordedAverage(points, windowStartMs, windowEndMs) {
    const pts = normalizeWindowPoints(points, windowStartMs, windowEndMs);
    if (pts.length === 0) return null;
    if (pts.length === 1) return pts[0].v;

    let weightedSum = 0;
    let totalDt = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const dt = pts[i + 1].t - pts[i].t;
        if (dt > 0) {
            weightedSum += ((pts[i].v + pts[i + 1].v) / 2) * dt;
            totalDt += dt;
        }
    }
    if (totalDt <= 0) {
        return pts.reduce((s, p) => s + p.v, 0) / pts.length;
    }
    return weightedSum / totalDt;
}

/**
 * Resolve CWS concentration cycles (N) from historical parameter rows up to dayEndMs.
 * Priority: hardness ratio (cws_hardness / makeup_hardness) > manual concentration_cycles (> 1) > default 8.
 * @param {Array<object>} cwsHistoryRows
 * @param {number} dayEndMs
 * @returns {{ cycles: number, sourceDate: number|null }}
 */
export function resolveConcentrationCycles(cwsHistoryRows, dayEndMs) {
    if (!Array.isArray(cwsHistoryRows) || cwsHistoryRows.length === 0) {
        return { cycles: 8, sourceDate: null };
    }

    const eligible = cwsHistoryRows
        .filter(r => r && Number(r.date || 0) <= dayEndMs)
        .sort((a, b) => {
            const dateDiff = Number(b.date || 0) - Number(a.date || 0);
            if (dateDiff !== 0) return dateDiff;
            const ua = a.updated_at ? Date.parse(a.updated_at) : 0;
            const ub = b.updated_at ? Date.parse(b.updated_at) : 0;
            return (Number.isFinite(ub) ? ub : 0) - (Number.isFinite(ua) ? ua : 0);
        });

    const hardnessRow = eligible.find(
        r => Number(r.cws_hardness) > 0 && Number(r.makeup_hardness) > 0
    );
    if (hardnessRow) {
        return {
            cycles: Number(hardnessRow.cws_hardness) / Number(hardnessRow.makeup_hardness),
            sourceDate: Number(hardnessRow.date) || null
        };
    }

    const manualRow = eligible.find(r => Number(r.concentration_cycles) > 1);
    if (manualRow) {
        return {
            cycles: Number(manualRow.concentration_cycles),
            sourceDate: Number(manualRow.date) || null
        };
    }

    return { cycles: 8, sourceDate: null };
}

const toFiniteNumber = (val) => {
    if (val === null || val === undefined || val === '') return null;
    const num = Number(val);
    return Number.isFinite(num) ? num : null;
};

/**
 * Calculate condensate recovery rate (%):
 *   ((F_給水 - F_補給 - F_排污) / F_產汽) * 100
 * When includeSprayWater is true, F_給水 = feedwaterFlow + sprayWaterFlow.
 * Returns null if any required input is missing/non-finite or steamProduction < 1.
 */
export function calculateCondensateRecoveryRate({
    feedwaterFlow,
    sprayWaterFlow = 0,
    makeupWaterFlow,
    blowdownFlow,
    steamProduction,
    includeSprayWater = true
}) {
    const fw = toFiniteNumber(feedwaterFlow);
    const sh = includeSprayWater ? toFiniteNumber(sprayWaterFlow) : 0;
    const dw = toFiniteNumber(makeupWaterFlow);
    const cbd = toFiniteNumber(blowdownFlow);
    const ms = toFiniteNumber(steamProduction);

    if (fw === null || sh === null || dw === null || cbd === null || ms === null) {
        return null;
    }
    if (ms < 1) {
        return null;
    }

    const totalFeedwater = fw + sh;
    const rate = ((totalFeedwater - dw - cbd) / ms) * 100;
    if (!Number.isFinite(rate)) return null;
    return Math.round(rate * 100) / 100;
}

/**
 * Aggregate flow-weighted condensate recovery rate over [weekStartMs, weekEndMs)
 * from daily BWS parameter rows.
 */
export function aggregateWeeklyCondensateRecovery(
    dailyRows,
    weekStartMs,
    weekEndMs,
    includeSprayWater = true
) {
    if (!Array.isArray(dailyRows) || !Number.isFinite(weekStartMs) || !Number.isFinite(weekEndMs)) {
        return null;
    }

    const eligible = dailyRows.filter((r) => {
        if (!r) return false;
        const ts = Number(r.date);
        if (!Number.isFinite(ts) || ts < weekStartMs || ts >= weekEndMs) return false;

        const fw = toFiniteNumber(r.feedwaterFlow ?? r.feedwater_flow);
        const sh = includeSprayWater ? toFiniteNumber(r.sprayWaterFlow ?? r.spray_water_flow) : 0;
        const dw = toFiniteNumber(r.makeupWaterFlow ?? r.makeup_water_flow);
        const cbd = toFiniteNumber(r.blowdownFlow ?? r.blowdown_flow);
        const ms = toFiniteNumber(r.steamProduction ?? r.steam_production);

        return fw !== null && sh !== null && dw !== null && cbd !== null && ms !== null && ms > 0;
    });

    if (eligible.length === 0) return null;

    let sumFw = 0;
    let sumSh = 0;
    let sumDw = 0;
    let sumCbd = 0;
    let sumMs = 0;

    for (const r of eligible) {
        sumFw += Number(r.feedwaterFlow ?? r.feedwater_flow);
        sumSh += includeSprayWater ? Number(r.sprayWaterFlow ?? r.spray_water_flow) : 0;
        sumDw += Number(r.makeupWaterFlow ?? r.makeup_water_flow);
        sumCbd += Number(r.blowdownFlow ?? r.blowdown_flow);
        sumMs += Number(r.steamProduction ?? r.steam_production);
    }

    const condensateRecoveryRate = calculateCondensateRecoveryRate({
        feedwaterFlow: sumFw,
        sprayWaterFlow: sumSh,
        makeupWaterFlow: sumDw,
        blowdownFlow: sumCbd,
        steamProduction: sumMs,
        includeSprayWater
    });

    return {
        condensateRecoveryRate,
        feedwaterFlow: Math.round(sumFw * 100) / 100,
        sprayWaterFlow: Math.round(sumSh * 100) / 100,
        makeupWaterFlow: Math.round(sumDw * 100) / 100,
        blowdownFlow: Math.round(sumCbd * 100) / 100,
        steamProduction: Math.round(sumMs * 100) / 100,
        coveredDays: eligible.length
    };
}

/**
 * Calculate condensate loss rate (%): 100 - condensateRecoveryRate.
 * @param {number|string|null|undefined} condensateRecoveryRate
 * @returns {number|null}
 */
export function calculateCondensateLossRate(condensateRecoveryRate) {
    const rec = toFiniteNumber(condensateRecoveryRate);
    if (rec === null) return null;
    const loss = 100 - rec;
    if (!Number.isFinite(loss)) return null;
    return Math.round(loss * 100) / 100;
}

/**
 * Calculate actual dosing concentration (ppm): (actualKg * 1000) / baseFlowTons.
 * Returns null if actualKg < 0/non-finite or baseFlowTons < 1/non-finite.
 * @param {number|string|null|undefined} actualKg
 * @param {number|string|null|undefined} baseFlowTons
 * @returns {number|null}
 */
export function calculateActualDosingPpm(actualKg, baseFlowTons) {
    const kg = toFiniteNumber(actualKg);
    const flow = toFiniteNumber(baseFlowTons);
    if (kg === null || kg < 0 || flow === null || flow < 1) {
        return null;
    }
    const ppm = (kg * 1000) / flow;
    if (!Number.isFinite(ppm)) return null;
    return Math.round(ppm * 1000) / 1000;
}

/**
 * Convert a reading's stored Taipei date into its physical end-of-day boundary timestamp
 * ((D + 1) 00:00:00+08:00), matching night-shift practice of logging day D after day D ends.
 * @param {{ timestamp?: number|string }} reading
 * @returns {number}
 */
export function getReadingPeriodEndMs(reading) {
    const ts = Number(reading?.timestamp);
    if (!Number.isFinite(ts)) return NaN;
    const d = new Date(ts + TAIPEI_OFFSET_MS);
    if (isNaN(d.getTime())) return NaN;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - TAIPEI_OFFSET_MS + DAY_MS;
}

/**
 * Collect ordered tank readings whose end-of-day boundaries cover [periodStartMs, periodEndExclusiveMs],
 * including the boundary reading at periodEndExclusiveMs and surrounding readings if needed.
 * @param {Array<any>} readings
 * @param {string} tankId
 * @param {number} periodStartMs
 * @param {number} periodEndExclusiveMs
 * @returns {Array<any>}
 */
export function computePeriodReadings(readings, tankId, periodStartMs, periodEndExclusiveMs) {
    if (!Array.isArray(readings) || !tankId || !Number.isFinite(periodStartMs) || !Number.isFinite(periodEndExclusiveMs)) {
        return [];
    }

    const sortedAll = readings
        .filter((r) => r && r.tankId === tankId && Number.isFinite(getReadingPeriodEndMs(r)))
        .sort((a, b) => getReadingPeriodEndMs(a) - getReadingPeriodEndMs(b) || Number(a.timestamp) - Number(b.timestamp));

    const seenKeys = new Set();
    const tankReadings = [];
    for (const r of sortedAll) {
        const key = r.id !== undefined && r.id !== null ? `id:${r.id}` : `ts:${r.timestamp}`;
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            tankReadings.push(r);
        }
    }

    if (tankReadings.length === 0) return [];

    const core = tankReadings.filter((r) => {
        const endTs = getReadingPeriodEndMs(r);
        return endTs >= periodStartMs && endTs <= periodEndExclusiveMs;
    });

    const result = [...core];

    if (core.length === 0 || getReadingPeriodEndMs(core[0]) > periodStartMs) {
        const before = tankReadings.filter((r) => getReadingPeriodEndMs(r) < periodStartMs);
        if (before.length > 0) {
            result.unshift(before[before.length - 1]);
        }
    }

    if (core.length === 0 || getReadingPeriodEndMs(core[core.length - 1]) < periodEndExclusiveMs) {
        const after = tankReadings.find((r) => getReadingPeriodEndMs(r) > periodEndExclusiveMs);
        if (after) {
            result.push(after);
        }
    }

    const deduped = [];
    const outKeys = new Set();
    for (const r of result.sort((a, b) => getReadingPeriodEndMs(a) - getReadingPeriodEndMs(b) || Number(a.timestamp) - Number(b.timestamp))) {
        const key = r.id !== undefined && r.id !== null ? `id:${r.id}` : `ts:${r.timestamp}`;
        if (!outKeys.has(key)) {
            outKeys.add(key);
            deduped.push(r);
        }
    }
    return deduped;
}

/**
 * Compute actual chemical usage over [periodStartMs, periodEndExclusiveMs) using volume intervals
 * and day-by-day active contract specific gravity / price conversion.
 * @param {Object} params
 * @param {Array<any>} params.readings
 * @param {string} params.tankId
 * @param {number} params.periodStartMs
 * @param {number} params.periodEndExclusiveMs
 * @param {'KG'|'L'|'$'} [params.metric]
 * @param {Array<any>} [params.suppliesHistory]
 * @param {(reading: any) => number} params.getVolume
 * @returns {number}
 */
export function computePeriodActualUsage({
    readings,
    tankId,
    periodStartMs,
    periodEndExclusiveMs,
    metric = 'KG',
    suppliesHistory = [],
    getVolume
}) {
    const orderedReadings = computePeriodReadings(readings, tankId, periodStartMs, periodEndExclusiveMs);
    if (orderedReadings.length < 2 || typeof getVolume !== 'function') {
        return 0;
    }

    const sortedSupplies = Array.isArray(suppliesHistory)
        ? [...suppliesHistory].sort((a, b) => Number(b?.startDate || 0) - Number(a?.startDate || 0))
        : [];

    const resolveSupplyAt = (ts) => sortedSupplies.find((s) => Number(s?.startDate || 0) <= ts);

    const intervals = [];
    for (let i = 1; i < orderedReadings.length; i++) {
        const prev = orderedReadings[i - 1];
        const curr = orderedReadings[i];
        const prevTs = getReadingPeriodEndMs(prev);
        const currTs = getReadingPeriodEndMs(curr);
        if (!Number.isFinite(prevTs) || !Number.isFinite(currTs) || currTs <= prevTs) continue;

        const prevVolume = Number(getVolume(prev));
        const currVolume = Number(getVolume(curr));
        const addedLiters = Number(curr.addedAmountLiters || 0);
        const decreaseLiters = Math.max(0, prevVolume - currVolume);
        const riseLiters = Math.max(0, currVolume - prevVolume);

        intervals.push({
            prev,
            curr,
            prevTs,
            currTs,
            prevVolume,
            currVolume,
            addedLiters,
            decreaseLiters,
            riseLiters
        });
    }

    if (intervals.length === 0) return 0;

    const firstTs = Number(orderedReadings[0].timestamp);
    const lastTs = Number(orderedReadings[orderedReadings.length - 1].timestamp);
    const elapsedDays = Math.max(1, (lastTs - firstTs) / DAY_MS);
    const estimatedDailyUsageLiters = intervals.reduce((sum, iv) => sum + iv.decreaseLiters, 0) / elapsedDays;
    const likelyRefillRiseThresholdLiters = estimatedDailyUsageLiters * 5;

    const hasRefill = intervals.some((iv) => {
        if (iv.addedLiters > 0) return true;
        if (estimatedDailyUsageLiters <= 0) return false;
        return iv.riseLiters >= likelyRefillRiseThresholdLiters;
    });

    let total = 0;

    for (const iv of intervals) {
        if (iv.currTs <= periodStartMs || iv.prevTs >= periodEndExclusiveMs) continue;

        const isImplicitRefill = estimatedDailyUsageLiters > 0 && iv.riseLiters >= likelyRefillRiseThresholdLiters;
        let fullIntervalLiters = 0;
        if (iv.addedLiters > 0) {
            fullIntervalLiters = Math.max(0, (iv.prevVolume + iv.addedLiters) - iv.currVolume);
        } else if (isImplicitRefill) {
            fullIntervalLiters = 0;
        } else if (!hasRefill) {
            fullIntervalLiters = iv.prevVolume - iv.currVolume;
        } else {
            fullIntervalLiters = iv.decreaseLiters;
        }

        const overlapStart = Math.max(iv.prevTs, periodStartMs);
        const overlapEnd = Math.min(iv.currTs, periodEndExclusiveMs);
        if (overlapEnd <= overlapStart) continue;

        const duration = iv.currTs - iv.prevTs;
        for (let segStart = overlapStart; segStart < overlapEnd; segStart += DAY_MS) {
            const segEnd = Math.min(segStart + DAY_MS, overlapEnd);
            const segLiters = fullIntervalLiters * ((segEnd - segStart) / duration);
            if (metric === 'L') {
                total += segLiters;
            } else {
                const sup = resolveSupplyAt(segEnd - 1);
                const sg = toFiniteNumber(sup?.specificGravity) || toFiniteNumber(iv.curr.appliedSpecificGravity) || 1;
                const segKg = segLiters * sg;
                if (metric === '$') {
                    const price = toFiniteNumber(sup?.price) || 0;
                    total += segKg * price;
                } else {
                    total += segKg;
                }
            }
        }
    }

    return Math.max(0, total);
}
