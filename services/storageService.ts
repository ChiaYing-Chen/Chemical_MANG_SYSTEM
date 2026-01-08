import { Tank, Reading, Note, SystemType, ChemicalSupply, CalculationMethod, CWSParameterRecord, BWSParameterRecord } from '../types';

// Simulating Database Tables using LocalStorage Keys
const KEYS = {
  // Table A: Tank Levels (Readings)
  READINGS: 'powerchem_readings',
  
  // Table B: Chemical Price/SG (Supplies)
  SUPPLIES: 'powerchem_supplies',
  
  // Table E: Tank Settings (Basic Config only)
  TANKS: 'powerchem_tanks',

  // Table C: CWS Theoretical Params (Separate Table)
  CWS_PARAMS: 'powerchem_cws_params',

  // Table D: BWS Theoretical Params (Separate Table)
  BWS_PARAMS: 'powerchem_bws_params',

  NOTES: 'powerchem_notes'
};

// Helper to generate a tank object (Seed Data)
const createTank = (
  id: string, 
  name: string, 
  system: SystemType, 
  desc: string, 
  capacity: number = 2000, 
  factor: number = 20, 
  target: number = 20,
  calcMethod: CalculationMethod = 'NONE'
): Tank => ({
  id, name, system, capacityLiters: capacity, factor, description: desc, safeMinLevel: 15, targetDailyUsage: target,
  calculationMethod: calcMethod
});

// Seed Params Helper
const createCWSParams = (tankId: string, r: number, dt: number, n: number, ppm: number): CWSParameterRecord => ({
  tankId, circulationRate: r, tempDiff: dt, concentrationCycles: n, targetPpm: ppm, 
  tempOutlet: 34.76, tempReturn: 41.35, cwsHardness: 843, makeupHardness: 94
});

const createBWSParams = (tankId: string, steam: number, ppm: number): BWSParameterRecord => ({
  tankId, steamProduction: steam, targetPpm: ppm
});

// --- Initial Seed Data Generation ---

const seedTanksBase: Tank[] = [
  // 1. 冷卻水系統 - 一階桶槽區
  createTank('tc1_1', 'CWS-1 硫酸槽', SystemType.COOLING, '一階冷卻水塔區 - 硫酸注入', 5000, 45, 50),
  createTank('tc1_2', 'CWS-1 漂白水槽', SystemType.COOLING, '一階冷卻水塔區 - 殺菌用', 3000, 30, 40),
  
  // Specific CWS Chemicals with Formula
  createTank('tc1_3', 'CWS-1 腐蝕結垢抑制劑', SystemType.COOLING, '一階冷卻水塔區', 2000, 20, 15, 'CWS_BLOWDOWN'),
  createTank('tc1_4', 'CWS-1 分散劑槽', SystemType.COOLING, '一階冷卻水塔區', 2000, 20, 10, 'CWS_BLOWDOWN'),
  createTank('tc1_5', 'CWS-1 銅腐蝕抑制劑', SystemType.COOLING, '一階冷卻水塔區', 1000, 10, 5, 'CWS_BLOWDOWN'),

  createTank('tc1_6', 'CWS-1 非氧化型殺菌劑', SystemType.COOLING, '一階冷卻水塔區', 1000, 10, 8),
  createTank('tc1_7', 'CWS-1 微生物分散劑', SystemType.COOLING, '一階冷卻水塔區', 1000, 10, 5),
  createTank('tc1_8', 'CWS-1 消泡劑槽', SystemType.COOLING, '一階冷卻水塔區', 500, 5, 2),

  // 1. 冷卻水系統 - 二階桶槽區
  createTank('tc2_1', 'CWS-2 硫酸槽', SystemType.COOLING, '二階冷卻水塔區 - 硫酸注入', 5000, 45, 50),
  createTank('tc2_2', 'CWS-2 漂白水槽', SystemType.COOLING, '二階冷卻水塔區 - 殺菌用', 3000, 30, 40),
  
  createTank('tc2_3', 'CWS-2 腐蝕結垢抑制劑', SystemType.COOLING, '二階冷卻水塔區', 2000, 20, 15, 'CWS_BLOWDOWN'),
  createTank('tc2_4', 'CWS-2 分散劑槽', SystemType.COOLING, '二階冷卻水塔區', 2000, 20, 10, 'CWS_BLOWDOWN'),
  createTank('tc2_5', 'CWS-2 銅腐蝕抑制劑', SystemType.COOLING, '二階冷卻水塔區', 1000, 10, 5, 'CWS_BLOWDOWN'),

  createTank('tc2_6', 'CWS-2 非氧化型殺菌劑', SystemType.COOLING, '二階冷卻水塔區', 1000, 10, 8),
  createTank('tc2_7', 'CWS-2 微生物分散劑', SystemType.COOLING, '二階冷卻水塔區', 1000, 10, 5),
  createTank('tc2_8', 'CWS-2 消泡劑槽', SystemType.COOLING, '二階冷卻水塔區', 500, 5, 2),

  // 2. 鍋爐水系統 (Specific BWS Chemicals with Formula)
  createTank('tb_1', 'BWS 清罐劑槽', SystemType.BOILER, '鍋爐房藥注區', 1000, 10, 12, 'BWS_STEAM'),
  createTank('tb_2', 'BWS 中和胺槽', SystemType.BOILER, '鍋爐房藥注區 - PH調整', 1000, 10, 10, 'BWS_STEAM'),
  createTank('tb_3', 'BWS 脫氧劑槽', SystemType.BOILER, '鍋爐房藥注區 - 除氧', 1000, 10, 15, 'BWS_STEAM'),

  // 3. 脫銷系統 (1 chemical)
  createTank('td_1', 'DeNOx 氨水槽', SystemType.DENOX, 'SCR 脫銷區', 10000, 80, 100),
];

