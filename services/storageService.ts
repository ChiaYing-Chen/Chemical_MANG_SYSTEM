// StorageService - 模擬 localStorage 的 API，現在作為 apiService 的包裝器
// 保持原有的介面，但底層改用 PostgreSQL API

import * as API from './apiService';
import { Tank, Reading, ChemicalSupply, CWSParameterRecord, BWSParameterRecord, ImportantNote } from '../types';

export class StorageService {
    // 初始化 - 不再需要，但保留介面相容性
    static init() {
        console.log('StorageService initialized (using PostgreSQL backend)');
    }

    // ==================== Tanks ====================

    static async getTanks(): Promise<Tank[]> {
        try {
            const tanks = await API.fetchTanks();
            return tanks.map(t => StorageService.convertTankFromAPI(t));
        } catch (err) {
            console.error('Failed to get tanks:', err);
            return [];
        }
    }

    static async saveTank(tank: Tank): Promise<void> {
        try {
            const apiTank = StorageService.convertTankToAPI(tank);
            // 檢查是否已存在
            const existing = await API.fetchTanks();
            const exists = existing.some(t => t.id === tank.id);

            if (exists) {
                await API.updateTank(tank.id, apiTank);
            } else {
                await API.createTank(apiTank);
            }

            // 儲存相關參數
            if (tank.calculationMethod === 'CWS_BLOWDOWN' && tank.cwsParams) {
                await API.saveCWSParams({
                    ...tank.cwsParams,
                    tank_id: tank.id,
                    date: tank.cwsParams.date || Date.now()
                });
            } else if (tank.calculationMethod === 'BWS_STEAM' && tank.bwsParams) {
                await API.saveBWSParams({
                    ...tank.bwsParams,
                    tank_id: tank.id,
                    date: tank.bwsParams.date || Date.now()
                });
            }
        } catch (err) {
            console.error('Failed to save tank:', err);
            throw err;
        }
    }

    static async deleteTank(id: string): Promise<void> {
        try {
            await API.deleteTank(id);
        } catch (err) {
            console.error('Failed to delete tank:', err);
            throw err;
        }
    }

    static async reorderTanks(updates: { id: string, sortOrder: number }[]): Promise<void> {
        try {
            await API.reorderTanks(updates.map(u => ({ id: u.id, sort_order: u.sortOrder })));
        } catch (err) {
            console.error('Failed to reorder tanks:', err);
            throw err;
        }
    }

    static async saveTanksBatch(tanks: Tank[]): Promise<void> {
        try {
            const apiTanks = tanks.map(t => StorageService.convertTankToAPI(t));
            await API.createTanksBatch(apiTanks);
        } catch (err) {
            console.error('Failed to save tanks batch:', err);
            throw err;
        }
    }

    // ==================== Readings ====================

    static async getReadings(): Promise<Reading[]> {
        try {
            const readings = await API.fetchReadings();
            return readings.map(r => StorageService.convertReadingFromAPI(r));
        } catch (err) {
            console.error('Failed to get readings:', err);
            return [];
        }
    }

    static async saveReading(reading: Reading): Promise<void> {
        try {
            const apiReading = StorageService.convertReadingToAPI(reading);
            await API.createReading(apiReading);
        } catch (err) {
            console.error('Failed to save reading:', err);
            throw err;
        }
    }

    static async updateReading(reading: Reading): Promise<void> {
        try {
            const apiReading = StorageService.convertReadingToAPI(reading);
            await API.updateReading(reading.id, apiReading);
        } catch (err) {
            console.error('Failed to update reading:', err);
            throw err;
        }
    }

    static async deleteReading(id: string): Promise<void> {
        try {
            await API.deleteReading(id);
        } catch (err) {
            console.error('Failed to delete reading:', err);
            throw err;
        }
    }

    static async saveReadingsBatch(readings: Reading[]): Promise<void> {
        const BATCH_SIZE = 100;
        try {
            const apiReadings = readings.map(r => StorageService.convertReadingToAPI(r));

            for (let i = 0; i < apiReadings.length; i += BATCH_SIZE) {
                const chunk = apiReadings.slice(i, i + BATCH_SIZE);
                await API.createReadingsBatch(chunk);
                // Optional: add a small delay to avoid overwhelming the server if needed
                // await new Promise(resolve => setTimeout(resolve, 50)); 
            }
        } catch (err) {
            console.error('Failed to save readings batch:', err);
            throw err;
        }
    }

