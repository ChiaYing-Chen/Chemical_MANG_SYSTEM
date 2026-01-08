export enum SystemType {
  BOILER = '鍋爐水系統',
  COOLING = '冷卻水系統',
  WASTEWATER = '廢水處理系統',
  DENOX = '脫銷系統'
}

// Table B: Chemical Price/SG
export interface ChemicalSupply {
  id: string;
  tankId: string;
  supplierName: string;
  chemicalName: string;
  specificGravity: number; // 該批次的比重
  price?: number; // 單價 (元/KG)
  startDate: number; // 生效日期
  notes?: string;
}

export type CalculationMethod = 'NONE' | 'CWS_BLOWDOWN' | 'BWS_STEAM';

// Table C: CWS Theoretical Params
export interface CWSParameterRecord {
  tankId: string; // Foreign Key
  circulationRate: number; // R (m3/hr)
  tempOutlet?: number; // T1
  tempReturn?: number; // T2
  tempDiff: number; // Delta T
  cwsHardness?: number; // ppm
  makeupHardness?: number; // ppm
  concentrationCycles: number; // N
  targetPpm: number; // Dosage
}

// Table D: BWS Theoretical Params
export interface BWSParameterRecord {
  tankId: string; // Foreign Key
  steamProduction: number; // Tons/Month
  targetPpm: number; // Dosage
}

// Table E: Tank Settings (Frontend Combined Object)
export interface Tank {
  id: string; // Primary Key
  name: string;
  system: string;
  capacityLiters: number;
  factor: number; // Geometric Factor: Liters per CM
  description?: string;
  safeMinLevel: number; // %
  targetDailyUsage?: number;
  
  // Configuration
  calculationMethod?: CalculationMethod;
  
  // Joined Data (from Table C & D)
  cwsParams?: CWSParameterRecord;
  bwsParams?: BWSParameterRecord;
}

// Table A: Tank Levels
export interface Reading {
  id: string;
  tankId: string; // Foreign Key
  timestamp: number;
  levelCm: number;
  
  // Snapshot data
  calculatedVolume: number; // Liters
  calculatedWeightKg: number; // KG
  appliedSpecificGravity: number; 
  supplyId?: string; // Foreign Key to Table B

  addedAmountLiters: number; 
  operatorName: string;
}

export enum NoteCategory {
  REFILL = '更換/補藥',
  CONTRACT = '合約紀錄',
  MAINTENANCE = '維修保養',
  OTHER = '其他紀要'
}

export interface Note {
  id: string;
  timestamp: number;
  category: NoteCategory;
  content: string;
  relatedTankId?: string;
}

export interface DailyUsage {
  date: string;
  usageLiters: number;
  readingsCount: number;
}