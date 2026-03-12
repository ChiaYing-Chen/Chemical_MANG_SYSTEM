// backendUtils.js
// 這是從 frontend calculationUtils.ts 移植過來的 Node.js 工具檔

/**
 * 取得指定日期的有效藥劑合約
 */
export const getActiveSupplyForDate = (dateOrTimestamp, suppliesHistory) => {
    const timestamp = typeof dateOrTimestamp === 'number' ? dateOrTimestamp : dateOrTimestamp.getTime();
    if (isNaN(timestamp)) return undefined;

    return suppliesHistory
        .filter(s => s.start_date <= timestamp)
        .sort((a, b) => b.start_date - a.start_date)[0];
};

/**
 * 計算儲槽內液體的實際體積 (Liters)
 */
export const calculateTankVolume = (tank, levelCm) => {
    let dimensions = tank.dimensions;
    if (typeof dimensions === 'string') {
        try { dimensions = JSON.parse(dimensions); } catch (e) { }
    }

    if (!tank.shape_type || tank.shape_type === 'VERTICAL_CYLINDER') {
        if (!dimensions?.diameter && tank.factor) {
            return levelCm * tank.factor;
        }
    }

    if (!dimensions) {
        return tank.factor ? levelCm * tank.factor : 0;
    }

    const diameter = Number(dimensions.diameter) || 0;
    const length = Number(dimensions.length) || 0;
    const width = Number(dimensions.width) || 0;
    const height = Number(dimensions.height) || 0;
    const sensorOffset = Number(dimensions.sensorOffset) || 0;
    const headType = dimensions.headType || 'SEMI_ELLIPTICAL_2_1';

    const offset = sensorOffset || 0;
    let h = levelCm + offset;

    if (h < 0) h = 0;
    if (height && h > height) h = height;

    if (tank.shape_type === 'VERTICAL_CYLINDER') {
        if (!diameter) return tank.factor ? levelCm * tank.factor : 0;
        const r = diameter / 2;
        const volCm3 = Math.PI * Math.pow(r, 2) * h;
        return volCm3 / 1000;
    }

    if (tank.shape_type === 'RECTANGULAR') {
        if (!width || !length) return tank.factor ? levelCm * tank.factor : 0;
        const volCm3 = length * width * h;
        return volCm3 / 1000;
    }

    if (tank.shape_type === 'HORIZONTAL_CYLINDER') {
        if (!diameter || !length) return tank.factor ? levelCm * tank.factor : 0;
        const r = diameter / 2;
        const hCalc = Math.min(h, diameter);

        let term1 = 0;
        if (hCalc <= 0) {
            term1 = 0;
        } else if (hCalc >= diameter) {
            term1 = Math.PI * Math.pow(r, 2);
        } else {
            const ratio = (r - hCalc) / r;
            term1 = Math.pow(r, 2) * Math.acos(ratio) - (r - hCalc) * Math.sqrt(2 * r * hCalc - Math.pow(hCalc, 2));
        }
        const vCyl = length * term1;

        let vHeads = 0;
        if (headType === 'FLAT') {
            vHeads = 0;
        } else if (headType === 'HEMISPHERICAL') {
            vHeads = (Math.PI * Math.pow(hCalc, 2) / 3) * (3 * r - hCalc);
        } else if (headType === 'SEMI_ELLIPTICAL_2_1') {
            const vHemi = (Math.PI * Math.pow(hCalc, 2) / 3) * (3 * r - hCalc);
            vHeads = vHemi * 0.5;
        }
        const vTotal = vCyl + vHeads;
        return vTotal / 1000;
    }

    return 0;
};

/**
 * 計算冷卻水 (CWS) 系統理論用量 (Evaporation Loss Method)
 */
export const calculateCWSUsage = (circulationRate, tempDiff, concentrationCycles, targetPpm, days) => {
    const E = (Number(circulationRate) * Number(tempDiff) * 1.8 * 24 * Number(days)) / 1000;
    const C = Number(concentrationCycles);
    const BW = C > 1 ? E / (C - 1) : 0;
    return (BW * targetPpm) / 1000;
};