    // ==================== Chemical Supplies ====================

    static async getSupplies(): Promise<ChemicalSupply[]> {
        try {
            const supplies = await API.fetchSupplies();
            return supplies.map(s => StorageService.convertSupplyFromAPI(s));
        } catch (err) {
            console.error('Failed to get supplies:', err);
            return [];
        }
    }

    static async saveSupply(supply: ChemicalSupply): Promise<void> {
        try {
            const apiSupply = StorageService.convertSupplyToAPI(supply);
            await API.createSupply(apiSupply);
        } catch (err) {
            console.error('Failed to save supply:', err);
            throw err;
        }
    }

    static async updateSupply(supply: ChemicalSupply): Promise<void> {
        try {
            const apiSupply = StorageService.convertSupplyToAPI(supply);
            await API.updateSupply(supply.id, apiSupply);
        } catch (err) {
            console.error('Failed to update supply:', err);
            throw err;
        }
    }

    static async addSuppliesBatch(supplies: ChemicalSupply[]): Promise<void> {
        try {
            const apiSupplies = supplies.map(s => StorageService.convertSupplyToAPI(s));
            await API.createSuppliesBatch(apiSupplies);
        } catch (err) {
            console.error('Failed to add supplies batch:', err);
            throw err;
        }
    }

    static async deleteSupply(id: string): Promise<void> {
        try {
            await API.deleteSupply(id);
        } catch (err) {
            console.error('Failed to delete supply:', err);
            throw err;
        }
    }

    static async getActiveSupply(tankId: string, timestamp: number): Promise<ChemicalSupply | null> {
        try {
            const supplies = await StorageService.getSupplies();
            const tankSupplies = supplies
                .filter(s => s.tankId === tankId && s.startDate <= timestamp)
                .sort((a, b) => b.startDate - a.startDate);

            return tankSupplies.length > 0 ? tankSupplies[0] : null;
        } catch (err) {
            console.error('Failed to get active supply:', err);
            return null;
        }
    }

    // ==================== Parameters ====================

    static async getCWSParam(tankId: string): Promise<CWSParameterRecord | null> {
        try {
            const params = await API.fetchCWSParams(tankId);
            return params ? StorageService.convertCWSParamFromAPI(params) : null;
        } catch (err) {
            console.error('Failed to get CWS params:', err);
            return null;
        }
    }

    // New: History
    static async getCWSParamsHistory(tankId: string): Promise<CWSParameterRecord[]> {
        try {
            const history = await API.fetchCWSParamsHistory(tankId);
            return history.map((p: any) => StorageService.convertCWSParamFromAPI(p));
        } catch (err) {
            console.error('Failed to get CWS history:', err);
            return [];
        }
    }

    static async saveCWSParam(param: CWSParameterRecord): Promise<void> {
        try {
            const apiParam = StorageService.convertCWSParamToAPI(param);
            await API.saveCWSParams(apiParam);
        } catch (err) {
            console.error('Failed to save CWS param:', err);
            throw err;
        }
    }

    static async updateCWSParamRecord(param: CWSParameterRecord): Promise<void> {
        try {
            const apiParam = StorageService.convertCWSParamToAPI(param);
            await API.updateCWSParams(apiParam);
        } catch (err) {
            console.error('Failed to update CWS param record:', err);
            throw err;
        }
    }

    static async deleteCWSParamRecord(id: string): Promise<void> {
        try {
            await API.deleteCWSParams(id);
        } catch (err) {
            console.error('Failed to delete CWS param record:', err);
            throw err;
        }
    }


    static async getBWSParam(tankId: string): Promise<BWSParameterRecord | null> {
        try {
            const params = await API.fetchBWSParams(tankId);
            return params ? StorageService.convertBWSParamFromAPI(params) : null;
        } catch (err) {
            console.error('Failed to get BWS params:', err);
            return null;
        }
    }

    // New: History
    static async getBWSParamsHistory(tankId: string): Promise<BWSParameterRecord[]> {
        try {
            const history = await API.fetchBWSParamsHistory(tankId);
            return history.map((p: any) => StorageService.convertBWSParamFromAPI(p));
        } catch (err) {
            console.error('Failed to get BWS history:', err);
            return [];
        }
    }

    static async saveBWSParam(param: BWSParameterRecord): Promise<void> {
        try {
            const apiParam = StorageService.convertBWSParamToAPI(param);
            await API.saveBWSParams(apiParam);
        } catch (err) {
            console.error('Failed to save BWS param:', err);
            throw err;
        }
    }