const seedCWSParams: CWSParameterRecord[] = [
  createCWSParams('tc1_3', 23407, 6.6, 9.0, 25),
  createCWSParams('tc1_4', 23407, 6.6, 9.0, 10),
  createCWSParams('tc1_5', 23407, 6.6, 9.0, 5),
  createCWSParams('tc2_3', 23407, 6.6, 9.0, 25),
  createCWSParams('tc2_4', 23407, 6.6, 9.0, 10),
  createCWSParams('tc2_5', 23407, 6.6, 9.0, 5),
];

const seedBWSParams: BWSParameterRecord[] = [
  createBWSParams('tb_1', 505600, 0.4),
  createBWSParams('tb_2', 505600, 0.4),
  createBWSParams('tb_3', 505600, 0.3),
];

// Helper to generate a default supply for a tank
const createSupply = (id: string, tankId: string, chemName: string, supplier: string, sg: number, price: number): ChemicalSupply => ({
  id, tankId, chemicalName: chemName, supplierName: supplier, specificGravity: sg, price, startDate: new Date('2023-01-01').getTime()
});

const seedSupplies: ChemicalSupply[] = [
  // Cooling 1
  createSupply('s_c1_1', 'tc1_1', 'H2SO4 98%', '台塑化學', 1.84, 15),
  createSupply('s_c1_2', 'tc1_2', 'NaOCl 12%', '台灣氯氣', 1.2, 8),
  createSupply('s_c1_3', 'tc1_3', 'CorroStop-100', '納爾科', 1.15, 85),
  createSupply('s_c1_4', 'tc1_4', 'Disp-200', '納爾科', 1.1, 70),
  createSupply('s_c1_5', 'tc1_5', 'Cu-Guard', '栗田工業', 1.05, 120),
  createSupply('s_c1_6', 'tc1_6', 'BioKill-X', '栗田工業', 1.02, 95),
  createSupply('s_c1_7', 'tc1_7', 'BioDisp-50', '通用化學', 1.05, 80),
  createSupply('s_c1_8', 'tc1_8', 'Defoam-A', '通用化學', 0.95, 200),

  // Cooling 2 (Assuming similar contracts for simplicity)
  createSupply('s_c2_1', 'tc2_1', 'H2SO4 98%', '台塑化學', 1.84, 15),
  createSupply('s_c2_2', 'tc2_2', 'NaOCl 12%', '台灣氯氣', 1.2, 8),
  createSupply('s_c2_3', 'tc2_3', 'CorroStop-100', '納爾科', 1.15, 85),
  createSupply('s_c2_4', 'tc2_4', 'Disp-200', '納爾科', 1.1, 70),
  createSupply('s_c2_5', 'tc2_5', 'Cu-Guard', '栗田工業', 1.05, 120),
  createSupply('s_c2_6', 'tc2_6', 'BioKill-X', '栗田工業', 1.02, 95),
  createSupply('s_c2_7', 'tc2_7', 'BioDisp-50', '通用化學', 1.05, 80),
  createSupply('s_c2_8', 'tc2_8', 'Defoam-A', '通用化學', 0.95, 200),

  // Boiler
  createSupply('s_b_1', 'tb_1', 'Phos-Clean', '奇異水處理', 1.1, 65),
  createSupply('s_b_2', 'tb_2', 'Amine-Plus', '奇異水處理', 0.98, 150),
  createSupply('s_b_3', 'tb_3', 'Oxy-Scav', '奇異水處理', 1.2, 55),

  // DeNOx
  createSupply('s_d_1', 'td_1', 'Ammonia 25%', '台肥', 0.9, 12),
];

