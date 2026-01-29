import { Tank, ChemicalSupply, CWSParameterRecord, BWSParameterRecord, SystemType, ShapeType, HeadType } from '../types';

/**
 * Get the active Chemical Supply contract for a specific date.
 */
export const getActiveSupplyForDate = (
    date: Date,
    suppliesHistory: ChemicalSupply[]
): ChemicalSupply | undefined => {
    const timestamp = date.getTime();
    // Validate timestamp
    if (isNaN(timestamp)) return undefined;

    // Find the closest contract starting on or before the date
    return suppliesHistory
        .filter(s => s.startDate <= timestamp)
        .sort((a, b) => b.startDate - a.startDate)[0];
};

/**
 * Calculate Theoretical Usage for a specific period (usually a week or month).
 * 
 * @param tank The tank entity.
 * @param periodStart Start date of the period.
 * @param periodEnd End date of the period.
 * @param paramsHistory Array of CWS or BWS parameter records.
 * @param activeSupply The active chemical supply contract for this period.
 * @returns Theoretical usage in KG.
 */
export const calculateTheoreticalUsage = (
    tank: Tank,
    periodStart: Date,
    periodEnd: Date, // Exclusive
    paramsHistory: (CWSParameterRecord | BWSParameterRecord)[],
    activeSupply: ChemicalSupply | undefined
): number => {
    if (!activeSupply || !activeSupply.targetPpm) return 0;

    const targetPpm = activeSupply.targetPpm;
    // const days = (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24); // Unused

    // Find matching params for the period
    const periodStartTs = periodStart.getTime();
    const periodEndTs = periodEnd.getTime();

    if (tank.calculationMethod === 'BWS_STEAM') {
        const bwsHistory = paramsHistory as BWSParameterRecord[];

        // We will try to find specific history first.
        let usedParam = bwsHistory.find(p => {
            const d = p.date || 0;
            return d >= periodStartTs && d < periodEndTs;
        });

        if (!usedParam) {
            usedParam = tank.bwsParams;
        }

        if (!usedParam) return 0;

        const steamProduction = usedParam.steamProduction || 0;

        // NOTE: This assumes 'steamProduction' provided is the TOTAL for the period.
        // If the period differs from the record's context (Weekly vs Monthly), caller must adjust.
        return (steamProduction * targetPpm) / 1000;
    }

    return 0;
};

/**
 * Calculate CWS Theoretical Usage (Evaporation Loss Method).
 * 
 * @param circulationRate Rate in m3/hr
 * @param tempDiff Delta T in Celsius
 * @param concentrationCycles Cycles (N)
 * @param targetPpm Target concentration
 * @param days Number of days in the period
 * @returns Usage in KG
 */
export const calculateCWSUsage = (
    circulationRate: number,
    tempDiff: number,
    concentrationCycles: number,
    targetPpm: number,
    days: number
): number => {
    // E = (R * dT * 1.8 * 24 * days) / 1000
    // 1.8 is likely Kcal factor or specific heat adjustment? Standard cooling tower formula factor.
    const E = (circulationRate * tempDiff * 1.8 * 24 * days) / 1000;

    // C = N
    const C = concentrationCycles;

    // BW = E / (C - 1)
    const BW = C > 1 ? E / (C - 1) : 0;

    // Usage = (BW * ppm) / 1000
    return (BW * targetPpm) / 1000;
};

/**
 * Calculate Volume (Liters) based on Tank Dimensions and Level (cm).
 * 
 * @param tank Tank Object
 * @param levelCm Measured Level in cm
 * @returns Volume in Liters
 */