    static async updateBWSParamRecord(param: BWSParameterRecord): Promise<void> {
        try {
            const apiParam = StorageService.convertBWSParamToAPI(param);
            await API.updateBWSParams(apiParam);
        } catch (err) {
            console.error('Failed to update BWS param record:', err);
            throw err;
        }
    }

    static async deleteBWSParamRecord(id: string): Promise<void> {
        try {
            await API.deleteBWSParams(id);
        } catch (err) {
            console.error('Failed to delete BWS param record:', err);
            throw err;
        }
    }

    // ==================== Important Notes ====================

    static async getNotes(): Promise<ImportantNote[]> {
        try {
            const notes = await API.fetchNotes();
            return notes.map(n => StorageService.convertNoteFromAPI(n));
        } catch (err) {
            console.error('Failed to get notes:', err);
            return [];
        }
    }

    static async saveNote(note: ImportantNote): Promise<void> {
        try {
            const apiNote = StorageService.convertNoteToAPI(note);
            await API.createNote(apiNote);
        } catch (err) {
            console.error('Failed to create note:', err);
            throw err;
        }
    }

    static async updateNote(note: ImportantNote): Promise<void> {
        try {
            const apiNote = StorageService.convertNoteToAPI(note);
            await API.updateNote(note.id, apiNote);
        } catch (err) {
            console.error('Failed to update note:', err);
            throw err;
        }
    }

    static async deleteNote(id: string): Promise<void> {
        try {
            await API.deleteNote(id);
        } catch (err) {
            console.error('Failed to delete note:', err);
            throw err;
        }
    }

    static async saveNotesBatch(notes: ImportantNote[]): Promise<void> {
        try {
            const apiNotes = notes.map(n => StorageService.convertNoteToAPI(n));
            await API.createNotesBatch(apiNotes);
        } catch (err) {
            console.error('Failed to save notes batch:', err);
            throw err;
        }
    }

    // ==================== Conversion Helpers ====================

    private static convertTankFromAPI(apiTank: any): Tank {
        return {
            id: apiTank.id,
            name: apiTank.name,
            system: apiTank.system_type,
            capacityLiters: parseFloat(apiTank.capacity_liters),
            factor: parseFloat(apiTank.geo_factor),
            description: apiTank.description,
            safeMinLevel: parseFloat(apiTank.safe_min_level || 20),
            targetDailyUsage: apiTank.target_daily_usage ? parseFloat(apiTank.target_daily_usage) : undefined,
            calculationMethod: apiTank.calculation_method,
            cwsParams: apiTank.cws_params ? StorageService.convertCWSParamFromAPI(apiTank.cws_params) : undefined,
            bwsParams: apiTank.bws_params ? StorageService.convertBWSParamFromAPI(apiTank.bws_params) : undefined,
            sortOrder: apiTank.sort_order ? parseInt(apiTank.sort_order) : undefined,
            shapeType: apiTank.shape_type,
            dimensions: apiTank.dimensions,
            inputUnit: apiTank.input_unit || 'CM',
            validationThreshold: apiTank.validation_threshold ? parseFloat(apiTank.validation_threshold) : 30,
            sgRangeMin: apiTank.sg_range_min ? parseFloat(apiTank.sg_range_min) : undefined,
            sgRangeMax: apiTank.sg_range_max ? parseFloat(apiTank.sg_range_max) : undefined
        };
    }

    private static convertTankToAPI(tank: Tank): any {
        return {
            id: tank.id,
            name: tank.name,
            system_type: tank.system,
            capacity_liters: tank.capacityLiters,
            geo_factor: tank.factor,
            description: tank.description,
            safe_min_level: tank.safeMinLevel,
            target_daily_usage: tank.targetDailyUsage,
            calculation_method: tank.calculationMethod,
            sort_order: tank.sortOrder,
            shape_type: tank.shapeType,
            dimensions: tank.dimensions,
            input_unit: tank.inputUnit,
            validation_threshold: tank.validationThreshold ?? 30,
            sg_range_min: tank.sgRangeMin,
            sg_range_max: tank.sgRangeMax
        };
    }

