/** 固定補藥週期模型登錄；只有離線建模、獨立驗證後才可發布新版本。 */
import { PI_CYCLE_MODELS } from './piCycleModels.generated.js';
export { PI_CYCLE_MODELS };
export const DAILY_PI_CONVERSIONS = Object.freeze(Object.fromEntries(Object.entries(PI_CYCLE_MODELS).filter(([,m])=>m.status==='ACTIVE')));
export function getPiRelationshipStatus(tank) {
    const model = PI_CYCLE_MODELS[tank.id];
    if (!model) return {status:'PENDING',reason:'尚未建立跨補藥週期驗證的固定關係式'};
    if (model.tag !== tank.piLevelTag || model.unit !== tank.piLevelUnit) return {...model,status:'PENDING',reason:'PI Tag 或單位已變更，舊關係式不適用'};
    return model;
}
/** 每次只查表，不擬合、不搜尋歷史、不以人工量程覆蓋驗證狀態。 */
export function getDailyPiConversion(tank) {
    const model = getPiRelationshipStatus(tank);
    return model.status === 'ACTIVE' ? model : null;
}