export const calculateTankVolume = (tank: Tank, levelCm: number): number => {
    // Legacy support: If no detailed shape config, use Factor
    if (!tank.shapeType || tank.shapeType === 'VERTICAL_CYLINDER') {
        if (!tank.dimensions?.diameter && tank.factor) {
            return levelCm * tank.factor;
        }
    }

    // If no dimensions setup at all, fallback to Factor (if exists) or 0
    if (!tank.dimensions) {
        return tank.factor ? levelCm * tank.factor : 0;
    }

    const { diameter, length, width, height, sensorOffset, headType } = tank.dimensions;

    // Apply Sensor Offset correction
    // Real Level = Reading + Offset
    const offset = sensorOffset || 0;
    let h = levelCm + offset;

    // Clamp h? h shouldn't be negative.
    if (h < 0) h = 0;
    if (height && h > height) h = height; // Optional clamping if height provided

    if (tank.shapeType === 'VERTICAL_CYLINDER') {
        if (!diameter) return tank.factor ? levelCm * tank.factor : 0; // Fallback

        // V = PI * r^2 * h
        const r = diameter / 2;
        const volCm3 = Math.PI * Math.pow(r, 2) * h;
        return volCm3 / 1000; // Convert cm3 to Liters
    }

    if (tank.shapeType === 'RECTANGULAR') {
        if (!width || !length) return tank.factor ? levelCm * tank.factor : 0;

        const volCm3 = length * width * h;
        return volCm3 / 1000;
    }

    if (tank.shapeType === 'HORIZONTAL_CYLINDER') {
        if (!diameter || !length) return tank.factor ? levelCm * tank.factor : 0;

        const r = diameter / 2;

        // Clamp h to diameter for calculation (physical limit)
        const hCalc = Math.min(h, diameter);

        // 1. Cylindrical Body Volume
        // V_cyl = L * [r^2 * acos((r-h)/r) - (r-h)*sqrt(2rh - h^2)]
        // Note: Math.acos inputs -1 to 1. (r-h)/r ranges from 1 (h=0) to -1 (h=2r).
        let term1 = 0;

        // Handle edges to avoid NaN
        if (hCalc <= 0) {
            term1 = 0;
        } else if (hCalc >= diameter) {
            term1 = Math.PI * Math.pow(r, 2);
        } else {
            const ratio = (r - hCalc) / r;
            term1 = Math.pow(r, 2) * Math.acos(ratio) - (r - hCalc) * Math.sqrt(2 * r * hCalc - Math.pow(hCalc, 2));
        }

        const vCyl = length * term1;

        // 2. Head Volume (Two heads)
        let vHeads = 0;
        const type = headType || 'SEMI_ELLIPTICAL_2_1'; // Default

        if (type === 'FLAT') {
            vHeads = 0;
        } else if (type === 'HEMISPHERICAL') {
            // Sphere formula for filled height h: V = (PI * h^2 / 3) * (3r - h)
            // This represents volume of ONE cap if h < r ? No, Sphere formula is for the whole sphere filled to h.
            // A horizontal capsule with hemispherical ends = Cylinder + Sphere.
            // So we just add the Sphere volume at height h.

            // Standard Sphere Segment Volume: V = (PI * h^2 / 3) * (3r - h)
            // Valid for 0 <= h <= 2r
            vHeads = (Math.PI * Math.pow(hCalc, 2) / 3) * (3 * r - hCalc);

        } else if (type === 'SEMI_ELLIPTICAL_2_1') {
            // 2:1 SE Head Volume.
            // Depth of head D = r / 2.
            // The volume of a 2:1 SE Head is exactly half of a hemispherical head of same radius?
            // No. A 2:1 SE ellipsoid has axes (r, r, r/2).
            // Volume of full ellipsoid = 4/3 * PI * a * b * c = 4/3 * PI * r * r * (r/2) = 2/3 * PI * r^3.
            // Volume of full sphere = 4/3 * PI * r^3.
            // So Full Volume is 0.5 of Sphere.

            // Does the partial volume scale linearly?
            // Ellipsoid partial volume V(h) / V_total equals Sphere partial volume V(h') / V_sphere_total ?
            // For an ellipsoid with vertical axis 'c' (here 2r? no, the axis vertical is '2r' (diameter), axis horizontal is depth).
            // WAIT. Horizontal Tank.
            // The cross section is Circular. The axis along the length varies.
            // For a Semi-Elliptical Head on a Horizontal Tank:
            // The Vertical Cross section at distance x from tangent is a Circle? No?
            // Standard SE Head: The cross section perpendicular to tank axis is Elliptical? No.
            // Tangent line is Circular (matches tank).
            // As we move outward, the cross sections stay circular but get smaller? YES.
            // An Ellipsoid of revolution.
            // Since diameter is vertical, the cross sections perpendicular to the major axis (lengthwise) are circles.
            // Integration:
            // V = Integral Area(x) dx
            // Area is circular segment? No.
            // Verification:
            // For Horizontal Cylinder with Ellipsoidal Heads:
            // The liquid surface area in the head is an ellipse?

            // Approximation:
            // Volume of liquid in a horizontal 2:1 SE Head is approximately (Volume of liquid in Hemisphere) * (Depth / Radius) ?
            // For 2:1 SE, Depth = r/2. Hemisphere Depth = r.
            // Ratio = 0.5.
            // Let's verify.
            // Volume of Ellipsoid (a, b, c) cut by plane.
            // If tank is horizontal, the cut plane is horizontal.
            // The head is an ellipsoid with axes: Vertical=r, Horizontal(Transverse)=r, Horizontal(Longitudinal)=Length_Head.
            // L_Head = r/2.
            // If we scale the Longitudinal axis by factor k (k=0.5), does Volume(h) scale by k?
            // Yes. Volume is linear with respect to the dimension perpendicular to the slicing plane? 
            // No, slicing plane is Horizontal (Parallel to Longitudinal and Transverse).
            // The slicing plane cuts the Vertical axis.
            // The area of the slice at height h in the ellipsoid:
            // Slice is an ellipse with axes A(h) and B(h).
            // In sphere (r,r,r), slice is circle with radius $x = \sqrt{r^2 - (r-h)^2}$. Area = $\pi x^2$.
            // In ellipsoid (r, r, r/2), slice is ellipse? 
            // Vertical axis = r. Transverse = r. Longitudinal = r/2.
            // Slice at height z.
            // The slice is an ellipse with axes:
            // Transverse axis (x) matches sphere: $x = \sqrt{r^2 - z^2}$ (if z is from center).
            // Longitudinal axis (y): $y = (L_head/r) * \sqrt{r^2 - z^2}$.
            // Area = $\pi * x * y = \pi * (\sqrt{...}) * (k * \sqrt{...}) = k * (\pi * (...))$.
            // Area_Ellipsoid(h) = k * Area_Sphere(h).
            // Integral Area dh => Vol_Ellipsoid(h) = k * Vol_Sphere(h).

            // CONCLUSION: Yes, simple scaling works.
            // For 2:1 SE Head, Volume is exactly 0.5 * Volume of Hemisphere at same level.

            const vHemi = (Math.PI * Math.pow(hCalc, 2) / 3) * (3 * r - hCalc);
            vHeads = vHemi * 0.5;

            // Logic Check: Two heads?
            // Formula above is for Volume of "Sphere" (Two hemispheres).
            // So 0.5 * Sphere Volume = Volume of Two SE Heads.
            // Correct.
        }

        const vTotal = vCyl + vHeads;
        return vTotal / 1000;
    }

    return 0;
};
