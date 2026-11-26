const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function toTaipeiDateKeyFromMs(ms) {
    if (!Number.isFinite(Number(ms))) return '';
    return new Date(Number(ms) + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Parse manual water quality values including numeric strings and `a*10^b` notation.
 * @param {*} val
 * @returns {number|null}
 */
export function parseWaterQualityNumber(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return Number.isFinite(val) ? val : null;
    const str = String(val).trim();
    if (!str || str.toLowerCase() === 'none' || str === '-') return null;

    if (str.includes('*10^')) {
        const parts = str.split('*10^');
        const base = parseFloat(parts[0]);
        const exp = parseInt(parts[1], 10);
        if (Number.isFinite(base) && Number.isFinite(exp)) {
            return base * Math.pow(10, exp);
        }
    }

    const cleanStr = str.replace(/[^\d.-]/g, '');
    const parsed = parseFloat(cleanStr);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalize messy water-quality column names using aliases and whitespace collapsing.
 * @param {string} rawName
 * @param {Map<string, string>|Record<string, string>|null} [aliasMap]
 * @returns {string}
 */
export function normalizeMetricLabel(rawName, aliasMap = null) {
    if (!rawName) return '';
    let aliased = rawName;
    if (aliasMap instanceof Map && aliasMap.has(rawName)) {
        aliased = aliasMap.get(rawName);
    } else if (aliasMap && typeof aliasMap === 'object' && !(aliasMap instanceof Map) && aliasMap[rawName]) {
        aliased = aliasMap[rawName];
    }
    return String(aliased).replace(/\s+/g, ' ').trim();
}

/**
 * Determine water quality system type and sample point groups for a tank.
 * @param {object} tank
 */
export function getWaterQualityContextForTank(tank) {
    if (!tank) return { waterType: null, defaultPointGroup: '', pointGroups: [] };
    const name = String(tank.name || '');
    const sys = String(tank.system || tank.system_type || '');
    const desc = String(tank.description || '');

    const isCooling = sys.includes('冷卻') || name.toUpperCase().startsWith('CT-1') || name.toUpperCase().startsWith('CT-2');
    if (isCooling) {
        const isCt2 = name.toUpperCase().includes('CT-2') || desc.includes('二階');
        return {
            waterType: 'CW',
            defaultPointGroup: isCt2 ? 'CW_2' : 'CW_1',
            pointGroups: [
                { id: 'CW_1', label: '一階冷卻水 (CW_1)', matchPoints: ['CW_1'] },
                { id: 'CW_2', label: '二階冷卻水 (CW_2)', matchPoints: ['CW_2'] },
                { id: 'TW', label: '補水 (TW)', matchPoints: ['TW'] }
            ]
        };
    }

    const isBoiler = sys.includes('鍋爐') || /中和胺|脫氧劑|清罐劑/.test(name);
    if (isBoiler) {
        let defaultPointGroup = 'CBD';
        if (name.includes('中和胺')) defaultPointGroup = 'CD';
        else if (name.includes('脫氧劑')) defaultPointGroup = 'BFW';
        else if (name.includes('清罐劑')) defaultPointGroup = 'CBD';

        return {
            waterType: 'BW',
            defaultPointGroup,
            pointGroups: [
                { id: 'CD', label: '冷凝水 (4爐平均)', matchPoints: ['BLR1_CD', 'BLR2_CD', 'BLR3_CD', 'BLR4_CD'] },
                { id: 'BFW', label: '給水 BFW (4爐平均)', matchPoints: ['BLR1_BFW', 'BLR2_BFW', 'BLR3_BFW', 'BLR4_BFW'] },
                { id: 'CBD', label: '爐水 CBD (4爐平均)', matchPoints: ['BLR1_CBD', 'BLR2_CBD', 'BLR3_CBD', 'BLR4_CBD'] },
                { id: 'DEA', label: '脫氣 DEA (4爐平均)', matchPoints: ['BLR1_DEA', 'BLR2_DEA', 'BLR3_DEA', 'BLR4_DEA'] },
                { id: 'MS', label: '主蒸汽 MS (4爐平均)', matchPoints: ['BLR1_MS', 'BLR2_MS', 'BLR3_MS', 'BLR4_MS'] },
                { id: 'DMP', label: '除礦水 (DMP)', matchPoints: ['DMP'] }
            ]
        };
    }

    return { waterType: null, defaultPointGroup: '', pointGroups: [] };
}

/**
 * Pick the most diagnostically relevant default water-quality metric key for a tank.
 * @param {object} tank
 * @param {string[]} availableMetricKeys
 * @returns {string}
 */
export function pickDefaultWaterQualityMetric(tank, availableMetricKeys) {
    if (!Array.isArray(availableMetricKeys) || availableMetricKeys.length === 0) return '';
    const name = String(tank?.name || '');

    const findByPatterns = (patterns) => {
        for (const pat of patterns) {
            const hit = availableMetricKeys.find(k => pat.test(k));
            if (hit) return hit;
        }
        return '';
    };

    if (name.includes('中和胺')) {
        return findByPatterns([/^pH\b/i, /\bpH\b/i, /NH3|氨/i]) || availableMetricKeys[0];
    }
    if (name.includes('脫氧劑')) {
        return findByPatterns([/N2H4|聯胺/i]) || availableMetricKeys[0];
    }
    if (name.includes('清罐劑')) {
        return findByPatterns([/OPO4|磷酸鹽/i, /^pH\b/i]) || availableMetricKeys[0];
    }
    if (name.includes('硫酸')) {
        return findByPatterns([/^pH\b/i, /\bpH\b/i, /M-Alkalinity|鹼性度/i]) || availableMetricKeys[0];
    }
    if (name.includes('漂白水')) {
        return findByPatterns([/殘餘氯|R-Cl/i]) || availableMetricKeys[0];
    }
    if (name.includes('銅腐蝕抑制劑')) {
        return findByPatterns([/銅腐蝕/i, /Copper|\bCu\b/i]) || availableMetricKeys[0];
    }
    if (name.includes('微生物') || name.includes('殺菌')) {
        return findByPatterns([/菌落數/i]) || availableMetricKeys[0];
    }
    if (name.includes('分散劑')) {
        return findByPatterns([/分散劑|TKC-3635/i, /Turbidity|混濁度/i]) || availableMetricKeys[0];
    }
    if (name.includes('腐蝕') && name.includes('抑制')) {
        return findByPatterns([/Ortho Phosphate/i, /總磷酸鹽|Total phosphate/i, /磷酸鹽/i]) || availableMetricKeys[0];
    }

    return availableMetricKeys[0];
}

/**
 * Normalize API date string (`YYYY-MM-DD`, `YYYY/MM/DD`, or ISO string) to Taipei `YYYY-MM-DD`.
 * @param {string} dateStr
 * @returns {string}
 */
export function normalizeDateKeyFromApi(dateStr) {
    if (!dateStr) return '';
    const trimmed = String(dateStr).trim();
    const ymdMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (ymdMatch) {
        return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
    }
    const ms = Date.parse(trimmed);
    if (!Number.isFinite(ms)) return '';
    return toTaipeiDateKeyFromMs(ms);
}

/**
 * Aggregate manual water quality readings by Taipei YYYY-MM-DD for the selected sample points & metric.
 * @param {Array<object>} wqReadings
 * @param {string[]} matchPoints
 * @param {string} metricKey
 * @returns {Map<string, { value: number, sampleCount: number }>}
 */
export function buildDailyWaterQualityMap(wqReadings, matchPoints, metricKey) {
    const acc = new Map();
    if (!Array.isArray(wqReadings) || !Array.isArray(matchPoints) || matchPoints.length === 0 || !metricKey) {
        return acc;
    }

    const pointSet = new Set(matchPoints);
    for (const row of wqReadings) {
        if (!row || !pointSet.has(row.sample_point) || !row.data) continue;
        const num = parseWaterQualityNumber(row.data[metricKey]);
        if (num === null) continue;
        const dateKey = normalizeDateKeyFromApi(row.test_date);
        if (!dateKey) continue;

        if (!acc.has(dateKey)) acc.set(dateKey, { sum: 0, count: 0 });
        const entry = acc.get(dateKey);
        entry.sum += num;
        entry.count += 1;
    }

    const result = new Map();
    for (const [dateKey, { sum, count }] of acc.entries()) {
        if (count > 0) {
            result.set(dateKey, {
                value: Math.round((sum / count) * 1000) / 1000,
                sampleCount: count
            });
        }
    }
    return result;
}

/**
 * Average daily water quality values over a week starting at weekStartDateKey (YYYY-MM-DD).
 * @param {Map<string, { value: number, sampleCount: number }>} dailyWqMap
 * @param {string} weekStartDateKey
 * @param {number} [days]
 * @returns {{ value: number|null, sampleDays: number }}
 */
export function computeWeeklyWaterQualityAverage(dailyWqMap, weekStartDateKey, days = 7) {
    if (!(dailyWqMap instanceof Map) || !weekStartDateKey) {
        return { value: null, sampleDays: 0 };
    }
    const startMs = Date.parse(`${weekStartDateKey}T00:00:00+08:00`);
    if (!Number.isFinite(startMs)) {
        return { value: null, sampleDays: 0 };
    }

    let sum = 0;
    let sampleDays = 0;
    for (let i = 0; i < days; i++) {
        const key = toTaipeiDateKeyFromMs(startMs + i * DAY_MS);
        const entry = dailyWqMap.get(key);
        if (entry && Number.isFinite(entry.value)) {
            sum += entry.value;
            sampleDays += 1;
        }
    }

    return {
        value: sampleDays > 0 ? Math.round((sum / sampleDays) * 1000) / 1000 : null,
        sampleDays
    };
}

/**
 * Compute CWS blowdown water volume in m3 for the specified period days.
 * @param {number} circulationRate
 * @param {number} tempDiff
 * @param {number} concentrationCycles
 * @param {number} [days]
 * @returns {number|null}
 */
export function calculateCwsBlowdownM3(circulationRate, tempDiff, concentrationCycles, days = 1) {
    const r = Number(circulationRate || 0);
    const dt = Number(tempDiff || 0);
    const c = Number(concentrationCycles || 0);
    if (!(r > 0) || !(dt > 0) || !(c > 1) || !(days > 0)) return null;

    const evaporation = (r * dt * 1.8 * 24 * days) / 1000;
    const blowdown = evaporation / (c - 1);
    return blowdown > 0 ? Math.round(blowdown * 10) / 10 : null;
}

/**
 * Normalize cm values in alert/note text so numbers with > maxDecimals decimal places are rounded to maxDecimals.
 * Handles both paired values (`49.632 / 48.439 cm`, `49.632／48.439 cm`) and single values (`0.419986... cm`).
 * Preserves non-cm numbers (slope coefficients, percentages, liters) and integers/1-2 decimal cm values.
 * @param {string} text
 * @param {number} [maxDecimals]
 * @returns {string}
 */
export function normalizeCmDecimalsInText(text, maxDecimals = 2) {
    if (typeof text !== 'string' || !text) return '';
    const decimals = Math.max(0, Number(maxDecimals) || 2);
    const fmt = (rawNum) => {
        const parts = String(rawNum).split('.');
        if (parts.length < 2 || parts[1].length <= decimals) return rawNum;
        const n = Number(rawNum);
        return Number.isFinite(n) ? String(Number(n.toFixed(decimals))) : rawNum;
    };
    let out = text.replace(
        /(-?\d+(?:\.\d+)?)(\s*[\/／]\s*)(-?\d+(?:\.\d+)?)(\s*cm\b)/gi,
        (_, a, sep, b, unit) => `${fmt(a)}${sep}${fmt(b)}${unit}`
    );
    out = out.replace(
        /(-?\d+\.\d+)(\s*cm\b)/gi,
        (_, num, unit) => `${fmt(num)}${unit}`
    );
    return out;
}

/**
 * Rewrite verbose technical PI-vs-manual level comparison alerts into plain, actionable wording
 * for operators while preserving cm decimal rounding and any trailing operator notes.
 * @param {string} text
 * @returns {string}
 */
export function formatAlertTextForDisplay(text) {
    const cleaned = normalizeCmDecimalsInText(text, 2);
    if (!cleaned) return '';

    const piDailyPattern = /人工日使用量\s*([\d.]+)\s*L[；;]\s*PI\s*日使用量\s*([\d.]+)\s*L[；;]\s*差距\s*([^（(；;\n]+)(?:[（(][^）)]*?(?:須小於|超過)\s*([\d.]+%?)[^）)]*[）)])?[^]*?PI\s*期初[／/]期末液位\s*([\d.]+)\s*[／/]\s*([\d.]+)\s*cm[，,]\s*依桶槽形狀換算存量\s*([\d.]+)\s*[／/]\s*([\d.]+)\s*L[^。]*。[；;\s]*(?:採用[^。]*。[^。]*。(?:[；;\s]*雷達\s*PI[^。]*。)?)?/;
    const match = cleaned.match(piDailyPattern);
    if (!match) {
        return cleaned;
    }

    const [, manualL, piL, rawGap, rawThreshold, startCm, endCm, startL, endL] = match;
    const gapText = String(rawGap || '').trim();
    const thresholdText = rawThreshold ? (rawThreshold.includes('%') ? rawThreshold : `${rawThreshold}%`) : '17%';

    const headline = gapText.includes('%')
        ? `人工液位抄表與線上液位計(PI)換算差距過大（差距 ${gapText}，超過 ${thresholdText} 門檻）：`
        : `人工液位顯示無用量，但線上液位計(PI)顯示明顯下降，兩者差距過大：`;

    const summary = [
        headline,
        `• 人工抄表推算日用量：${manualL} L`,
        `• 線上液位計(PI)日用量：${piL} L（液位 ${startCm} → ${endCm} cm，存量 ${startL} → ${endL} L）`,
        '請確認現場抄表數值與加藥狀況，或檢查線上液位計是否異常飄移。'
    ].join('\n');

    const trailing = cleaned.slice((match.index || 0) + match[0].length).replace(/^[；;\s]+/, '').trim();
    return trailing ? `${summary}\n備註說明：${trailing}` : summary;
}

/**
 * Build a per-day map of diagnostic events (refills, fluctuation alerts, important notes, contract switches).
 * @param {object} params
 * @returns {Map<string, Array<{ type: 'REFILL'|'ALERT'|'NOTE'|'SUPPLY', icon: string, label: string, detail: string }>>}
 */
export function buildDailyEventMap({ tank, readings = [], notes = [], alerts = [], supplies = [], startDate = '', endDate = '' }) {
    const eventMap = new Map();
    if (!tank) return eventMap;

    const addEvent = (dateKey, ev) => {
        if (!dateKey) return;
        if (startDate && dateKey < startDate) return;
        if (endDate && dateKey > endDate) return;
        if (!eventMap.has(dateKey)) eventMap.set(dateKey, []);
        eventMap.get(dateKey).push(ev);
    };

    // 1. Refill events from readings
    for (const r of readings) {
        if (!r || r.tankId !== tank.id) continue;
        const added = Number(r.addedAmountLiters || 0);
        if (added > 0) {
            const key = toTaipeiDateKeyFromMs(r.timestamp);
            addEvent(key, {
                type: 'REFILL',
                icon: '🚚',
                label: '補藥',
                detail: `補藥 ${added.toFixed(0)} L${r.operatorName ? ` (${r.operatorName})` : ''}`
            });
        }
    }

    // 2. Fluctuation alerts & operator explanations
    for (const a of alerts) {
        if (!a || a.tankId !== tank.id) continue;
        const key = normalizeDateKeyFromApi(a.dateStr);
        const noteText = String(a.note || '').trim();
        addEvent(key, {
            type: 'ALERT',
            icon: '⚠️',
            label: noteText ? '異常(已備註)' : '異常警報',
            detail: formatAlertTextForDisplay(noteText || String(a.reason || '液位變動異常'))
        });
    }

    // 3. Important notes matched by tank chemical/system while isolating CT-1 vs CT-2
    const tankName = String(tank.name || '');
    const tankSys = String(tank.system || tank.system_type || '');
    const tankDesc = String(tank.description || '');
    const tankUpper = tankName.toUpperCase();
    const isCt1 = tankUpper.includes('CT-1') || tankDesc.includes('一階');
    const isCt2 = tankUpper.includes('CT-2') || tankDesc.includes('二階');
    const isCooling = tankSys.includes('冷卻') || isCt1 || isCt2;
    const isBoiler = tankSys.includes('鍋爐') || /中和胺|脫氧劑|清罐劑/.test(tankName);
    const coreChem = tankName.replace(/^CT-[12]\s*/i, '').trim();

    for (const n of notes) {
        if (!n) continue;
        const key = normalizeDateKeyFromApi(n.dateStr);
        if (!key) continue;

        const area = String(n.area || '');
        const chem = String(n.chemicalName || '');
        const text = String(n.note || '');
        const combined = `${area} ${chem} ${text}`;
        const combinedUpper = combined.toUpperCase();

        const noteIsCt1 = combinedUpper.includes('CT-1') || combined.includes('一階') || combined.includes('1階');
        const noteIsCt2 = combinedUpper.includes('CT-2') || combined.includes('二階') || combined.includes('2階');

        if (isCt1 && noteIsCt2 && !noteIsCt1) continue;
        if (isCt2 && noteIsCt1 && !noteIsCt2) continue;

        let matched = false;
        if (coreChem && (chem.includes(coreChem) || text.includes(coreChem))) {
            matched = true;
        } else if (isCooling && (n.markedWaterType === 'CW' || area.includes('冷卻'))) {
            matched = true;
        } else if (isBoiler && (n.markedWaterType === 'BW' || area.includes('鍋爐'))) {
            matched = true;
        }

        if (matched) {
            addEvent(key, {
                type: 'NOTE',
                icon: '📝',
                label: chem || area || '重要紀事',
                detail: normalizeCmDecimalsInText(text.trim() || `${area} ${chem}`.trim())
            });
        }
    }

    // 4. Chemical supply updates (distinguish quarterly SG adjustment vs supplier/chemical contract switch)
    const tankSupplies = supplies
        .filter(s => s && s.tankId === tank.id && Number.isFinite(Number(s.startDate)))
        .sort((a, b) => Number(a.startDate) - Number(b.startDate));

    for (let i = 0; i < tankSupplies.length; i++) {
        const s = tankSupplies[i];
        const prev = i > 0 ? tankSupplies[i - 1] : null;
        const key = toTaipeiDateKeyFromMs(s.startDate);
        const nameLabel = s.chemicalName || s.supplierName || '藥劑批次';
        const sgCurr = Number(s.specificGravity);
        const ppmCurr = s.targetPpm ?? '-';

        if (!prev) {
            addEvent(key, {
                type: 'SUPPLY',
                icon: '🔄',
                label: '初始設定',
                detail: `藥劑起始設定：${nameLabel}（比重 ${sgCurr}，目標 ${ppmCurr} ppm）`
            });
            continue;
        }

        const prevSup = String(prev.supplierName || '').trim();
        const currSup = String(s.supplierName || '').trim();
        const prevChem = String(prev.chemicalName || '').trim();
        const currChem = String(s.chemicalName || '').trim();
        const supplierChanged = Boolean(prevSup && currSup && prevSup !== currSup);
        const chemChanged = Boolean(
            prevChem && currChem && prevChem !== currChem &&
            !currChem.includes(prevChem) && !prevChem.includes(currChem)
        );
        const contractChanged = supplierChanged || chemChanged;
        const sgPrev = Number(prev.specificGravity);
        const sgChanged = Math.round(sgPrev * 10000) !== Math.round(sgCurr * 10000);
        const ppmChanged = Math.round(Number(prev.targetPpm || 0) * 1000) !== Math.round(Number(s.targetPpm || 0) * 1000);

        if (contractChanged) {
            addEvent(key, {
                type: 'SUPPLY',
                icon: '🔄',
                label: '合約切換',
                detail: `合約切換：${nameLabel}（比重 ${sgChanged ? `${sgPrev} → ${sgCurr}` : sgCurr}，目標 ${ppmCurr} ppm）`
            });
        } else if (sgChanged) {
            addEvent(key, {
                type: 'SUPPLY',
                icon: '⚖️',
                label: '比重調整',
                detail: `每季比重調整：${sgPrev} → ${sgCurr}（${nameLabel}，目標 ${ppmCurr} ppm）`
            });
        } else if (ppmChanged) {
            addEvent(key, {
                type: 'SUPPLY',
                icon: '⚖️',
                label: '參數調整',
                detail: `目標濃度調整：${prev.targetPpm ?? '-'} → ${ppmCurr} ppm（${nameLabel}，比重 ${sgCurr}）`
            });
        } else {
            addEvent(key, {
                type: 'SUPPLY',
                icon: '⚖️',
                label: '比重確認',
                detail: `每季比重確認：${sgCurr}（${nameLabel}，目標 ${ppmCurr} ppm，無變動）`
            });
        }
    }

    return eventMap;
}

/**
 * Truncate tooltip event descriptions cleanly so hover popups remain compact and unclipped.
 * @param {Array<{ type?: string, icon?: string, label?: string, detail?: string }>} events
 * @param {number} [maxItems]
 * @param {number} [maxDetailChars]
 * @returns {{ items: Array<{ type?: string, icon?: string, label?: string, detail?: string, shortDetail: string, truncated: boolean }>, hiddenCount: number, hasMoreDetail: boolean, totalCount: number }}
 */
export function formatTooltipEvents(events, maxItems = 2, maxDetailChars = 42) {
    if (!Array.isArray(events) || events.length === 0) {
        return { items: [], hiddenCount: 0, hasMoreDetail: false, totalCount: 0 };
    }

    const limit = Math.max(1, Number(maxItems) || 2);
    const charLimit = Math.max(10, Number(maxDetailChars) || 42);
    const items = events.slice(0, limit).map(ev => {
        const raw = String(ev?.detail || '').trim();
        const chars = Array.from(raw);
        if (chars.length > charLimit) {
            return {
                ...ev,
                shortDetail: `${chars.slice(0, charLimit).join('')}…`,
                truncated: true
            };
        }
        return {
            ...ev,
            shortDetail: raw,
            truncated: false
        };
    });

    const hiddenCount = Math.max(0, events.length - items.length);
    const hasMoreDetail = hiddenCount > 0 || items.some(it => it.truncated);

    return {
        items,
        hiddenCount,
        hasMoreDetail,
        totalCount: events.length
    };
}