export const StorageService = {
  // --- TABLE A: READINGS ---
  getReadings: (): Reading[] => {
    const data = localStorage.getItem(KEYS.READINGS);
    return data ? JSON.parse(data) : [];
  },
  addReading: (reading: Reading) => {
    const readings = StorageService.getReadings();
    readings.push(reading);
    readings.sort((a, b) => b.timestamp - a.timestamp);
    localStorage.setItem(KEYS.READINGS, JSON.stringify(readings));
  },
  addReadingsBatch: (newReadings: Reading[]) => {
    const readings = StorageService.getReadings();
    readings.push(...newReadings);
    readings.sort((a, b) => b.timestamp - a.timestamp);
    localStorage.setItem(KEYS.READINGS, JSON.stringify(readings));
  },

  // --- TABLE B: SUPPLIES ---
  getSupplies: (): ChemicalSupply[] => {
    const data = localStorage.getItem(KEYS.SUPPLIES);
    return data ? JSON.parse(data) : seedSupplies;
  },
  saveSupply: (supply: ChemicalSupply) => {
    const supplies = StorageService.getSupplies();
    const index = supplies.findIndex(s => s.id === supply.id);
    if (index >= 0) {
      supplies[index] = supply;
    } else {
      supplies.push(supply);
    }
    supplies.sort((a, b) => b.startDate - a.startDate);
    localStorage.setItem(KEYS.SUPPLIES, JSON.stringify(supplies));
  },
  addSuppliesBatch: (newSupplies: ChemicalSupply[]) => {
    const supplies = StorageService.getSupplies();
    supplies.push(...newSupplies);
    supplies.sort((a, b) => b.startDate - a.startDate);
    localStorage.setItem(KEYS.SUPPLIES, JSON.stringify(supplies));
  },
  deleteSupply: (id: string) => {
    const supplies = StorageService.getSupplies().filter(s => s.id !== id);
    localStorage.setItem(KEYS.SUPPLIES, JSON.stringify(supplies));
  },
  getActiveSupply: (tankId: string, timestamp: number): ChemicalSupply | undefined => {
    const supplies = StorageService.getSupplies()
      .filter(s => s.tankId === tankId)
      .sort((a, b) => b.startDate - a.startDate);
    return supplies.find(s => s.startDate <= timestamp);
  },

  // --- TABLE C: CWS PARAMS (Internal) ---
  getCWSParams: (): CWSParameterRecord[] => {
    const data = localStorage.getItem(KEYS.CWS_PARAMS);
    return data ? JSON.parse(data) : seedCWSParams;
  },
  saveCWSParam: (param: CWSParameterRecord) => {
    const list = StorageService.getCWSParams();
    const index = list.findIndex(p => p.tankId === param.tankId);
    if (index >= 0) list[index] = param;
    else list.push(param);
    localStorage.setItem(KEYS.CWS_PARAMS, JSON.stringify(list));
  },

  // --- TABLE D: BWS PARAMS (Internal) ---
  getBWSParams: (): BWSParameterRecord[] => {
    const data = localStorage.getItem(KEYS.BWS_PARAMS);
    return data ? JSON.parse(data) : seedBWSParams;
  },
  saveBWSParam: (param: BWSParameterRecord) => {
    const list = StorageService.getBWSParams();
    const index = list.findIndex(p => p.tankId === param.tankId);
    if (index >= 0) list[index] = param;
    else list.push(param);
    localStorage.setItem(KEYS.BWS_PARAMS, JSON.stringify(list));
  },

  // --- TABLE E: TANKS (Config) & JOIN LOGIC ---
  getTanks: (): Tank[] => {
    const tanksData = localStorage.getItem(KEYS.TANKS);
    const baseTanks: Tank[] = tanksData ? JSON.parse(tanksData) : seedTanksBase;
    
    // Simulate SQL JOIN: Tanks LEFT JOIN CWS_Params LEFT JOIN BWS_Params
    const cwsParams = StorageService.getCWSParams();
    const bwsParams = StorageService.getBWSParams();

    return baseTanks.map(t => {
      const cws = cwsParams.find(c => c.tankId === t.id);
      const bws = bwsParams.find(b => b.tankId === t.id);
      
      // Re-assemble the frontend object structure
      const tankObj = { ...t };
      if (cws) tankObj.cwsParams = cws;
      if (bws) tankObj.bwsParams = bws;
      return tankObj;
    });
  },

  saveTank: (tank: Tank) => {
    // 1. Separate Parameters for Table C & D
    if (tank.cwsParams) {
      StorageService.saveCWSParam({ ...tank.cwsParams, tankId: tank.id });
    }
    if (tank.bwsParams) {
      StorageService.saveBWSParam({ ...tank.bwsParams, tankId: tank.id });
    }

    // 2. Save Base Tank Config to Table E (Strip joined data if necessary, though retaining it in JSON is harmless, we will clean it to simulate DB strictness)
    const tanks = StorageService.getTanks(); // Gets joined data
    
    // Create 'Clean' tank object for storage
    const cleanTank: Tank = {
        id: tank.id,
        name: tank.name,
        system: tank.system,
        capacityLiters: tank.capacityLiters,
        factor: tank.factor,
        description: tank.description,
        safeMinLevel: tank.safeMinLevel,
        targetDailyUsage: tank.targetDailyUsage,
        calculationMethod: tank.calculationMethod,
        // Explicitly remove nested params when saving to 'Tanks' table
        cwsParams: undefined,
        bwsParams: undefined
    };

    const existingTanksRaw = localStorage.getItem(KEYS.TANKS);
    const existingTanks: Tank[] = existingTanksRaw ? JSON.parse(existingTanksRaw) : seedTanksBase;
    const index = existingTanks.findIndex(t => t.id === tank.id);
    
    if (index >= 0) {
      existingTanks[index] = cleanTank;
    } else {
      existingTanks.push(cleanTank);
    }
    localStorage.setItem(KEYS.TANKS, JSON.stringify(existingTanks));
  },

  deleteTank: (id: string) => {
    // Delete from Table E
    const existingTanksRaw = localStorage.getItem(KEYS.TANKS);
    const existingTanks: Tank[] = existingTanksRaw ? JSON.parse(existingTanksRaw) : seedTanksBase;
    const newTanks = existingTanks.filter(t => t.id !== id);
    localStorage.setItem(KEYS.TANKS, JSON.stringify(newTanks));

    // Cleanup Table C
    const cws = StorageService.getCWSParams().filter(p => p.tankId !== id);
    localStorage.setItem(KEYS.CWS_PARAMS, JSON.stringify(cws));

    // Cleanup Table D
    const bws = StorageService.getBWSParams().filter(p => p.tankId !== id);
    localStorage.setItem(KEYS.BWS_PARAMS, JSON.stringify(bws));
  },

  getNotes: (): Note[] => {
    const data = localStorage.getItem(KEYS.NOTES);
    return data ? JSON.parse(data) : [];
  },

  addNote: (note: Note) => {
    const notes = StorageService.getNotes();
    notes.push(note);
    notes.sort((a, b) => b.timestamp - a.timestamp);
    localStorage.setItem(KEYS.NOTES, JSON.stringify(notes));
  },

  addNotesBatch: (newNotes: Note[]) => {
    const notes = StorageService.getNotes();
    notes.push(...newNotes);
    notes.sort((a, b) => b.timestamp - a.timestamp);
    localStorage.setItem(KEYS.NOTES, JSON.stringify(notes));
  }
};