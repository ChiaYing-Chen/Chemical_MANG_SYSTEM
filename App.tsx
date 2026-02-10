import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { StorageService } from './services/storageService';
import { calculateTankVolume } from './utils/calculationUtils';
import { Tank, Reading, SystemType, ChemicalSupply, CWSParameterRecord, BWSParameterRecord, ImportantNote, CalculationMethod, ShapeType, HeadType, FluctuationAlert } from './types';
import { Icons } from './components/Icons';
import { LoadingOverlay } from './components/LoadingOverlay';
import { ImportAnomalyModal, ImportAnomaly } from './components/ImportAnomalyModal';
import * as XLSX from 'xlsx';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    BarChart, Bar, ComposedChart, Area
} from 'recharts';
import AnnualDataView from './views/AnnualDataView';
import { ExcelImportView } from './views/ExcelImportView';
import { FluctuationAlertsView } from './components/FluctuationAlertsView';
import { formatAnomalyMessage } from './utils/textUtils';

// --- Helper Components ---

export const Card: React.FC<{ children: React.ReactNode; className?: string; title?: string; action?: React.ReactNode }> = ({ children, className = "", title, action }) => (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden ${className}`}>
        {(title || action) && (
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                {title && <h3 className="font-semibold text-slate-800">{title}</h3>}
                {action && <div>{action}</div>}
            </div>
        )}
        <div className="p-6">{children}</div>
    </div>
);

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }> = ({ children, variant = 'primary', className = "", ...props }) => {
    const baseStyle = "inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed";
    const variants = {
        primary: "bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500",
        secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-slate-500",
        danger: "bg-red-50 text-red-600 hover:bg-red-100 focus:ring-red-500",
        ghost: "bg-transparent text-slate-600 hover:bg-slate-100"
    };
    return (
        <button className={`${baseStyle} ${variants[variant]} ${className}`} {...props}>
            {children}
        </button>
    );
};

// Common input styles
const inputClassName = "w-full rounded-lg border-slate-600 border p-2.5 bg-slate-900 text-white placeholder-slate-400 focus:ring-brand-500 focus:border-brand-500";

const BWS_TAGS = [
    "W52_FI-MS27-A.PV",
    "W52_FI-MS27-B.PV",
    "W52_FI-MS27-C.PV",
    "W52_FI-MS27-D.PV"
];

const CWS_TAGS_CONFIG: any = {
    'CT-1': {
        flow: ['W52_FI-CW56-Z.PV', 'W52_FI-CW57-Z.PV'],
        tempOut: ['W52_TI-CW77-Z.PV'],
        tempRet: ['W52_TI-CW76-Z.PV']
    },
    'CT-2': {
        flow: ['W52_FI-CW56-Y.PV', 'W52_FI-CW57-Y.PV'],
        tempOut: ['W52_TI-AC77-Y.PV'],
        tempRet: ['W52_TI-CW76-Y.PV']
    }
};

// --- Utility Functions ---

// 跨環境相容的 UUID 生成函數 (因為 crypto.randomUUID 只能在 HTTPS 環境使用)
const generateUUID = (): string => {
    // 優先使用原生 crypto.randomUUID (HTTPS 環境)
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        try {
            return crypto.randomUUID();
        } catch {
            // 如果 randomUUID 存在但拋出錯誤 (非安全上下文)，則使用 fallback
        }
    }
    // Fallback: 使用 getRandomValues 或手動生成
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    // 最終 Fallback: 使用 Math.random
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

const readExcelFile = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];

                // Use header: 1 to get raw array of arrays
                const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];

                if (rawRows.length === 0) {
                    resolve([]);
                    return;
                }

                // Process Headers (Row 0)
                const headers = rawRows[0].map((h: any) => {
                    if (h instanceof Date) {
                        // Force Date Headers to YYYY/MM/DD format to avoid ambiguous parsing
                        const offset = h.getTimezoneOffset();
                        const localDate = new Date(h.getTime() - (offset * 60 * 1000));
                        return localDate.toISOString().split('T')[0].replace(/-/g, '/');
                    }
                    return String(h).trim();
                });

                // Map Rows 1..N to JSON objects
                const jsonData = rawRows.slice(1).map(row => {
                    const rowData: any = {};
                    headers.forEach((header, index) => {
                        // Use header as key
                        // Handle case where row might be shorter than headers
                        rowData[header] = row[index] !== undefined ? row[index] : "";
                    });
                    return rowData;
                });

                resolve(jsonData);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsBinaryString(file);
    });
};

const formatDateForInput = (date: any): string => {
    if (!date) return "";
    try {
        const d = new Date(date);
        if (isNaN(d.getTime())) return "";
        const offset = d.getTimezoneOffset();
        const localDate = new Date(d.getTime() - (offset * 60 * 1000));
        return localDate.toISOString().split('T')[0];
    } catch {
    }
};

// Helper: Normalize date string "YYYY-MM-DD" or "YYYY/MM/DD" to timestamp at Local Midnight
// This ensures consistency between Manual Input and Excel Import for "Same Day" checks
const getNormalizedTimestamp = (dateStr: string | Date | number): number | null => {
    if (!dateStr) return null; // Strict check: Return null if empty
    if (typeof dateStr === 'number') return dateStr;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null; // Strict check: Return null if invalid

    // Reset to midnight
    d.setHours(0, 0, 0, 0);
    return d.getTime();
};

const parseDateKey = (key: string): Date | null => {
    // 0. Check if key contains a 4-digit year (YYYY) - PRIORITY 1 (Western Date)
    const hasYear = /\d{4}/.test(key);

    if (hasYear) {
        const d = new Date(key);
        if (!isNaN(d.getTime())) return d;
    }

    // 1. Check for ROC Date format (e.g., 104/01, 111-05-20)
    // Matches 2-3 digits (year), separator, 1-2 digits (month), optional separator+day
    const rocMatch = key.match(/^(\d{2,3})[/.-](\d{1,2})([/.-](\d{1,2}))?/);
    if (rocMatch) {
        const rocYear = parseInt(rocMatch[1]);
        // Basic sanity check: ROC year usually between 1 and ~200 (current year 114 is 2025)
        // To avoid confusing simple numbers or short ISO years (though <4 digits usually implies something else)
        if (rocYear > 0 && rocYear < 200) {
            const year = rocYear + 1911;
            const month = parseInt(rocMatch[2]);
            const day = rocMatch[4] ? parseInt(rocMatch[4]) : 1;

            // Validation: Month must be 1-12, Day 1-31
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                const d = new Date(year, month - 1, day);
                if (!isNaN(d.getTime())) return d;
            }
        }
    }

    // 2. If no Year, try appending current year
    const currentYear = new Date().getFullYear();
    // Try formats like 1/1, 01-01
    const d2 = new Date(`${currentYear}/${key}`);
    if (!isNaN(d2.getTime())) return d2;

    // 3. Fallback: Try straight parse (in case of other formats), but be careful of 2001 default
    const d3 = new Date(key);
    if (!isNaN(d3.getTime()) && d3.getFullYear() > 2000) {
        if (hasYear) return d3;
        d3.setFullYear(currentYear);
        return d3;
    }

    return null;
}

// --- Views ---

const TankStatusCard: React.FC<{
    tank: any,
    dragProps?: any,
    onNavigate?: (tankId: string) => void,
    onDeliveryClick?: (tank: any) => void,
    lowLevelWarningText?: string
}> = ({ tank, dragProps, onNavigate, onDeliveryClick, lowLevelWarningText = '存量偏低，請叫藥' }) => {

    const handleCardClick = () => {
        if (onNavigate) {
            onNavigate(tank.id);
        }
    };

    const handleDeliveryClick = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent card click
        if (onDeliveryClick) {
            onDeliveryClick(tank);
        }
    };

    return (
        <div
            className={`bg-white rounded-lg border border-slate-200 shadow-sm p-4 hover:border-brand-300 transition-colors relative overflow-hidden ${onNavigate ? 'cursor-pointer hover:shadow-md' : 'cursor-default'}`}
            {...dragProps}
            onClick={handleCardClick}
        >
            {dragProps && (
                <div className="absolute top-2 left-2 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing z-20">
                    <Icons.DragHandle className="w-5 h-5" />
                </div>
            )}
            {tank.isLow && (
                <div className="absolute top-0 right-0 w-16 h-16 -mr-8 -mt-8 bg-red-100 rounded-full flex items-end justify-start pl-3 pb-3">
                    <Icons.Alert className="w-5 h-5 text-red-500" />
                </div>
            )}

            <div className="flex justify-between items-start mb-3 pr-4">
                <h3 className="font-bold text-slate-800 text-base">{tank.name.split(' ').pop()}</h3>
                <div className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    {tank.name.split(' ')[0]}
                </div>
            </div>

            <div className="space-y-3">
                <div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-500">存量</span>
                        <span className={`font-bold ${tank.isLow ? 'text-red-600' : 'text-slate-700'}`}>
                            {tank.lastReading?.calculatedVolume.toFixed(0) || 0} L
                        </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                        <div
                            className={`h-2 rounded-full transition-all duration-500 ${tank.isLow ? 'bg-red-500' : 'bg-brand-500'}`}
                            style={{ width: `${Math.min(100, Math.max(0, tank.currentLevel))}%` }}
                        ></div>
                    </div>
                    {tank.isLow && (
                        <div className="text-yellow-600 text-xs font-medium mt-1 animate-pulse">
                            ⚠️ {lowLevelWarningText}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-50 pt-2">
                    <div>
                        <span className="text-slate-400 block">液位 (H)</span>
                        <span className="font-medium text-slate-700">
                            {tank.lastReading?.levelCm || 0} cm
                            {tank.inputUnit === 'PERCENT' && tank.dimensions && (tank.dimensions.diameter || tank.dimensions.height) ? (
                                <span className="text-slate-400 text-[10px] ml-1">
                                    ({((tank.lastReading?.levelCm || 0) / (tank.dimensions.height || tank.dimensions.diameter || 1) * 100).toFixed(1)}%)
                                </span>
                            ) : null}
                        </span>
                    </div>
                    <div className="text-right">
                        <span className="text-slate-400 block">重量 (W)</span>
                        <span className="font-medium text-slate-700">{tank.lastReading?.calculatedWeightKg.toFixed(0) || 0} kg</span>
                    </div>
                </div>

                {/* Daily Usage & Remaining Days */}
                <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-100 pt-2 bg-slate-50 -mx-4 px-4 py-2">
                    <div>
                        <span className="text-slate-400 block">日用量</span>
                        <span className="font-medium text-blue-600">
                            {tank.avgDailyUsageKg > 0 ? `${tank.avgDailyUsageKg.toFixed(1)} kg/日` : '-'}
                        </span>
                    </div>
                    <div className="text-right">
                        <span className="text-slate-400 block">剩餘天數</span>
                        <span className={`font-bold ${tank.remainingDays !== null && tank.remainingDays < 30 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {tank.remainingDays !== null ? `約 ${tank.remainingDays} 天` : '-'}
                        </span>
                    </div>
                </div>

                <div className="flex items-center justify-between mt-1">
                    <div className="text-[10px] text-slate-400 flex items-center">
                        <Icons.ClipboardPen className="w-3 h-3 mr-1 opacity-50" />
                        {tank.lastReading ? new Date(tank.lastReading.timestamp).toLocaleDateString() : '無紀錄'}
                    </div>

                    {onDeliveryClick && (
                        <button
                            onClick={handleDeliveryClick}
                            className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 px-2 py-1 rounded flex items-center gap-1 transition-colors"
                            title="交貨評估"
                        >
                            📦 評估
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// Delivery Estimation Modal
const DeliveryEstimationModal: React.FC<{
    tank: any;
    onClose: () => void;
}> = ({ tank, onClose }) => {
    const [deliveryDate, setDeliveryDate] = useState<string>(() => {
        const d = new Date();
        d.setDate(d.getDate() + 7); // Default 7 days ahead
        return d.toISOString().split('T')[0];
    });
    const [deliveryKg, setDeliveryKg] = useState<number>(0);

    // Calculate projections
    const daysUntilDelivery = useMemo(() => {
        const deliveryTs = new Date(deliveryDate).getTime();
        const now = Date.now();
        return Math.max(0, Math.floor((deliveryTs - now) / (24 * 60 * 60 * 1000)));
    }, [deliveryDate]);

    const sg = tank.lastReading?.appliedSpecificGravity || 1;
    const avgDailyUsageLiters = tank.avgDailyUsageLiters || 0;
    const avgDailyUsageKg = avgDailyUsageLiters * sg;

    // Projected level on delivery day
    const currentWeightKg = tank.currentWeightKg || 0;
    const projectedUsageKg = avgDailyUsageKg * daysUntilDelivery;
    const projectedLevelKg = Math.max(0, currentWeightKg - projectedUsageKg);
    const projectedLevelLiters = projectedLevelKg / sg;

    // After delivery
    const afterDeliveryKg = projectedLevelKg + deliveryKg;
    const afterDeliveryLiters = afterDeliveryKg / sg;
    const afterDeliveryPercent = (afterDeliveryLiters / tank.capacityLiters) * 100;

    // Check max capacity warning
    const maxWarning = tank.maxCapacityWarningKg || (tank.capacityLiters * sg);
    const exceedsMax = afterDeliveryKg > maxWarning;

    // New remaining days after delivery
    const newRemainingDays = avgDailyUsageLiters > 0
        ? Math.floor(afterDeliveryLiters / avgDailyUsageLiters)
        : null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="bg-amber-50 px-6 py-4 border-b border-amber-100">
                    <h2 className="text-lg font-bold text-amber-900 flex items-center gap-2">
                        📦 交貨評估 - {tank.name}
                    </h2>
                </div>

                <div className="p-6 space-y-4">
                    {/* Current Status */}
                    <div className="bg-slate-50 rounded-lg p-4 text-sm">
                        <div className="font-medium text-slate-700 mb-2">目前狀態</div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>存量：<span className="font-bold">{currentWeightKg.toFixed(0)} kg</span></div>
                            <div>日用量：<span className="font-bold text-blue-600">{avgDailyUsageKg.toFixed(1)} kg/日</span></div>
                        </div>
                    </div>

                    {/* Input Fields */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">交貨日期</label>
                            <input
                                type="date"
                                value={deliveryDate}
                                onChange={e => setDeliveryDate(e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">交貨量 (kg)</label>
                            <input
                                type="number"
                                value={deliveryKg || ''}
                                onChange={e => setDeliveryKg(parseFloat(e.target.value) || 0)}
                                placeholder="例: 1000"
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                            />
                        </div>
                    </div>

                    {/* Projection Results */}
                    <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                        <div className="text-sm text-slate-600">
                            <span className="text-slate-400">距交貨：</span>
                            <span className="font-medium">{daysUntilDelivery} 天</span>
                        </div>

                        <div className="text-sm">
                            <span className="text-slate-400">預估交貨當日存量：</span>
                            <span className={`font-bold ${projectedLevelKg < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                                {projectedLevelKg.toFixed(0)} kg
                            </span>
                            {projectedLevelKg <= 0 && (
                                <span className="text-red-500 text-xs ml-2">⚠️ 交貨前可能用盡！</span>
                            )}
                        </div>

                        <div className="border-t border-slate-100 pt-3">
                            <div className="text-sm font-medium text-slate-700 mb-2">入藥後</div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                    存量：
                                    <span className={`font-bold ${exceedsMax ? 'text-red-600' : 'text-emerald-600'}`}>
                                        {afterDeliveryKg.toFixed(0)} kg
                                    </span>
                                </div>
                                <div>
                                    容量：
                                    <span className={`font-bold ${afterDeliveryPercent > 100 ? 'text-red-600' : 'text-slate-700'}`}>
                                        {afterDeliveryPercent.toFixed(1)}%
                                    </span>
                                </div>
                            </div>

                            {exceedsMax && (
                                <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-2 text-sm text-red-700 flex items-center gap-2">
                                    ⚠️ 將超過上限警報 ({maxWarning.toFixed(0)} kg)！
                                </div>
                            )}

                            <div className="mt-2 text-sm">
                                新剩餘天數：
                                <span className="font-bold text-emerald-600">
                                    {newRemainingDays !== null ? `約 ${newRemainingDays} 天` : '-'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-end">
                    <button
                        onClick={onClose}
                        className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                        關閉
                    </button>
                </div>
            </div>
        </div>
    );
};

const DashboardView: React.FC<{ tanks: Tank[], readings: Reading[], onRefresh: () => void, onNavigate?: (tankId: string, month: number, year: number) => void, onLoading?: (loading: boolean) => void, usageCalcWeeks?: number, lowLevelWarningText?: string }> = ({ tanks, readings, onRefresh, onNavigate, onLoading, usageCalcWeeks = 8, lowLevelWarningText = '存量偏低，請叫藥' }) => {
    const [deliveryModalTank, setDeliveryModalTank] = useState<any>(null);

    const tanksWithStatus = useMemo(() => {
        const weeksAgo = Date.now() - usageCalcWeeks * 7 * 24 * 60 * 60 * 1000;

        return tanks.map(tank => {
            const tankReadings = readings.filter(r => r.tankId === tank.id).sort((a, b) => b.timestamp - a.timestamp);
            const lastReading = tankReadings[0];
            const currentVolume = lastReading?.calculatedVolume || 0;
            const currentWeightKg = lastReading?.calculatedWeightKg || 0;
            const currentLevel = lastReading ? (currentVolume / tank.capacityLiters) * 100 : 0;
            // Compare actual level with safeMinLevel (safeMinLevel is now in level units, not %)
            const safeMinLevelCm = tank.inputUnit === 'PERCENT' ? tank.safeMinLevel * 100 : tank.safeMinLevel;
            const isLow = lastReading ? (lastReading.levelCm < safeMinLevelCm) : false;

            // Calculate average daily usage from past N weeks (configurable)
            const recentReadings = tankReadings.filter(r => r.timestamp >= weeksAgo).sort((a, b) => a.timestamp - b.timestamp);
            let avgDailyUsageLiters = 0;
            let avgDailyUsageKg = 0;

            if (recentReadings.length >= 2) {
                // Sum up usage between consecutive readings
                let totalUsageLiters = 0;
                for (let i = 1; i < recentReadings.length; i++) {
                    const prev = recentReadings[i - 1];
                    const curr = recentReadings[i];
                    // Usage = previous volume - current volume + any added amount
                    const usage = prev.calculatedVolume - curr.calculatedVolume + (curr.addedAmountLiters || 0);
                    if (usage > 0) totalUsageLiters += usage;
                }

                // Days covered
                const firstTs = recentReadings[0].timestamp;
                const lastTs = recentReadings[recentReadings.length - 1].timestamp;
                const daysCovered = Math.max(1, (lastTs - firstTs) / (24 * 60 * 60 * 1000));

                avgDailyUsageLiters = totalUsageLiters / daysCovered;
                // Approximate kg using last reading's SG
                const sg = lastReading?.appliedSpecificGravity || 1;
                avgDailyUsageKg = avgDailyUsageLiters * sg;
            }

            // Remaining days
            const remainingDays = avgDailyUsageLiters > 0
                ? Math.floor(currentVolume / avgDailyUsageLiters)
                : null;

            return {
                ...tank,
                currentLevel,
                currentVolume,
                currentWeightKg,
                lastReading,
                isLow,
                avgDailyUsageLiters,
                avgDailyUsageKg,
                remainingDays
            };
        });
    }, [tanks, readings]);

    const groups = useMemo(() => {
        const cooling = tanksWithStatus.filter(t => t.system === SystemType.COOLING);
        const coolingArea1 = cooling.filter(t => {
            if (t.name.includes('CWS-1') || t.name.includes('CT-1')) return true;
            if (t.name.includes('CWS-2') || t.name.includes('CT-2')) return false; // 優先排除 CT-2
            return t.description?.includes('一階');
        });
        const coolingArea2 = cooling.filter(t => {
            if (coolingArea1.some(a1 => a1.id === t.id)) return false;
            if (t.name.includes('CWS-2') || t.name.includes('CT-2')) return true;
            return t.description?.includes('二階');
        });
        const boiler = tanksWithStatus.filter(t => t.system === SystemType.BOILER);
        const denox = tanksWithStatus.filter(t => t.system === SystemType.DENOX);

        // Find remaining cooling tanks that didn't match Area 1 or 2
        const coolingOthers = cooling.filter(t =>
            !coolingArea1.some(a1 => a1.id === t.id) &&
            !coolingArea2.some(a2 => a2.id === t.id)
        );

        return {
            coolingArea1,
            coolingArea2,
            boiler,
            denox,
            others: [
                ...tanksWithStatus.filter(t =>
                    t.system !== SystemType.COOLING &&
                    t.system !== SystemType.BOILER &&
                    t.system !== SystemType.DENOX
                ),
                ...coolingOthers
            ]
        };
    }, [tanksWithStatus]);

    const handleNavigate = (tankId: string) => {
        if (onNavigate) {
            // Pass 0 for month/year to indicate "show all data" (no filter)
            onNavigate(tankId, 0, 0);
        }
    };






    // Drag and Drop Handlers
    const handleDragStart = (e: React.DragEvent, tankId: string, group: string) => {
        e.dataTransfer.setData('tankId', tankId);
        e.dataTransfer.setData('sourceGroup', group);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = async (e: React.DragEvent, targetGroup: string, targetIndex: number, groupTanks: any[]) => {
        e.preventDefault();
        const tankId = e.dataTransfer.getData('tankId');
        const sourceGroup = e.dataTransfer.getData('sourceGroup');

        if (sourceGroup !== targetGroup) return;

        const sourceIndex = groupTanks.findIndex(t => t.id === tankId);
        if (sourceIndex === -1 || sourceIndex === targetIndex) return;

        // Optimistic Reordering locally is hard without local state for tanks, 
        // so we just call API and refresh.
        // Calculate new Sort Orders.
        // We need the full list of tanks in this group to calculate new orders.
        const reordered = [...groupTanks];
        const [moved] = reordered.splice(sourceIndex, 1);
        reordered.splice(targetIndex, 0, moved);

        // Assign new sort indices
        // To verify we don't mess up global sort order, we should probably assign
        // sort orders relative to the group, or just simple integers if we assume groups are disjoint.
        // Since we only sort within Cooling1/Cooling2, and they are distinct sets manually grouped,
        // we can just assign increasing sortOrder. However, global list is sorted by sortOrder.
        // If we have mixed sortOrders (e.g. 0, 0, 0), and we set 0, 1, 2... for this group,
        // it might shift them relative to other groups if they share the same range.
        // BUT the user request says "Design sorting for Cooling System, Phase 1 & 2".
        // It's safest if these tanks have distinct sortOrder values.
        // Let's assume we simply update the sortOrder of *these* tanks to be consistent.
        // A simple strategy: Use Date.now() + index to ensure global uniqueness and order? 
        // Or just index if we filter by group in SQL? SQL logic sorts ALL tanks by sort_order.
        // If we only update this group's tanks to 0, 1, 2... and others are 0, collision happens.
        // Solution: Get the MIN sort_order of the current group (or 0) and re-index from there?
        // Or better: Just give them large spaced numbers?
        // Let's try 1000 * groupIndex + index. 
        // Cooling1: 1000 + index. Cooling2: 2000 + index. 
        // This ensures separation.

        const baseIndex = targetGroup === 'coolingArea1' ? 1000 : 2000;
        const updates = reordered.map((t, idx) => ({
            id: t.id,
            sortOrder: baseIndex + idx
        }));

        await StorageService.reorderTanks(updates);
        onRefresh();
    };

    const lowLevelCount = tanksWithStatus.filter(t => t.isLow).length;

    return (
        <div className="space-y-8 animate-fade-in">
            {lowLevelCount > 0 && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r shadow-sm flex items-center justify-between">
                    <div className="flex items-center text-red-700">
                        <Icons.Alert className="w-5 h-5 mr-2" />
                        <span className="font-bold">系統警示：目前有 {lowLevelCount} 個儲槽液位低於警戒值，請盡速安排補藥。</span>
                    </div>
                </div>
            )}

            <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-sky-50 px-6 py-4 border-b border-sky-100 flex items-center gap-3">
                    <div className="p-2 bg-sky-200 rounded-lg text-sky-700">
                        <Icons.Cooling className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-sky-900">冷卻水系統</h2>
                        <p className="text-xs text-sky-600">Cooling Water System (CWS)</p>
                    </div>
                </div>

                <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center after:content-[''] after:flex-1 after:h-px after:bg-slate-200 after:ml-4">
                            <span className="bg-slate-100 px-2 py-1 rounded text-slate-600">一階桶槽區</span>
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {groups.coolingArea1.map((t, idx) => (
                                <TankStatusCard
                                    key={t.id}
                                    tank={t}
                                    onNavigate={handleNavigate}
                                    onDeliveryClick={setDeliveryModalTank}
                                    lowLevelWarningText={lowLevelWarningText}
                                    dragProps={{
                                        draggable: true,
                                        onDragStart: (e: React.DragEvent) => handleDragStart(e, t.id, 'coolingArea1'),
                                        onDragOver: handleDragOver,
                                        onDrop: (e: React.DragEvent) => handleDrop(e, 'coolingArea1', idx, groups.coolingArea1)
                                    }}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center after:content-[''] after:flex-1 after:h-px after:bg-slate-200 after:ml-4">
                            <span className="bg-slate-100 px-2 py-1 rounded text-slate-600">二階桶槽區</span>
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {groups.coolingArea2.map((t, idx) => (
                                <TankStatusCard
                                    key={t.id}
                                    tank={t}
                                    onNavigate={handleNavigate}
                                    onDeliveryClick={setDeliveryModalTank}
                                    lowLevelWarningText={lowLevelWarningText}
                                    dragProps={{
                                        draggable: true,
                                        onDragStart: (e: React.DragEvent) => handleDragStart(e, t.id, 'coolingArea2'),
                                        onDragOver: handleDragOver,
                                        onDrop: (e: React.DragEvent) => handleDrop(e, 'coolingArea2', idx, groups.coolingArea2)
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <section className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="bg-orange-50 px-6 py-4 border-b border-orange-100 flex items-center gap-3">
                        <div className="p-2 bg-orange-200 rounded-lg text-orange-700">
                            <Icons.Boiler className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-orange-900">鍋爐水系統</h2>
                            <p className="text-xs text-orange-600">Boiler Water System (BWS)</p>
                        </div>
                    </div>
                    <div className="p-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                            {groups.boiler.map(t => <TankStatusCard key={t.id} tank={t} onNavigate={handleNavigate} onDeliveryClick={setDeliveryModalTank} lowLevelWarningText={lowLevelWarningText} />)}
                        </div>
                    </div>
                </section>

                <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="bg-emerald-50 px-6 py-4 border-b border-emerald-100 flex items-center gap-3">
                        <div className="p-2 bg-emerald-200 rounded-lg text-emerald-700">
                            <Icons.DeNOx className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-emerald-900">脫銷系統</h2>
                            <p className="text-xs text-emerald-600">DeNOx (SCR)</p>
                        </div>
                    </div>
                    <div className="p-6">
                        <div className="grid grid-cols-1 gap-4">
                            {groups.denox.map(t => <TankStatusCard key={t.id} tank={t} onNavigate={handleNavigate} onDeliveryClick={setDeliveryModalTank} lowLevelWarningText={lowLevelWarningText} />)}
                        </div>
                    </div>
                </section>
            </div>

            {groups.others.length > 0 && (
                <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center gap-3">
                        <Icons.Factory className="w-5 h-5 text-slate-500" />
                        <h2 className="text-lg font-bold text-slate-700">其他系統</h2>
                    </div>
                    <div className="p-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {groups.others.map(t => <TankStatusCard key={t.id} tank={t} onNavigate={handleNavigate} onDeliveryClick={setDeliveryModalTank} lowLevelWarningText={lowLevelWarningText} />)}
                        </div>
                    </div>
                </section>
            )}

            {/* Delivery Estimation Modal */}
            {deliveryModalTank && (
                <DeliveryEstimationModal
                    tank={deliveryModalTank}
                    onClose={() => setDeliveryModalTank(null)}
                />
            )}
        </div>
    );
};

const DataEntryView: React.FC<{
    tanks: Tank[],
    readings: Reading[],
    onSave: (r: Reading) => void,
    onBatchSave: (rs: Reading[]) => void,
    onUpdateTank: (tank?: Tank) => void;
    onLoading: (loading: boolean) => void;
    appSettings: any;
}> = ({ tanks, readings, onSave, onBatchSave, onUpdateTank, onLoading, appSettings }) => {
    const [selectedTankId, setSelectedTankId] = useState<string>('');
    const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
    // Batch Levels for Type A
    const [batchLevels, setBatchLevels] = useState<{ [key: string]: string }>({});
    const [activeType, setActiveType] = useState<'A' | 'B' | 'C' | 'D'>('A');

    // State for editing history items
    // Allow editingItem to be Reading | ChemicalSupply | CWSParameterRecord | BWSParameterRecord
    const [editingItem, setEditingItem] = useState<any>(null);
    const [editForm, setEditForm] = useState<any>({});
    const [isEditOpen, setIsEditOpen] = useState(false);

    // Anomaly Modal State
    const [importAnomalies, setImportAnomalies] = useState<ImportAnomaly[]>([]);
    const [showAnomalyModal, setShowAnomalyModal] = useState(false);
    const [anomalySource, setAnomalySource] = useState<'IMPORT' | 'MANUAL'>('IMPORT');
    const [pendingReadings, setPendingReadings] = useState<Reading[]>([]);
    const [convertedCountInfo, setConvertedCountInfo] = useState<number>(0);

    const handleConfirmImport = async () => {
        if (pendingReadings.length === 0) return;

        onLoading(true);
        try {
            // Save Anomalies as Alerts
            if (importAnomalies.length > 0) {
                const alertsToSave: Partial<FluctuationAlert>[] = importAnomalies.map(anomaly => {
                    // Find tank ID
                    const tank = tanks.find(t => t.name === anomaly.tankName);
                    return {
                        tankId: tank?.id || 'UNKNOWN',
                        tankName: anomaly.tankName,
                        dateStr: anomaly.date.replace(/\//g, '-'), // Ensure YYYY-MM-DD
                        reason: anomaly.reason,
                        currentValue: anomaly.currentValue,
                        prevValue: anomaly.prevValue,
                        nextValue: anomaly.nextValue,
                        isPossibleRefill: anomaly.isPossibleRefill,
                        source: anomalySource,
                        note: '' // Initial note is empty
                    };
                });
                await StorageService.saveAlertsBatch(alertsToSave);
            }

            if (anomalySource === 'MANUAL') {
                // Manual Entry Saving
                if (pendingReadings.length === 1) {
                    await onSave(pendingReadings[0]);

                    alert('Table A: 液位紀錄已儲存');
                }
            } else {
                // Import Saving
                await onBatchSave(pendingReadings);
                alert(`成功匯入 ${pendingReadings.length} 筆資料${convertedCountInfo > 0 ? ` (其中 ${convertedCountInfo} 筆已自動從百分比換算為公分)` : ''}。`);
            }
        } catch (error) {
            console.error(error);
            alert('儲存失敗 (警報或數據)');
        } finally {
            onLoading(false);
            setShowAnomalyModal(false);
            setPendingReadings([]);
            setImportAnomalies([]);
            onUpdateTank(); // Refresh data after successful import
        }
    };

    const handleCancelImport = () => {
        setShowAnomalyModal(false);
        setPendingReadings([]);
        setImportAnomalies([]);
        // We might want to clear the file input too, but tricky from here without ref to ExcelImportView
    };

    // History State
    const [historySupplies, setHistorySupplies] = useState<ChemicalSupply[]>([]);
    const [historyCWS, setHistoryCWS] = useState<CWSParameterRecord[]>([]);
    const [historyBWS, setHistoryBWS] = useState<BWSParameterRecord[]>([]);
    const [showMoreHistory, setShowMoreHistory] = useState(false); // Shared toggle state

    // File input for Excel import
    const [file, setFile] = useState<File | null>(null);

    // --- PI Import State ---
    const [piBaseUrl, setPiBaseUrl] = useState(() => localStorage.getItem('piWebApiUrl') || 'https://10.122.51.61/piwebapi');
    const [importWeeks, setImportWeeks] = useState(1);
    const [importing, setImporting] = useState(false);
    const [importLogs, setImportLogs] = useState<string[]>([]);

    useEffect(() => {
        localStorage.setItem('piWebApiUrl', piBaseUrl);
    }, [piBaseUrl]);

    // Helper to get Monday
    const getMonday = (d: Date) => {
        d = new Date(d);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const mon = new Date(d.setDate(diff));
        mon.setHours(0, 0, 0, 0);
        return mon;
    };

    const fetchPiValue = async (tagName: string, startTime: string, endTime: string, summaryType: 'Total' | 'Average'): Promise<{ value: number, error?: string }> => {
        try {
            const fetchOptions: RequestInit = { credentials: 'include' };
            // 1. Get Data Servers
            const serversRes = await fetch(`${piBaseUrl}/dataservers`, fetchOptions);
            if (!serversRes.ok) throw new Error("Auth Failed or API unreachable");
            const serversData = await serversRes.json();
            const serverWebId = serversData.Items[0].WebId;
            // 2. Search Point
            const searchRes = await fetch(`${piBaseUrl}/dataservers/${serverWebId}/points?nameFilter=${tagName}`, fetchOptions);
            const searchData = await searchRes.json();
            if (!searchData.Items || searchData.Items.length === 0) return { value: 0, error: "Tag Not Found" };
            const webId = searchData.Items[0].WebId;
            // 3. Get Summary
            const summaryUrl = `${piBaseUrl}/streams/${webId}/summary?startTime=${startTime}&endTime=${endTime}&summaryType=${summaryType}`;
            const summaryRes = await fetch(summaryUrl, fetchOptions);
            if (!summaryRes.ok) return { value: 0, error: `Summary Failed` };
            const summaryData = await summaryRes.json();
            const item = summaryData.Items ? summaryData.Items[0] : summaryData;
            let rawVal = item.Value;
            if (typeof rawVal === 'object' && rawVal !== null && rawVal.Value !== undefined) rawVal = rawVal.Value;
            const num = Number(rawVal);
            return { value: isNaN(num) ? 0 : num };
        } catch (e: any) {
            return { value: 0, error: e.message || String(e) };
        }
    };

    const handleBatchImportBWS = async () => {
        if (!confirm(`確定要匯入「近 ${importWeeks} 週」的數據至資料庫嗎？\n這將寫入所有鍋爐儲槽的生產參數。`)) return;
        setImporting(true);
        // onLoading(true); // Disabled as per user request
        setImportLogs([]);
        const addLog = (msg: string) => setImportLogs(prev => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
        try {
            addLog("開始初始化...");
            const currentWeekMonday = getMonday(new Date());
            const targetWeeks = [];
            for (let i = 1; i <= importWeeks; i++) {
                const endDate = new Date(currentWeekMonday);
                endDate.setDate(currentWeekMonday.getDate() - (7 * (i - 1)));
                const startDate = new Date(endDate);
                startDate.setDate(endDate.getDate() - 7);
                targetWeeks.push({ start: startDate, end: endDate });
            }
            targetWeeks.reverse();
            addLog(`準備處理 ${targetWeeks.length} 個週次...`);

            const boilerTanks = tanks.filter(t => t.system === SystemType.BOILER);

            for (const week of targetWeeks) {
                const startStr = week.start.toISOString().split('T')[0] + 'T00:00:00';
                const endStr = week.end.toISOString().split('T')[0] + 'T00:00:00';
                addLog(`處理週次: ${week.start.toLocaleDateString()} ~ ${week.end.toLocaleDateString()}`);

                let weekTotalSum = 0;
                for (const tag of BWS_TAGS) {
                    const result = await fetchPiValue(tag, startStr, endStr, 'Total');
                    if (result.error) addLog(`    [Error] ${tag}: ${result.error}`);
                    weekTotalSum += result.value;
                }
                const safeTotal = Math.round(weekTotalSum * 24);
                addLog(`  -> 總和: ${safeTotal}`);
                const dateTs = week.start.getTime();
                let saveCount = 0;
                for (const tank of boilerTanks) {
                    const record: BWSParameterRecord = {
                        id: generateUUID(),
                        tankId: tank.id,
                        steamProduction: safeTotal,
                        date: dateTs
                    };
                    const history = await StorageService.getBWSParamsHistory(tank.id);
                    const existing = history.find(h => h.date === dateTs);
                    if (existing) {
                        await StorageService.updateBWSParamRecord({ ...existing, steamProduction: safeTotal });
                    } else {
                        await StorageService.saveBWSParam(record);
                    }
                    saveCount++;
                }
                addLog(`  -> 已更新 ${saveCount} 個儲槽`);
            }
            addLog("完成");
            await loadHistory();
        } catch (e: any) {
            addLog(`錯誤: ${e.message}`);
        } finally {
            setImporting(false);
            // onLoading(false); // Disabled as per user request
        }
    };

    const handleBatchImportCWS = async () => {
        if (!confirm(`確定要匯入「近 ${importWeeks} 週」的數據至資料庫嗎？\n這將寫入冷卻水系統的循環量與溫度參數。`)) return;

        setImporting(true);
        // onLoading(true); // Disabled as per user request
        setImportLogs([]);
        const addLog = (msg: string) => setImportLogs(prev => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
        try {
            addLog("開始 CWS 資料匯入...");
            const cwsTanks = tanks.filter(t => t.system === SystemType.COOLING);
            const ct1Tanks = cwsTanks.filter(t => t.name.includes('CWS-1') || t.name.includes('CT-1') || (t.description || '').includes('一階'));
            const ct2Tanks = cwsTanks.filter(t => !ct1Tanks.find(ct1 => ct1.id === t.id));
            addLog(`偵測到 CT-1: ${ct1Tanks.length}, CT-2: ${ct2Tanks.length}`);

            const currentWeekMonday = getMonday(new Date());
            const targetWeeks = [];
            for (let i = 1; i <= importWeeks; i++) {
                const endDate = new Date(currentWeekMonday);
                endDate.setDate(currentWeekMonday.getDate() - (7 * (i - 1)));
                const startDate = new Date(endDate);
                startDate.setDate(endDate.getDate() - 7);
                targetWeeks.push({ start: startDate, end: endDate });
            }
            targetWeeks.reverse();

            const fetchAreaData = async (areaKey: 'CT-1' | 'CT-2', start: string, end: string) => {
                const config = CWS_TAGS_CONFIG[areaKey];
                let flowSum = 0;
                for (const tag of config.flow) {
                    const r = await fetchPiValue(tag, start, end, 'Average');
                    if (r.error) addLog(`  [Warn] ${tag}: ${r.error}`);
                    flowSum += r.value;
                }
                let tOutSum = 0, tOutCount = 0;
                for (const tag of config.tempOut) {
                    const r = await fetchPiValue(tag, start, end, 'Average');
                    if (!r.error) { tOutSum += r.value; tOutCount++; }
                }
                const tOut = tOutCount > 0 ? tOutSum / tOutCount : 0;
                let tRetSum = 0, tRetCount = 0;
                for (const tag of config.tempRet) {
                    const r = await fetchPiValue(tag, start, end, 'Average');
                    if (!r.error) { tRetSum += r.value; tRetCount++; }
                }
                const tRet = tRetCount > 0 ? tRetSum / tRetCount : 0;
                return { circulationRate: flowSum, tempOutlet: tOut, tempReturn: tRet, tempDiff: tRet - tOut };
            };

            for (const week of targetWeeks) {
                const startStr = week.start.toISOString().split('T')[0] + 'T00:00:00';
                const endStr = week.end.toISOString().split('T')[0] + 'T00:00:00';
                const dateTs = week.start.getTime();
                addLog(`處理週次: ${week.start.toLocaleDateString()}`);

                if (ct1Tanks.length > 0) {
                    const d1 = await fetchAreaData('CT-1', startStr, endStr);
                    for (const tank of ct1Tanks) {
                        const history = await StorageService.getCWSParamsHistory(tank.id);
                        const existing = history.find(h => h.date === dateTs);
                        const cwsHardness = existing?.cwsHardness || 0;
                        const makeupHardness = existing?.makeupHardness || 0;
                        const cycles = makeupHardness > 0 ? cwsHardness / makeupHardness : 1;
                        const record: CWSParameterRecord = {
                            id: existing?.id || generateUUID(),
                            tankId: tank.id,
                            date: dateTs,
                            circulationRate: d1.circulationRate,
                            tempOutlet: d1.tempOutlet,
                            tempReturn: d1.tempReturn,
                            tempDiff: d1.tempDiff,
                            cwsHardness: cwsHardness,
                            makeupHardness: makeupHardness,
                            concentrationCycles: cycles
                        };
                        await StorageService.saveCWSParam(record);
                    }
                    addLog(`  -> Updated CT-1`);
                }
                if (ct2Tanks.length > 0) {
                    const d2 = await fetchAreaData('CT-2', startStr, endStr);
                    for (const tank of ct2Tanks) {
                        const history = await StorageService.getCWSParamsHistory(tank.id);
                        const existing = history.find(h => h.date === dateTs);
                        const cwsHardness = existing?.cwsHardness || 0;
                        const makeupHardness = existing?.makeupHardness || 0;
                        const cycles = makeupHardness > 0 ? cwsHardness / makeupHardness : 1;
                        const record: CWSParameterRecord = {
                            id: existing?.id || generateUUID(),
                            tankId: tank.id,
                            date: dateTs,
                            circulationRate: d2.circulationRate,
                            tempOutlet: d2.tempOutlet,
                            tempReturn: d2.tempReturn,
                            tempDiff: d2.tempDiff,
                            cwsHardness: cwsHardness,
                            makeupHardness: makeupHardness,
                            concentrationCycles: cycles
                        };
                        await StorageService.saveCWSParam(record);
                    }
                    addLog(`  -> Updated CT-2`);
                }
            }
            addLog("完成");
            await loadHistory();
        } catch (e: any) {
            addLog(`錯誤: ${e.message}`);
        } finally {
            setImporting(false);
            // onLoading(false); // Disabled as per user request
        }
    };

    // Initial Tanks Effect - select first one
    useEffect(() => {
        if (tanks.length > 0 && !selectedTankId) {
            setSelectedTankId(tanks[0].id);
        }
    }, [tanks]);

    // Fetch History Effect
    const loadHistory = useCallback(async () => {
        if (!selectedTankId) return;

        // Always fetch ALL history types for the selected tank to ensure Analysis charts work correctly
        // regardless of which "Manual Entry" tab is active.
        try {
            // Type B (Global or Filtered? Service gets all, we sort/filter here)
            const supplies = await StorageService.getSupplies();
            const filteredSupplies = supplies.filter(s => s.tankId === selectedTankId);
            setHistorySupplies(filteredSupplies.sort((a, b) => b.startDate - a.startDate));

            // Type C
            const cwsData = await StorageService.getCWSParamsHistory(selectedTankId);
            setHistoryCWS(cwsData);

            // Type D
            const bwsData = await StorageService.getBWSParamsHistory(selectedTankId);
            setHistoryBWS(bwsData);

        } catch (error) {
            console.error("Failed to load history:", error);
        }
    }, [selectedTankId]);

    // Fetch History Effect
    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const [operator, setOperator] = useState<string>('');
    const [activeSupply, setActiveSupply] = useState<ChemicalSupply | undefined>(undefined);
    const [lastReadingSG, setLastReadingSG] = useState<number | null>(null);
    const [newSupply, setNewSupply] = useState<Partial<ChemicalSupply>>({});
    const [cwsInput, setCwsInput] = useState<Partial<CWSParameterRecord> & { dateStr?: string }>({ dateStr: new Date().toISOString().split('T')[0] });
    const [bwsInput, setBwsInput] = useState<Partial<BWSParameterRecord> & { dateStr?: string }>({ dateStr: new Date().toISOString().split('T')[0] });

    const selectedTank = tanks.find(t => t.id === selectedTankId);


    useEffect(() => {
        const loadActiveSupply = async () => {
            if (activeType === 'A' && selectedTankId && date) {
                const timestamp = new Date(date).getTime();
                const supply = await StorageService.getActiveSupply(selectedTankId, timestamp);
                setActiveSupply(supply || undefined);

                const tankReadings = readings
                    .filter(r => r.tankId === selectedTankId && r.timestamp < timestamp)
                    .sort((a, b) => b.timestamp - a.timestamp);

                if (tankReadings.length > 0) {
                    setLastReadingSG(tankReadings[0].appliedSpecificGravity);
                } else {
                    setLastReadingSG(null);
                }
            }
        };
        loadActiveSupply();
    }, [selectedTankId, date, readings, activeType]);

    // Pre-fill CWS Input from History when Date/Tank changes
    useEffect(() => {
        if (activeType === 'C' && selectedTankId && date) {
            const timestamp = getNormalizedTimestamp(date);
            if (timestamp && historyCWS.length > 0) {
                const existing = historyCWS.find(h => h.date === timestamp);
                if (existing) {
                    // Found existing record (e.g. from PI Import)
                    setCwsInput(prev => ({
                        ...prev,
                        ...existing,
                        dateStr: date // Ensure dateStr is kept
                    }));
                    return;
                }
            }
            // Reset if no existing record found (but keep date/tankId implicit)
            setCwsInput({ dateStr: date });
        }
    }, [activeType, selectedTankId, date, historyCWS]);

    // Anomaly Detection Helper
    const detectReadingAnomaly = (tank: Tank, newReading: Reading, existingReadings: Reading[]): ImportAnomaly | null => {
        // Merge and sort
        const allReadings = [...existingReadings, newReading].sort((a, b) => a.timestamp - b.timestamp);
        const idx = allReadings.findIndex(r => r.id === newReading.id);
        if (idx === -1) return null;

        const prev = idx > 0 ? allReadings[idx - 1] : null;
        const next = idx < allReadings.length - 1 ? allReadings[idx + 1] : null;

        // Calculate Capacity
        let tankCapacity = tank.capacityLiters > 0 ? tank.capacityLiters : 0;
        if (tankCapacity === 0 && tank.dimensions?.height) {
            tankCapacity = calculateTankVolume(tank, tank.dimensions.height);
        }
        if (tankCapacity === 0) tankCapacity = 10000;

        const thresholdPercent = tank.validationThreshold ?? 30; // Default 30% if not set
        const dailyThreshold = tankCapacity * (thresholdPercent / 100);

        let anomalyReason = null;

        if (prev) {
            const daysDiff = (newReading.timestamp - prev.timestamp) / (1000 * 60 * 60 * 24);
            if (daysDiff > 0) {
                const addedAmount = newReading.addedAmountLiters || 0;
                // Calculate consumption (positive means consumption, negative means level rose)
                const levelChange = (prev.calculatedVolume + addedAmount) - newReading.calculatedVolume;
                const dailyChange = Math.abs(levelChange) / daysDiff;

                // 判斷是否為「可能補藥」：液位上升（levelChange < 0）且超過閾值12倍以上
                const isPossibleRefill = levelChange < 0 && dailyChange > dailyThreshold * 12;

                // Check for abnormal consumption rate
                if (dailyChange > dailyThreshold) {
                    if (isPossibleRefill) {
                        const warnText = appSettings?.possibleRefillText || '可能為補藥紀錄';
                        // Refill warning usually doesn't have format variables in current logic, but we can support if user asks. Current logic just appends label.
                        // Wait, user asked for "可能為補藥警告" to ALSO be a template.
                        // The user's example: "液位異常上升超過閾值數倍，判斷可能為入藥"
                        // If they want variables, we should pass them.
                        // Let's pass diff if applicable? Refill condition: levelChange < 0 (meaning 'added' in current logic? No, check calc mechanism).
                        // In `detectReadingAnomaly`: levelChange = prevLevel - currentLevel. If negative, implies current > prev (Refill).
                        // dailyChange is absolute.

                        // Actually, for Refill, the user might just want text.
                        // But to be consistent, let's allow formatting if they put {diff} etc.
                        anomalyReason = formatAnomalyMessage(warnText, {
                            text: '可能為補藥紀錄',
                            diff: dailyChange.toFixed(0),
                            limit: dailyThreshold.toFixed(0),
                            unit: 'L'
                        });
                    } else {
                        const warnText = appSettings?.thresholdWarningText || '液位變化異常，請確認 ({diff} {unit} > {limit} {unit})';
                        anomalyReason = formatAnomalyMessage(warnText, {
                            text: '液位變化異常，請確認',
                            diff: dailyChange.toFixed(0),
                            limit: dailyThreshold.toFixed(0),
                            unit: 'L'
                        });
                    }
                    return {
                        id: newReading.id,
                        tankId: tank.id,
                        date: new Date(newReading.timestamp).toLocaleDateString(),
                        tankName: tank.name,
                        reason: anomalyReason,
                        currentValue: newReading.calculatedVolume,
                        prevDate: prev ? new Date(prev.timestamp).toLocaleDateString() : undefined,
                        prevValue: prev ? prev.calculatedVolume : undefined,
                        nextDate: next ? new Date(next.timestamp).toLocaleDateString() : undefined,
                        nextValue: next ? next.calculatedVolume : undefined,
                        isPossibleRefill
                    };
                }
            }
        }
        return null;
    };

    const handleSubmitReadings = async (e: React.FormEvent) => {
        e.preventDefault();

        const entries = Object.entries(batchLevels);
        if (entries.length === 0) {
            alert('請至少輸入一個液位數值');
            return;
        }

        onLoading(true);
        try {
            let savedCount = 0;
            // Pre-fetch supplies map could be optimizing, but sequentially is safer/easier for now
            const timestamp = new Date(date).getTime();

            for (const [tId, valStr] of entries) {
                if (!valStr) continue;

                const tank = tanks.find(t => t.id === tId);
                if (!tank) continue;

                // Get Active Supply for SG
                const activeSup = await StorageService.getActiveSupply(tId, timestamp);
                // Prioritize active supply SG, else 1.0. (Ignoring last reading SG to keep batch logic simple/consistent)
                const finalSG = activeSup?.specificGravity || 1.0;

                let finalLevelCm = parseFloat(valStr as string);

                // Unit Conversion
                if (tank.inputUnit === 'PERCENT') {
                    // Meters Input -> cm
                    finalLevelCm = finalLevelCm * 100;
                }

                const vol = calculateTankVolume(tank, finalLevelCm);
                const weight = vol * finalSG;

                const newReading: Reading = {
                    id: generateUUID(),
                    tankId: tId,
                    timestamp: timestamp,
                    levelCm: finalLevelCm,
                    calculatedVolume: vol,
                    calculatedWeightKg: weight,
                    appliedSpecificGravity: finalSG,
                    supplyId: activeSup?.id,
                    addedAmountLiters: 0, // No refill calc in batch manual
                    operatorName: operator
                };

                await onSave(newReading);
                savedCount++;
            }

            setBatchLevels({}); // Clear inputs
            alert(`已成功儲存 ${savedCount} 筆液位紀錄`);
        } catch (e) {
            console.error(e);
            alert('批次儲存部分或全部失敗');
        } finally {
            onLoading(false);
        }
    };

    const handleSubmitContract = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newSupply.tankId || !newSupply.supplierName || !newSupply.specificGravity || !newSupply.startDate) {
            alert("請填寫所有必要欄位");
            return;
        }

        // 取得所選儲槽以檢查比重範圍
        const selectedTank = tanks.find(t => t.id === newSupply.tankId);
        if (selectedTank) {
            const sg = Number(newSupply.specificGravity);
            const minSG = selectedTank.sgRangeMin;
            const maxSG = selectedTank.sgRangeMax;

            if ((minSG !== undefined && sg < minSG) || (maxSG !== undefined && sg > maxSG)) {
                const rangeStr = minSG !== undefined && maxSG !== undefined
                    ? `${minSG} ~ ${maxSG}`
                    : minSG !== undefined ? `≥ ${minSG}` : `≤ ${maxSG}`;
                if (!confirm(`警告：輸入的比重 ${sg} 超出此儲槽的合格比重範圍 (${rangeStr})！\n\n確定要繼續儲存嗎？`)) {
                    return;
                }
            }
        }

        // Fetch all supplies for validation and inheritance
        onLoading(true);
        try {
            const allSupplies = await StorageService.getSupplies();

            // Check for inheritance if targetPpm is missing
            let finalTargetPpm = newSupply.targetPpm ? Number(newSupply.targetPpm) : undefined;
            if (finalTargetPpm === undefined) {
                const tankSupplies = allSupplies
                    .filter(s => s.tankId === newSupply.tankId)
                    .sort((a, b) => b.startDate - a.startDate); // Latest first

                if (tankSupplies.length > 0) {
                    finalTargetPpm = tankSupplies[0].targetPpm;
                }
            }

            // Check for existing supply on the same day to prevent duplicates
            const sameDaySupply = allSupplies.find(s =>
                s.tankId === newSupply.tankId &&
                s.startDate === new Date(newSupply.startDate as any).getTime()
            );

            let savedSupply: ChemicalSupply;

            if (sameDaySupply) {
                if (!confirm(`該儲槽在 ${newSupply.startDate} 已有合約紀錄，確定要覆蓋嗎？`)) return;

                savedSupply = {
                    ...sameDaySupply, // Keep ID
                    supplierName: newSupply.supplierName,
                    chemicalName: newSupply.chemicalName || '',
                    specificGravity: Number(newSupply.specificGravity),
                    price: newSupply.price ? Number(newSupply.price) : undefined,
                    notes: newSupply.notes,
                    targetPpm: finalTargetPpm
                };
                await StorageService.updateSupply(savedSupply);
                alert(`已更新現有的合約紀錄`);
            } else {
                savedSupply = {
                    id: generateUUID(),
                    tankId: newSupply.tankId!,
                    supplierName: newSupply.supplierName,
                    chemicalName: newSupply.chemicalName || '',
                    specificGravity: Number(newSupply.specificGravity),
                    price: newSupply.price ? Number(newSupply.price) : undefined,
                    startDate: new Date(newSupply.startDate as any).getTime(),
                    notes: newSupply.notes,
                    targetPpm: finalTargetPpm
                };
                await StorageService.saveSupply(savedSupply);
                alert(`已新增合約紀錄`);
            }

            // 自動重新計算該儲槽相關的液位紀錄比重
            const supplyStartDate = savedSupply.startDate;
            let sgUpdatedCount = 0;
            for (const reading of readings) {
                // 只處理同一儲槽且日期 >= 合約生效日的紀錄
                if (reading.tankId === savedSupply.tankId && reading.timestamp >= supplyStartDate) {
                    const activeSupply = await StorageService.getActiveSupply(reading.tankId, reading.timestamp);
                    if (activeSupply && activeSupply.specificGravity !== reading.appliedSpecificGravity) {
                        const tank = tanks.find(t => t.id === reading.tankId);
                        if (tank) {
                            const vol = calculateTankVolume(tank, reading.levelCm);
                            await StorageService.updateReading({
                                ...reading,
                                appliedSpecificGravity: activeSupply.specificGravity,
                                calculatedWeightKg: vol * activeSupply.specificGravity,
                                supplyId: activeSupply.id
                            });
                            sgUpdatedCount++;
                        }
                    }
                }
            }

            if (sgUpdatedCount > 0) {
                onUpdateTank(); // 觸發刷新
            }

            setNewSupply({});
            loadHistory();
            alert(`Table B: 合約紀錄處理完成${sgUpdatedCount > 0 ? `，並更新 ${sgUpdatedCount} 筆液位紀錄的比重` : ''}`);
        } catch (e) {
            console.error(e);
            alert('儲存失敗');
        } finally {
            onLoading(false);
        }
    }

    // Helper: Normalize date string "YYYY-MM-DD" or "YYYY/MM/DD" to timestamp at Local Midnight
    // This ensures consistency between Manual Input and Excel Import for "Same Day" checks
    // MOVED TO GLOBAL SCOPE

    const handleSubmitCWS = async (e: React.FormEvent) => {
        e.preventDefault();
        // Here tankId might be "CT-1", "CT-2" or specific tank ID (legacy support)
        const selectedAreaOrTank = cwsInput.tankId;
        if (!selectedAreaOrTank || !cwsInput.dateStr) return;

        try {
            onLoading(true);
            const tempOutlet = Number(cwsInput.tempOutlet) || 0;
            const tempReturn = Number(cwsInput.tempReturn) || 0;
            const cwsHardness = Number(cwsInput.cwsHardness) || 0;
            const makeupHardness = Number(cwsInput.makeupHardness) || 0;

            // 自動計算溫差
            const tempDiff = tempReturn - tempOutlet;

            // 自動計算濃縮倍數
            const concentrationCycles = (makeupHardness > 0) ? cwsHardness / makeupHardness : 1;

            // Determine target tanks
            let targetTanks: Tank[] = [];
            if (selectedAreaOrTank === 'CT-1' || selectedAreaOrTank === 'CT-2') {
                targetTanks = tanks.filter(t =>
                    t.system === SystemType.COOLING &&
                    t.name.trim().toUpperCase().startsWith(selectedAreaOrTank)
                );
            } else {
                const singleTank = tanks.find(t => t.id === selectedAreaOrTank);
                if (singleTank) targetTanks = [singleTank];
            }

            if (targetTanks.length === 0) {
                alert('找不到對應的儲槽');
                return;
            }

            for (const tank of targetTanks) {
                await StorageService.saveCWSParam({
                    tankId: tank.id,
                    circulationRate: Number(cwsInput.circulationRate) || 0,
                    tempDiff: tempDiff,
                    cwsHardness: cwsHardness,
                    makeupHardness: makeupHardness,
                    concentrationCycles: concentrationCycles,
                    tempOutlet: tempOutlet,
                    tempReturn: tempReturn,
                    // Use normalized timestamp
                    date: getNormalizedTimestamp(cwsInput.dateStr)
                });
            }


            await loadHistory();
            setCwsInput({ ...cwsInput, circulationRate: undefined, tempDiff: undefined, cwsHardness: undefined, makeupHardness: undefined, tempOutlet: undefined, tempReturn: undefined }); // partial reset
            alert(`已更新 ${targetTanks.length} 個儲槽的 CWS 參數`);
        } catch (error) {
            console.error(error);
            alert('更新失敗');
        } finally {
            onLoading(false);
        }
    };


    const handleSubmitBWS = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!bwsInput.tankId || !bwsInput.dateStr) return;

        try {
            onLoading(true);
            await StorageService.saveBWSParam({
                tankId: bwsInput.tankId,
                steamProduction: Number(bwsInput.steamProduction) || 0,
                // targetPpm removed from input, defaulting to 0 or handled by migration
                // We keep the field optional in type but don't save it from input
                // Or better: The backend might still expect it? The type definition says optional?
                // Let's assume we just don't send it or send undefined.
                // For safety, checks if the backend needs it.
                // Assuming backend update isn't needed immediately if we just stop sending it or send 0.
                date: getNormalizedTimestamp(bwsInput.dateStr) || Date.now()
            });
            onUpdateTank();
            await loadHistory();
            setBwsInput({ ...bwsInput, steamProduction: undefined }); // partial reset
            alert('已更新 BWS 參數');
        } catch (error) {
            console.error(error);
            alert('更新失敗');
        } finally {
            onLoading(false);
        }
    };

    const processExcel = async () => {
        if (!file) return;

        try {
            onLoading(true);
            const rawJsonData = await readExcelFile(file);
            // 1. Normalize keys (Trim whitespace)
            const jsonData = rawJsonData.map((row: any) => {
                const newRow: any = {};
                Object.keys(row).forEach(key => {
                    newRow[key.trim()] = row[key];
                });
                return newRow;
            });

            let successCount = 0;
            let failCount = 0; // Track skipped records
            let sgUpdatedCount = 0; // 追蹤比重更新的筆數
            let convertedCount = 0; // Track % conversions
            const updatedTanks: Tank[] = []; // To trigger onUpdateTank for affected tanks

            // 偵錯輸出
            console.log('=== Excel 匯入偵錯 ===');
            console.log('讀取到的資料筆數:', jsonData.length);
            if (jsonData.length > 0) {
                console.log('第一筆資料的欄位 (keys):', Object.keys(jsonData[0]));
                console.log('第一筆資料:', jsonData[0]);
            }
            console.log('系統中的儲槽名稱:', tanks.map(t => t.name));

            if (activeType === 'A') {

                const newReadings: Reading[] = [];
                for (const row of jsonData) {
                    const tankName = row['儲槽名稱'] || row['TankName'] || row['儲槽'];
                    if (!tankName) continue;
                    const targetTank = tanks.find(t => t.name.trim() === String(tankName).trim());
                    if (!targetTank) continue;

                    const keys = Object.keys(row);
                    const i = jsonData.indexOf(row);
                    for (const key of keys) {
                        const readingDate = parseDateKey(key);
                        if (readingDate) {
                            const levelVal = row[key];
                            if (levelVal !== undefined && levelVal !== '' && !isNaN(Number(levelVal))) {
                                // Important: Use normalized timestamp (Midnight)
                                const timestamp = getNormalizedTimestamp(readingDate);

                                if (!timestamp) {
                                    console.warn(`[Skip] Row ${i + 1} Col ${key}: 無效日期`);
                                    failCount++;
                                    continue;
                                }

                                // Check future
                                if (timestamp > Date.now()) {
                                    console.warn(`[Skip] Row ${i + 1} Col ${key}: 未來日期 ${new Date(timestamp).toLocaleDateString()}`);
                                    failCount++;
                                    continue;
                                }

                                let lvl = parseFloat(levelVal);

                                // Enhanced Percentage Detection logic
                                const valStr = String(levelVal).trim();
                                const hasPercentSign = valStr.includes('%');
                                const isPercentMode = targetTank.inputUnit === 'PERCENT';

                                if (isPercentMode || hasPercentSign) {
                                    // Interpret as Meters -> CM (e.g. 1.3 -> 130cm)
                                    // This applies to both manual "1.3%" (excel formatting) or "1.3" (raw number)
                                    // We multiply by 100.
                                    lvl = lvl * 100;
                                    convertedCount++;
                                }


                                const supply = await StorageService.getActiveSupply(targetTank.id, timestamp);
                                const sg = supply?.specificGravity || 1.0;
                                const vol = calculateTankVolume(targetTank, lvl);

                                // 這裡加入檢查邏輯：是否已經有同一天、同一個儲槽的紀錄？
                                // 如果有，沿用該 ID 以達成「覆蓋」效果 (搭配後端 upsert)
                                const existingReading = readings.find(r =>
                                    r.tankId === targetTank.id &&
                                    new Date(r.timestamp).toDateString() === new Date(timestamp).toDateString()
                                );

                                newReadings.push({
                                    id: existingReading ? existingReading.id : generateUUID(), // 若存在則沿用 ID
                                    tankId: targetTank.id,
                                    timestamp: timestamp,
                                    levelCm: lvl,
                                    calculatedVolume: vol,
                                    calculatedWeightKg: vol * sg,
                                    appliedSpecificGravity: sg,
                                    supplyId: supply?.id,
                                    addedAmountLiters: existingReading ? existingReading.addedAmountLiters : 0, // 保留原有的加藥量設定
                                    operatorName: 'Batch Import'
                                });
                                successCount++;
                            }
                        }
                    }
                }

                if (newReadings.length > 0) {
                    // === 液位合理性檢查 ===
                    const anomalies: ImportAnomaly[] = [];

                    // Group by tank for validation
                    const tankGroups = new Map<string, Reading[]>();
                    newReadings.forEach(r => {
                        if (!tankGroups.has(r.tankId)) tankGroups.set(r.tankId, []);
                        tankGroups.get(r.tankId)!.push(r);
                    });

                    tankGroups.forEach((tankNewReadings, tankId) => {
                        const tank = tanks.find(t => t.id === tankId);
                        if (!tank) return;

                        // Combine existing + new readings for this tank, sorted by date
                        const existingTankReadings = readings
                            .filter(r => r.tankId === tankId)
                            .sort((a, b) => a.timestamp - b.timestamp);

                        // Merge for analysis
                        // Note: newReadings might overwrite existing ones on same day.
                        // We need a consolidated list where same-day readings are replaced by new ones.
                        const consolidatedMap = new Map<number, Reading>();
                        existingTankReadings.forEach(r => consolidatedMap.set(r.timestamp, r));
                        tankNewReadings.forEach(r => consolidatedMap.set(r.timestamp, r));

                        const allReadings = Array.from(consolidatedMap.values())
                            .sort((a, b) => a.timestamp - b.timestamp);

                        // Calculate tank capacity for threshold (use volume if available)
                        // Priority: 1. Defined Capacity -> 2. Calculated from Height -> 3. Default
                        let tankCapacity = tank.capacityLiters > 0 ? tank.capacityLiters : 0;
                        if (tankCapacity === 0 && tank.dimensions?.height) {
                            tankCapacity = calculateTankVolume(tank, tank.dimensions.height);
                        }
                        if (tankCapacity === 0) tankCapacity = 10000; // Default 10000L if unknown
                        const thresholdPercent = tank.validationThreshold ?? 30; // Use tank setting or default 30%
                        const dailyThreshold = tankCapacity * (thresholdPercent / 100);

                        // Check each new reading against its predecessor/successor
                        for (const newReading of tankNewReadings) {
                            const idx = allReadings.findIndex(r => r.id === newReading.id);
                            if (idx === -1) continue;

                            let anomalyReason = null;
                            const prev = idx > 0 ? allReadings[idx - 1] : null;
                            const next = idx < allReadings.length - 1 ? allReadings[idx + 1] : null;

                            // 1. Check vs Prev
                            if (prev) {
                                const daysDiff = (newReading.timestamp - prev.timestamp) / (1000 * 60 * 60 * 24);
                                if (daysDiff > 0) {
                                    const addedAmount = newReading.addedAmountLiters || 0;
                                    const levelChange = (prev.calculatedVolume + addedAmount) - newReading.calculatedVolume;
                                    const dailyChange = Math.abs(levelChange) / daysDiff;

                                    if (dailyChange > dailyThreshold) {
                                        // 判斷是否為「可能補藥」：液位上升（levelChange < 0）且超過閾值12倍以上
                                        const isPossibleRefill = levelChange < 0 && dailyChange > dailyThreshold * 12;
                                        // Use SG from the reading to display Kg
                                        const sg = newReading.appliedSpecificGravity || 1.0;
                                        const dailyChangeKg = dailyChange * sg;
                                        const dailyThresholdKg = dailyThreshold * sg;

                                        console.log('[AnomalyCheck]', {
                                            tank: tank.name,
                                            isPossibleRefill,
                                            settings: appSettings,
                                            refillText: appSettings?.possibleRefillText,
                                            warnText: appSettings?.thresholdWarningText
                                        });

                                        if (isPossibleRefill) {
                                            const warnText = appSettings?.possibleRefillText || '可能為補藥紀錄';
                                            anomalyReason = formatAnomalyMessage(warnText, {
                                                text: '可能為補藥紀錄',
                                                diff: dailyChangeKg.toFixed(0),
                                                limit: dailyThresholdKg.toFixed(0),
                                                unit: 'kg'
                                            });
                                        } else {
                                            const warnText = appSettings?.thresholdWarningText || '液位變化異常，請確認 ({diff} {unit} > {limit} {unit})';
                                            anomalyReason = formatAnomalyMessage(warnText, {
                                                text: '液位變化異常，請確認',
                                                diff: dailyChangeKg.toFixed(0),
                                                limit: dailyThresholdKg.toFixed(0),
                                                unit: 'kg'
                                            });
                                        }

                                        anomalies.push({
                                            id: newReading.id,
                                            tankId: tank.id,
                                            date: new Date(newReading.timestamp).toLocaleDateString(),
                                            tankName: tank.name,
                                            reason: anomalyReason,
                                            currentValue: newReading.calculatedVolume,
                                            prevDate: prev ? new Date(prev.timestamp).toLocaleDateString() : undefined,
                                            prevValue: prev ? prev.calculatedVolume : undefined,
                                            nextDate: next ? new Date(next.timestamp).toLocaleDateString() : undefined,
                                            nextValue: next ? next.calculatedVolume : undefined,
                                            isPossibleRefill
                                        });
                                    }
                                }
                            }
                        }
                    });

                    // Show warning modal if any issues found
                    if (anomalies.length > 0) {
                        // 排序異常列表：先按日期，再按儲槽名稱
                        anomalies.sort((a, b) => {
                            // 先按日期排序
                            const dateA = new Date(a.date.replace(/\//g, '-')).getTime();
                            const dateB = new Date(b.date.replace(/\//g, '-')).getTime();
                            if (dateA !== dateB) return dateA - dateB;
                            // 日期相同則按儲槽名稱排序
                            return a.tankName.localeCompare(b.tankName, 'zh-TW');
                        });
                        setImportAnomalies(anomalies);
                        setPendingReadings(newReadings);
                        setConvertedCountInfo(convertedCount);
                        setShowAnomalyModal(true);
                        onLoading(false); // Stop loading to show modal
                        return; // Stop here, wait for user confirmation
                    }

                    await onBatchSave(newReadings);
                    alert(`成功匯入 ${newReadings.length} 筆資料${convertedCount > 0 ? ` (其中 ${convertedCount} 筆已自動從百分比換算為公分)` : ''}。`);
                }
            } else if (activeType === 'B') {
                const newSupplies: ChemicalSupply[] = [];
                const updatesToPerform: ChemicalSupply[] = [];
                // Pre-fetch existing supplies for inheritance and duplicate check
                const existingSupplies = await StorageService.getSupplies();

                for (const row of jsonData) {
                    const dateRaw = row['生效日期'] || row['Date'];
                    const supplier = row['供應商'] || row['Supplier'];
                    const chem = row['藥劑名稱'] || row['Chemical'];
                    const tankName = row['適用儲槽'] || row['儲槽名稱'] || row['Tank'] || row['儲槽'];
                    const sg = row['比重'] || row['SG'];

                    if (dateRaw && supplier && tankName && sg) {
                        const t = tanks.find(t => t.name.trim() === String(tankName).trim());
                        if (!t) continue;

                        const dateStr = formatDateForInput(dateRaw);
                        if (!dateStr) continue;

                        const targetPpmInput = row['目標藥劑濃度'] || row['目標濃度'] || row['Target PPM'];
                        let finalTargetPpm = targetPpmInput ? parseFloat(targetPpmInput) : undefined;

                        // Auto-inherit from previous record if missing
                        if (finalTargetPpm === undefined) {
                            // 1. Try to find in newly added supplies for this tank (Fill-down behavior within file)
                            // We look for any PREVIOUSLY processed row for this tank in this batch
                            const lastAdded = [...newSupplies, ...updatesToPerform].filter(s => s.tankId === t.id).sort((a, b) => b.startDate - a.startDate)[0];
                            if (lastAdded && lastAdded.targetPpm !== undefined) {
                                finalTargetPpm = lastAdded.targetPpm;
                            } else {
                                // 2. Try to find in existing DB history
                                const dateMs = new Date(dateStr).getTime();
                                const history = existingSupplies
                                    .filter(s => s.tankId === t.id && s.startDate < dateMs)
                                    .sort((a, b) => b.startDate - a.startDate);

                                if (history.length > 0 && history[0].targetPpm !== undefined) {
                                    finalTargetPpm = history[0].targetPpm;
                                }
                            }
                        }

                        const targetDateMs = new Date(dateStr).getTime();

                        // Check if we already have this tank+date in current batch (deduplicate within file -> keep last one)
                        // If we encounter a duplicate within the file, we should update the entry in 'newSupplies' or 'updatesToPerform' usually.
                        // Ideally the file shouldn't have same date twice. If it does, last one wins.
                        // We will remove previous entry from newSupplies if exists.
                        const existingInBatchIndex = newSupplies.findIndex(s => s.tankId === t.id && s.startDate === targetDateMs);
                        if (existingInBatchIndex >= 0) {
                            newSupplies.splice(existingInBatchIndex, 1);
                        }
                        const existingInUpdatesBatchIndex = updatesToPerform.findIndex(s => s.tankId === t.id && s.startDate === targetDateMs);
                        if (existingInUpdatesBatchIndex >= 0) {
                            updatesToPerform.splice(existingInUpdatesBatchIndex, 1);
                        }

                        // Check if we already have this tank+date in DB (Overwrite logic)
                        const existingInDB = existingSupplies.find(s => s.tankId === t.id && s.startDate === targetDateMs);

                        const supplyObj: ChemicalSupply = {
                            id: existingInDB ? existingInDB.id : generateUUID(), // Use existing ID if overwriting
                            tankId: t.id,
                            supplierName: supplier,
                            chemicalName: chem || '',
                            specificGravity: parseFloat(sg),
                            price: row['單價'] || row['Price'] ? parseFloat(row['單價'] || row['Price']) : undefined,
                            startDate: targetDateMs,
                            notes: row['備註'] || row['Notes'] || '',
                            targetPpm: finalTargetPpm
                        };

                        if (existingInDB) {
                            updatesToPerform.push(supplyObj);
                        } else {
                            newSupplies.push(supplyObj);
                        }
                        successCount++;
                    }
                }

                // 檢查比重是否在合格範圍內
                const sgWarnings: string[] = [];
                const allSupplyItems = [...newSupplies, ...updatesToPerform];
                for (const supply of allSupplyItems) {
                    const tank = tanks.find(t => t.id === supply.tankId);
                    if (tank && (tank.sgRangeMin !== undefined || tank.sgRangeMax !== undefined)) {
                        const sg = supply.specificGravity;
                        const minSG = tank.sgRangeMin;
                        const maxSG = tank.sgRangeMax;

                        if ((minSG !== undefined && sg < minSG) || (maxSG !== undefined && sg > maxSG)) {
                            const rangeStr = minSG !== undefined && maxSG !== undefined
                                ? `${minSG} ~ ${maxSG}`
                                : minSG !== undefined ? `≥ ${minSG}` : `≤ ${maxSG}`;
                            const dateStr = new Date(supply.startDate).toLocaleDateString();
                            sgWarnings.push(`[${dateStr}] ${tank.name}: 比重 ${sg} 超出範圍 (${rangeStr})`);
                        }
                    }
                }

                // 如有比重異常，提醒使用者確認
                if (sgWarnings.length > 0) {
                    const warningMsg = `發現 ${sgWarnings.length} 筆比重超出合格範圍的記錄:\n\n${sgWarnings.slice(0, 10).join('\n')}${sgWarnings.length > 10 ? `\n... 及另外 ${sgWarnings.length - 10} 筆` : ''}\n\n確定要繼續匯入嗎?`;
                    if (!confirm(warningMsg)) {
                        alert('已取消匯入，請核對資料後再試。');
                        setFile(null);
                        return;
                    }
                }

                // Batch Create New
                if (newSupplies.length > 0) {
                    await StorageService.addSuppliesBatch(newSupplies);
                }

                // Execute Updates (Sequentially or Parallel)
                if (updatesToPerform.length > 0) {
                    for (const update of updatesToPerform) {
                        await StorageService.updateSupply(update);
                    }
                }

                if (successCount > 0) {
                    // 自動重新計算所有液位紀錄的比重
                    for (const reading of readings) {
                        const supply = await StorageService.getActiveSupply(reading.tankId, reading.timestamp);
                        if (supply && supply.specificGravity !== reading.appliedSpecificGravity) {
                            const tank = tanks.find(t => t.id === reading.tankId);
                            const vol = reading.levelCm * (tank?.factor || 1);
                            await StorageService.updateReading({
                                ...reading,
                                appliedSpecificGravity: supply.specificGravity,
                                calculatedWeightKg: vol * supply.specificGravity,
                                supplyId: supply.id
                            });
                            sgUpdatedCount++;
                        }
                    }
                    if (sgUpdatedCount > 0) {
                        onUpdateTank(); // 觸發刷新
                    }
                    loadHistory();
                }
            } else if (activeType === 'C') {
                // 1. Pre-process and Sort (Sort by Date ASC for Fill-Down logic)
                const validRows: any[] = [];
                for (const row of jsonData) {
                    // 使用「區域」欄位 (CT-1 或 CT-2)
                    const areaName = row['區域'] || row['儲槽名稱'] || row['Tank'];
                    if (!areaName) continue;
                    const areaStr = String(areaName).trim().toUpperCase(); // Force uppercase for CT-1/CT-2 check

                    let targetTanks: Tank[] = [];
                    if (areaStr === 'CT-1' || areaStr === 'CT-2') {
                        targetTanks = tanks.filter(t => t.system === SystemType.COOLING && t.name.startsWith(areaStr));
                    } else {
                        // Fallback: fuzzy match for single tank
                        const t = tanks.find(tank => tank.name.includes(areaStr));
                        if (t) targetTanks = [t];
                    }

                    if (targetTanks.length === 0) continue;

                    const normalizedTs = getNormalizedTimestamp(row['日期'] || row['填表日期'] || row['Date']);
                    const dateVal = normalizedTs ? getMonday(new Date(normalizedTs)).getTime() : null;
                    const i = jsonData.indexOf(row);

                    if (!dateVal) {
                        console.warn(`[Skip] Row ${i + 1}: 無效日期`, row);
                        failCount++;
                        continue;
                    }
                    // Skip future
                    if (dateVal > Date.now()) {
                        console.warn(`[Skip] Row ${i + 1}: 未來日期 ${new Date(dateVal).toLocaleDateString()}`);
                        failCount++;
                        continue;
                    }

                    // Push a valid row for EACH target tank
                    for (const t of targetTanks) {
                        validRows.push({ row, t, date: dateVal, i });
                    }
                }

                validRows.sort((a, b) => a.date - b.date);

                // 2. Process each row
                for (const { row, t, date } of validRows) {
                    const targetTankId = t.id;

                    // Parse Excel Values
                    const rowCirculation = parseFloat(row['循環水量'] || row['Circulation Rate'] || '0');
                    const rowTempOutlet = parseFloat(row['出水溫'] || row['出水溫度'] || row['T1'] || '0');
                    const rowTempReturn = parseFloat(row['回水溫'] || row['回水溫度'] || row['T2'] || '0');
                    const cwsHardness = parseFloat(row['冷卻水硬度'] || row['CWS Hardness'] || '0');
                    const makeupHardness = parseFloat(row['補水硬度'] || row['Makeup Hardness'] || '0');

                    // 自動計算 (Excel Row)
                    const rowTempDiff = rowTempReturn - rowTempOutlet;
                    const concentrationCycles = (makeupHardness > 0) ? cwsHardness / makeupHardness : 1;

                    // 檢查是否已存在相同 tankId + date 的紀錄
                    const existingHistory = await StorageService.getCWSParamsHistory(targetTankId);
                    const existingRecord = existingHistory.find(h => h.date === date);

                    let record: CWSParameterRecord;

                    if (existingRecord) {
                        // 若已存在：只更新硬度與濃縮倍數，保留原有的溫度與流量數據 (避免覆蓋 PI 系統數據)
                        record = {
                            ...existingRecord,
                            id: existingRecord.id,
                            tankId: targetTankId,
                            date: date,
                            // 更新欄位
                            cwsHardness: cwsHardness,
                            makeupHardness: makeupHardness,
                            concentrationCycles: concentrationCycles,
                            // 保護欄位 (明確保留原值)
                            circulationRate: existingRecord.circulationRate,
                            tempOutlet: existingRecord.tempOutlet,
                            tempReturn: existingRecord.tempReturn,
                            tempDiff: existingRecord.tempDiff
                        };
                    } else {
                        // 若為新紀錄：使用 Excel 中的所有數據
                        record = {
                            id: generateUUID(),
                            tankId: targetTankId,
                            date: date,
                            circulationRate: rowCirculation,
                            tempOutlet: rowTempOutlet,
                            tempReturn: rowTempReturn,
                            tempDiff: rowTempDiff,
                            cwsHardness: cwsHardness,
                            makeupHardness: makeupHardness,
                            concentrationCycles: concentrationCycles
                        };
                    }

                    await StorageService.saveCWSParam(record);
                    if (updatedTanks.findIndex(tank => tank.id === targetTankId) === -1) {
                        updatedTanks.push(t);
                    }
                    successCount++;
                }

                if (updatedTanks.length > 0) {
                    onUpdateTank();
                    // Auto-Switch to populated tank
                    const first = updatedTanks[0];
                    setSelectedTankId(first.id);
                    setCwsInput(prev => ({ ...prev, tankId: first.id }));
                }
                alert(`已匯入 ${successCount} 筆 CWS 數據 (略過 ${failCount} 筆)`);
            } else if (activeType === 'D') {
                // BWS Excel Import
                const newParams: BWSParameterRecord[] = [];

                for (const row of jsonData) {
                    const tankName = row['儲槽名稱'] || row['TankName'] || row['儲槽'];
                    const steam = row['蒸氣量'] || row['Steam'] || row['蒸氣總產量'];

                    if (tankName && steam !== undefined) {
                        const targetTank = tanks.find(t => t.name.trim() === String(tankName).trim());
                        if (!targetTank) continue;

                        const normalizedTs = getNormalizedTimestamp(row['日期'] || row['填表日期'] || row['Date']);
                        const dateVal = normalizedTs ? getMonday(new Date(normalizedTs)).getTime() : null;
                        const i = jsonData.indexOf(row);

                        if (!dateVal) {
                            console.warn(`[Skip] Row ${i + 1}: 無效日期`, row);
                            failCount++;
                            continue;
                        }

                        // 檢查是否已存在相同 tankId + date 的紀錄 (Overwrite Logic)
                        const existingHistory = await StorageService.getBWSParamsHistory(targetTank.id);
                        const existingRecord = existingHistory.find(h => h.date === dateVal);

                        const newParam: BWSParameterRecord = {
                            id: existingRecord?.id || generateUUID(), // 使用現有 ID 以達成覆蓋
                            tankId: targetTank.id,
                            steamProduction: Number(steam),
                            date: dateVal
                        };
                        newParams.push(newParam);
                        if (!updatedTanks.find(t => t.id === targetTank.id)) {
                            updatedTanks.push(targetTank);
                        }
                        successCount++;
                    }
                }

                if (newParams.length > 0) {
                    for (const param of newParams) {
                        await StorageService.saveBWSParam(param);
                    }
                    if (updatedTanks.length > 0) {
                        onUpdateTank();
                    }
                    loadHistory();
                    alert(`已匯入 ${successCount} 筆 BWS 數據 (略過 ${failCount} 筆)`);
                } else {
                    alert('未找到有效數據');
                }
            }

            // 組合完成訊息
            let message = `匯入完成!\n成功: ${successCount} 筆`;
            if (failCount > 0) {
                message += `\n失敗/跳過: ${failCount} 筆 (請查看 Console 確認詳情)`;
            }
            if (activeType === 'B' && sgUpdatedCount > 0) {
                message += `\n\n已自動更新 ${sgUpdatedCount} 筆液位紀錄的比重`;
            }
            // 不要為 C/D 顯示同樣的 alert 因為它們各自有
            if (activeType === 'A' || activeType === 'B') {
                alert(message);
            }
            setFile(null);

        } catch (e: any) {
            console.error('Excel 匯入錯誤:', e);
            const errorMsg = e?.message || String(e);
            alert(`檔案讀取失敗，請確認格式。\n\n錯誤詳情: ${errorMsg}`);
        }
        finally {
            onLoading(false);
        }
    };

    // 批次重新計算比重 - 根據 Table B 的合約資料重新計算 Table A 的比重
    // silent: true 時不顯示確認對話框（用於自動觸發）
    const recalculateSG = async (silent = false): Promise<number> => {
        if (!silent && !confirm('此操作將根據藥劑合約 (Table B) 重新計算所有液位紀錄的比重，確定要繼續嗎？')) return 0;

        onLoading(true);
        try {
            let updatedCount = 0;
            const updatedReadings: Reading[] = [];

            for (const reading of readings) {
                const supply = await StorageService.getActiveSupply(reading.tankId, reading.timestamp);
                const newSG = supply?.specificGravity || reading.appliedSpecificGravity; // 保留原值如果找不到合約

                // 只在有找到合約且比重不同時才更新
                if (supply && newSG !== reading.appliedSpecificGravity) {
                    const tank = tanks.find(t => t.id === reading.tankId);
                    if (tank) {
                        const vol = calculateTankVolume(tank, reading.levelCm);

                        updatedReadings.push({
                            ...reading,
                            appliedSpecificGravity: newSG,
                            calculatedWeightKg: vol * newSG,
                            supplyId: supply.id
                        });
                        updatedCount++;
                    }
                }
            }

            // 批次更新
            for (const reading of updatedReadings) {
                await StorageService.updateReading(reading);
            }

            if (updatedCount > 0) {
                onUpdateTank(); // 觸發刷新
            }

            if (!silent) {
                alert(`重新計算完成！共更新 ${updatedCount} 筆紀錄的比重。`);
            }
            return updatedCount;
        } catch (e: any) {
            console.error('重新計算比重失敗:', e);
            if (!silent) {
                alert(`重新計算失敗: ${e?.message || e}`);
            }
        } finally {
            onLoading(false);
        }
    };

    const handleExport = () => {
        const data = readings.map(r => {
            const t = tanks.find(tank => tank.id === r.tankId);
            return {
                'Date': new Date(r.timestamp).toLocaleDateString(),
                'Tank': t ? t.name : r.tankId,
                'Level (cm)': r.levelCm,
                'Volume (L)': r.calculatedVolume.toFixed(2),
                'Weight (kg)': r.calculatedWeightKg.toFixed(2),
                'SG': r.appliedSpecificGravity,
                'Operator': r.operatorName
            };
        });
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Readings");
        XLSX.writeFile(wb, "PowerChem_Readings.xlsx");
        XLSX.writeFile(wb, "PowerChem_Readings.xlsx");
    };

    const handleAddNote = async (anomaly: ImportAnomaly, noteContent: string) => {
        try {
            onLoading(true);
            const tank = tanks.find(t => t.id === anomaly.tankId);
            const area = tank ? tank.system : 'Unknown';

            // Try to format date to YYYY-MM-DD
            let dateStr = anomaly.date.replace(/\//g, '-');
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                // Ensure padding
                dateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            }

            const note: ImportantNote = {
                id: generateUUID(),
                dateStr: dateStr,
                area: area,
                chemicalName: tank ? tank.name : anomaly.tankName,
                note: noteContent,
                createdAt: new Date().toISOString()
            };

            await StorageService.saveNote(note);
            alert('重要紀事已新增');
        } catch (e) {
            console.error('Failed to add note:', e);
            alert('新增失敗');
        } finally {
            onLoading(false);
        }
    };

    return (
        <div className="max-w-[1600px] mx-auto space-y-6">
            <div className="bg-white p-2 rounded-xl shadow-sm border border-slate-200 grid grid-cols-4 gap-2">
                <button
                    onClick={() => setActiveType('A')}
                    className={`flex items-center justify-center py-3 rounded-lg text-sm font-bold transition-all
              ${activeType === 'A' ? 'bg-blue-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                    <Icons.Entry className="w-4 h-4 mr-2" />
                    A. 液位數據
                </button>
                <button
                    onClick={() => setActiveType('B')}
                    className={`flex items-center justify-center py-3 rounded-lg text-sm font-bold transition-all
              ${activeType === 'B' ? 'bg-purple-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                    <Icons.ClipboardPen className="w-4 h-4 mr-2" />
                    B. 藥劑合約
                </button>
                <button
                    onClick={() => setActiveType('C')}
                    className={`flex items-center justify-center py-3 rounded-lg text-sm font-bold transition-all
              ${activeType === 'C' ? 'bg-sky-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                    <Icons.Cooling className="w-4 h-4 mr-2" />
                    C. 冷卻水生產數據
                </button>
                <button
                    onClick={() => setActiveType('D')}
                    className={`flex items-center justify-center py-3 rounded-lg text-sm font-bold transition-all
              ${activeType === 'D' ? 'bg-orange-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                    <Icons.Boiler className="w-4 h-4 mr-2" />
                    D. 鍋爐水生產數據
                </button>
            </div>

            <div className={`grid grid-cols-1 gap-8 ${['A', 'C', 'D'].includes(activeType) ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
                <Card
                    title={
                        activeType === 'A' ? "手動輸入 - 液位紀錄 (批次)" :
                            activeType === 'B' ? "手動輸入 - 合約資料" :
                                activeType === 'C' ? "手動輸入 - 冷卻水參數" : "手動輸入 - 鍋爐水參數"
                    }
                    className={`border-t-4 ${activeType === 'A' ? 'border-t-blue-500 lg:col-span-2' : // A type takes 2 cols
                        activeType === 'B' ? 'border-t-purple-500' :
                            activeType === 'C' ? 'border-t-sky-500 lg:col-span-2' : 'border-t-orange-500 lg:col-span-2'
                        }`}
                >
                    {activeType === 'A' && (
                        <form onSubmit={handleSubmitReadings} className="space-y-6">
                            <div className="flex items-center justify-between bg-blue-50 p-3 rounded-lg border border-blue-100 mb-4">
                                <div className="flex items-center gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-blue-900">抄表日期</label>
                                        <input
                                            type="date"
                                            value={date}
                                            onClick={(e) => e.currentTarget.showPicker()}
                                            onChange={e => setDate(e.target.value)}
                                            className="mt-1 block w-full rounded-md border-blue-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                                            required
                                        />
                                    </div>
                                    <div className="text-sm text-blue-700 pt-5">
                                        <span className="bg-blue-200 px-2 py-1 rounded text-xs mr-2">提示</span>
                                        若儲槽設定為 <span className="font-bold">PERCENT</span>，單位為「公尺」，系統自動換算 x100 為公分。
                                    </div>
                                </div>
                            </div>

                            {/* Grouped Tank Inputs */}
                            {(() => {
                                const groups = {
                                    'CT-1 (一階)': tanks.filter(t => t.system === SystemType.COOLING && (t.name.includes('CT-1') || t.description?.includes('一階'))),
                                    'CT-2 (二階)': tanks.filter(t => t.system === SystemType.COOLING && (t.name.includes('CT-2') || t.description?.includes('二階') || (!t.name.includes('CT-1') && !t.description?.includes('一階')))),
                                    '鍋爐藥劑': tanks.filter(t => t.system === SystemType.BOILER),
                                    '氨水 (脫硝)': tanks.filter(t => t.system === SystemType.DENOX),
                                    '其他': tanks.filter(t => t.system !== SystemType.COOLING && t.system !== SystemType.BOILER && t.system !== SystemType.DENOX)
                                };

                                return Object.entries(groups).map(([groupName, groupTanks]) => {
                                    if (groupTanks.length === 0) return null;

                                    return (
                                        <div key={groupName} className="border border-slate-200 rounded-lg overflow-hidden">
                                            <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 font-bold text-slate-700 text-sm">
                                                {groupName}
                                            </div>
                                            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {groupTanks.map(tank => {
                                                    const isMeters = tank.inputUnit === 'PERCENT';
                                                    const unitLabel = isMeters ? '公尺' : '公分';
                                                    const placeholder = isMeters ? 'M' : 'cm';

                                                    return (
                                                        <div key={tank.id} className="flex items-center gap-3">
                                                            <div className="w-1/3 text-right">
                                                                <div className="text-sm font-medium text-slate-700 truncate" title={tank.name}>{tank.name}</div>
                                                                <div className="text-[10px] text-slate-400">{tank.system}</div>
                                                            </div>
                                                            <div className="w-2/3 relative">
                                                                <input
                                                                    type="number"
                                                                    step={isMeters ? "0.01" : "0.1"}
                                                                    placeholder={placeholder}
                                                                    value={batchLevels[tank.id] || ''}
                                                                    onChange={(e) => setBatchLevels(prev => ({ ...prev, [tank.id]: e.target.value }))}
                                                                    className={`${inputClassName} pr-12`}
                                                                />
                                                                <div className="absolute right-3 top-2.5 text-xs text-slate-400 font-bold pointer-events-none">
                                                                    {unitLabel}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                });
                            })()}

                            <div className="pt-4 sticky bottom-0 bg-white border-t border-slate-100 p-4 -mx-6 -mb-6 shadow-up z-10">
                                <Button type="submit" className="w-full justify-center text-lg py-3 shadow-lg">
                                    <Icons.Save className="w-5 h-5 mr-2" />
                                    批次儲存所有輸入
                                </Button>
                            </div>
                        </form>
                    )}

                    {/* 近期歷史紀錄列表 (全域) */}
                    {activeType === 'A' && (() => {
                        const historyLimit = 20;
                        const historyReadings = readings
                            .sort((a, b) => b.timestamp - a.timestamp)
                            .slice(0, historyLimit);

                        const handleHistoryEdit = (item: Reading) => {
                            setEditingItem(item);
                            setEditForm({
                                ...item,
                                dateStr: new Date(item.timestamp).toISOString().split('T')[0]
                            });
                            setIsEditOpen(true);
                        };

                        const handleHistoryDelete = async (id: string) => {
                            if (!confirm('確定要刪除此紀錄嗎？')) return;
                            try {
                                await StorageService.deleteReading(id);
                                onUpdateTank();
                                alert('刪除成功');
                            } catch (e) {
                                console.error(e);
                                alert('刪除失敗');
                            }
                        };

                        if (historyReadings.length === 0) return null;

                        return (
                            <div className="mt-8 border-t border-slate-200 pt-6">
                                <h4 className="font-bold text-slate-800 flex items-center mb-4">
                                    <Icons.ClipboardPen className="w-4 h-4 mr-2" />
                                    近期歷史紀錄 (Top {historyLimit})
                                </h4>
                                <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[500px] overflow-y-auto">
                                    <table className="min-w-full divide-y divide-slate-200">
                                        <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">日期</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">儲槽</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">液位</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">存量 (L)</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-slate-200">
                                            {historyReadings.map(r => {
                                                const tankName = tanks.find(t => t.id === r.tankId)?.name || r.tankId;
                                                return (
                                                    <tr key={r.id} className="hover:bg-slate-50">
                                                        <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                            {new Date(r.timestamp).toLocaleDateString()}
                                                        </td>
                                                        <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900 font-medium">
                                                            {tankName}
                                                        </td>
                                                        <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                            {r.levelCm} cm
                                                        </td>
                                                        <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                            {Math.round(r.calculatedVolume)}
                                                        </td>
                                                        <td className="px-3 py-2 whitespace-nowrap text-right text-sm">
                                                            <button onClick={() => handleHistoryEdit(r)} className="text-blue-600 hover:text-blue-900 mr-3">編輯</button>
                                                            <button onClick={() => handleHistoryDelete(r.id)} className="text-red-600 hover:text-red-900">刪除</button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}

                    {activeType === 'A' && (
                        <div className="mt-4 pt-4 border-t border-slate-100">
                            <Button onClick={handleExport} variant="ghost" className="text-slate-500 w-full justify-center">
                                <Icons.Download className="w-4 h-4 mr-2" />
                                匯出歷史液位資料 (Table A)
                            </Button>
                        </div>
                    )}

                    {/* Edit Dialog - 重用 DataEntryView 內部的狀態 */}
                    <EditDialog
                        isOpen={isEditOpen}
                        title={
                            activeType === 'A' ? "編輯液位紀錄" :
                                activeType === 'B' ? "編輯藥劑合約" :
                                    activeType === 'C' ? "編輯冷卻水參數" : "編輯鍋爐水參數"
                        }
                        onClose={() => setIsEditOpen(false)}
                        onSave={async () => {
                            try {
                                if (!editingItem) return;

                                if (activeType === 'A') {
                                    await StorageService.updateReading({
                                        ...editingItem,
                                        ...editForm,
                                        levelCm: Number(editForm.levelCm),
                                        calculatedVolume: Number(editForm.calculatedVolume),
                                        calculatedWeightKg: Number(editForm.calculatedWeightKg),
                                        timestamp: new Date(editForm.dateStr).getTime()
                                    });
                                } else if (activeType === 'B') {
                                    await StorageService.updateSupply({
                                        ...editingItem,
                                        ...editForm,
                                        startDate: new Date(editForm.dateStr).getTime(),
                                        specificGravity: Number(editForm.specificGravity),
                                        price: editForm.price ? Number(editForm.price) : undefined
                                    });
                                    // Refresh logic handled by parent or effect?
                                    // Hack: Force effect to reload by touching activeType or similar?
                                    // Or just call filter directly?
                                    // Let's assume onUpdateTank or effect dependency handles it.
                                    // Adding a toggle for refresh would be cleaner but let's see.
                                } else if (activeType === 'C') {
                                    await StorageService.updateCWSParamRecord({
                                        ...editingItem,
                                        ...editForm,
                                        date: new Date(editForm.dateStr).getTime(),
                                        circulationRate: Number(editForm.circulationRate),
                                        // Add other Number conversions
                                        tempDiff: Number(editForm.tempDiff),
                                        cwsHardness: Number(editForm.cwsHardness),
                                        makeupHardness: Number(editForm.makeupHardness),
                                        concentrationCycles: Number(editForm.concentrationCycles)
                                    });
                                } else if (activeType === 'D') {
                                    await StorageService.updateBWSParamRecord({
                                        ...editingItem,
                                        ...editForm,
                                        date: new Date(editForm.dateStr).getTime(),
                                        steamProduction: Number(editForm.steamProduction)
                                    });
                                }

                                setIsEditOpen(false);
                                setEditingItem(null);
                                onUpdateTank(); // Refresh global data
                                alert('更新成功');
                                // Trigger history reload hack for B/C/D if needed (since they depend on separate endpoint)
                                // We can depend on onUpdateTank triggering re-render?
                                // Actually, historyEffect depends on selectedTankId.
                                // We might need to manually trigger reload.
                            } catch (e) {
                                console.error(e);
                                alert('更新失敗');
                            }
                        }}
                    >
                        {/* Common Date Field */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700">日期</label>
                            <input
                                type="date"
                                className={inputClassName}
                                value={editForm.dateStr || ''}
                                onChange={e => setEditForm({ ...editForm, dateStr: e.target.value })}
                            />
                        </div>

                        {/* Type A Fields */}
                        {activeType === 'A' && (
                            <>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">液位 (cm)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        className={inputClassName}
                                        value={editForm.levelCm || ''}
                                        onChange={e => {
                                            const lvl = parseFloat(e.target.value);
                                            const tank = tanks.find(t => t.id === editingItem?.tankId);
                                            const vol = tank ? lvl * tank.factor : editingItem?.calculatedVolume;
                                            setEditForm({
                                                ...editForm,
                                                levelCm: e.target.value,
                                                calculatedVolume: vol,
                                                calculatedWeightKg: vol * (editingItem?.appliedSpecificGravity || 1)
                                            });
                                        }}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">存量 (L)</label>
                                    <input
                                        type="number"
                                        className={inputClassName}
                                        value={editForm.calculatedVolume || ''}
                                        readOnly
                                        disabled
                                    />
                                </div>
                            </>
                        )}

                        {/* Type B Fields */}
                        {activeType === 'B' && (
                            <>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">供應商</label>
                                    <input
                                        type="text"
                                        className={inputClassName}
                                        value={editForm.supplierName || ''}
                                        onChange={e => setEditForm({ ...editForm, supplierName: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">藥品名稱</label>
                                    <input
                                        type="text"
                                        className={inputClassName}
                                        value={editForm.chemicalName || ''}
                                        onChange={e => setEditForm({ ...editForm, chemicalName: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">比重</label>
                                    <input
                                        type="number" step="0.001"
                                        className={inputClassName}
                                        value={editForm.specificGravity || ''}
                                        onChange={e => setEditForm({ ...editForm, specificGravity: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">單價 (元/KG)</label>
                                    <input
                                        type="number" step="0.1"
                                        className={inputClassName}
                                        value={editForm.price || ''}
                                        onChange={e => setEditForm({ ...editForm, price: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">備註</label>
                                    <input
                                        type="text"
                                        className={inputClassName}
                                        value={editForm.notes || ''}
                                        onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                                    />
                                </div>
                            </>
                        )}

                        {/* Type C Fields (Simplified for common use) */}
                        {activeType === 'C' && (
                            <>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">循環水量 (m3/hr)</label>
                                    <input
                                        type="number"
                                        className={inputClassName}
                                        value={editForm.circulationRate || ''}
                                        onChange={e => setEditForm({ ...editForm, circulationRate: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">溫差 (Delta T)</label>
                                    <input
                                        type="number" step="0.1"
                                        className={inputClassName}
                                        value={editForm.tempDiff || ''}
                                        onChange={e => setEditForm({ ...editForm, tempDiff: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">冷卻水硬度 (ppm)</label>
                                    <input
                                        type="number"
                                        className={inputClassName}
                                        value={editForm.cwsHardness || ''}
                                        onChange={e => {
                                            const val = e.target.value;
                                            const cws = Number(val);
                                            const mk = Number(editForm.makeupHardness || 0);
                                            const n = (cws && mk) ? (cws / mk).toFixed(1) : (editForm.concentrationCycles || '');
                                            setEditForm({ ...editForm, cwsHardness: val, concentrationCycles: n });
                                        }}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">補水硬度 (ppm)</label>
                                    <input
                                        type="number"
                                        className={inputClassName}
                                        value={editForm.makeupHardness || ''}
                                        onChange={e => {
                                            const val = e.target.value;
                                            const mk = Number(val);
                                            const cws = Number(editForm.cwsHardness || 0);
                                            const n = (cws && mk) ? (cws / mk).toFixed(1) : (editForm.concentrationCycles || '');
                                            setEditForm({ ...editForm, makeupHardness: val, concentrationCycles: n });
                                        }}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">濃縮倍數 (N)</label>
                                    <div className={`p-2.5 rounded-lg border border-slate-600 bg-slate-800 text-slate-400 text-sm`}>
                                        {editForm.concentrationCycles || '-'} (自動計算: 冷卻水硬度/補水硬度)
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Type D Fields */}
                        {activeType === 'D' && (
                            <>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">每週平均產氣量 (噸)</label>
                                    <input
                                        type="number"
                                        className={inputClassName}
                                        value={editForm.steamProduction || ''}
                                        onChange={e => setEditForm({ ...editForm, steamProduction: e.target.value })}
                                    />
                                </div>
                            </>
                        )}

                    </EditDialog>

                    {activeType === 'B' && (
                        <form onSubmit={handleSubmitContract} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">1. 適用儲槽</label>
                                <select
                                    value={newSupply.tankId || ''}
                                    onChange={e => {
                                        setNewSupply({ ...newSupply, tankId: e.target.value });
                                        setSelectedTankId(e.target.value);
                                    }}
                                    className={inputClassName}
                                    required
                                >
                                    <option value="">-- 請選擇 --</option>
                                    {tanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">2. 供應商</label>
                                <input type="text" value={newSupply.supplierName || ''} onChange={e => setNewSupply({ ...newSupply, supplierName: e.target.value })} className={inputClassName} required placeholder="例如: 台塑" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">藥劑名稱</label>
                                    <input type="text" value={newSupply.chemicalName || ''} onChange={e => setNewSupply({ ...newSupply, chemicalName: e.target.value })} className={inputClassName} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">比重 (SG)</label>
                                    <input type="number" step="0.001" value={newSupply.specificGravity || ''} onChange={e => setNewSupply({ ...newSupply, specificGravity: parseFloat(e.target.value) })} className={inputClassName} required placeholder="1.0" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">單價 (元/kg)</label>
                                    <input type="number" step="0.1" value={newSupply.price || ''} onChange={e => setNewSupply({ ...newSupply, price: parseFloat(e.target.value) })} className={inputClassName} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">目標藥劑濃度 (ppm)</label>
                                    <input type="number" step="0.1" value={newSupply.targetPpm || ''} onChange={e => setNewSupply({ ...newSupply, targetPpm: parseFloat(e.target.value) })} className={inputClassName} placeholder="選填" />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">生效日期</label>
                                    <input type="date" value={newSupply.startDate as any || ''} onClick={(e) => e.currentTarget.showPicker()} onChange={e => setNewSupply({ ...newSupply, startDate: e.target.value as any })} className={inputClassName} required />
                                </div>
                            </div>
                            <div className="pt-2">
                                <Button type="submit" className="w-full justify-center bg-purple-600 hover:bg-purple-700">儲存合約紀錄</Button>
                            </div>
                        </form>
                    )}

                    {/* B - 藥劑合約歷史記錄 */}
                    {activeType === 'B' && selectedTankId && (() => {
                        const historyLimit = showMoreHistory ? 60 : 10;
                        const historyItems = historySupplies.slice(0, historyLimit);

                        const handleHistoryEdit = (item: ChemicalSupply) => {
                            setEditingItem(item);
                            setEditForm({
                                ...item,
                                dateStr: new Date(item.startDate).toISOString().split('T')[0]
                            });
                            setIsEditOpen(true);
                        };

                        const handleHistoryDelete = async (id: string) => {
                            if (!confirm('確定要刪除此藥劑合約紀錄嗎？')) return;
                            try {
                                await StorageService.deleteSupply(id);
                                const data = await StorageService.getSupplies();
                                const filtered = data.filter(s => s.tankId === selectedTankId);
                                setHistorySupplies(filtered.sort((a, b) => b.startDate - a.startDate));
                                alert('刪除成功');
                            } catch (e) {
                                console.error(e);
                                alert('刪除失敗');
                            }
                        };

                        if (historyItems.length === 0) return null;

                        return (
                            <div className="mt-8 border-t border-slate-200 pt-6">
                                <div className="flex justify-between items-center mb-4">
                                    <h4 className="font-bold text-slate-800 flex items-center">
                                        <Icons.ClipboardPen className="w-4 h-4 mr-2" />
                                        歷史紀錄 (最近{historyLimit}筆 - 可編輯)
                                    </h4>
                                    <button
                                        onClick={() => setShowMoreHistory(!showMoreHistory)}
                                        className="text-sm text-brand-600 hover:text-brand-800 underline"
                                    >
                                        {showMoreHistory ? '顯示較少' : '顯示更多歷史紀錄'}
                                    </button>
                                </div>
                                <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[500px] overflow-y-auto">
                                    <table className="min-w-full divide-y divide-slate-200">
                                        <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">生效日期</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">供應商</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">藥劑名稱</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">比重</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">目標濃度</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-slate-200">
                                            {historyItems.map(item => (
                                                <tr key={item.id} className="hover:bg-slate-50">
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                        {new Date(item.startDate).toLocaleDateString()}
                                                    </td>
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">{item.supplierName}</td>
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">{item.chemicalName || '-'}</td>
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">{item.specificGravity}</td>
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">{item.targetPpm || '-'}</td>
                                                    <td className="px-3 py-2 whitespace-nowrap text-right text-sm">
                                                        <button
                                                            onClick={() => handleHistoryEdit(item)}
                                                            className="text-blue-600 hover:text-blue-900 mr-3"
                                                        >
                                                            編輯
                                                        </button>
                                                        <button
                                                            onClick={() => handleHistoryDelete(item.id)}
                                                            className="text-red-600 hover:text-red-900"
                                                        >
                                                            刪除
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}

                    {activeType === 'B' && (
                        <div className="mt-4 pt-4 border-t border-slate-100">
                            <Button onClick={() => recalculateSG(false)} variant="ghost" className="text-purple-600 hover:text-purple-800 hover:bg-purple-50 w-full justify-center">
                                <Icons.Recycle className="w-4 h-4 mr-2" />
                                重新計算比重 (依合約)
                            </Button>
                        </div>
                    )}

                    {activeType === 'C' && (
                        <form onSubmit={handleSubmitCWS} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">1. 選擇區域 (僅限 CWS)</label>
                                <select
                                    value={cwsInput.tankId || ''}
                                    onChange={e => {
                                        setCwsInput({ ...cwsInput, tankId: e.target.value });
                                        // Clear current tank selection effectively or handle logic
                                        // setSelectedTankId is mainly for displaying history below.
                                        // If we pick a group, maybe we pick the first tank of the group to show history?
                                        if (e.target.value === 'CT-1' || e.target.value === 'CT-2') {
                                            const firstTank = tanks.find(t => t.name.startsWith(e.target.value));
                                            if (firstTank) setSelectedTankId(firstTank.id);
                                        } else {
                                            setSelectedTankId(e.target.value);
                                        }
                                    }}
                                    className={inputClassName}
                                    required
                                >
                                    <option value="">-- 請選擇 --</option>
                                    <option value="CT-1">CT-1 區域</option>
                                    <option value="CT-2">CT-2 區域</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">2. 填表日期</label>
                                <input type="date" value={cwsInput.dateStr || ''} onClick={(e) => e.currentTarget.showPicker()} onChange={e => setCwsInput({ ...cwsInput, dateStr: e.target.value })} className={inputClassName} required />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">循環水量 R (m3/h)</label>
                                    <input type="number" value={cwsInput.circulationRate || ''} onChange={e => setCwsInput({ ...cwsInput, circulationRate: parseFloat(e.target.value) })} className={inputClassName} placeholder="R" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">出水溫度 T1 (°C)</label>
                                    <input type="number" step="0.1" value={cwsInput.tempOutlet || ''} onChange={e => setCwsInput({ ...cwsInput, tempOutlet: parseFloat(e.target.value) })} className={inputClassName} placeholder="T1" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">回水溫度 T2 (°C)</label>
                                    <input type="number" step="0.1" value={cwsInput.tempReturn || ''} onChange={e => setCwsInput({ ...cwsInput, tempReturn: parseFloat(e.target.value) })} className={inputClassName} placeholder="T2" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">溫差 ΔT (°C) <span className="text-slate-400 text-xs">(自動計算)</span></label>
                                    <div className={`${inputClassName} bg-slate-100 text-slate-600`}>
                                        {((cwsInput.tempOutlet || 0) - (cwsInput.tempReturn || 0)).toFixed(2) || '-'}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">冷卻水硬度 (ppm)</label>
                                    <input type="number" value={cwsInput.cwsHardness || ''} onChange={e => setCwsInput({ ...cwsInput, cwsHardness: parseFloat(e.target.value) })} className={inputClassName} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">補水硬度 (ppm)</label>
                                    <input type="number" value={cwsInput.makeupHardness || ''} onChange={e => setCwsInput({ ...cwsInput, makeupHardness: parseFloat(e.target.value) })} className={inputClassName} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 mb-1">濃縮倍數 N <span className="text-slate-400 text-xs">(自動計算: 冷卻水硬度 / 補水硬度)</span></label>
                                    <div className={`${inputClassName} bg-slate-100 text-slate-600`}>
                                        {(cwsInput.cwsHardness && cwsInput.makeupHardness && cwsInput.makeupHardness > 0)
                                            ? (cwsInput.cwsHardness / cwsInput.makeupHardness).toFixed(2)
                                            : '-'}
                                    </div>
                                </div>
                            </div>
                            <div className="pt-2">
                                <Button type="submit" className="w-full justify-center bg-sky-600 hover:bg-sky-700">更新 CWS 參數</Button>
                            </div>
                        </form>
                    )}

                    {/* C - 冷卻水生產數據歷史記錄 */}
                    {activeType === 'C' && selectedTankId && (() => {
                        const historyLimit = showMoreHistory ? 60 : 10;
                        const historyItems = historyCWS.slice(0, historyLimit);

                        const handleHistoryEdit = (item: CWSParameterRecord) => {
                            setEditingItem(item);
                            setEditForm({
                                ...item,
                                dateStr: item.date ? new Date(item.date).toISOString().split('T')[0] : ''
                            });
                            setIsEditOpen(true);
                        };

                        const handleHistoryDelete = async (id: string) => {
                            if (!confirm('確定要刪除此冷卻水生產數據紀錄嗎？')) return;
                            try {
                                await StorageService.deleteCWSParamRecord(id);
                                const data = await StorageService.getCWSParamsHistory(selectedTankId);
                                setHistoryCWS(data);
                                onUpdateTank();
                                alert('刪除成功');
                            } catch (e) {
                                console.error(e);
                                alert('刪除失敗');
                            }
                        };

                        if (historyItems.length === 0) return null;

                        return (
                            <div className="mt-8 border-t border-slate-200 pt-6">
                                <div className="flex justify-between items-center mb-4">
                                    <h4 className="font-bold text-slate-800 flex items-center">
                                        <Icons.ClipboardPen className="w-4 h-4 mr-2" />
                                        歷史紀錄 (最近{historyLimit}筆 - 可編輯)
                                    </h4>
                                    <button
                                        onClick={() => setShowMoreHistory(!showMoreHistory)}
                                        className="text-sm text-brand-600 hover:text-brand-800 underline"
                                    >
                                        {showMoreHistory ? '顯示較少' : '顯示更多歷史紀錄'}
                                    </button>
                                </div>
                                <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[500px] overflow-y-auto">
                                    <table className="min-w-full divide-y divide-slate-200">
                                        <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">週起始日</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">循環水量 (m³/hr)</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">溫差 (°C)</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-slate-200">
                                            {historyItems.map(item => (
                                                <tr key={item.id} className="hover:bg-slate-50">
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                        {item.date ? new Date(item.date).toLocaleDateString() : '-'}
                                                    </td>
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                        {item.circulationRate || '-'}
                                                    </td>
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                        {item.tempDiff || '-'}
                                                    </td>
                                                    <td className="px-3 py-2 whitespace-nowrap text-right text-sm">
                                                        <button
                                                            onClick={() => handleHistoryEdit(item)}
                                                            className="text-blue-600 hover:text-blue-900 mr-3"
                                                        >
                                                            編輯
                                                        </button>
                                                        <button
                                                            onClick={() => handleHistoryDelete(item.id)}
                                                            className="text-red-600 hover:text-red-900"
                                                        >
                                                            刪除
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}

                    {activeType === 'D' && (
                        <form onSubmit={handleSubmitBWS} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">1. 選擇儲槽 (僅限 BWS)</label>
                                <select
                                    value={bwsInput.tankId || ''}
                                    onChange={e => {
                                        setBwsInput({ ...bwsInput, tankId: e.target.value });
                                        setSelectedTankId(e.target.value);
                                    }}
                                    className={inputClassName}
                                    required
                                >
                                    <option value="">-- 請選擇 --</option>
                                    {tanks.filter(t => t.system === SystemType.BOILER).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">2. 填表日期</label>
                                <input type="date" value={bwsInput.dateStr || ''} onClick={(e) => e.currentTarget.showPicker()} onChange={e => setBwsInput({ ...bwsInput, dateStr: e.target.value })} className={inputClassName} required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">週蒸汽總產量 (Ton/Week)</label>
                                <input type="number" value={bwsInput.steamProduction || ''} onChange={e => setBwsInput({ ...bwsInput, steamProduction: parseFloat(e.target.value) })} className={inputClassName} placeholder="Steam" />
                            </div>
                            <div className="pt-2">
                                <Button type="submit" className="w-full justify-center bg-orange-600 hover:bg-orange-700">更新 BWS 參數</Button>
                            </div>
                        </form>
                    )}

                    {/* D - 鍋爐水生產數據歷史記錄 */}
                    {activeType === 'D' && selectedTankId && (() => {
                        const historyLimit = showMoreHistory ? 60 : 10;
                        const historyItems = historyBWS.slice(0, historyLimit);

                        const handleHistoryEdit = (item: BWSParameterRecord) => {
                            setEditingItem(item);
                            setEditForm({
                                ...item,
                                dateStr: item.date ? new Date(item.date).toISOString().split('T')[0] : ''
                            });
                            setIsEditOpen(true);
                        };

                        const handleHistoryDelete = async (id: string) => {
                            if (!confirm('確定要刪除此鍋爐水生產數據紀錄嗎？')) return;
                            try {
                                await StorageService.deleteBWSParamRecord(id);
                                const data = await StorageService.getBWSParamsHistory(selectedTankId);
                                setHistoryBWS(data);
                                onUpdateTank();
                                alert('刪除成功');
                            } catch (e) {
                                console.error(e);
                                alert('刪除失敗');
                            }
                        };

                        if (historyItems.length === 0) return null;

                        return (
                            <div className="mt-8 border-t border-slate-200 pt-6">
                                <div className="flex justify-between items-center mb-4">
                                    <h4 className="font-bold text-slate-800 flex items-center">
                                        <Icons.ClipboardPen className="w-4 h-4 mr-2" />
                                        歷史紀錄 (最近{historyLimit}筆 - 可編輯)
                                    </h4>
                                    <button
                                        onClick={() => setShowMoreHistory(!showMoreHistory)}
                                        className="text-sm text-brand-600 hover:text-brand-800 underline"
                                    >
                                        {showMoreHistory ? '顯示較少' : '顯示更多歷史紀錄'}
                                    </button>
                                </div>
                                <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[500px] overflow-y-auto">
                                    <table className="min-w-full divide-y divide-slate-200">
                                        <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">週起始日</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">蒸汽總產量 (ton)</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-slate-200">
                                            {historyItems.map(item => (
                                                <tr key={item.id} className="hover:bg-slate-50">
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                        {item.date ? new Date(item.date).toLocaleDateString() : '-'}
                                                    </td>
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                        {item.steamProduction || '-'}
                                                    </td>
                                                    <td className="px-3 py-2 whitespace-nowrap text-right text-sm">
                                                        <button
                                                            onClick={() => handleHistoryEdit(item)}
                                                            className="text-blue-600 hover:text-blue-900 mr-3"
                                                        >
                                                            編輯
                                                        </button>
                                                        <button
                                                            onClick={() => handleHistoryDelete(item.id)}
                                                            className="text-red-600 hover:text-red-900"
                                                        >
                                                            刪除
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}
                </Card>


                <Card
                    title="Excel 批次匯入"
                    className="border-l-4 border-l-slate-400 bg-slate-50"
                >
                    <div className="space-y-6">
                        <div className="bg-white p-4 rounded-lg border border-slate-200 text-sm text-slate-600 space-y-2">
                            <h4 className="font-bold text-slate-800">格式說明 ({activeType})</h4>

                            {activeType === 'A' && (
                                <ul className="list-disc list-inside">
                                    <li>必要欄位: <strong>儲槽名稱</strong></li>
                                    <li>日期欄位: <strong>1/1, 1/2...</strong> (對應液位高度), 亦可包含年份 如 <strong>2026/1/1</strong></li>
                                </ul>
                            )}

                            {activeType === 'B' && (
                                <ul className="list-disc list-inside">
                                    <li>必要欄位: <strong>儲槽名稱</strong> (或適用儲槽), <strong>供應商</strong>, <strong>比重</strong>, <strong>生效日期</strong></li>
                                    <li>選填欄位: <strong>藥劑名稱</strong>, <strong>單價</strong>, <strong>目標藥劑濃度</strong>, <strong>備註</strong></li>
                                </ul>
                            )}

                            {activeType === 'C' && (
                                <ul className="list-disc list-inside">
                                    <li>必要欄位: <strong>區域</strong></li>
                                    <li>參數欄位: <strong>循環水量, 出水溫, 回水溫, 冷卻水硬度, 補水硬度...</strong></li>
                                    <li>注意: <strong>溫差</strong> 與 <strong>濃縮倍數</strong> 將自動計算</li>
                                </ul>
                            )}

                            {activeType === 'D' && (
                                <ul className="list-disc list-inside">
                                    <li>必要欄位: <strong>儲槽名稱</strong></li>
                                    <li>參數欄位: <strong>蒸汽量, 目標濃度</strong></li>
                                </ul>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">選擇檔案 (.xlsx / .csv)</label>
                            <input
                                type="file"
                                accept=".csv, .xlsx, .xls"
                                onChange={e => setFile(e.target.files ? e.target.files[0] : null)}
                                className={`block w-full text-sm text-slate-500
                              file:mr-4 file:py-2 file:px-4
                              file:rounded-full file:border-0
                              file:text-sm file:font-semibold
                              file:bg-slate-200 file:text-slate-700
                              hover:file:bg-slate-300
                              cursor-pointer ${inputClassName} pl-1`}
                            />
                        </div>

                        <Button onClick={processExcel} disabled={!file} className="w-full justify-center" variant="secondary">
                            <Icons.ClipboardPen className="w-4 h-4 mr-2" />
                            開始匯入 (Type {activeType})
                        </Button>
                    </div>
                </Card>

                {/* PI Import Card for CWS & BWS */}
                {(activeType === 'C' || activeType === 'D') && (
                    <Card title={activeType === 'C' ? "冷卻水系統 (CWS) PI 匯入" : "鍋爐系統 (BWS) PI 匯入"} className="border-l-4 border-l-brand-400 bg-brand-50/30">
                        <div className="space-y-4">
                            <div className="bg-white p-4 rounded-lg border border-slate-200 text-sm text-slate-600">
                                {activeType === 'C' ? (
                                    <>讀取 CT-1 / CT-2 區域 Tags 的 <strong>Average</strong> 值。<br />自動寫入該週次的循環水量與溫度。</>
                                ) : (
                                    <>讀取 4 個 Steam Tags 的 <strong>Total</strong> 值 (加總 x 24)。<br />寫入所有鍋爐儲槽。</>
                                )}
                            </div>

                            <div>
                                <label className="block text-slate-500 text-xs mb-1">PI Web API URL</label>
                                <input
                                    type="text"
                                    value={piBaseUrl}
                                    onChange={e => setPiBaseUrl(e.target.value)}
                                    className="w-full text-xs rounded border-slate-300 bg-white"
                                />
                            </div>

                            <div className="flex items-end gap-3">
                                <div className="flex-1">
                                    <label className="block text-slate-500 text-sm mb-1">時間範圍</label>
                                    <select
                                        value={importWeeks}
                                        onChange={(e) => setImportWeeks(Number(e.target.value))}
                                        className="w-full rounded-lg border-slate-300 border p-2 bg-white text-slate-700"
                                    >
                                        <option value={1}>近 1 週</option>
                                        <option value={4}>近 4 週</option>
                                        <option value={12}>近 12 週</option>
                                    </select>
                                </div>
                                <Button
                                    onClick={activeType === 'C' ? handleBatchImportCWS : handleBatchImportBWS}
                                    disabled={importing}
                                    className="bg-brand-600 hover:bg-brand-700 text-white h-[40px] px-6"
                                >
                                    {importing ? "匯入中..." : `開始 ${activeType === 'C' ? 'CWS' : 'BWS'} 匯入`}
                                </Button>
                            </div>

                            {importLogs.length > 0 && (
                                <div className="mt-4 p-3 bg-slate-900 rounded border border-slate-700 max-h-32 overflow-y-auto font-mono text-xs text-slate-400">
                                    {importLogs.map((log, i) => <div key={i}>{log}</div>)}
                                </div>
                            )}
                        </div>
                    </Card>
                )}

            </div>

            <div className="flex justify-between pt-4 border-t border-slate-200">
                {/* Buttons moved specifically to Type A and Type B sections */}
            </div>
            {/* Anomaly Modal */}
            <ImportAnomalyModal
                isOpen={showAnomalyModal}
                anomalies={importAnomalies}
                onConfirm={handleConfirmImport}
                onCancel={handleCancelImport}
                onAddNote={handleAddNote}
            />
        </div>
    );
};

// Helper Component: Generic Edit Dialog
const EditDialog: React.FC<{
    isOpen: boolean;
    title: string;
    onClose: () => void;
    onSave: () => void;
    children: React.ReactNode;
}> = ({ isOpen, title, onClose, onSave, children }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-slate-800">{title}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <Icons.X className="w-5 h-5" />
                    </button>
                </div>
                <div className="space-y-4">
                    {children}
                </div>
                <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
                    <Button variant="secondary" onClick={onClose}>取消</Button>
                    <Button onClick={onSave}>儲存變更</Button>
                </div>
            </div>
        </div>
    );
};

const AnalysisView: React.FC<{
    tanks: Tank[],
    readings: Reading[],
    initialState?: { tankId: string, monthStr: string } | null,
    onStateConsumed?: () => void
}> = ({ tanks, readings, initialState, onStateConsumed }) => {
    const [selectedTankId, setSelectedTankId] = useState<string>(tanks[0]?.id || '');

    const getLastMonthRange = () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth(); // 0-indexed (Jan=0)

        // Previous month logic
        // If Jan 2026 (month=0), we want Dec 2025.
        // new Date(year, month - 1, 1) automatically handles year wrap-around.
        const startOfLastMonth = new Date(year, month - 1, 1);
        const endOfLastMonth = new Date(year, month, 0); // Last day of previous month

        return {
            start: startOfLastMonth.toLocaleDateString('zh-CA'), // YYYY-MM-DD
            end: endOfLastMonth.toLocaleDateString('zh-CA'),
            yearMonth: `${startOfLastMonth.getFullYear()}-${String(startOfLastMonth.getMonth() + 1).padStart(2, '0')}`
        };
    };

    const defaultRangeData = useMemo(() => getLastMonthRange(), []);

    // Default to Last Month Range
    const [tempDateRange, setTempDateRange] = useState({ start: defaultRangeData.start, end: defaultRangeData.end });
    const [appliedDateRange, setAppliedDateRange] = useState({ start: defaultRangeData.start, end: defaultRangeData.end });

    // Month Picker State - Default to Last Month
    const [selectedMonth, setSelectedMonth] = useState<string>(defaultRangeData.yearMonth);

    // Initial State Handing
    useEffect(() => {
        if (initialState) {
            console.log('AnalysisView applying initial state:', initialState);
            if (initialState.tankId) setSelectedTankId(initialState.tankId);

            if (initialState.monthStr) {
                // Apply month string (YYYY-MM)
                setSelectedMonth(initialState.monthStr);
                const [year, month] = initialState.monthStr.split('-').map(Number);
                const startDate = new Date(year, month - 1, 1);
                const endDate = new Date(year, month, 0);

                const startStr = startDate.toLocaleDateString('zh-CA');
                const endStr = endDate.toLocaleDateString('zh-CA');

                const newRange = { start: startStr, end: endStr };
                setTempDateRange(newRange);
                setAppliedDateRange(newRange);
            }

            if (onStateConsumed) onStateConsumed();
        }
    }, [initialState, onStateConsumed]);



    // Help Tooltip State
    const [helpTopic, setHelpTopic] = useState<'weekly' | 'monthly' | null>(null);

    const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value; // YYYY-MM
        setSelectedMonth(val);
        if (val) {
            const [year, month] = val.split('-').map(Number);
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0);

            // Adjust to local timezone string YYYY-MM-DD
            const startStr = startDate.toLocaleDateString('zh-CA'); // YYYY-MM-DD
            const endStr = endDate.toLocaleDateString('zh-CA');

            const newRange = { start: startStr, end: endStr };
            setTempDateRange(newRange);
            // Optional: Auto-apply? Let's just update temp range for consistency with user flow
            // If user wants one-click apply, we can do setAppliedDateRange here too?
            // Current flow suggests user clicks "Apply" button (filter icon?).
            // Let's stick to update params, user clicks button if that exists, OR if the UI has auto-apply on month change?
            // Looking at UI code (not fully visible here but assuming standard pattern):
            // Usually there is handleApply or similar.
            // But for Month Picking convenience, it might be better to auto-apply tempRange if the user uses the specific month picker.
            // Let's just update temp for now.
        }
    };

    const [metric, setMetric] = useState<'KG' | 'L' | '$'>('KG');
    const [bwsParamsHistory, setBwsParamsHistory] = useState<BWSParameterRecord[]>([]);
    const [cwsParamsHistory, setCwsParamsHistory] = useState<CWSParameterRecord[]>([]);
    const [suppliesHistory, setSuppliesHistory] = useState<ChemicalSupply[]>([]);

    const selectedTank = tanks.find(t => t.id === selectedTankId);

    // 載入該儲槽的參數歷史記錄和藥劑合約歷史
    useEffect(() => {
        const loadParamsHistory = async () => {
            if (!selectedTankId) return;
            try {
                const bwsHistory = await StorageService.getBWSParamsHistory(selectedTankId);
                const cwsHistory = await StorageService.getCWSParamsHistory(selectedTankId);
                const supplies = await StorageService.getSupplies();
                const tankSupplies = supplies.filter(s => s.tankId === selectedTankId);
                setBwsParamsHistory(bwsHistory);
                setCwsParamsHistory(cwsHistory);
                setSuppliesHistory(tankSupplies.sort((a, b) => b.startDate - a.startDate));
            } catch (error) {
                console.error('載入參數歷史記錄失敗:', error);
            }
        };
        loadParamsHistory();
    }, [selectedTankId]);

    // 1. Process readings into daily continuous data (Extended for Weekly View)
    // We strictly follow "Weekly View should show complete weeks (Mon-Sun)".
    // So if user selects 12/1 (Tue) - 12/31, we extend start to 11/30 (Mon) and end to nearest Sun.
    const dailyData = useMemo(() => {
        if (!selectedTank || readings.length < 2) return [];

        // Calculate Extended Range for Data Fetching
        const userStart = new Date(appliedDateRange.start);
        const userEnd = new Date(appliedDateRange.end);

        // Extend Start to Monday
        const startDay = userStart.getDay(); // 0=Sun, 1=Mon
        const daysToMon = (startDay + 6) % 7; // If Mon(1)->0, Tue(2)->1... Sun(0)->6
        const extStart = new Date(userStart);
        extStart.setDate(userStart.getDate() - daysToMon);

        // Extend End to Sunday
        const endDay = userEnd.getDay(); // 0=Sun...
        const daysToSun = (7 - endDay) % 7; // If Sun(0)->0, Mon(1)->6...
        const extEnd = new Date(userEnd);
        extEnd.setDate(userEnd.getDate() + daysToSun);

        const startTs = getNormalizedTimestamp(extStart);
        const endTs = getNormalizedTimestamp(extEnd) + (24 * 60 * 60 * 1000 - 1);

        // Get readings within range
        const readingsInRange = readings
            .filter(r => r.tankId === selectedTankId && r.timestamp >= startTs && r.timestamp <= endTs);

        // Find ONE reading just before startTs
        const prevReading = readings
            .filter(r => r.tankId === selectedTankId && r.timestamp < startTs)
            .sort((a, b) => b.timestamp - a.timestamp)[0]; // Latest one before startTs

        // Find ONE reading just after endTs to allow calculating the last interval crossing the end date
        // This fixes the issue where usage for the end of the month is missing if the interval extends beyond endTs
        const nextReading = readings
            .filter(r => r.tankId === selectedTankId && r.timestamp > endTs)
            .sort((a, b) => a.timestamp - b.timestamp)[0]; // Earliest one after endTs

        const tankReadings = [prevReading, ...readingsInRange, nextReading]
            .filter(Boolean)
            // Deduplicate (in case range overlaps perfectly with prev/next finding logic, though filter >/< should prevent this)
            .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)
            .sort((a, b) => a.timestamp - b.timestamp);

        if (tankReadings.length < 1) return [];

        const dailyMap = new Map<string, { date: Date, usage: number, refill: number, level: number }>();

        for (let i = 0; i < tankReadings.length - 1; i++) {
            const curr = tankReadings[i];
            const next = tankReadings[i + 1];

            const diffMs = next.timestamp - curr.timestamp;
            const diffDays = diffMs / (1000 * 60 * 60 * 24);

            if (diffDays <= 0) continue;

            let totalUsage = 0;
            let startLevel = 0;
            let endLevel = 0;

            if (metric === 'L') {
                startLevel = curr.calculatedVolume;
                endLevel = next.calculatedVolume;
                totalUsage = (startLevel + next.addedAmountLiters) - endLevel;
            } else {
                // Apply historic specific gravity for KG or Cost ($)
                const addedKg = next.addedAmountLiters * next.appliedSpecificGravity;
                startLevel = curr.calculatedWeightKg;
                endLevel = next.calculatedWeightKg;
                totalUsage = (startLevel + addedKg) - endLevel;
            }

            const dailyUsage = Math.max(0, totalUsage / diffDays);

            let iterDate = new Date(curr.timestamp);
            while (iterDate < new Date(next.timestamp)) {
                // 使用 Local Time 建構日期 Key，與 AnnualDataView 一致，避免時區錯位
                const Y = iterDate.getFullYear();
                const M = String(iterDate.getMonth() + 1).padStart(2, '0');
                const D = String(iterDate.getDate()).padStart(2, '0');
                const dateKey = `${Y}-${M}-${D}`;
                if (!dailyMap.has(dateKey)) {
                    let finalValue = dailyUsage;

                    // If Cost metric, multiply by price
                    if (metric === '$') {
                        // Find active supply for this specific day to get price
                        const dayTime = iterDate.getTime();
                        const activeSupply = suppliesHistory.find(s => s.startDate <= dayTime);
                        const price = activeSupply?.price || 0;
                        finalValue = dailyUsage * price;
                    }

                    dailyMap.set(dateKey, {
                        date: new Date(iterDate),
                        usage: finalValue,
                        refill: 0,
                        level: metric === 'L' ? curr.calculatedVolume : curr.calculatedWeightKg
                    });
                }
                iterDate.setDate(iterDate.getDate() + 1);
            }
        }

        return Array.from(dailyMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [readings, selectedTankId, metric, selectedTank, appliedDateRange]);

    // 2. Weekly Aggregation (Directly uses extended dailyData to form complete weeks)
    const weeklyData = useMemo(() => {
        if (dailyData.length === 0) return [];

        const weeklyMap = new Map<string, { date: Date, dateStr: string, usage: number, avgLevel: number, count: number }>();

        dailyData.forEach(day => {
            const dayDate = new Date(day.date);
            const dayNum = dayDate.getDay();
            const daysSinceMonday = (dayNum + 6) % 7;
            const weekStart = new Date(dayDate);
            weekStart.setDate(dayDate.getDate() - daysSinceMonday);
            weekStart.setHours(0, 0, 0, 0);

            const key = weekStart.toISOString().split('T')[0];

            if (!weeklyMap.has(key)) {
                weeklyMap.set(key, {
                    date: weekStart,
                    dateStr: `${weekStart.getMonth() + 1}/${weekStart.getDate()}`,
                    usage: 0,
                    avgLevel: 0,
                    count: 0
                });
            }

            const w = weeklyMap.get(key)!;
            w.usage += day.usage;
            w.avgLevel += day.level;
            w.count += 1;
        });

        return Array.from(weeklyMap.values()).map(w => ({
            ...w,
            level: w.avgLevel / (w.count || 1)
        })).sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [dailyData]);

    // 3. Monthly Comparison Data (Actual vs Theoretical)
    const monthlyComparisonData = useMemo(() => {
        if (!selectedTank || dailyData.length === 0) return [];

        // STRICT filtering by appliedDateRange for Monthly Charts
        // We do NOT want the extended days (padding for weeks) to affect monthly stats.
        const userStart = getNormalizedTimestamp(appliedDateRange.start);
        const userEnd = getNormalizedTimestamp(appliedDateRange.end) + (24 * 60 * 60 * 1000 - 1);

        const filteredDaily = dailyData.filter(d => {
            const t = d.date.getTime();
            return t >= userStart && t <= userEnd;
        });

        const monthlyMap = new Map<string, {
            date: Date,
            dateStr: string,
            actual: number,
            theoretical: number,
            days: number,
            sgSet: Set<number>,
            priceSet: Set<number>
        }>();

        // Initialize Monthly Map with ALL months in range (or at least cover the days found)
        // Better: Iterate through the time range day by day to build a complete picture
        // BUT, simplified: Iterate through filteredDaily to get months, THEN fill missing days for theoretical.

        filteredDaily.forEach(day => {
            const mKey = `${day.date.getFullYear()}-${String(day.date.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlyMap.has(mKey)) {
                monthlyMap.set(mKey, {
                    date: new Date(day.date.getFullYear(), day.date.getMonth(), 1),
                    dateStr: `${day.date.getFullYear()}/${day.date.getMonth() + 1}`,
                    actual: 0,
                    theoretical: 0,
                    days: 0,
                    sgSet: new Set(),
                    priceSet: new Set()
                }); // Will calculate theoretical for the WHOLE month later
            }
            const m = monthlyMap.get(mKey)!;
            m.actual += day.usage;
            m.days++;

            // Track SG/Price used
            const dayTime = day.date.getTime();
            const activeSupply = suppliesHistory.find(s => s.startDate <= dayTime);
            const price = activeSupply?.price || 0;
            const sg = activeSupply?.specificGravity;

            if (sg !== undefined) m.sgSet.add(Math.round(sg * 10000) / 10000);
            if (price) m.priceSet.add(Math.round(price * 100) / 100);
        });

        // Loop through each month to calculate FULL Monthly Theoretical Usage
        // This ensures even if we only have data for 1/5-1/31, we calculate theoretical for 1/1-1/31
        monthlyMap.forEach(m => {
            const year = m.date.getFullYear();
            const month = m.date.getMonth(); // 0-indexed
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const today = new Date();
            today.setHours(23, 59, 59, 999);
            const todayTime = today.getTime();

            let monthTheory = 0;

            for (let d = 1; d <= daysInMonth; d++) {
                const dayDate = new Date(year, month, d);
                const dayTime = dayDate.getTime();

                // Skip future dates
                if (dayTime > todayTime) continue;

                // 1. Find effective Supply for this specific day
                const activeSupply = suppliesHistory.find(s => s.startDate <= dayTime);
                const targetPpm = activeSupply?.targetPpm || 0;
                const price = activeSupply?.price || 0;

                if (!targetPpm) continue;

                let dailyTheoretical = 0;
                const calcMethod = selectedTank.calculationMethod || 'NONE';

                if (calcMethod === 'CWS_BLOWDOWN') {
                    // Find parameters that COVER this day
                    const cwsParam = cwsParamsHistory.find(p => {
                        const pDate = p.date || 0;
                        const pEnd = pDate + (7 * 24 * 60 * 60 * 1000);
                        return dayTime >= pDate && dayTime < pEnd;
                    }) || selectedTank.cwsParams; // Fallback only if tank.cwsParams exists (legacy), but ideally restrict like AnnualDataView

                    // Strict sync with AnnualDataView: AnnualDataView logic does NOT use fallback if logic was updated to match implementation plan
                    // The implementation plan for AnnualDataView removed fallback. 
                    // Let's check if we should be strict here too.
                    // The recent change to AnnualDataView REMOVED the fallback to tank.cwsParams if looking for weekly data fails to find one?
                    // Actually, AnnualDataView implementation: 
                    // const cwsParam = tankCwsHistory.find(...) || tank.cwsParams;
                    // It STILL has fallback in the code I inserted? 
                    // Wait, looking at Step 134 diff:
                    // const cwsParam = tankCwsHistory.find(...) || tank.cwsParams; <-- REMOVED fallback? No, the diff showed:
                    // - }) || tank.cwsParams;
                    // + });
                    // So YES, AnnualDataView REMOVED fallback. We should do the same here for consistency.

                    // Re-finding strictly without fallback to match AnnualDataView's latest logic
                    const strictCwsParam = cwsParamsHistory.find(p => {
                        const pDate = p.date || 0;
                        const pEnd = pDate + (7 * 24 * 60 * 60 * 1000);
                        return dayTime >= pDate && dayTime < pEnd;
                    });

                    if (strictCwsParam) {
                        const { circulationRate, tempDiff, cwsHardness, makeupHardness, concentrationCycles } = strictCwsParam;
                        const R = circulationRate || 0;
                        const dT = tempDiff || 0;
                        let C = 1;
                        if (cwsHardness && makeupHardness && makeupHardness > 0) {
                            C = cwsHardness / makeupHardness;
                        } else if (concentrationCycles && concentrationCycles > 1) {
                            C = concentrationCycles;
                        }
                        const E = (R * dT * 1.8 * 24) / 1000;
                        const B = C > 1 ? E / (C - 1) : 0;
                        dailyTheoretical = (B * targetPpm) / 1000;
                    }

                } else if (calcMethod === 'BWS_STEAM') {
                    const bwsParam = bwsParamsHistory.find(p => {
                        const pDate = p.date || 0;
                        const pEnd = pDate + (7 * 24 * 60 * 60 * 1000);
                        return dayTime >= pDate && dayTime < pEnd;
                    }) || selectedTank.bwsParams; // AnnualDataView removed fallback here too? Yes.

                    // Strict find
                    const strictBwsParam = bwsParamsHistory.find(p => {
                        const pDate = p.date || 0;
                        const pEnd = pDate + (7 * 24 * 60 * 60 * 1000);
                        return dayTime >= pDate && dayTime < pEnd;
                    });

                    if (strictBwsParam && strictBwsParam.steamProduction) {
                        const weeklySteam = strictBwsParam.steamProduction;
                        const dailySteam = weeklySteam / 7;
                        dailyTheoretical = (dailySteam * targetPpm) / 1000;
                    }
                }

                // Convert to Cost if needed
                if (metric === '$') {
                    dailyTheoretical = dailyTheoretical * price;
                }

                monthTheory += dailyTheoretical;
            }

            m.theoretical = monthTheory;
        });

        return Array.from(monthlyMap.values()).map(m => {
            // 取得該月最後一天有效的藥劑合約（而非逐日收集，避免舊合約干擾）
            const monthEnd = new Date(m.date.getFullYear(), m.date.getMonth() + 1, 0); // 該月最後一天
            const monthEndTime = monthEnd.getTime();
            const activeSupplyForMonth = suppliesHistory.find(s => s.startDate <= monthEndTime);

            const specificGravity = activeSupplyForMonth?.specificGravity;
            const price = activeSupplyForMonth?.price;

            return {
                dateStr: m.dateStr,
                date: m.date,
                actual: m.actual,
                theoretical: m.theoretical,
                deviation: m.theoretical > 0 ? ((m.actual - m.theoretical) / m.theoretical) * 100 : 0,
                specificGravity,
                price
            };
        }).sort((a, b) => a.date.getTime() - b.date.getTime());

    }, [dailyData, selectedTank, metric, suppliesHistory, cwsParamsHistory, bwsParamsHistory, appliedDateRange]);

    // 4. Weekly Comparison Data (Actual vs Theoretical)
    const weeklyComparisonData = useMemo(() => {
        if (!selectedTank || weeklyData.length === 0) return [];

        return weeklyData.map(week => {
            let theoreticalTotal = 0;
            const weekStartTime = week.date.getTime();
            const weekEndTime = weekStartTime + (7 * 24 * 60 * 60 * 1000);

            // 逐日收集該週使用的比重與單價
            const sgSet = new Set<number>();
            const priceSet = new Set<number>();

            for (let i = 0; i < 7; i++) {
                const dayTime = weekStartTime + i * 24 * 60 * 60 * 1000;
                const activeSupplyForDay = suppliesHistory.find(s => s.startDate <= dayTime);
                if (activeSupplyForDay?.specificGravity !== undefined) {
                    sgSet.add(Math.round(activeSupplyForDay.specificGravity * 10000) / 10000);
                }
                if (activeSupplyForDay?.price) {
                    priceSet.add(Math.round(activeSupplyForDay.price * 100) / 100);
                }
            }

            // 取得該週末有效的藥劑合約（用於計算）
            const activeSupply = suppliesHistory
                .filter(s => s.startDate <= weekEndTime)
                .sort((a, b) => b.startDate - a.startDate)[0];
            const targetPpm = activeSupply?.targetPpm || 0;
            const calcPrice = activeSupply?.price || 0;

            // Calculate theoretical usage based on tank calculation method
            if (selectedTank.calculationMethod === 'BWS_STEAM') {
                // Find BWS data for this exact week (must have steamProduction for that week)
                const weekData = bwsParamsHistory.find(p => {
                    const pDate = p.date || 0;
                    return pDate >= weekStartTime && pDate < weekEndTime;
                });

                // Only calculate if we have steamProduction for this week
                if (weekData && weekData.steamProduction) {
                    const steamProduction = weekData.steamProduction;
                    theoreticalTotal = (steamProduction * targetPpm) / 1000;

                    if (metric === '$' && calcPrice) {
                        theoreticalTotal = theoreticalTotal * calcPrice;
                    }
                }
                // If no weekData with steamProduction, theoreticalTotal stays 0
            } else if (selectedTank.calculationMethod === 'CWS_BLOWDOWN') {
                // Find CWS data for this exact week (must have production data for that week)
                const weekData = cwsParamsHistory.find(p => {
                    const pDate = p.date || 0;
                    return pDate >= weekStartTime && pDate < weekEndTime;
                });

                // Use weekData if available, otherwise fallback to tank defaults
                const params = weekData || selectedTank.cwsParams;

                // Only calculate if we have effective parameters
                if (params && params.circulationRate && params.tempDiff) {
                    const { circulationRate, tempDiff, cwsHardness, makeupHardness, concentrationCycles } = params;

                    const days = 7;
                    const E = (circulationRate * tempDiff * 1.8 * 24 * days) / 1000;

                    let C = 1;
                    if (cwsHardness && makeupHardness && makeupHardness > 0) {
                        C = cwsHardness / makeupHardness;
                    } else if (concentrationCycles && concentrationCycles > 1) {
                        C = concentrationCycles;
                    }

                    const BW = C > 1 ? E / (C - 1) : 0;
                    theoreticalTotal = (BW * targetPpm) / 1000;

                    if (metric === '$' && calcPrice) {
                        theoreticalTotal = theoreticalTotal * calcPrice;
                    }
                }
                // If no weekData with production data, theoreticalTotal stays 0
            }

            // 計算比重與單價結果
            const sgArray = Array.from(sgSet);
            const priceArray = Array.from(priceSet);

            return {
                dateStr: week.dateStr,
                date: week.date,
                actual: week.usage,
                theoretical: theoreticalTotal,
                deviation: theoreticalTotal > 0 ? ((week.usage - theoreticalTotal) / theoreticalTotal) * 100 : 0,
                specificGravity: sgArray.length === 1 ? sgArray[0] : undefined,
                specificGravityMultiple: sgArray.length > 1 ? sgArray : undefined,
                price: priceArray.length === 1 ? priceArray[0] : undefined,
                priceMultiple: priceArray.length > 1 ? priceArray : undefined
            };
        }).sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [weeklyData, selectedTank, bwsParamsHistory, cwsParamsHistory, suppliesHistory, metric]);

    const hasCalculation = selectedTank && selectedTank.calculationMethod && selectedTank.calculationMethod !== 'NONE';

    // Theoretical Calculation Details Card
    const TheoreticalUsageCard: React.FC<{ tank: Tank, weeklyData: any[] }> = ({ tank, weeklyData }) => {
        // 取得該日期有效的藥劑合約 (用於取得 targetPpm)
        const getActiveSupplyForDate = (date: Date): ChemicalSupply | undefined => {
            const timestamp = date.getTime();
            // 找到該日期之前最近的合約
            return suppliesHistory
                .filter(s => s.startDate <= timestamp)
                .sort((a, b) => b.startDate - a.startDate)[0];
        };

        // 對於每週數據,找出對應的參數記錄
        const getParamsForWeek = (weekStart: Date) => {
            const weekStartTime = weekStart.getTime();
            const weekEndTime = weekStartTime + (7 * 24 * 60 * 60 * 1000);

            if (tank.calculationMethod === 'BWS_STEAM') {
                // 找該週內的 BWS 參數,優先使用該週的,否則使用最近的歷史值
                const weekParams = bwsParamsHistory.find(p => {
                    const pDate = p.date || 0;
                    return pDate >= weekStartTime && pDate < weekEndTime;
                });

                // Only use data if we have steamProduction for this week
                if (weekParams && weekParams.steamProduction) {
                    return weekParams;
                }
                // If no production data for this week, return null (no fallback)
                return null;
            } else if (tank.calculationMethod === 'CWS_BLOWDOWN') {
                const weekParams = cwsParamsHistory.find(p => {
                    const pDate = p.date || 0;
                    const match = pDate >= weekStartTime && pDate < weekEndTime;
                    // Debug Log for specific week matching
                    // console.log(`Checking CWS Week ${weekStart.toLocaleDateString()}:`, { pDate: new Date(pDate).toLocaleDateString(), match });
                    return match;
                });

                // Only use data if we have production data for this week
                if (weekParams && weekParams.circulationRate && weekParams.tempDiff) {
                    return weekParams;
                }

                // Debug if missing
                // console.log(`No CWS params found for week ${weekStart.toLocaleDateString()} in history of size ${cwsParamsHistory.length}`);

                // If no production data for this week, return null (no fallback)
                return null;
            }
            return null;
        };
        const [selectedWeek, setSelectedWeek] = useState<{
            weekStr: string;
            params: any;

            calc: { E: number, C: number, BW: number, theoryUsage: number, cFormula: string };
            targetPpm: number;
            price: number;
        } | null>(null);

        if (tank.calculationMethod === 'CWS_BLOWDOWN') {
            if (weeklyData.length === 0) return null;

            return (
                <Card title="理論用量計算展示 (每個單週)" className="mt-6 border-l-4 border-l-sky-500">
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-200">
                                    <th className="p-2 font-semibold text-slate-800">週次</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">循環水量 R (m³/h)</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">溫差 ΔT (°C)</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">濃縮倍數 N</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">目標濃度 (ppm)</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">理論用量 ({metric})</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">實際用量 ({metric})</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">差異 %</th>
                                    <th className="p-2 font-semibold text-slate-800 text-center">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {weeklyData.map((week, idx) => {
                                    const params = getParamsForWeek(week.date) as CWSParameterRecord | undefined;
                                    // Use params if available, else fallback to tank default if exists
                                    const p = params || tank.cwsParams || {} as any;

                                    const circulationRate = p.circulationRate || 0;
                                    const tempDiff = p.tempDiff || 0;
                                    const cwsHardness = p.cwsHardness || 0;
                                    const makeupHardness = p.makeupHardness || 0;

                                    // 從藥劑合約取得 targetPpm
                                    const activeSupply = getActiveSupplyForDate(week.date);
                                    const targetPpm = activeSupply?.targetPpm || 0;

                                    const days = 7;
                                    const E = (circulationRate * tempDiff * 1.8 * 24 * days) / 1000;

                                    let C = 1;
                                    let cFormula = `預設 1`;
                                    // Same priority as chart logic
                                    if (cwsHardness && makeupHardness && makeupHardness > 0) {
                                        C = cwsHardness / makeupHardness;
                                        cFormula = `${cwsHardness} (冷卻水) / ${makeupHardness} (補水) = ${C.toFixed(1)}`;
                                    } else if (p.concentrationCycles && p.concentrationCycles > 1) {
                                        C = p.concentrationCycles;
                                        cFormula = `手動設定: ${C}`;
                                    }

                                    const BW = C > 1 ? E / (C - 1) : 0;

                                    // Calculate Theoretical Usage
                                    // If metric is '$', convert to Cost
                                    // activeSupply already found above (Need to ensure price is available)
                                    const price = activeSupply?.price || 0;
                                    let theoryUsage = (BW * targetPpm) / 1000;
                                    if (metric === '$') {
                                        theoryUsage = theoryUsage * price;
                                    }

                                    const actualUsage = week.usage; // This is already in correct metric from weeklyData
                                    const diffPercent = theoryUsage > 0 ? ((actualUsage - theoryUsage) / theoryUsage * 100) : 0;
                                    const diffColor = Math.abs(diffPercent) > 20 ? 'text-red-600' :
                                        Math.abs(diffPercent) > 10 ? 'text-yellow-600' : 'text-green-600';

                                    const weekStartTime = week.date.getTime();
                                    const weekEndTime = weekStartTime + (7 * 24 * 60 * 60 * 1000);
                                    const isHistory = params && params.date && params.date >= weekStartTime && params.date < weekEndTime;

                                    return (
                                        <tr key={idx} className={`hover:bg-sky-50 transition-colors cursor-pointer ${idx % 2 === 0 ? 'bg-slate-50' : 'bg-white'}`}
                                            onClick={() => setSelectedWeek({
                                                weekStr: week.dateStr,
                                                params: p,
                                                calc: { E, C, BW, theoryUsage, cFormula },
                                                targetPpm: targetPpm,
                                                price: price
                                            })}
                                        >
                                            <td className="p-2 font-medium text-slate-700">{week.dateStr}</td>
                                            <td className="p-2 text-right font-mono text-slate-600">{circulationRate}</td>
                                            <td className="p-2 text-right font-mono text-slate-600">{tempDiff}</td>
                                            <td className="p-2 text-right font-mono text-slate-600">{C.toFixed(1)}</td>
                                            <td className="p-2 text-right font-mono text-slate-600">{targetPpm}</td>
                                            <td className="p-2 text-right font-bold text-red-600">{theoryUsage.toFixed(1)}</td>
                                            <td className="p-2 text-right font-bold text-blue-600">{actualUsage.toFixed(1)}</td>
                                            <td className={`p-2 text-right font-bold ${diffColor}`}>
                                                {diffPercent > 0 ? '+' : ''}{diffPercent.toFixed(1)}%
                                            </td>
                                            <td className="p-2 text-center">
                                                <button className="text-xs bg-sky-100 text-sky-700 px-2 py-1 rounded hover:bg-sky-200">
                                                    詳細計算
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Calculation Details Modal */}
                    {selectedWeek && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.stopPropagation()}>
                            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl animate-in fade-in zoom-in duration-200 relative">
                                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-sky-50 rounded-t-lg">
                                    <h3 className="text-lg font-bold text-slate-800 flex items-center">
                                        <Icons.Calculator className="w-5 h-5 mr-2 text-sky-600" />
                                        理論用量計算詳情 - {selectedWeek.weekStr}
                                    </h3>
                                    <button
                                        onClick={() => setSelectedWeek(null)}
                                        className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"
                                    >
                                        <Icons.X className="w-6 h-6" />
                                    </button>
                                </div>
                                <div className="p-6 space-y-6">
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                        <div className="bg-slate-50 p-3 rounded border border-slate-100">
                                            <span className="text-slate-500 block">循環水量 (R)</span>
                                            <span className="font-mono text-lg font-bold text-slate-800">{selectedWeek.params.circulationRate || 0} m³/h</span>
                                        </div>
                                        <div className="bg-slate-50 p-3 rounded border border-slate-100">
                                            <span className="text-slate-500 block">溫差 (ΔT)</span>
                                            <span className="font-mono text-lg font-bold text-slate-800">{selectedWeek.params.tempDiff || 0} °C</span>
                                        </div>
                                        <div className="bg-slate-50 p-3 rounded border border-slate-100">
                                            <span className="text-slate-500 block">濃縮倍數 (N)</span>
                                            <span className="font-mono text-lg font-bold text-slate-800">{selectedWeek.calc.C.toFixed(2)}</span>
                                        </div>
                                        <div className="bg-slate-50 p-3 rounded border border-slate-100">
                                            <span className="text-slate-500 block">目標濃度</span>
                                            <span className="font-mono text-lg font-bold text-slate-800">{selectedWeek.targetPpm || 0} ppm</span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 border-t border-slate-100 pt-6">
                                        <div className="space-y-6">
                                            <div>
                                                <h4 className="font-bold text-slate-700 mb-2">1. 週蒸發水量 (E)</h4>
                                                <div className="bg-slate-50 p-3 rounded font-mono text-sm text-slate-600 border border-slate-200">
                                                    = R x ΔT x 1.8/1000 x 24HR x 7天<br />
                                                    = {selectedWeek.params.circulationRate} x {selectedWeek.params.tempDiff} x 1.8/1000 x 24 x 7<br />
                                                    = <span className="text-sky-600 font-bold">{selectedWeek.calc.E.toFixed(1)} m³</span>
                                                </div>
                                            </div>

                                            <div>
                                                <h4 className="font-bold text-slate-700 mb-2">2. 平均濃縮倍數 (C)</h4>
                                                <div className="bg-slate-50 p-3 rounded font-mono text-sm text-slate-600 border border-slate-200">
                                                    = {selectedWeek.calc.cFormula}<br />
                                                    = <span className="text-sky-600 font-bold">{selectedWeek.calc.C.toFixed(2)}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-6">
                                            <div>
                                                <h4 className="font-bold text-slate-700 mb-2">3. 週排放水量 (B.W)</h4>
                                                <div className="bg-slate-50 p-3 rounded font-mono text-sm text-slate-600 border border-slate-200">
                                                    = E / (C - 1)<br />
                                                    = {selectedWeek.calc.E.toFixed(1)} / ({selectedWeek.calc.C.toFixed(2)} - 1)<br />
                                                    = <span className="text-sky-600 font-bold">{selectedWeek.calc.BW.toFixed(1)} m³</span>
                                                </div>
                                            </div>

                                            <div className="bg-yellow-50 p-4 rounded border border-yellow-200">
                                                <h4 className="font-bold text-slate-800 mb-2">4. 藥品理論週用量 ({metric})</h4>
                                                <div className="font-mono text-sm text-slate-700">
                                                    {metric === '$' ? (
                                                        <>
                                                            = B.W x 目標濃度 / 1000 x 單價<br />
                                                            = {selectedWeek.calc.BW.toFixed(1)} x {selectedWeek.targetPpm} / 1000 x {selectedWeek.price}<br />
                                                            = <span className="text-red-600 font-bold text-xl">{selectedWeek.calc.theoryUsage.toFixed(1)} {metric}</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            = B.W x 目標濃度 ({selectedWeek.targetPpm} ppm) / 1000<br />
                                                            = {selectedWeek.calc.BW.toFixed(1)} x {selectedWeek.targetPpm} / 1000<br />
                                                            = <span className="text-red-600 font-bold text-xl">{selectedWeek.calc.theoryUsage.toFixed(1)} {metric}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex justify-end pt-2">
                                        <button
                                            onClick={() => setSelectedWeek(null)}
                                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
                                        >
                                            關閉
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </Card>
            );
        } else if (tank.calculationMethod === 'BWS_STEAM') {
            if (weeklyData.length === 0) return null;

            return (
                <Card title="理論用量計算展示 (每週基礎)" className="mt-6 border-l-4 border-l-orange-500">
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-200">
                                    <th className="p-2 font-semibold text-slate-800">週次</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">蒸汽總產量 (ton)</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">目標濃度 (ppm)</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">理論用量 ({metric})</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">實際用量 ({metric})</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">差異 %</th>
                                    <th className="p-2 font-semibold text-slate-800 text-center">數據來源</th>
                                </tr>
                            </thead>
                            <tbody>
                                {weeklyData.map((week, idx) => {
                                    const params = getParamsForWeek(week.date) as BWSParameterRecord | undefined;
                                    const steamProduction = params?.steamProduction || tank.bwsParams?.steamProduction || 0;

                                    // Get Target PPM from Contract
                                    const activeSupply = getActiveSupplyForDate(week.date);
                                    const targetPpm = activeSupply?.targetPpm || 0;
                                    const price = activeSupply?.price || 0;

                                    let theoryUsage = (steamProduction * targetPpm) / 1000;
                                    if (metric === '$') {
                                        theoryUsage = theoryUsage * price;
                                    }

                                    const weekStartTime = week.date.getTime();
                                    const weekEndTime = weekStartTime + (7 * 24 * 60 * 60 * 1000);
                                    const hasWeekData = params && params.date && params.date >= weekStartTime && params.date < weekEndTime;

                                    const actualUsage = week.usage;
                                    const diffPercent = theoryUsage > 0 ? ((actualUsage - theoryUsage) / theoryUsage * 100) : 0;
                                    const diffColor = Math.abs(diffPercent) > 20 ? 'text-red-600' :
                                        Math.abs(diffPercent) > 10 ? 'text-yellow-600' : 'text-green-600';

                                    return (
                                        <tr key={idx} className={idx % 2 === 0 ? 'bg-slate-50' : 'bg-white'}>
                                            <td className="p-2 font-medium text-slate-700">{week.dateStr}</td>
                                            <td className="p-2 text-right font-mono text-orange-700">{steamProduction.toFixed(1)}</td>
                                            <td className="p-2 text-right font-mono">{targetPpm.toFixed(1)}</td>
                                            <td className="p-2 text-right font-bold text-red-600">{theoryUsage.toFixed(1)}</td>
                                            <td className="p-2 text-right font-bold text-blue-600">{actualUsage.toFixed(1)}</td>
                                            <td className={`p-2 text-right font-bold ${diffColor}`}>
                                                {diffPercent > 0 ? '+' : ''}{diffPercent.toFixed(1)}%
                                            </td>
                                            <td className="p-2 text-center">
                                                {hasWeekData ? (
                                                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">當週數據</span>
                                                ) : params ? (
                                                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">歷史數據</span>
                                                ) : (
                                                    <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">預設值</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Card>
            );
        }
        return null;
    };

    if (!selectedTank) return <div>請先設定儲槽</div>;

    // Sort tanks by region: CT-1, CT-2, Boiler, Ammonia, Others
    const sortedTanks = useMemo(() => {
        const regionOrder: Record<string, number> = {
            'CT-1': 1,
            'CT-2': 2,
            '鍋爐': 3,
            '氨水': 4
        };
        return [...tanks].sort((a, b) => {
            const getRegionOrder = (name: string) => {
                if (name.startsWith('CT-1')) return 1;
                if (name.startsWith('CT-2')) return 2;
                if (name.includes('鍋爐') || name.includes('中和胺') || name.includes('清罐劑') || name.includes('脫氧劑')) return 3;
                if (name.includes('氨水')) return 4;
                return 5;
            };
            return getRegionOrder(a.name) - getRegionOrder(b.name);
        });
    }, [tanks]);

    // Group tanks for optgroup display
    const tankGroups = useMemo(() => {
        const groups: Record<string, typeof tanks> = {
            'CT-1 冷卻水': [],
            'CT-2 冷卻水': [],
            '鍋爐藥劑': [],
            '脫硝系統': [],
            '其他': []
        };
        sortedTanks.forEach(t => {
            if (t.name.startsWith('CT-1')) groups['CT-1 冷卻水'].push(t);
            else if (t.name.startsWith('CT-2')) groups['CT-2 冷卻水'].push(t);
            else if (t.name.includes('中和胺') || t.name.includes('清罐劑') || t.name.includes('脫氧劑')) groups['鍋爐藥劑'].push(t);
            else if (t.name.includes('氨水')) groups['脫硝系統'].push(t);
            else groups['其他'].push(t);
        });
        return groups;
    }, [sortedTanks]);

    return (
        <div className="space-y-6">
            {/* Compact Filter Bar */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-4">
                    {/* Tank Selector - Compact */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500">藥劑</span>
                        <select
                            value={selectedTankId}
                            onChange={e => setSelectedTankId(e.target.value)}
                            className={`${inputClassName} w-44 text-sm`}
                        >
                            {Object.entries(tankGroups).map(([group, groupTanks]) => (
                                (groupTanks as any[]).length > 0 && (
                                    <optgroup key={group} label={group}>
                                        {(groupTanks as any[]).map(t => (
                                            <option key={t.id} value={t.id}>{t.name.split(' ').pop()}</option>
                                        ))}
                                    </optgroup>
                                )
                            ))}
                        </select>
                    </div>

                    <span className="text-slate-200">|</span>

                    {/* Month Picker */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500">月份</span>
                        <input
                            type="month"
                            value={selectedMonth}
                            onChange={handleMonthChange}
                            className={`${inputClassName} w-36 text-sm`}
                            onClick={(e) => e.currentTarget.showPicker()}
                        />
                    </div>

                    <span className="text-slate-200">|</span>

                    {/* Custom Date Range */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500">範圍</span>
                        <input
                            type="date"
                            value={tempDateRange.start}
                            onClick={(e) => e.currentTarget.showPicker()}
                            onChange={e => setTempDateRange(prev => ({ ...prev, start: e.target.value }))}
                            className={`${inputClassName} w-32 text-sm`}
                        />
                        <span className="text-slate-400">~</span>
                        <input
                            type="date"
                            value={tempDateRange.end}
                            onClick={(e) => e.currentTarget.showPicker()}
                            onChange={e => setTempDateRange(prev => ({ ...prev, end: e.target.value }))}
                            className={`${inputClassName} w-32 text-sm`}
                        />
                        <Button
                            onClick={() => {
                                setAppliedDateRange(tempDateRange);
                                setSelectedMonth('');
                            }}
                            className="bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-1.5"
                        >
                            套用
                        </Button>
                    </div>

                    <div className="ml-auto flex gap-1">
                        <div className="bg-slate-100 border rounded-lg p-0.5 flex">
                            <button onClick={() => setMetric('KG')} className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${metric === 'KG' ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-200'}`}>KG</button>
                            <button onClick={() => setMetric('L')} className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${metric === 'L' ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-200'}`}>L</button>
                            <button onClick={() => setMetric('$')} className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${metric === '$' ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-200'}`}>$</button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Weekly Comparison Chart - Left */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                            {hasCalculation ? `週用量 vs 理論值 (${metric})` : `週用量趨勢 (${metric})`}
                            {hasCalculation && (
                                <button onClick={() => setHelpTopic('weekly')} className="text-slate-400 hover:text-brand-500 transition-colors">
                                    <Icons.Help className="w-4 h-4" />
                                </button>
                            )}
                        </h3>
                    </div>
                    <div className="px-6 pt-4" style={{ height: '340px' }}>
                        {weeklyComparisonData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                                <ComposedChart data={weeklyComparisonData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis
                                        dataKey="dateStr"
                                        tick={(props) => {
                                            const { x, y, payload } = props;
                                            const data = weeklyComparisonData.find(d => d.dateStr === payload.value);
                                            const diff = data?.deviation || 0;
                                            const color = Math.abs(diff) > 20 ? '#dc2626' : Math.abs(diff) > 10 ? '#ca8a04' : '#16a34a';
                                            return (
                                                <g transform={`translate(${x},${y})`}>
                                                    <text x={0} y={0} dy={16} textAnchor="middle" fill="#666" fontSize={12}>
                                                        {payload.value}
                                                    </text>
                                                    <text x={0} y={20} dy={16} textAnchor="middle" fill={color} fontSize={11} fontWeight="bold">
                                                        {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                                                    </text>
                                                </g>
                                            );
                                        }}
                                    />
                                    <YAxis />
                                    <Tooltip formatter={(value: number) => value.toFixed(1)} />
                                    <Legend verticalAlign="top" />

                                    {hasCalculation && metric === 'KG' && (
                                        <Area type="monotone" dataKey="theoretical" fill="#e0f2fe" stroke="#0ea5e9" name="理論預估" />
                                    )}
                                    <Bar dataKey="actual" barSize={20} fill="#3b82f6" name="實際用量" radius={[4, 4, 0, 0]} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-slate-400">此時間範圍內無足夠數據</div>
                        )}
                    </div>
                    {/* 週用量詳細表格 - 對齊柱狀圖 */}
                    {weeklyComparisonData.length > 0 && (
                        <div className="px-6 pb-2" style={{ marginLeft: '40px', marginRight: '30px' }}>
                            <div className="flex text-xs border-b border-slate-100">
                                <div className="w-12 py-1 text-slate-500 flex-shrink-0">單價</div>
                                <div className="flex-1 flex">
                                    {weeklyComparisonData.map(w => (
                                        <div key={w.dateStr} className="flex-1 text-center py-1 text-slate-700">
                                            {w.price !== undefined ? `$${w.price}` :
                                                w.priceMultiple ? <span className="text-amber-600 cursor-help" title={w.priceMultiple.map(p => `$${p}`).join(', ')}>多值*</span> : '-'}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="flex text-xs">
                                <div className="w-12 py-1 text-slate-500 flex-shrink-0">比重</div>
                                <div className="flex-1 flex">
                                    {weeklyComparisonData.map(w => (
                                        <div key={w.dateStr} className="flex-1 text-center py-1 text-slate-700">
                                            {w.specificGravity !== undefined ? w.specificGravity.toFixed(3) :
                                                w.specificGravityMultiple ? <span className="text-amber-600 cursor-help" title={w.specificGravityMultiple.map(sg => sg.toFixed(3)).join(', ')}>多值*</span> : '-'}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>


                {/* Monthly Comparison Chart - Right */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                            {hasCalculation ? `月用量 vs 理論值 (${metric})` : `月用量趨勢 (${metric})`}
                            <button onClick={() => setHelpTopic('monthly')} className="text-slate-400 hover:text-brand-500 transition-colors">
                                <Icons.Help className="w-4 h-4" />
                            </button>
                        </h3>
                    </div>
                    <div className="px-6 pt-4" style={{ height: '340px' }}>
                        {monthlyComparisonData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                                <ComposedChart data={monthlyComparisonData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis
                                        dataKey="dateStr"
                                        tick={(props) => {
                                            const { x, y, payload } = props;
                                            const data = monthlyComparisonData.find(d => d.dateStr === payload.value);
                                            const diff = data?.deviation || 0;
                                            const color = Math.abs(diff) > 20 ? '#dc2626' : Math.abs(diff) > 10 ? '#ca8a04' : '#16a34a';
                                            return (
                                                <g transform={`translate(${x},${y})`}>
                                                    <text x={0} y={0} dy={16} textAnchor="middle" fill="#666" fontSize={12}>
                                                        {payload.value}
                                                    </text>
                                                    <text x={0} y={20} dy={16} textAnchor="middle" fill={color} fontSize={11} fontWeight="bold">
                                                        {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                                                    </text>
                                                </g>
                                            );
                                        }}
                                    />
                                    <YAxis />
                                    <Tooltip formatter={(value: number) => value.toFixed(1)} />
                                    <Legend verticalAlign="top" />

                                    {hasCalculation && metric === 'KG' && (
                                        <Area type="monotone" dataKey="theoretical" fill="#e0f2fe" stroke="#0ea5e9" name="理論預估" />
                                    )}
                                    <Bar dataKey="actual" barSize={20} fill="#3b82f6" name="實際用量" radius={[4, 4, 0, 0]} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                                <p>尚無足夠數據</p>
                            </div>
                        )}
                    </div>
                    {/* 月用量詳細表格 - 對齊柱狀圖 */}
                    {monthlyComparisonData.length > 0 && (
                        <div className="px-6 pb-2" style={{ marginLeft: '40px', marginRight: '30px' }}>
                            <div className="flex text-xs border-b border-slate-100">
                                <div className="w-12 py-1 text-slate-500 flex-shrink-0">單價</div>
                                <div className="flex-1 flex">
                                    {monthlyComparisonData.map(m => (
                                        <div key={m.dateStr} className="flex-1 text-center py-1 text-slate-700">
                                            {m.price !== undefined ? `$${m.price}` : '-'}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="flex text-xs">
                                <div className="w-12 py-1 text-slate-500 flex-shrink-0">比重</div>
                                <div className="flex-1 flex">
                                    {monthlyComparisonData.map(m => (
                                        <div key={m.dateStr} className="flex-1 text-center py-1 text-slate-700">
                                            {m.specificGravity !== undefined ? m.specificGravity.toFixed(3) : '-'}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <TheoreticalUsageCard tank={selectedTank} weeklyData={weeklyData} />

            {/* Help Modal */}
            {
                helpTopic && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setHelpTopic(null)}>
                        <div className="bg-white rounded-lg shadow-xl w-full max-w-lg animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
                            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-lg">
                                <h3 className="text-lg font-bold text-slate-800 flex items-center">
                                    <Icons.Help className="w-5 h-5 mr-2 text-brand-500" />
                                    {helpTopic === 'weekly' ? '週理論用量計算說明' : '月理論用量計算說明'}
                                </h3>
                                <button onClick={() => setHelpTopic(null)} className="text-slate-400 hover:text-slate-600">
                                    <Icons.X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-6 space-y-4 text-slate-700 text-sm">
                                {helpTopic === 'weekly' ? (
                                    <div className="space-y-4">
                                        <h4 className="font-bold text-brand-700">冷卻水系統 (CWS)</h4>
                                        <div className="bg-slate-50 p-3 rounded font-mono text-xs border border-slate-200">
                                            (循環水量 × 溫差 × 1.8 × 24hr × 7天) / 1000 / (濃縮倍數 - 1) × 目標濃度(ppm) / 1000
                                        </div>
                                        <p>依據當週的平均操作參數計算。</p>

                                        <h4 className="font-bold text-orange-700 mt-4">鍋爐系統 (BWS)</h4>
                                        <div className="bg-slate-50 p-3 rounded font-mono text-xs border border-slate-200">
                                            (當週蒸氣總產量 × 目標濃度(ppm)) / 1000
                                        </div>
                                        <p>直接依據流量計回傳的蒸氣總量計算。</p>

                                        <h4 className="font-bold text-amber-700 mt-4">比重與單價說明</h4>
                                        <ul className="list-disc pl-5 space-y-2">
                                            <li>
                                                <span className="font-semibold">顯示方式</span>：若該週內只有單一比重/單價，則直接顯示該值；若有多個不同的值（例如週中換約），則顯示 <span className="text-amber-600 font-bold">「多值*」</span>，將游標移至該文字可檢視所有數值。
                                            </li>
                                            <li>
                                                計算金額時，系統會依據每日各自適用的合約單價逐日計算後加總。
                                            </li>
                                        </ul>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {hasCalculation && (
                                            <>
                                                <h4 className="font-bold text-slate-800">理論值計算原理</h4>
                                                <p>月度理論值採用<span className="font-bold text-brand-600">「逐日加總」</span>方式計算：</p>
                                                <div className="bg-slate-50 p-3 rounded font-mono text-xs border border-slate-200">
                                                    月總量 = ∑ (每日理論用量)
                                                </div>
                                                <ul className="list-disc pl-5 space-y-2 mt-2">
                                                    <li>
                                                        <span className="font-semibold">每日理論用量</span> = 對應週次的週理論用量 ÷ 7
                                                    </li>
                                                    <li>
                                                        系統會自動找出每一天所屬的週次參數進行計算。
                                                    </li>
                                                    <li>
                                                        此方式能精確處理由於月份天數不同 (28/30/31天) 以及週次跨月所導致的計算誤差，確保月度總和與實際天數完全吻合。
                                                    </li>
                                                </ul>
                                            </>
                                        )}
                                        <h4 className="font-bold text-amber-700 mt-4">比重與單價說明</h4>
                                        <ul className="list-disc pl-5 space-y-2">
                                            <li>
                                                <span className="font-semibold">週次</span>：顯示該週最後生效的藥劑合約之比重與單價。
                                            </li>
                                            <li>
                                                <span className="font-semibold">月份</span>：顯示該月最後一天生效的藥劑合約之比重與單價。
                                            </li>
                                            <li>
                                                計算金額時，系統會依據每日各自適用的合約單價逐日計算後加總。
                                            </li>
                                        </ul>
                                    </div>
                                )}
                            </div>
                            <div className="px-6 py-4 bg-slate-50 rounded-b-lg flex justify-end">
                                <Button onClick={() => setHelpTopic(null)}>關閉</Button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

const ImportantNotesView: React.FC<{ thresholdWarningText?: string }> = ({ thresholdWarningText }) => {
    const [notes, setNotes] = useState<ImportantNote[]>([]);
    const [loading, setLoading] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editingNote, setEditingNote] = useState<ImportantNote | null>(null);
    const [formData, setFormData] = useState<Partial<ImportantNote>>({
        dateStr: formatDateForInput(new Date()),
        area: '',
        chemicalName: '',
        note: ''
    });

    const loadNotes = async () => {
        setLoading(true);
        try {
            const data = await StorageService.getNotes();
            setNotes(data);
        } catch (error) {
            console.error(error);
            alert('載入資料失敗');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadNotes();
    }, []);

    const handleEdit = (note: ImportantNote) => {
        setEditingNote(note);
        setFormData({
            dateStr: note.dateStr,
            area: note.area,
            chemicalName: note.chemicalName,
            note: note.note
        });
        setIsEditOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('確定要刪除此筆重要紀事嗎？')) return;
        try {
            await StorageService.deleteNote(id);
            loadNotes();
        } catch (error) {
            console.error(error);
            alert('刪除失敗');
        }
    };
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingNote) {
                await StorageService.updateNote({ ...editingNote, ...formData } as ImportantNote);
            } else {
                await StorageService.saveNote(formData as ImportantNote);
            }
            setIsEditOpen(false);
            setEditingNote(null);
            setFormData({
                dateStr: formatDateForInput(new Date()),
                area: '',
                chemicalName: '',
                note: ''
            });
            loadNotes();
        } catch (error) {
            console.error(error);
            alert('儲存失敗');
        }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        try {
            const jsonData = await readExcelFile(file);
            const notesToImport: ImportantNote[] = jsonData.map((row: any) => ({
                id: generateUUID(),
                dateStr: row['日期'] ? formatDateForInput(parseDateKey(row['日期'])) : formatDateForInput(new Date()),
                area: row['區域'] || '',
                chemicalName: row['藥品名稱'] || '',
                note: row['重要紀事'] || '',
            })).filter((n: ImportantNote) => n.note || n.chemicalName); // Filter empty rows

            if (notesToImport.length > 0) {
                if (confirm(`即將匯入 ${notesToImport.length} 筆資料，確定嗎？`)) {
                    await StorageService.saveNotesBatch(notesToImport);
                    loadNotes();
                    alert('匯入成功');
                }
            } else {
                alert('無有效資料可匯入');
            }
        } catch (error) {
            console.error(error);
            alert('匯入失敗，請確認檔案格式');
        }
        e.target.value = ''; // Reset input
    };

    const handleExport = () => {
        const exportData = notes.map(n => ({
            '日期': n.dateStr,
            '區域': n.area,
            '藥品名稱': n.chemicalName,
            '重要紀事': n.note
        }));
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '重要紀事');
        XLSX.writeFile(wb, `ImportantNotes_${formatDateForInput(new Date())}.xlsx`);
    };



    // --- Tab Logic ---
    const [activeTab, setActiveTab] = useState<'notes' | 'alerts'>('notes');
    const [alerts, setAlerts] = useState<FluctuationAlert[]>([]);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    const loadAlerts = async () => {
        setLoading(true);
        try {
            const data = await StorageService.getAlerts();
            setAlerts(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'alerts') {
            loadAlerts();
        } else {
            loadNotes();
        }
    }, [activeTab]);

    const handleAddNoteFromAlert = async (alertItem: FluctuationAlert, noteContent: string) => {
        try {
            await StorageService.updateAlertNote(alertItem.id, noteContent);
            const newNote: Partial<ImportantNote> = {
                dateStr: alertItem.dateStr,
                area: alertItem.tankName,
                chemicalName: '異常警報',
                note: noteContent
            };
            await StorageService.saveNote(newNote as ImportantNote);
            loadAlerts();
            alert('已加入重要紀事');
        } catch (e) {
            console.error(e);
            alert('操作失敗');
        }
    };

    return (
        <div className="h-full flex flex-col bg-slate-50">
            {/* Header with Tabs */}
            <div className="bg-white border-b border-slate-200 px-6 pt-4 flex-shrink-0">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-slate-100 rounded-lg text-slate-600">
                            <Icons.Notes className="w-6 h-6" />
                        </div>
                        <h2 className="text-xl font-bold text-slate-800">
                            {activeTab === 'notes' ? '重要紀事' : '液位變動警報'}
                        </h2>
                    </div>
                </div>

                <div className="flex gap-6 -mb-px">
                    <button
                        onClick={() => setActiveTab('notes')}
                        className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'notes' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
                    >
                        重要紀事
                    </button>
                    <button
                        onClick={() => setActiveTab('alerts')}
                        className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'alerts' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
                    >
                        液位變動警報
                    </button>
                </div>
            </div>

            <div className="p-6">
                {activeTab === 'notes' ? (
                    <Card className="flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <div className="flex space-x-2">
                                <div className="relative">
                                    <input
                                        type="file"
                                        accept=".xlsx, .xls"
                                        onChange={handleImport}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    <Button variant="secondary" className="flex items-center gap-2">
                                        <Icons.Import className="w-4 h-4" /> 匯入 Excel
                                    </Button>
                                </div>
                                <Button variant="secondary" onClick={handleExport} className="flex items-center gap-2">
                                    <Icons.Download className="w-4 h-4" /> 匯出 Excel
                                </Button>
                            </div>
                            <Button onClick={() => { setEditingNote(null); setFormData({ dateStr: formatDateForInput(new Date()), area: '', chemicalName: '', note: '' }); setIsEditOpen(true); }} className="flex items-center gap-2">
                                <Icons.Plus className="w-4 h-4" /> 新增紀事
                            </Button>
                        </div>

                        <div className="-mx-6 overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-200">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">日期</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">區域/儲槽</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">藥劑名稱</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">紀事內容</th>
                                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-slate-200">
                                    {loading ? (
                                        <tr><td colSpan={5} className="text-center py-8 text-slate-500">載入中...</td></tr>
                                    ) : notes.length === 0 ? (
                                        <tr><td colSpan={5} className="text-center py-8 text-slate-500">尚無資料</td></tr>
                                    ) : (
                                        notes
                                            .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                                            .map(note => ( // Pagination Slice
                                                <tr key={note.id} className="hover:bg-slate-50">
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 font-medium">{note.dateStr}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{note.area}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{note.chemicalName}</td>
                                                    <td className="px-6 py-4 text-sm text-slate-600 max-w-md break-words">{note.note}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                        <button onClick={() => handleEdit(note)} className="text-brand-600 hover:text-brand-900 mr-3">編輯</button>
                                                        <button onClick={() => handleDelete(note.id)} className="text-red-600 hover:text-red-900">刪除</button>
                                                    </td>
                                                </tr>
                                            ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Controls */}
                        {!loading && notes.length > 0 && (
                            <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-slate-500">
                                        顯示 {((currentPage - 1) * itemsPerPage) + 1} 至 {Math.min(currentPage * itemsPerPage, notes.length)} 筆，共 {notes.length} 筆
                                    </span>
                                    <select
                                        value={itemsPerPage}
                                        onChange={e => {
                                            setItemsPerPage(Number(e.target.value));
                                            setCurrentPage(1); // Reset to first page
                                        }}
                                        className="ml-2 text-sm border-slate-300 rounded-md shadow-sm focus:border-brand-500 focus:ring-brand-500"
                                    >
                                        <option value={10}>10 筆/頁</option>
                                        <option value={20}>20 筆/頁</option>
                                        <option value={50}>50 筆/頁</option>
                                    </select>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="secondary"
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className="px-3 py-1 text-sm"
                                    >
                                        上一頁
                                    </Button>
                                    <span className="flex items-center text-sm font-medium text-slate-700">
                                        第 {currentPage} 頁 / 共 {Math.ceil(notes.length / itemsPerPage)} 頁
                                    </span>
                                    <Button
                                        variant="secondary"
                                        onClick={() => setCurrentPage(p => Math.min(Math.ceil(notes.length / itemsPerPage), p + 1))}
                                        disabled={currentPage >= Math.ceil(notes.length / itemsPerPage)}
                                        className="px-3 py-1 text-sm"
                                    >
                                        下一頁
                                    </Button>
                                </div>
                            </div>
                        )}
                    </Card>
                ) : (
                    <Card className="flex flex-col p-0">
                        {loading ? (
                            <div className="flex-1 flex items-center justify-center text-slate-500">載入中...</div>
                        ) : (
                            <FluctuationAlertsView alerts={alerts} onAddNote={handleAddNoteFromAlert} onDelete={loadAlerts} thresholdWarningText={thresholdWarningText} />
                        )}
                    </Card>
                )}
            </div>

            {/* Edit Modal (Only for Notes) */}
            {isEditOpen && (activeTab === 'notes') && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 w-full max-w-md">
                        <h3 className="text-lg font-bold mb-4">{editingNote ? '編輯重要紀事' : '新增重要紀事'}</h3>
                        <form onSubmit={handleSave} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">日期</label>
                                <input type="date" value={formData.dateStr} onChange={e => setFormData({ ...formData, dateStr: e.target.value })} className={inputClassName} required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">區域/儲槽</label>
                                <input type="text" value={formData.area} onChange={e => setFormData({ ...formData, area: e.target.value })} className={inputClassName} required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">藥劑名稱</label>
                                <input type="text" value={formData.chemicalName} onChange={e => setFormData({ ...formData, chemicalName: e.target.value })} className={inputClassName} required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">紀事內容</label>
                                <textarea value={formData.note} onChange={e => setFormData({ ...formData, note: e.target.value })} className={inputClassName} rows={3} required />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <Button type="button" variant="ghost" onClick={() => { setIsEditOpen(false); setEditingNote(null); }}>取消</Button>
                                <Button type="submit">儲存</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

const SettingsView: React.FC<{ tanks: Tank[], readings: Reading[], onRefresh: () => void, onLoading: (loading: boolean) => void }> = ({ tanks, readings, onRefresh, onLoading }) => {
    const [editingTank, setEditingTank] = useState<Tank | null>(null);
    const [currentSG, setCurrentSG] = useState<{ sg: number; chemicalName: string } | null>(null);

    // 當編輯儲槽變更時，載入該儲槽的當前藥劑比重
    useEffect(() => {
        const loadActiveSupply = async () => {
            if (editingTank) {
                const supply = await StorageService.getActiveSupply(editingTank.id, Date.now());
                if (supply) {
                    setCurrentSG({ sg: supply.specificGravity, chemicalName: supply.chemicalName });
                } else {
                    setCurrentSG(null);
                }
            } else {
                setCurrentSG(null);
            }
        };
        loadActiveSupply();
    }, [editingTank?.id]);

    // Grouping logic similar to DashboardView
    const groups = useMemo(() => {
        const cooling = tanks.filter(t => t.system === SystemType.COOLING);
        const coolingArea1 = cooling.filter(t => {
            if (t.name.includes('CWS-1') || t.name.includes('CT-1')) return true;
            if (t.name.includes('CWS-2') || t.name.includes('CT-2')) return false; // 優先排除 CT-2
            return t.description?.includes('一階');
        });
        const coolingArea2 = cooling.filter(t => {
            if (coolingArea1.some(a1 => a1.id === t.id)) return false;
            if (t.name.includes('CWS-2') || t.name.includes('CT-2')) return true;
            return t.description?.includes('二階');
        });
        const boiler = tanks.filter(t => t.system === SystemType.BOILER);
        const denox = tanks.filter(t => t.system === SystemType.DENOX);

        const coolingOthers = cooling.filter(t =>
            !coolingArea1.some(a1 => a1.id === t.id) &&
            !coolingArea2.some(a2 => a2.id === t.id)
        );

        return {
            coolingArea1,
            coolingArea2,
            boiler,
            denox,
            others: [
                ...tanks.filter(t =>
                    t.system !== SystemType.COOLING &&
                    t.system !== SystemType.BOILER &&
                    t.system !== SystemType.DENOX
                ),
                ...coolingOthers
            ]
        };
    }, [tanks]);

    // Drag and Drop Handlers for Settings
    const handleDragStart = (e: React.DragEvent, tankId: string, group: string) => {
        e.dataTransfer.setData('tankId', tankId);
        e.dataTransfer.setData('sourceGroup', group);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = async (e: React.DragEvent, targetGroup: string, targetIndex: number, groupTanks: any[]) => {
        e.preventDefault();
        const tankId = e.dataTransfer.getData('tankId');
        const sourceGroup = e.dataTransfer.getData('sourceGroup');

        if (sourceGroup !== targetGroup) return;

        const sourceIndex = groupTanks.findIndex(t => t.id === tankId);
        if (sourceIndex === -1 || sourceIndex === targetIndex) return;

        const reordered = [...groupTanks];
        const [moved] = reordered.splice(sourceIndex, 1);
        reordered.splice(targetIndex, 0, moved);

        // Same index logic as DashboardView
        const baseIndex = targetGroup === 'coolingArea1' ? 1000 : 2000;
        const updates = reordered.map((t, idx) => ({
            id: t.id,
            sortOrder: baseIndex + idx
        }));

        await StorageService.reorderTanks(updates);
        onRefresh();
    };

    const handleExport = () => {
        const data = tanks.map(t => ({
            '儲槽ID': t.id,
            '名稱': t.name,
            '系統': t.system,
            '容量': t.capacityLiters,
            '因子': t.factor,
            '安全低液位': t.safeMinLevel,
            '描述': t.description || '',
            '計算模式': t.calculationMethod || 'NONE'
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Tanks Config");
        XLSX.writeFile(wb, `WTCA_Tanks_Config_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        try {
            const jsonData = await readExcelFile(file);
            const tanksToSave: Tank[] = jsonData.map((row: any) => {
                const tankId = row['儲槽ID'] || generateUUID();
                return {
                    id: tankId,
                    name: row['名稱'] || '未命名',
                    system: row['系統'] || SystemType.COOLING,
                    capacityLiters: Number(row['容量']) || 1000,
                    factor: Number(row['因子']) || 1,
                    safeMinLevel: Number(row['安全低液位']) || 15,
                    description: row['描述'] || '',
                    calculationMethod: row['計算模式'] as CalculationMethod || 'NONE'
                };
            });

            if (tanksToSave.length > 0) {
                if (confirm(`即將匯入/更新 ${tanksToSave.length} 個儲槽，確定執行？`)) {
                    await StorageService.saveTanksBatch(tanksToSave);
                    await onRefresh();
                    alert('匯入成功');
                }
            }
        } catch (error) {
            console.error(error);
            alert('匯入失敗，請檢查檔案格式');
        } finally {
            onLoading(false);
        }
        e.target.value = '';
    };

    const handleDelete = async (id: string) => {
        if (confirm('確定要刪除此儲槽及其所有相關設定嗎? (液位紀錄將保留)')) {
            onLoading(true);
            try {
                await StorageService.deleteTank(id);
                await onRefresh();
            } finally {
                onLoading(false);
            }
        }
    }

    const recalculateTankHistory = async (tankId: string) => {
        const tank = tanks.find(t => t.id === tankId);
        if (!tank) return;

        const tankReadings = readings.filter(r => r.tankId === tankId);
        let updatedCount = 0;
        const updates: Reading[] = [];

        for (const reading of tankReadings) {
            const vol = calculateTankVolume(tank, reading.levelCm);
            // Check if volume changed significantly (> 0.1 L)
            if (Math.abs(vol - reading.calculatedVolume) > 0.1) {
                const supply = await StorageService.getActiveSupply(reading.tankId, reading.timestamp);
                const sg = supply?.specificGravity || reading.appliedSpecificGravity || 1.0;

                updates.push({
                    ...reading,
                    calculatedVolume: vol,
                    calculatedWeightKg: vol * sg,
                    appliedSpecificGravity: sg
                });
                updatedCount++;
            }
        }

        if (updates.length > 0) {
            await StorageService.saveReadingsBatch(updates);
            return updatedCount;
        }
        return 0;
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingTank) return;

        onLoading(true);
        try {
            // Update modification timestamps if params exist
            const tankToSave = { ...editingTank };
            if (tankToSave.cwsParams) {
                tankToSave.cwsParams.date = Date.now();
            }
            if (tankToSave.bwsParams) {
                tankToSave.bwsParams.date = Date.now();
            }

            await StorageService.saveTank(tankToSave);

            // Ask for recalculation if dimensions might have changed
            if (confirm('儲槽設定已更新。是否要根據新的設定重新計算此儲槽的所有歷史用量數據？\n(若您剛變更了形狀或尺寸，建議執行此操作)')) {
                const count = await recalculateTankHistory(tankToSave.id);
                alert(`已重新計算 ${count} 筆歷史資料`);
            } else {
                alert('儲槽設定已更新');
            }

            await onRefresh();
            setEditingTank(null);
        } catch (e: any) {
            console.error(e);
            alert('儲存失敗');
        } finally {
            onLoading(false);
        }
    };

    const updateTankField = (field: keyof Tank, value: any) => {
        if (!editingTank) return;
        setEditingTank({ ...editingTank, [field]: value });
    };

    const updateDimensions = (field: string, value: any) => {
        if (!editingTank) return;
        const currentDims = editingTank.dimensions || { diameter: 0 };
        setEditingTank({
            ...editingTank,
            dimensions: { ...currentDims, [field]: value }
        });
    };

    const updateCWSParam = (field: keyof CWSParameterRecord, value: any) => {
        if (!editingTank) return;
        const currentParams = editingTank.cwsParams || {
            tankId: editingTank.id,
            circulationRate: 0,
            tempDiff: 0,
            concentrationCycles: 1,
            targetPpm: 0
        } as CWSParameterRecord;

        setEditingTank({
            ...editingTank,
            cwsParams: { ...currentParams, [field]: value }
        });
    };

    const updateBWSParam = (field: keyof BWSParameterRecord, value: any) => {
        if (!editingTank) return;
        const currentParams = editingTank.bwsParams || {
            tankId: editingTank.id,
            steamProduction: 0,
            targetPpm: 0
        } as BWSParameterRecord;

        setEditingTank({
            ...editingTank,
            bwsParams: { ...currentParams, [field]: value }
        });
    };

    if (editingTank) {
        return (
            <Card title={`編輯儲槽設定 - ${editingTank.name}`}>
                <form onSubmit={handleSave} className="space-y-6">
                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">儲槽名稱</label>
                            <input type="text" value={editingTank.name} onChange={e => updateTankField('name', e.target.value)} className={inputClassName} required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">所屬系統</label>
                            <select value={editingTank.system} onChange={e => updateTankField('system', e.target.value)} className={inputClassName}>
                                {Object.values(SystemType).map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <h4 className="font-bold text-slate-700 mb-4">桶槽規格與形狀 (體積計算)</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">形狀類型</label>
                                <select
                                    value={editingTank.shapeType || 'VERTICAL_CYLINDER'}
                                    onChange={e => updateTankField('shapeType', e.target.value)}
                                    className={inputClassName}
                                >
                                    <option value="VERTICAL_CYLINDER">垂直圓柱 (Vertical Cylinder)</option>
                                    <option value="HORIZONTAL_CYLINDER">臥式圓柱 (Horizontal Cylinder)</option>
                                    <option value="RECTANGULAR">方形/矩形 (Rectangular)</option>
                                </select>
                            </div>

                            {/* Height / Max Level */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">桶槽高度/最大液位 (cm)</label>
                                <input
                                    type="number"
                                    value={editingTank.dimensions?.height || ''}
                                    onChange={e => updateDimensions('height', Number(e.target.value))}
                                    className={inputClassName}
                                    placeholder="參考用"
                                />
                            </div>

                            {/* Sensor Offset */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    液位計零點偏差 (cm)
                                    <span className="text-xs text-slate-400 ml-1">(若法蘭非桶底)</span>
                                </label>
                                <input
                                    type="number"
                                    value={editingTank.dimensions?.sensorOffset || 0}
                                    onChange={e => updateDimensions('sensorOffset', Number(e.target.value))}
                                    className={inputClassName}
                                />
                            </div>

                            {/* Shape Specific Dimensions */}
                            {(editingTank.shapeType === 'VERTICAL_CYLINDER' || !editingTank.shapeType) && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">直徑 (ID, cm)</label>
                                    <input
                                        type="number"
                                        value={editingTank.dimensions?.diameter || ''}
                                        onChange={e => updateDimensions('diameter', Number(e.target.value))}
                                        className={inputClassName}
                                    />
                                </div>
                            )}

                            {editingTank.shapeType === 'HORIZONTAL_CYLINDER' && (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">直徑 (ID, cm)</label>
                                        <input
                                            type="number"
                                            value={editingTank.dimensions?.diameter || ''}
                                            onChange={e => updateDimensions('diameter', Number(e.target.value))}
                                            className={inputClassName}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">
                                            直管段長度 (T.L.-T.L., cm)
                                        </label>
                                        <input
                                            type="number"
                                            value={editingTank.dimensions?.length || ''}
                                            onChange={e => updateDimensions('length', Number(e.target.value))}
                                            className={inputClassName}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">封頭形狀</label>
                                        <select
                                            value={editingTank.dimensions?.headType || 'SEMI_ELLIPTICAL_2_1'}
                                            onChange={e => updateDimensions('headType', e.target.value)}
                                            className={inputClassName}
                                        >
                                            <option value="SEMI_ELLIPTICAL_2_1">2:1 半橢圓 (Standard)</option>
                                            <option value="HEMISPHERICAL">半球形 (Hemispherical)</option>
                                            <option value="FLAT">平底 (Flat)</option>
                                        </select>
                                    </div>
                                </>
                            )}

                            {editingTank.shapeType === 'RECTANGULAR' && (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">長度 (cm)</label>
                                        <input
                                            type="number"
                                            value={editingTank.dimensions?.length || ''}
                                            onChange={e => updateDimensions('length', Number(e.target.value))}
                                            className={inputClassName}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">寬度 (cm)</label>
                                        <input
                                            type="number"
                                            value={editingTank.dimensions?.width || ''}
                                            onChange={e => updateDimensions('width', Number(e.target.value))}
                                            className={inputClassName}
                                        />
                                    </div>
                                </>
                            )}

                            {/* Legacy Factor Override */}
                            <div className="md:col-span-2 border-t border-slate-200 pt-4 mt-2">
                                <label className="block text-sm font-medium text-slate-500 mb-1">
                                    換算因子 Override (L/cm)
                                    <span className="text-xs text-slate-400 ml-2">(若設定此值，與計算結果不符時可能導致混淆，建議僅在「垂直圓柱」且未輸入直徑時使用)</span>
                                </label>
                                <input type="number" step="0.1" value={editingTank.factor} onChange={e => updateTankField('factor', Number(e.target.value))} className={`${inputClassName} bg-slate-800 text-slate-300`} />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">容量標示 (L)</label>
                                <input type="number" value={editingTank.capacityLiters} onChange={e => updateTankField('capacityLiters', Number(e.target.value))} className={inputClassName} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    安全低液位警戒 ({editingTank.inputUnit === 'PERCENT' ? '公尺' : '公分'})
                                </label>
                                <input type="number" value={editingTank.safeMinLevel} onChange={e => updateTankField('safeMinLevel', Number(e.target.value))} className={inputClassName} />
                                <p className="text-xs text-slate-500 mt-1">
                                    {(() => {
                                        const levelCm = editingTank.inputUnit === 'PERCENT'
                                            ? editingTank.safeMinLevel * 100
                                            : editingTank.safeMinLevel;
                                        const volumeL = calculateTankVolume(editingTank, levelCm);
                                        const sg = currentSG?.sg || 1.0;
                                        const weightKg = volumeL * sg;
                                        return `${editingTank.safeMinLevel}${editingTank.inputUnit === 'PERCENT' ? '公尺' : '公分'} ≈ ${volumeL.toLocaleString(undefined, { maximumFractionDigits: 0 })} L ≈ ${weightKg.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg`;
                                    })()}
                                    {currentSG ? (
                                        <span className="text-brand-600"> (以{currentSG.chemicalName}比重 {currentSG.sg} 計)</span>
                                    ) : (
                                        <span className="text-amber-600"> (尚無藥劑資料，以比重 1.0 計)</span>
                                    )}
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    匯入異常檢測閾值 (%)
                                    <span className="text-xs text-slate-400 ml-1">(日均變動超過容量此比例則警告)</span>
                                </label>
                                <input
                                    type="number"
                                    min="0.1"
                                    max="100"
                                    step="0.1"
                                    value={editingTank.validationThreshold ?? 30}
                                    onChange={e => updateTankField('validationThreshold', Number(e.target.value))}
                                    className={inputClassName}
                                    placeholder="預設 30"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    換算約 {((editingTank.validationThreshold ?? 30) / 100 * editingTank.capacityLiters).toLocaleString(undefined, { maximumFractionDigits: 0 })} L ≈ {((editingTank.validationThreshold ?? 30) / 100 * editingTank.capacityLiters * (currentSG?.sg || 1.0)).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg
                                    {currentSG ? (
                                        <span className="text-brand-600"> (以{currentSG.chemicalName}比重 {currentSG.sg} 計)</span>
                                    ) : (
                                        <span className="text-amber-600"> (尚無藥劑資料，以比重 1.0 計)</span>
                                    )}
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    合格比重下限
                                    <span className="text-xs text-slate-400 ml-1">(藥劑合約輸入時檢查)</span>
                                </label>
                                <input
                                    type="number"
                                    min="0.1"
                                    step="0.001"
                                    value={editingTank.sgRangeMin ?? ''}
                                    onChange={e => updateTankField('sgRangeMin', e.target.value ? Number(e.target.value) : undefined)}
                                    className={inputClassName}
                                    placeholder="例如: 1.80"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    合格比重上限
                                    <span className="text-xs text-slate-400 ml-1">(藥劑合約輸入時檢查)</span>
                                </label>
                                <input
                                    type="number"
                                    min="0.1"
                                    step="0.001"
                                    value={editingTank.sgRangeMax ?? ''}
                                    onChange={e => updateTankField('sgRangeMax', e.target.value ? Number(e.target.value) : undefined)}
                                    className={inputClassName}
                                    placeholder="例如: 1.88"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-slate-700 mb-1">描述</label>
                                <input type="text" value={editingTank.description || ''} onChange={e => updateTankField('description', e.target.value)} className={inputClassName} />
                            </div>

                            <div className="md:col-span-2 mt-4 p-3 bg-slate-50 rounded border border-slate-200">
                                <label className="block text-sm font-medium text-slate-700 mb-2">液位輸入模式</label>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="inputUnit"
                                            value="CM"
                                            checked={editingTank.inputUnit !== 'PERCENT'}
                                            onChange={() => updateTankField('inputUnit', 'CM')}
                                            className="text-brand-600 focus:ring-brand-500"
                                        />
                                        <span>公分 (cm)</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="inputUnit"
                                            value="PERCENT"
                                            checked={editingTank.inputUnit === 'PERCENT'}
                                            onChange={() => updateTankField('inputUnit', 'PERCENT')}
                                            className="text-brand-600 focus:ring-brand-500"
                                        />
                                        <span>公尺 (×100)</span>
                                    </label>
                                </div>
                                {editingTank.inputUnit === 'PERCENT' && (
                                    <p className="text-xs text-amber-600 mt-1">
                                        注意：此模式適用於如 CT-1 硫酸桶槽等特殊情況，輸入值會乘以 100 換算為公分 (例如輸入 0.72 = 72 cm)。
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    <hr className="border-slate-200" />

                    {/* Calculation Logic */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">理論用量計算模式</label>
                        <select
                            value={editingTank.calculationMethod || 'NONE'}
                            onChange={e => updateTankField('calculationMethod', e.target.value)}
                            className={inputClassName}
                        >
                            <option value="NONE">不計算 (僅追蹤實際用量)</option>
                            <option value="CWS_BLOWDOWN">冷卻水 (基於排放量與濃縮倍數)</option>
                            <option value="BWS_STEAM">鍋爐水 (基於蒸汽產量)</option>
                        </select>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <Button type="button" variant="ghost" onClick={() => setEditingTank(null)}>取消</Button>
                        <Button type="submit">儲存變更</Button>
                    </div>
                </form>
            </Card>
        );
    }

    const TankCard: React.FC<{ tank: Tank, dragProps?: any }> = ({ tank, dragProps }) => (
        <div
            className={`bg-white rounded-lg border border-slate-200 shadow-sm p-4 hover:border-brand-300 transition-colors relative overflow-hidden flex flex-col justify-between ${dragProps ? 'cursor-default' : ''}`}
            {...dragProps}
        >
            {dragProps && (
                <div className="absolute top-2 left-2 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing z-20">
                    <Icons.DragHandle className="w-5 h-5" />
                </div>
            )}
            <div>
                <div className="flex justify-between items-start mb-3">
                    <h3 className="font-bold text-slate-800 text-base">{tank.name}</h3>
                    <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 uppercase tracking-wider">{tank.system}</span>
                </div>

                <div className="space-y-2 text-xs text-slate-600 mb-4">
                    <div className="flex justify-between border-b border-slate-50 pb-1">
                        <span className="text-slate-400">容量</span>
                        <span className="font-mono font-medium">{tank.capacityLiters.toLocaleString()} L</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-50 pb-1">
                        <span className="text-slate-400">換算因子</span>
                        <span className="font-mono font-medium">{tank.factor} L/cm</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-50 pb-1">
                        <span className="text-slate-400">液位警戒</span>
                        <span className="font-mono font-medium">{tank.safeMinLevel} {tank.inputUnit === 'PERCENT' ? '公尺' : 'cm'}</span>
                    </div>
                    {tank.calculationMethod && tank.calculationMethod !== 'NONE' && (
                        <div className="pt-1">
                            <span className={`block text-center w-full px-1.5 py-1 rounded text-[10px] ${tank.calculationMethod === 'CWS_BLOWDOWN' ? 'bg-sky-50 text-sky-600' : 'bg-orange-50 text-orange-600'}`}>
                                {tank.calculationMethod === 'CWS_BLOWDOWN' ? '自動計算: CWS' : '自動計算: BWS'}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex gap-2 justify-end pt-3 border-t border-slate-50 mt-auto">
                <Button variant="secondary" onClick={() => setEditingTank(tank)} className="flex-1 py-1.5 px-2 text-xs justify-center">
                    <Icons.Settings className="w-3.5 h-3.5 mr-1.5" /> 編輯
                </Button>
                <Button variant="danger" onClick={() => handleDelete(tank.id)} className="flex-none py-1.5 px-3 text-xs">
                    <Icons.Delete className="w-3.5 h-3.5" />
                </Button>
            </div>
        </div>
    );

    return (
        <div className="space-y-8 animate-fade-in">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-slate-800">儲槽設定</h2>
                <div className="flex gap-2">
                    <div className="relative">
                        <input
                            type="file"
                            accept=".xlsx, .xls"
                            onChange={handleImport}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <Button variant="secondary" className="flex items-center gap-2">
                            <Icons.Plus className="w-4 h-4" /> 匯入 Excel
                        </Button>
                    </div>
                    <Button variant="secondary" onClick={handleExport} className="flex items-center gap-2">
                        <Icons.Download className="w-4 h-4" /> 匯出 Excel
                    </Button>
                </div>
            </div>

            {/* Cooling Water Section */}
            <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-sky-50 px-6 py-4 border-b border-sky-100 flex items-center gap-3">
                    <div className="p-2 bg-sky-200 rounded-lg text-sky-700">
                        <Icons.Cooling className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-sky-900">冷卻水儲槽設定</h2>
                        <p className="text-xs text-sky-600">Cooling Water System (CWS)</p>
                    </div>
                </div>

                <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center after:content-[''] after:flex-1 after:h-px after:bg-slate-200 after:ml-4">
                            <span className="bg-slate-100 px-2 py-1 rounded text-slate-600">一階桶槽區</span>
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {groups.coolingArea1.map((t, idx) => (
                                <TankCard
                                    key={t.id}
                                    tank={t}
                                    dragProps={{
                                        draggable: true,
                                        onDragStart: (e: React.DragEvent) => handleDragStart(e, t.id, 'coolingArea1'),
                                        onDragOver: handleDragOver,
                                        onDrop: (e: React.DragEvent) => handleDrop(e, 'coolingArea1', idx, groups.coolingArea1)
                                    }}
                                />
                            ))}
                            {groups.coolingArea1.length === 0 && <div className="text-slate-400 text-sm italic col-span-2 text-center py-4 bg-slate-50 rounded border border-dashed border-slate-200">無儲槽資料</div>}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center after:content-[''] after:flex-1 after:h-px after:bg-slate-200 after:ml-4">
                            <span className="bg-slate-100 px-2 py-1 rounded text-slate-600">二階桶槽區</span>
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {groups.coolingArea2.map((t, idx) => (
                                <TankCard
                                    key={t.id}
                                    tank={t}
                                    dragProps={{
                                        draggable: true,
                                        onDragStart: (e: React.DragEvent) => handleDragStart(e, t.id, 'coolingArea2'),
                                        onDragOver: handleDragOver,
                                        onDrop: (e: React.DragEvent) => handleDrop(e, 'coolingArea2', idx, groups.coolingArea2)
                                    }}
                                />
                            ))}
                            {groups.coolingArea2.length === 0 && <div className="text-slate-400 text-sm italic col-span-2 text-center py-4 bg-slate-50 rounded border border-dashed border-slate-200">無儲槽資料</div>}
                        </div>
                    </div>
                </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Boiler Section */}
                <section className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="bg-orange-50 px-6 py-4 border-b border-orange-100 flex items-center gap-3">
                        <div className="p-2 bg-orange-200 rounded-lg text-orange-700">
                            <Icons.Boiler className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-orange-900">鍋爐水儲槽設定</h2>
                            <p className="text-xs text-orange-600">Boiler Water System (BWS)</p>
                        </div>
                    </div>
                    <div className="p-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                            {groups.boiler.map(t => <TankCard key={t.id} tank={t} />)}
                            {groups.boiler.length === 0 && <div className="text-slate-400 text-sm italic col-span-full text-center py-8 bg-slate-50 rounded border border-dashed border-slate-200">無儲槽資料</div>}
                        </div>
                    </div>
                </section>

                {/* DeNOx Section */}
                <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="bg-emerald-50 px-6 py-4 border-b border-emerald-100 flex items-center gap-3">
                        <div className="p-2 bg-emerald-200 rounded-lg text-emerald-700">
                            <Icons.DeNOx className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-emerald-900">脫銷儲槽設定</h2>
                            <p className="text-xs text-emerald-600">DeNOx (SCR)</p>
                        </div>
                    </div>
                    <div className="p-6">
                        <div className="grid grid-cols-1 gap-4">
                            {groups.denox.map(t => <TankCard key={t.id} tank={t} />)}
                            {groups.denox.length === 0 && <div className="text-slate-400 text-sm italic text-center py-8 bg-slate-50 rounded border border-dashed border-slate-200">無儲槽資料</div>}
                        </div>
                    </div>
                </section>
            </div>

            {/* Others Section */}
            {(groups.others.length > 0 || tanks.length === 0) && (
                <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center gap-3">
                        <Icons.Factory className="w-5 h-5 text-slate-500" />
                        <h2 className="text-lg font-bold text-slate-700">其他儲槽設定</h2>
                    </div>
                    <div className="p-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {groups.others.map(t => <TankCard key={t.id} tank={t} />)}
                            {groups.others.length === 0 && tanks.length === 0 && <div className="text-slate-400 text-sm italic col-span-full text-center py-8">尚無任何儲槽資料</div>}
                        </div>
                    </div>
                </section>
            )}
        </div>
    )
}

// === PARAMS SETTINGS VIEW ===
const ParamsSettingsView: React.FC<{
    appSettings: {
        usageCalcWeeks: number;
        lowLevelWarningText: string;
        thresholdWarningText: string;
        possibleRefillText: string;
    };
    setAppSettings: React.Dispatch<React.SetStateAction<any>>;
}> = ({ appSettings, setAppSettings }) => {
    const [localSettings, setLocalSettings] = useState(appSettings);
    const [saved, setSaved] = useState(false);

    // Sync local state when prop updates (e.g. from DB load)
    useEffect(() => {
        setLocalSettings(appSettings);
    }, [appSettings]);

    const handleSave = async () => {
        try {
            await StorageService.saveAppSettings(localSettings);
            setAppSettings(localSettings);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (error) {
            console.error('Failed to save settings:', error);
            alert('儲存設定失敗，請檢查網路連線或稍後再試。');
        }
    };

    const inputClassName = "w-full px-4 py-2.5 rounded-lg border border-slate-300 bg-slate-800 text-white focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none transition-all";

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-3">
                <Icons.Settings className="w-7 h-7 text-brand-500" />
                參數設定
            </h1>

            <Card>
                <div className="p-6 space-y-6">
                    {/* 日用量計算週數 */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            日用量計算週數（總覽看板）
                        </label>
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                min="1"
                                max="52"
                                value={localSettings.usageCalcWeeks}
                                onChange={e => setLocalSettings(prev => ({ ...prev, usageCalcWeeks: Math.max(1, Math.min(52, Number(e.target.value))) }))}
                                className={`${inputClassName} w-32`}
                            />
                            <span className="text-slate-500">週</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">用於計算每個儲槽的平均日用量（建議 4-12 週）</p>
                    </div>

                    <hr className="border-slate-200" />

                    <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Icons.Alert className="w-5 h-5 text-brand-600" />
                        液位檢查警告文字
                        <div className="group relative ml-1">
                            <Icons.Info className="w-4 h-4 text-slate-400 cursor-help" />
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-3 bg-slate-800 text-white text-xs rounded shadow-lg w-64 hidden group-hover:block z-50 pointer-events-none">
                                <p className="font-bold mb-1">格式範本可用變數:</p>
                                <ul className="list-disc pl-4 space-y-1">
                                    <li><code className="bg-slate-700 px-1 rounded">{'{diff}'}</code> 日均變動量</li>
                                    <li><code className="bg-slate-700 px-1 rounded">{'{limit}'}</code> 閾值</li>
                                    <li><code className="bg-slate-700 px-1 rounded">{'{unit}'}</code> 單位</li>
                                </ul>
                                <p className="mt-2 text-slate-400 border-t border-slate-700 pt-2">
                                    適用於「液位變化超標」與「可能為補藥」警告
                                </p>
                            </div>
                        </div>
                    </h3>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm text-slate-600 mb-1">低液位警告</label>
                            <input
                                type="text"
                                value={localSettings.lowLevelWarningText}
                                onChange={e => setLocalSettings(prev => ({ ...prev, lowLevelWarningText: e.target.value }))}
                                className={inputClassName}
                                placeholder="存量偏低，請叫藥"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-slate-600 mb-1">液位變化超標警告 (格式範本)</label>
                            <input
                                type="text"
                                value={localSettings.thresholdWarningText}
                                onChange={e => setLocalSettings(prev => ({ ...prev, thresholdWarningText: e.target.value }))}
                                className={inputClassName}
                                placeholder="範例: 液位變化異常 ({diff} {unit} > {limit} {unit})"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-slate-600 mb-1">可能為補藥警告 (格式範本)</label>
                            <input
                                type="text"
                                value={localSettings.possibleRefillText}
                                onChange={e => setLocalSettings(prev => ({ ...prev, possibleRefillText: e.target.value }))}
                                className={inputClassName}
                                placeholder="可能為補藥紀錄"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <Button
                            onClick={handleSave}
                            className="bg-brand-600 hover:bg-brand-700 text-white"
                        >
                            {saved ? '✓ 已儲存' : '儲存設定'}
                        </Button>
                    </div>
                </div>
            </Card>
        </div>
    );
};

type ViewType = 'dashboard' | 'entry' | 'analysis' | 'settings' | 'notes' | 'annual' | 'pi-test' | 'import' | 'params';

const App: React.FC = () => {
    const [currentView, setCurrentView] = useState<ViewType>(() => {
        // 從 URL hash 讀取初始頁面
        const hash = window.location.hash.slice(1);
        if (hash && ['dashboard', 'entry', 'analysis', 'settings', 'notes', 'annual', 'pi-test', 'import', 'params'].includes(hash)) {
            return hash as ViewType;
        }
        return 'dashboard';
    });
    const [tanks, setTanks] = useState<Tank[]>([]);
    const [readings, setReadings] = useState<Reading[]>([]);

    // Navigation State for jumping to Analysis
    const [analysisInitialState, setAnalysisInitialState] = useState<{ tankId: string, monthStr: string } | null>(null);

    // Global Loading State
    const [isLoading, setIsLoading] = useState(false);

    // Persist UserName
    const [userName, setUserName] = useState(() => localStorage.getItem('appUserName') || 'OP');

    // App Settings
    const [appSettings, setAppSettings] = useState({
        usageCalcWeeks: 8,
        lowLevelWarningText: '存量偏低，請叫藥',
        thresholdWarningText: '液位變化異常，請確認',
        possibleRefillText: '可能為補藥紀錄'
    });

    // Load appSettings from API on startup
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const settingsFromDb = await StorageService.getAppSettings();
                if (settingsFromDb && Object.keys(settingsFromDb).length > 0) {
                    setAppSettings(prev => ({ ...prev, ...settingsFromDb }));
                }
            } catch (error) {
                console.error('Failed to load app settings:', error);
            }
        };
        loadSettings();
    }, []);

    // 導航函數 - 更新頁面並推入瀏覽器歷史
    const navigateTo = useCallback((view: ViewType, replace = false) => {
        if (view === currentView && !replace) return;

        if (replace) {
            window.history.replaceState({ view }, '', `#${view}`);
        } else {
            window.history.pushState({ view }, '', `#${view}`);
        }
        setCurrentView(view);
    }, [currentView]);

    // 監聽瀏覽器的上一頁/下一頁按鈕
    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            if (event.state && event.state.view) {
                setCurrentView(event.state.view as ViewType);
            } else {
                // 從 hash 讀取
                const hash = window.location.hash.slice(1);
                if (hash && ['dashboard', 'entry', 'analysis', 'settings', 'notes', 'annual', 'pi-test', 'import', 'params'].includes(hash)) {
                    setCurrentView(hash as ViewType);
                } else {
                    setCurrentView('dashboard');
                }
            }
        };

        // 初始化時設定 history state
        window.history.replaceState({ view: currentView }, '', `#${currentView}`);

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []); // 只在掛載時執行一次

    // Auto-detect user from server
    useEffect(() => {
        const fetchUser = async () => {
            try {
                const res = await fetch('./api/whoami');
                if (res.ok) {
                    const data = await res.json();
                    if (data.username) {
                        setUserName(data.username);
                        localStorage.setItem('appUserName', data.username);
                    }
                }
            } catch (e) {
                console.warn('Failed to auto-detect user:', e);
            }
        };
        fetchUser();
    }, []);

    const handleNameChange = () => {
        const newName = prompt("請輸入您的名稱 (顯示於右上角):", userName);
        if (newName && newName.trim()) {
            setUserName(newName.trim());
            localStorage.setItem('appUserName', newName.trim());
        }
    };



    const handleNavigateToAnalysis = (tankId: string, month: number, year: number) => {
        // month is 1-based (1-12), or 0 to indicate "use default (last month)"
        let monthStr: string;
        if (month === 0 || year === 0) {
            // Use current month as default
            const today = new Date();
            monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        } else {
            monthStr = `${year}-${String(month).padStart(2, '0')}`;
        }
        console.log('Navigating to Analysis:', { tankId, monthStr });
        setAnalysisInitialState({ tankId, monthStr });
        navigateTo('analysis');
    };

    const refreshData = async () => {
        try {
            const [tanksData, readingsData] = await Promise.all([
                StorageService.getTanks(),
                StorageService.getReadings()
            ]);
            setTanks(tanksData);
            setReadings(readingsData);
        } catch (error) {
            console.error('載入資料失敗:', error);
        }
    };

    useEffect(() => {
        refreshData();
    }, []);

    const handleSaveReading = async (reading: Reading) => {
        await StorageService.saveReading(reading);
        await refreshData();
    };

    const handleBatchSaveReadings = async (newReadings: Reading[]) => {
        await StorageService.saveReadingsBatch(newReadings);
        await refreshData();
    }

    const renderContent = () => {
        switch (currentView) {
            case 'dashboard': return <DashboardView tanks={tanks} readings={readings} onRefresh={refreshData} onNavigate={handleNavigateToAnalysis} onLoading={setIsLoading} />;
            case 'entry': return <DataEntryView tanks={tanks} readings={readings} onSave={handleSaveReading} onBatchSave={handleBatchSaveReadings} onUpdateTank={() => refreshData()} onLoading={setIsLoading} appSettings={appSettings} />;
            case 'analysis': return (
                <AnalysisView
                    tanks={tanks}
                    readings={readings}
                    initialState={analysisInitialState}
                    onStateConsumed={() => setAnalysisInitialState(null)}
                />
            );
            case 'settings': return <SettingsView tanks={tanks} readings={readings} onRefresh={refreshData} onLoading={setIsLoading} />;
            case 'notes': return <ImportantNotesView thresholdWarningText={appSettings.thresholdWarningText} />;
            case 'annual': return <AnnualDataView tanks={tanks} readings={readings} onNavigate={handleNavigateToAnalysis} />;
            case 'import': return <ExcelImportView tanks={tanks} onComplete={refreshData} onLoading={setIsLoading} />;
            case 'params': return <ParamsSettingsView appSettings={appSettings} setAppSettings={setAppSettings} />;
            default: return <DashboardView tanks={tanks} readings={readings} onRefresh={refreshData} usageCalcWeeks={appSettings.usageCalcWeeks} lowLevelWarningText={appSettings.lowLevelWarningText} />;
        }
    };

    const NavItem = ({ view, icon: Icon, label }: { view: ViewType, icon: React.ElementType, label: string }) => (
        <button
            onClick={() => navigateTo(view)}
            className={`w-full flex items-center px-3 py-2 text-sm font-medium transition-colors
          ${currentView === view ? 'bg-brand-50 text-brand-700 border-r-4 border-brand-500' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
        >
            <Icon className={`w-5 h-5 mr-3 ${currentView === view ? 'text-brand-500' : 'text-slate-400'}`} />
            {label}
        </button>
    );

    return (
        <div className="flex h-screen bg-slate-50 overflow-hidden relative">
            <LoadingOverlay isOpen={isLoading} />
            {/* Sidebar */}
            <aside className="bg-white border-r border-slate-200 flex-shrink-0 w-48 flex flex-col">
                <div className="h-16 flex items-center px-4 border-b border-slate-100">
                    <img src="logo.png" alt="Logo" className="w-8 h-8 mr-3 object-contain" />
                    <span className="font-bold text-lg text-slate-800 tracking-tight">藥劑管理</span>
                </div>

                <nav className="flex-1 overflow-y-auto py-4 space-y-1">
                    <NavItem view="dashboard" icon={Icons.Dashboard} label="總覽看板" />
                    <NavItem view="analysis" icon={Icons.Analysis} label="用量分析" />
                    <NavItem view="annual" icon={Icons.Calendar} label="年度數據" />
                    <NavItem view="notes" icon={Icons.Notes} label="重要紀事" />
                    <NavItem view="entry" icon={Icons.Entry} label="數據輸入" />
                    <NavItem view="import" icon={Icons.FileText} label="辨識匯入" />
                    <NavItem view="settings" icon={Icons.Cylinder} label="儲槽設定" />
                    <NavItem view="params" icon={Icons.Settings} label="參數設定" />
                </nav>

                {/* User Info & Date at Bottom */}

            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <div className="flex-1 overflow-auto p-8">
                    {renderContent()}
                </div>
            </main>
        </div>
    );
};

export default App;