    private static convertReadingFromAPI(apiReading: any): Reading {
        return {
            id: apiReading.id,
            tankId: apiReading.tank_id,
            timestamp: parseInt(apiReading.timestamp),
            levelCm: parseFloat(apiReading.level_cm),
            calculatedVolume: parseFloat(apiReading.calculated_volume),
            calculatedWeightKg: parseFloat(apiReading.calculated_weight_kg),
            appliedSpecificGravity: parseFloat(apiReading.applied_sg),
            supplyId: apiReading.supply_id,
            addedAmountLiters: parseFloat(apiReading.added_amount_liters || 0),
            operatorName: apiReading.operator_name
        };
    }

    private static convertReadingToAPI(reading: Reading): any {
        return {
            id: reading.id,
            tank_id: reading.tankId,
            timestamp: reading.timestamp,
            level_cm: reading.levelCm,
            calculated_volume: reading.calculatedVolume,
            calculated_weight_kg: reading.calculatedWeightKg,
            applied_sg: reading.appliedSpecificGravity,
            supply_id: reading.supplyId,
            added_amount_liters: reading.addedAmountLiters,
            operator_name: reading.operatorName
        };
    }

    private static convertSupplyFromAPI(apiSupply: any): ChemicalSupply {
        return {
            id: apiSupply.id,
            tankId: apiSupply.tank_id,
            supplierName: apiSupply.supplier_name,
            chemicalName: apiSupply.chemical_name,
            specificGravity: parseFloat(apiSupply.specific_gravity),
            price: apiSupply.price ? parseFloat(apiSupply.price) : undefined,
            startDate: parseInt(apiSupply.start_date),
            notes: apiSupply.notes,
            targetPpm: apiSupply.target_ppm ? parseFloat(apiSupply.target_ppm) : undefined
        };
    }

    private static convertSupplyToAPI(supply: ChemicalSupply): any {
        return {
            id: supply.id,
            tank_id: supply.tankId,
            supplier_name: supply.supplierName,
            chemical_name: supply.chemicalName,
            specific_gravity: supply.specificGravity,
            price: supply.price,
            start_date: supply.startDate,
            notes: supply.notes,
            target_ppm: supply.targetPpm
        };
    }

    private static convertCWSParamFromAPI(apiParam: any): CWSParameterRecord {
        return {
            id: apiParam.id,
            tankId: apiParam.tank_id,
            circulationRate: parseFloat(apiParam.circulation_rate || 0),
            tempOutlet: apiParam.temp_outlet ? parseFloat(apiParam.temp_outlet) : undefined,
            tempReturn: apiParam.temp_return ? parseFloat(apiParam.temp_return) : undefined,
            tempDiff: parseFloat(apiParam.temp_diff || 0),
            cwsHardness: apiParam.cws_hardness ? parseFloat(apiParam.cws_hardness) : undefined,
            makeupHardness: apiParam.makeup_hardness ? parseFloat(apiParam.makeup_hardness) : undefined,
            concentrationCycles: parseFloat(apiParam.concentration_cycles || 1),
            date: apiParam.date ? parseInt(apiParam.date) : undefined
        };
    }

    private static convertCWSParamToAPI(param: CWSParameterRecord): any {
        return {
            id: param.id,
            tank_id: param.tankId,
            circulation_rate: param.circulationRate,
            temp_outlet: param.tempOutlet,
            temp_return: param.tempReturn,
            temp_diff: param.tempDiff,
            cws_hardness: param.cwsHardness,
            makeup_hardness: param.makeupHardness,
            concentration_cycles: param.concentrationCycles,
            date: param.date
        };
    }

    private static convertBWSParamFromAPI(apiParam: any): BWSParameterRecord {
        return {
            id: apiParam.id,
            tankId: apiParam.tank_id,
            steamProduction: parseFloat(apiParam.steam_production || 0),
            date: apiParam.date ? parseInt(apiParam.date) : undefined
        };
    }

    private static convertBWSParamToAPI(param: BWSParameterRecord): any {
        return {
            id: param.id,
            tank_id: param.tankId,
            steam_production: param.steamProduction,
            date: param.date
        };
    }
    private static convertNoteFromAPI(apiNote: any): ImportantNote {
        return {
            id: apiNote.id,
            dateStr: apiNote.date_str,
            area: apiNote.area,
            chemicalName: apiNote.chemical_name,
            note: apiNote.note,
            createdAt: apiNote.created_at
        };
    }

    private static convertNoteToAPI(note: ImportantNote): any {
        return {
            id: note.id,
            date_str: note.dateStr,
            area: note.area,
            chemical_name: note.chemicalName,
            note: note.note
        };
    }
}
