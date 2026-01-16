import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { StorageService } from './services/storageService';
import { Tank, Reading, SystemType, ChemicalSupply, CWSParameterRecord, BWSParameterRecord, ImportantNote, CalculationMethod } from './types';
import { Icons } from './components/Icons';
import * as XLSX from 'xlsx';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    BarChart, Bar, ComposedChart, Area
} from 'recharts';

// --- Helper Components ---

const Card: React.FC<{ children: React.ReactNode; className?: string; title?: string; action?: React.ReactNode }> = ({ children, className = "", title, action }) => (
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

const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }> = ({ children, variant = 'primary', className = "", ...props }) => {
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
                const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: "" });
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
const getNormalizedTimestamp = (dateStr: string | Date | number): number => {
    if (!dateStr) return Date.now();
    if (typeof dateStr === 'number') return dateStr;
    const d = new Date(dateStr);
    // Reset to midnight
    d.setHours(0, 0, 0, 0);
    return d.getTime();
};

const parseDateKey = (key: string): Date | null => {
    // 1. Check if key contains a 4-digit year (YYYY)
    const hasYear = /\d{4}/.test(key);

    if (hasYear) {
        const d = new Date(key);
        if (!isNaN(d.getTime())) return d;
    }

    // 2. If no Year, try appending current year
    const currentYear = new Date().getFullYear();
    // Try formats like 1/1, 01-01
    const d2 = new Date(`${currentYear}/${key}`);
    if (!isNaN(d2.getTime())) return d2;

    // 3. Fallback: Try straight parse (in case of other formats), but be careful of 2001 default
    const d3 = new Date(key);
    if (!isNaN(d3.getTime()) && d3.getFullYear() > 2000) {
        // Only accept if it has year (handled above) OR if we really trust JS.
        // But since we want to avoid 2001 default for "1/1", we loop back.
        // If "1/1" is parsed as 2001, hasYear is false, so we hit step 2.
        // So d3 is only for cases that failed step 2 but somehow parseable?
        // e.g. "Jan 1" -> might parse.
        // If "Jan 1" -> 2001. We want 2024.
        // Better to strictly prefer current year if no year digits found.
        if (hasYear) return d3;

        // If no year digit, and step 2 failed, maybe format is weird.
        // Let's force current year on d3 components?
        d3.setFullYear(currentYear);
        return d3;
    }

    return null;
}

// --- Views ---

const TankStatusCard: React.FC<{ tank: any, dragProps?: any }> = ({ tank, dragProps }) => {
    return (
        <div
            className={`bg-white rounded-lg border border-slate-200 shadow-sm p-4 hover:border-brand-300 transition-colors relative overflow-hidden ${dragProps ? 'cursor-default' : ''}`}
            {...dragProps}
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
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-50 pt-2">
                    <div>
                        <span className="text-slate-400 block">液位 (H)</span>
                        <span className="font-medium text-slate-700">{tank.lastReading?.levelCm || 0} cm</span>
                    </div>
                    <div className="text-right">
                        <span className="text-slate-400 block">重量 (W)</span>
                        <span className="font-medium text-slate-700">{tank.lastReading?.calculatedWeightKg.toFixed(0) || 0} kg</span>
                    </div>
                </div>

                <div className="text-[10px] text-slate-400 flex items-center justify-end mt-1">
                    <Icons.ClipboardPen className="w-3 h-3 mr-1 opacity-50" />
                    {tank.lastReading ? new Date(tank.lastReading.timestamp).toLocaleDateString() : '無紀錄'}
                </div>
            </div>
        </div>
    );
}

const DashboardView: React.FC<{ tanks: Tank[], readings: Reading[], onRefresh: () => void }> = ({ tanks, readings, onRefresh }) => {
    const tanksWithStatus = useMemo(() => {
        return tanks.map(tank => {
            const tankReadings = readings.filter(r => r.tankId === tank.id).sort((a, b) => b.timestamp - a.timestamp);
            const lastReading = tankReadings[0];
            const currentLevel = lastReading ? (lastReading.calculatedVolume / tank.capacityLiters) * 100 : 0;
            const isLow = currentLevel < tank.safeMinLevel;
            return { ...tank, currentLevel, lastReading, isLow };
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
                            {groups.boiler.map(t => <TankStatusCard key={t.id} tank={t} />)}
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
                            {groups.denox.map(t => <TankStatusCard key={t.id} tank={t} />)}
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
                            {groups.others.map(t => <TankStatusCard key={t.id} tank={t} />)}
                        </div>
                    </div>
                </section>
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
}> = ({ tanks, readings, onSave, onBatchSave, onUpdateTank }) => {
    const [selectedTankId, setSelectedTankId] = useState<string>('');
    const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [levelCm, setLevelCm] = useState<string>('');
    const [customSG, setCustomSG] = useState<string>('');
    const [activeType, setActiveType] = useState<'A' | 'B' | 'C' | 'D'>('A');

    // State for editing history items
    // Allow editingItem to be Reading | ChemicalSupply | CWSParameterRecord | BWSParameterRecord
    const [editingItem, setEditingItem] = useState<any>(null);
    const [editForm, setEditForm] = useState<any>({});
    const [isEditOpen, setIsEditOpen] = useState(false);

    // History State
    const [historySupplies, setHistorySupplies] = useState<ChemicalSupply[]>([]);
    const [historyCWS, setHistoryCWS] = useState<CWSParameterRecord[]>([]);
    const [historyBWS, setHistoryBWS] = useState<BWSParameterRecord[]>([]);
    const [showMoreHistory, setShowMoreHistory] = useState(false); // Shared toggle state

    // File input for Excel import
    const [file, setFile] = useState<File | null>(null);

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

    const handleSubmitReadings = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTank) return;

        let finalSG = 1.0;
        if (customSG && parseFloat(customSG) > 0) finalSG = parseFloat(customSG);
        else if (lastReadingSG) finalSG = lastReadingSG;
        else if (activeSupply) finalSG = activeSupply.specificGravity;

        const vol = parseFloat(levelCm) * selectedTank.factor;
        const weight = vol * finalSG;

        const newReading: Reading = {
            id: Date.now().toString(),
            tankId: selectedTankId,
            timestamp: new Date(date).getTime(),
            levelCm: parseFloat(levelCm),
            calculatedVolume: vol,
            calculatedWeightKg: weight,
            appliedSpecificGravity: finalSG,
            supplyId: activeSupply?.id,
            addedAmountLiters: 0,
            operatorName: operator
        };

        onSave(newReading);
        setLevelCm('');
        setCustomSG('');
        alert('Table A: 液位紀錄已儲存');
    };

    const handleSubmitContract = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newSupply.tankId || !newSupply.supplierName || !newSupply.specificGravity || !newSupply.startDate) {
            alert("請填寫所有必要欄位");
            return;
        }
        const supply: ChemicalSupply = {
            id: Date.now().toString(),
            tankId: newSupply.tankId,
            supplierName: newSupply.supplierName,
            chemicalName: newSupply.chemicalName || '',
            specificGravity: Number(newSupply.specificGravity),
            price: newSupply.price ? Number(newSupply.price) : undefined,
            startDate: new Date(newSupply.startDate).getTime(),
            notes: newSupply.notes
        } as ChemicalSupply;

        await StorageService.saveSupply(supply);

        // 自動重新計算該儲槽相關的液位紀錄比重
        const supplyStartDate = supply.startDate;
        let sgUpdatedCount = 0;
        for (const reading of readings) {
            // 只處理同一儲槽且日期 >= 合約生效日的紀錄
            if (reading.tankId === supply.tankId && reading.timestamp >= supplyStartDate) {
                const activeSupply = await StorageService.getActiveSupply(reading.tankId, reading.timestamp);
                if (activeSupply && activeSupply.specificGravity !== reading.appliedSpecificGravity) {
                    const tank = tanks.find(t => t.id === reading.tankId);
                    const vol = reading.levelCm * (tank?.factor || 1);
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

        if (sgUpdatedCount > 0) {
            onUpdateTank(); // 觸發刷新
        }

        setNewSupply({});
        loadHistory();
        alert(`Table B: 合約紀錄已儲存${sgUpdatedCount > 0 ? `，並更新 ${sgUpdatedCount} 筆液位紀錄的比重` : ''}`);
    }

    // Helper: Normalize date string "YYYY-MM-DD" or "YYYY/MM/DD" to timestamp at Local Midnight
    // This ensures consistency between Manual Input and Excel Import for "Same Day" checks
    // MOVED TO GLOBAL SCOPE

    const handleSubmitCWS = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!cwsInput.tankId || !cwsInput.dateStr) return;

        try {
            await StorageService.saveCWSParam({
                tankId: cwsInput.tankId,
                circulationRate: Number(cwsInput.circulationRate) || 0,
                tempDiff: Number(cwsInput.tempDiff) || 0,
                cwsHardness: Number(cwsInput.cwsHardness) || 0,
                makeupHardness: Number(cwsInput.makeupHardness) || 0,
                concentrationCycles: 1, // Default to 1 for manual entry
                targetPpm: Number(cwsInput.targetPpm) || 0,
                tempOutlet: Number(cwsInput.tempOutlet) || 0,
                tempReturn: Number(cwsInput.tempReturn) || 0,
                // Use normalized timestamp
                date: getNormalizedTimestamp(cwsInput.dateStr)
            });
            onUpdateTank();
            await loadHistory();
            setCwsInput({ ...cwsInput, circulationRate: undefined, tempDiff: undefined, cwsHardness: undefined, makeupHardness: undefined, targetPpm: undefined, tempOutlet: undefined, tempReturn: undefined }); // partial reset
            alert('已更新 CWS 參數');
        } catch (error) {
            console.error(error);
            alert('更新失敗');
        }
    };

    const handleSubmitBWS = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!bwsInput.tankId || !bwsInput.dateStr) return;

        try {
            await StorageService.saveBWSParam({
                tankId: bwsInput.tankId,
                steamProduction: Number(bwsInput.steamProduction) || 0,
                targetPpm: Number(bwsInput.targetPpm) || 0,
                // Use normalized timestamp
                date: getNormalizedTimestamp(bwsInput.dateStr)
            });
            onUpdateTank();
            await loadHistory();
            setBwsInput({ ...bwsInput, steamProduction: undefined, targetPpm: undefined }); // partial reset
            alert('已更新 BWS 參數');
        } catch (error) {
            console.error(error);
            alert('更新失敗');
        }
    };

    const processExcel = async () => {
        if (!file) return;

        try {
            const jsonData = await readExcelFile(file);
            let successCount = 0;
            let sgUpdatedCount = 0; // 追蹤比重更新的筆數
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
                    for (const key of keys) {
                        const readingDate = parseDateKey(key);
                        if (readingDate) {
                            const levelVal = row[key];
                            if (levelVal !== undefined && levelVal !== '' && !isNaN(Number(levelVal))) {
                                const timestamp = readingDate.getTime();
                                const lvl = parseFloat(levelVal);
                                const supply = await StorageService.getActiveSupply(targetTank.id, timestamp);
                                const sg = supply?.specificGravity || 1.0;
                                const vol = lvl * targetTank.factor;

                                // 這裡加入檢查邏輯：是否已經有同一天、同一個儲槽的紀錄？
                                // 如果有，沿用該 ID 以達成「覆蓋」效果 (搭配後端 upsert)
                                const existingReading = readings.find(r =>
                                    r.tankId === targetTank.id &&
                                    new Date(r.timestamp).toDateString() === readingDate.toDateString()
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
                if (successCount > 0) onBatchSave(newReadings);
            } else if (activeType === 'B') {
                const newSupplies: ChemicalSupply[] = [];
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

                        newSupplies.push({
                            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                            tankId: t.id,
                            supplierName: supplier,
                            chemicalName: chem || '',
                            specificGravity: parseFloat(sg),
                            price: row['單價'] || row['Price'] ? parseFloat(row['單價'] || row['Price']) : undefined,
                            startDate: new Date(dateStr).getTime(),
                            notes: row['備註'] || row['Notes'] || ''
                        });
                        successCount++;
                    }
                }
                if (successCount > 0) {
                    await StorageService.addSuppliesBatch(newSupplies);

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
                for (const row of jsonData) {
                    const tankName = row['儲槽名稱'] || row['Tank'];
                    if (!tankName) continue;
                    const t = tanks.find(tank => tank.name.trim() === String(tankName).trim());
                    if (!t) continue;
                    const targetTankId = t.id;

                    // Type C: CWS Parameters
                    // Try to map Excel columns
                    const record: CWSParameterRecord = {
                        id: generateUUID(), // Temp ID
                        tankId: targetTankId,
                        circulationRate: parseFloat(row['循環水量'] || row['Circulation Rate'] || '0'),
                        tempDiff: parseFloat(row['溫差'] || row['Delta T'] || '0'),
                        cwsHardness: parseFloat(row['冷卻水硬度'] || row['CWS Hardness'] || '0'),
                        makeupHardness: parseFloat(row['補水硬度'] || row['Makeup Hardness'] || '0'),
                        concentrationCycles: parseFloat(row['濃縮倍數'] || row['Concentration Cycles'] || '1'),
                        targetPpm: parseFloat(row['目標濃度'] || row['目標藥劑濃度'] || row['Target PPM'] || '0'),
                        tempOutlet: parseFloat(row['出水溫'] || row['T1'] || '0'),
                        tempReturn: parseFloat(row['回水溫'] || row['T2'] || '0'),
                        date: getNormalizedTimestamp(row['日期'] || row['填表日期'] || row['Date'])
                    };

                    // Skip future dates
                    if (record.date > Date.now()) {
                        console.warn(`Skipping future CWS param: ${record.date}`);
                        continue;
                    }

                    await StorageService.saveCWSParam(record);
                    if (updatedTanks.findIndex(tank => tank.id === targetTankId) === -1) {
                        updatedTanks.push(t);
                    }
                    successCount++;
                }
                if (updatedTanks.length > 0) {
                    onUpdateTank(); // Trigger refresh for all affected tanks
                }
                await loadHistory();
            } else if (activeType === 'D') {
                for (const row of jsonData) {
                    const tankName = row['儲槽名稱'] || row['Tank'];
                    if (!tankName) continue;
                    const t = tanks.find(tank => tank.name.trim() === String(tankName).trim());
                    if (!t) continue;
                    const targetTankId = t.id;

                    // Type D: BWS Parameters
                    const record: BWSParameterRecord = {
                        id: generateUUID(), // Temp ID
                        tankId: targetTankId,
                        steamProduction: parseFloat(row['蒸汽總產量'] || row['Steam Production'] || '0'),
                        targetPpm: parseFloat(row['目標濃度'] || row['Target PPM'] || '0'),
                        date: getNormalizedTimestamp(row['日期'] || row['填表日期'] || row['Date'])
                    };

                    // Skip future dates
                    if (record.date > Date.now()) {
                        console.warn(`Skipping future BWS param: ${record.date}`);
                        continue;
                    }

                    await StorageService.saveBWSParam(record);
                    if (updatedTanks.findIndex(tank => tank.id === targetTankId) === -1) {
                        updatedTanks.push(t);
                    }
                    successCount++;
                }
                if (updatedTanks.length > 0) {
                    onUpdateTank(); // Trigger refresh for all affected tanks
                }
                await loadHistory();
            }

            // 組合完成訊息
            let message = `匯入完成! 成功處理 ${successCount} 筆資料 (Type ${activeType})`;
            if (activeType === 'B' && sgUpdatedCount > 0) {
                message += `\n\n已自動更新 ${sgUpdatedCount} 筆液位紀錄的比重`;
            }
            alert(message);
            setFile(null);

        } catch (e: any) {
            console.error('Excel 匯入錯誤:', e);
            const errorMsg = e?.message || String(e);
            alert(`檔案讀取失敗，請確認格式。\n\n錯誤詳情: ${errorMsg}`);
        }
    };

    // 批次重新計算比重 - 根據 Table B 的合約資料重新計算 Table A 的比重
    // silent: true 時不顯示確認對話框（用於自動觸發）
    const recalculateSG = async (silent = false): Promise<number> => {
        if (!silent && !confirm('此操作將根據藥劑合約 (Table B) 重新計算所有液位紀錄的比重，確定要繼續嗎？')) return 0;

        try {
            let updatedCount = 0;
            const updatedReadings: Reading[] = [];

            for (const reading of readings) {
                const supply = await StorageService.getActiveSupply(reading.tankId, reading.timestamp);
                const newSG = supply?.specificGravity || reading.appliedSpecificGravity; // 保留原值如果找不到合約

                // 只在有找到合約且比重不同時才更新
                if (supply && newSG !== reading.appliedSpecificGravity) {
                    const tank = tanks.find(t => t.id === reading.tankId);
                    const vol = reading.levelCm * (tank?.factor || 1);

                    updatedReadings.push({
                        ...reading,
                        appliedSpecificGravity: newSG,
                        calculatedWeightKg: vol * newSG,
                        supplyId: supply.id
                    });
                    updatedCount++;
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
            return 0;
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
    };

    return (
        <div className="max-w-5xl mx-auto space-y-6">
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Card
                    title={
                        activeType === 'A' ? "手動輸入 - 液位紀錄" :
                            activeType === 'B' ? "手動輸入 - 合約資料" :
                                activeType === 'C' ? "手動輸入 - 冷卻水參數" : "手動輸入 - 鍋爐水參數"
                    }
                    className={`border-t-4 ${activeType === 'A' ? 'border-t-blue-500' :
                        activeType === 'B' ? 'border-t-purple-500' :
                            activeType === 'C' ? 'border-t-sky-500' : 'border-t-orange-500'
                        }`}
                >
                    {activeType === 'A' && (
                        <form onSubmit={handleSubmitReadings} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">1. 選擇儲槽</label>
                                <select value={selectedTankId} onChange={e => setSelectedTankId(e.target.value)} className={inputClassName} required>
                                    {tanks.map(t => <option key={t.id} value={t.id}>{t.name} ({t.system})</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">2. 抄表日期</label>
                                <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClassName} required />
                            </div>
                            <div className="p-3 bg-blue-50 rounded border border-blue-100 text-sm text-blue-900">
                                <div className="flex justify-between">
                                    <span>當期合約: {activeSupply?.supplierName || '無'}</span>
                                    <span className="font-bold">比重: {lastReadingSG || activeSupply?.specificGravity || 1.0}</span>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">液位高度 (cm)</label>
                                    <input type="number" step="0.1" value={levelCm} onChange={e => setLevelCm(e.target.value)} className={inputClassName} placeholder="H" required />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">自訂比重 (選填)</label>
                                    <input type="number" step="0.001" value={customSG} onChange={e => setCustomSG(e.target.value)} className={inputClassName} placeholder="SG" />
                                </div>
                            </div>
                            <div className="pt-2">
                                <Button type="submit" className="w-full justify-center">儲存液位紀錄</Button>
                            </div>
                        </form>
                    )}

                    {/* 歷史數據列表 - 僅在 Type A 且已選擇儲槽時顯示 */}
                    {activeType === 'A' && selectedTankId && (() => {
                        const historyLimit = showMoreHistory ? 60 : 10;

                        const historyReadings = readings
                            .filter(r => r.tankId === selectedTankId)
                            .sort((a, b) => b.timestamp - a.timestamp)
                            .slice(0, historyLimit);

                        // 定義編輯處理函數
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
                                onUpdateTank(); // 觸發刷新
                                alert('刪除成功');
                            } catch (e) {
                                console.error(e);
                                alert('刪除失敗');
                            }
                        };

                        if (historyReadings.length === 0) return null;

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
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">日期</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">液位 (cm)</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">存量 (L)</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-slate-200">
                                            {historyReadings.map(r => (
                                                <tr key={r.id} className="hover:bg-slate-50">
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                        {new Date(r.timestamp).toLocaleDateString()}
                                                    </td>
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                        {r.levelCm}
                                                    </td>
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                        {Math.round(r.calculatedVolume)}
                                                    </td>
                                                    <td className="px-3 py-2 whitespace-nowrap text-right text-sm">
                                                        <button
                                                            onClick={() => handleHistoryEdit(r)}
                                                            className="text-blue-600 hover:text-blue-900 mr-3"
                                                        >
                                                            編輯
                                                        </button>
                                                        <button
                                                            onClick={() => handleHistoryDelete(r.id)}
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
                                        concentrationCycles: Number(editForm.concentrationCycles),
                                        targetPpm: Number(editForm.targetPpm)
                                    });
                                } else if (activeType === 'D') {
                                    await StorageService.updateBWSParamRecord({
                                        ...editingItem,
                                        ...editForm,
                                        date: new Date(editForm.dateStr).getTime(),
                                        steamProduction: Number(editForm.steamProduction),
                                        targetPpm: Number(editForm.targetPpm)
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
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">目標藥劑濃度 (ppm)</label>
                                    <input
                                        type="number" step="1"
                                        className={inputClassName}
                                        value={editForm.targetPpm || ''}
                                        onChange={e => setEditForm({ ...editForm, targetPpm: e.target.value })}
                                    />
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
                                <div>
                                    <label className="block text-sm font-medium text-slate-700">基準添加量 (ppm)</label>
                                    <input
                                        type="number" step="1"
                                        className={inputClassName}
                                        value={editForm.targetPpm || ''}
                                        onChange={e => setEditForm({ ...editForm, targetPpm: e.target.value })}
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
                                    <label className="block text-sm font-medium text-slate-700 mb-1">生效日期</label>
                                    <input type="date" onChange={e => setNewSupply({ ...newSupply, startDate: e.target.value as any })} className={inputClassName} required />
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
                                <label className="block text-sm font-medium text-slate-700 mb-1">1. 選擇儲槽 (僅限 CWS)</label>
                                <select
                                    value={cwsInput.tankId || ''}
                                    onChange={e => {
                                        setCwsInput({ ...cwsInput, tankId: e.target.value });
                                        setSelectedTankId(e.target.value);
                                    }}
                                    className={inputClassName}
                                    required
                                >
                                    <option value="">-- 請選擇 --</option>
                                    {tanks
                                        .filter(t => t.system === SystemType.COOLING && t.calculationMethod === 'CWS_BLOWDOWN')
                                        .map(t => <option key={t.id} value={t.id}>{t.name}</option>)
                                    }
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">2. 填表日期</label>
                                <input type="date" value={cwsInput.dateStr || ''} onChange={e => setCwsInput({ ...cwsInput, dateStr: e.target.value })} className={inputClassName} required />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">循環水量 R (m3/h)</label>
                                    <input type="number" value={cwsInput.circulationRate || ''} onChange={e => setCwsInput({ ...cwsInput, circulationRate: parseFloat(e.target.value) })} className={inputClassName} placeholder="R" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">溫差 ΔT (°C)</label>
                                    <input type="number" step="0.1" value={cwsInput.tempDiff || ''} onChange={e => setCwsInput({ ...cwsInput, tempDiff: parseFloat(e.target.value) })} className={inputClassName} placeholder="dT" />
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
                                    <label className="block text-sm font-medium text-slate-700 mb-1">目標藥劑濃度 (ppm)</label>
                                    <input type="number" step="0.1" value={cwsInput.targetPpm || ''} onChange={e => setCwsInput({ ...cwsInput, targetPpm: parseFloat(e.target.value) })} className={inputClassName} />
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
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">目標濃度 (ppm)</th>
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
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                        {item.targetPpm || '-'}
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
                                <input type="date" value={bwsInput.dateStr || ''} onChange={e => setBwsInput({ ...bwsInput, dateStr: e.target.value })} className={inputClassName} required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">週蒸汽總產量 (Ton/Week)</label>
                                <input type="number" value={bwsInput.steamProduction || ''} onChange={e => setBwsInput({ ...bwsInput, steamProduction: parseFloat(e.target.value) })} className={inputClassName} placeholder="Steam" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">目標藥劑濃度 (ppm)</label>
                                <input type="number" step="0.1" value={bwsInput.targetPpm || ''} onChange={e => setBwsInput({ ...bwsInput, targetPpm: parseFloat(e.target.value) })} className={inputClassName} placeholder="Target" />
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
                                                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-50">目標濃度 (ppm)</th>
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
                                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-900">
                                                        {item.targetPpm || '-'}
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
                                    <li>選填欄位: <strong>藥劑名稱</strong>, <strong>單價</strong>, <strong>備註</strong></li>
                                </ul>
                            )}

                            {activeType === 'C' && (
                                <ul className="list-disc list-inside">
                                    <li>必要欄位: <strong>儲槽名稱</strong></li>
                                    <li>參數欄位: <strong>循環水量, 溫差...</strong></li>
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
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-200">
                {/* Buttons moved specifically to Type A and Type B sections */}
            </div>
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

const AnalysisView: React.FC<{ tanks: Tank[], readings: Reading[] }> = ({ tanks, readings }) => {
    const [selectedTankId, setSelectedTankId] = useState<string>(tanks[0]?.id || '');

    const getLastCompleteWeek = () => {
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0(Sun) - 6(Sat)
        const daysSinceLastSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
        const lastSunday = new Date(today);
        lastSunday.setDate(today.getDate() - daysSinceLastSunday);
        const lastMonday = new Date(lastSunday);
        lastMonday.setDate(lastSunday.getDate() - 6);
        return {
            start: lastMonday.toISOString().split('T')[0],
            end: lastSunday.toISOString().split('T')[0]
        };
    };
    const defaultRange = useMemo(() => getLastCompleteWeek(), []);

    const [tempDateRange, setTempDateRange] = useState(defaultRange);
    const [appliedDateRange, setAppliedDateRange] = useState(defaultRange);

    const [metric, setMetric] = useState<'KG' | 'L'>('KG');
    const [bwsParamsHistory, setBwsParamsHistory] = useState<BWSParameterRecord[]>([]);
    const [cwsParamsHistory, setCwsParamsHistory] = useState<CWSParameterRecord[]>([]);

    const selectedTank = tanks.find(t => t.id === selectedTankId);

    // 載入該儲槽的參數歷史記錄
    useEffect(() => {
        const loadParamsHistory = async () => {
            if (!selectedTankId) return;
            try {
                const bwsHistory = await StorageService.getBWSParamsHistory(selectedTankId);
                const cwsHistory = await StorageService.getCWSParamsHistory(selectedTankId);
                setBwsParamsHistory(bwsHistory);
                setCwsParamsHistory(cwsHistory);
            } catch (error) {
                console.error('載入參數歷史記錄失敗:', error);
            }
        };
        loadParamsHistory();
    }, [selectedTankId]);

    // Time Range Options
    const timeRanges = [
        { label: '近 1 個月', value: 30 },
        { label: '近 3 個月', value: 90 },
        { label: '近 6 個月', value: 180 },
        { label: '近 1 年', value: 365 },
    ];

    // 1. Process readings into daily continuous data
    const dailyData = useMemo(() => {
        if (!selectedTank || readings.length < 2) {
            console.log('[每週用量] dailyData: 數據不足', {
                selectedTank: selectedTank?.name,
                totalReadingsCount: readings.length
            });
            return [];
        }

        const startTs = getNormalizedTimestamp(appliedDateRange.start);
        const endTs = getNormalizedTimestamp(appliedDateRange.end) + (24 * 60 * 60 * 1000 - 1); // End of day

        const tankReadings = readings
            .filter(r => r.tankId === selectedTankId && r.timestamp >= startTs && r.timestamp <= endTs)
            .sort((a, b) => a.timestamp - b.timestamp);

        console.log('[每週用量] 該儲槽讀數', {
            tankId: selectedTankId,
            tankName: selectedTank.name,
            count: tankReadings.length,
            dateRange: tankReadings.length > 0 ? {
                from: new Date(tankReadings[0].timestamp).toLocaleDateString('zh-TW'),
                to: new Date(tankReadings[tankReadings.length - 1].timestamp).toLocaleDateString('zh-TW')
            } : null
        });

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
                // Apply historic specific gravity
                const addedKg = next.addedAmountLiters * next.appliedSpecificGravity;
                startLevel = curr.calculatedWeightKg;
                endLevel = next.calculatedWeightKg;
                totalUsage = (startLevel + addedKg) - endLevel;
            }

            const dailyUsage = Math.max(0, totalUsage / diffDays);

            let iterDate = new Date(curr.timestamp);
            while (iterDate < new Date(next.timestamp)) {
                const dateKey = iterDate.toISOString().split('T')[0];
                if (!dailyMap.has(dateKey)) {
                    dailyMap.set(dateKey, {
                        date: new Date(iterDate),
                        usage: dailyUsage,
                        refill: 0,
                        level: metric === 'L' ? curr.calculatedVolume : curr.calculatedWeightKg
                    });
                }
                iterDate.setDate(iterDate.getDate() + 1);
            }
        }

        const result = Array.from(dailyMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
        console.log('[每週用量] dailyData 生成完成', {
            count: result.length,
            dateRange: result.length > 0 ? {
                from: result[0].date.toLocaleDateString('zh-TW'),
                to: result[result.length - 1].date.toLocaleDateString('zh-TW')
            } : null
        });
        return result;
    }, [readings, selectedTankId, metric, selectedTank, appliedDateRange]);

    // 2. Weekly Aggregation
    const weeklyData = useMemo(() => {
        if (dailyData.length === 0) {
            console.log('[每週用量] weeklyData: 每日數據為空');
            return [];
        }

        // dailyData is already filtered by dateRange, so we just use it directly
        const filteredDaily = dailyData;

        console.log('[每週用量] 時間範圍篩選', {
            dateRange: appliedDateRange,
            filteredCount: filteredDaily.length
        });

        const weeklyMap = new Map<string, { date: Date, dateStr: string, usage: number, avgLevel: number, count: number }>();

        filteredDaily.forEach(day => {
            const dayDate = new Date(day.date);
            const dayNum = dayDate.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
            // 計算距離本週星期一的天數
            // 星期一=0天, 星期二=1天, ..., 星期日=6天
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

        const result = Array.from(weeklyMap.values()).map(w => ({
            ...w,
            level: w.avgLevel / (w.count || 1)
        })).sort((a, b) => a.date.getTime() - b.date.getTime());

        console.log('[每週用量] weeklyData 生成完成', {
            count: result.length,
            weeks: result.map(w => ({
                week: w.dateStr,
                usage: w.usage.toFixed(2),
                level: w.level.toFixed(2),
                days: w.count
            }))
        });

        return result;
    }, [dailyData]);

    // 3. Monthly Comparison Data (Actual vs Theoretical)
    const monthlyComparisonData = useMemo(() => {
        if (!selectedTank || dailyData.length === 0) return [];

        // dailyData is already filtered by dateRange
        const filteredDaily = dailyData;

        const monthlyMap = new Map<string, { date: Date, dateStr: string, actual: number, days: number }>();

        filteredDaily.forEach(day => {
            const mKey = `${day.date.getFullYear()}-${String(day.date.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlyMap.has(mKey)) {
                monthlyMap.set(mKey, {
                    date: new Date(day.date.getFullYear(), day.date.getMonth(), 1),
                    dateStr: `${day.date.getFullYear()}/${day.date.getMonth() + 1}`,
                    actual: 0,
                    days: 0
                });
            }
            const m = monthlyMap.get(mKey)!;
            m.actual += day.usage;
            m.days++;
        });

        const calcMethod = selectedTank.calculationMethod || 'NONE';

        return Array.from(monthlyMap.values()).map(m => {
            let theoreticalTotal = 0;

            if (calcMethod === 'CWS_BLOWDOWN' && selectedTank.cwsParams) {
                const { circulationRate, tempDiff, targetPpm, cwsHardness, makeupHardness } = selectedTank.cwsParams;

                let cycles = 1;
                if (cwsHardness && makeupHardness && makeupHardness > 0) {
                    cycles = cwsHardness / makeupHardness;
                }

                // Formula: E = R * dT * 1.8 / 1000 * 24 * Days
                const E = (circulationRate * tempDiff * 1.8 * 24 * m.days) / 1000;
                // B = E / (Cycles - 1)
                const B = cycles > 1 ? E / (cycles - 1) : 0;
                // Theoretical (kg) = B(m3) * ppm / 1000
                theoreticalTotal = (B * targetPpm) / 1000;

            } else if (calcMethod === 'BWS_STEAM' && selectedTank.bwsParams) {
                const { steamProduction, targetPpm } = selectedTank.bwsParams;
                // steamProduction is now Weekly.
                // Formula: Daily = Weekly / 7. Total = Daily * Days
                // Theoretical (kg) = Total Steam (Ton) * ppm / 1000
                const dailySteam = steamProduction / 7;
                theoreticalTotal = (dailySteam * m.days * targetPpm) / 1000;
            }

            // If metric is L, we need SG to convert theoretical KG back to L
            // Simplified: assuming SG=1.0 for theoretical display in Liters, or user should switch to KG
            // For accuracy, we usually compare KG in chemical engineering.
            if (metric === 'L' && theoreticalTotal > 0) {
                // Not converting back to L for theoretical currently as SG varies per batch. 
                // Suggest viewing in KG.
            }

            return {
                dateStr: m.dateStr,
                date: m.date,
                actual: m.actual,
                theoretical: theoreticalTotal,
                deviation: theoreticalTotal > 0 ? ((m.actual - theoreticalTotal) / theoreticalTotal) * 100 : 0
            };
        }).sort((a, b) => a.date.getTime() - b.date.getTime());

    }, [dailyData, selectedTank, metric]);

    // 4. Weekly Comparison Data (Actual vs Theoretical)
    const weeklyComparisonData = useMemo(() => {
        if (!selectedTank || weeklyData.length === 0) return [];

        return weeklyData.map(week => {
            let theoreticalTotal = 0;
            const weekStartTime = week.date.getTime();
            const weekEndTime = weekStartTime + (7 * 24 * 60 * 60 * 1000);

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
                    // targetPpm can fallback to previous week or default
                    const targetPpm = weekData.targetPpm ||
                        bwsParamsHistory
                            .filter(p => (p.date || 0) < weekEndTime && p.targetPpm)
                            .sort((a, b) => (b.date || 0) - (a.date || 0))[0]?.targetPpm ||
                        selectedTank.bwsParams?.targetPpm || 0;
                    theoreticalTotal = (steamProduction * targetPpm) / 1000;
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

                    // targetPpm priority: weekData > history fallback > tank default
                    // Since 'params' might be 'selectedTank.cwsParams', we need to be careful.
                    // If weekData exists, use its logic. If not, 'params' is tank defaults.

                    let targetPpm = params.targetPpm || 0;
                    if (weekData) {
                        targetPpm = weekData.targetPpm ||
                            cwsParamsHistory
                                .filter(p => (p.date || 0) < weekEndTime && p.targetPpm)
                                .sort((a, b) => (b.date || 0) - (a.date || 0))[0]?.targetPpm ||
                            selectedTank.cwsParams?.targetPpm || 0;
                    } else {
                        // Fallback case: using tank defaults, so use tank's targetPpm
                        targetPpm = selectedTank.cwsParams?.targetPpm || 0;
                    }

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
                }
                // If no weekData with production data, theoreticalTotal stays 0
            }

            return {
                dateStr: week.dateStr,
                date: week.date,
                actual: week.usage,
                theoretical: theoreticalTotal,
                deviation: theoreticalTotal > 0 ? ((week.usage - theoreticalTotal) / theoreticalTotal) * 100 : 0
            };
        }).sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [weeklyData, selectedTank, bwsParamsHistory, cwsParamsHistory]);

    const hasCalculation = selectedTank && selectedTank.calculationMethod && selectedTank.calculationMethod !== 'NONE';

    // Theoretical Calculation Details Card
    const TheoreticalUsageCard: React.FC<{ tank: Tank, weeklyData: any[] }> = ({ tank, weeklyData }) => {
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
                                    <th className="p-2 font-semibold text-slate-800 text-right">理論用量 (kg)</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">實際用量 (kg)</th>
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
                                    const targetPpm = p.targetPpm || 0;

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
                                    const theoryUsage = (BW * targetPpm) / 1000;

                                    const actualUsage = week.usage;
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
                                                calc: { E, C, BW, theoryUsage, cFormula }
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
                                            <span className="font-mono text-lg font-bold text-slate-800">{selectedWeek.params.targetPpm || 0} ppm</span>
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
                                                <h4 className="font-bold text-slate-800 mb-2">4. 藥品理論週用量</h4>
                                                <div className="font-mono text-sm text-slate-700">
                                                    = B.W x 目標濃度 ({selectedWeek.params.targetPpm} ppm) / 1000<br />
                                                    = {selectedWeek.calc.BW.toFixed(1)} x {selectedWeek.params.targetPpm} / 1000<br />
                                                    = <span className="text-red-600 font-bold text-xl">{selectedWeek.calc.theoryUsage.toFixed(1)} kg</span>
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
                                    <th className="p-2 font-semibold text-slate-800 text-right">理論用量 (kg)</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">實際用量 (kg)</th>
                                    <th className="p-2 font-semibold text-slate-800 text-right">差異 %</th>
                                    <th className="p-2 font-semibold text-slate-800 text-center">數據來源</th>
                                </tr>
                            </thead>
                            <tbody>
                                {weeklyData.map((week, idx) => {
                                    const params = getParamsForWeek(week.date) as BWSParameterRecord | undefined;
                                    const steamProduction = params?.steamProduction || tank.bwsParams?.steamProduction || 0;
                                    const targetPpm = params?.targetPpm || tank.bwsParams?.targetPpm || 0;
                                    const theoryUsage = (steamProduction * targetPpm) / 1000;

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

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="w-full sm:w-auto flex gap-4">
                    <select
                        value={selectedTankId}
                        onChange={e => setSelectedTankId(e.target.value)}
                        className={`${inputClassName} w-48`}
                    >
                        {tanks.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>

                    <div className="flex items-center gap-2">
                        <input
                            type="date"
                            value={tempDateRange.start}
                            onChange={e => setTempDateRange(prev => ({ ...prev, start: e.target.value }))}
                            className={inputClassName}
                        />
                        <span className="text-slate-500">至</span>
                        <input
                            type="date"
                            value={tempDateRange.end}
                            onChange={e => setTempDateRange(prev => ({ ...prev, end: e.target.value }))}
                            className={inputClassName}
                        />
                        <Button
                            onClick={() => setAppliedDateRange(tempDateRange)}
                            className="bg-brand-600 hover:bg-brand-700 text-white ml-2"
                        >
                            套用
                        </Button>
                    </div>
                </div>
                <div className="flex gap-2">
                    <div className="bg-white border rounded-lg p-1 flex">
                        <button onClick={() => setMetric('KG')} className={`px-3 py-1 rounded text-sm ${metric === 'KG' ? 'bg-brand-500 text-white' : 'text-slate-600'}`}>KG</button>
                        <button onClick={() => setMetric('L')} className={`px-3 py-1 rounded text-sm ${metric === 'L' ? 'bg-brand-500 text-white' : 'text-slate-600'}`}>L</button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Weekly Comparison Chart - Left */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                        <h3 className="font-semibold text-slate-800">
                            {hasCalculation ? `週用量 vs 理論值 (${metric})` : `週用量趨勢 (${metric})`}
                        </h3>
                    </div>
                    <div className="p-6" style={{ height: '400px' }}>
                        {weeklyComparisonData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%" minHeight={300}>
                                <ComposedChart data={weeklyComparisonData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
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
                </div>


                {/* Monthly Comparison Chart - Right */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                        <h3 className="font-semibold text-slate-800">
                            {hasCalculation ? `月用量 vs 理論值 (${metric})` : `月用量趨勢 (${metric})`}
                        </h3>
                    </div>
                    <div className="p-6" style={{ height: '400px' }}>
                        {monthlyComparisonData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%" minHeight={300}>
                                <ComposedChart data={monthlyComparisonData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
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
                </div>
            </div>

            <TheoreticalUsageCard tank={selectedTank} weeklyData={weeklyData} />
        </div>
    );
};

const ImportantNotesView: React.FC = () => {
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

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-slate-800">重要紀事</h2>
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
                    <Button onClick={() => { setEditingNote(null); setFormData({ dateStr: formatDateForInput(new Date()), area: '', chemicalName: '', note: '' }); setIsEditOpen(true); }} className="flex items-center gap-2">
                        <Icons.Plus className="w-4 h-4" /> 新增紀事
                    </Button>
                </div>
            </div>

            <Card>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-slate-600">
                        <thead className="text-xs text-slate-700 uppercase bg-slate-50 border-b">
                            <tr>
                                <th className="px-6 py-3">日期</th>
                                <th className="px-6 py-3">區域</th>
                                <th className="px-6 py-3">藥品名稱</th>
                                <th className="px-6 py-3">重要紀事</th>
                                <th className="px-6 py-3 w-24">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {notes.map(note => (
                                <tr key={note.id} className="bg-white border-b hover:bg-slate-50">
                                    <td className="px-6 py-4 font-medium text-slate-900 whitespace-nowrap">{note.dateStr}</td>
                                    <td className="px-6 py-4">{note.area}</td>
                                    <td className="px-6 py-4">{note.chemicalName}</td>
                                    <td className="px-6 py-4 max-w-md truncate" title={note.note}>{note.note}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center space-x-2">
                                            <button onClick={() => handleEdit(note)} className="text-blue-600 hover:text-blue-800 p-1 rounded-full hover:bg-blue-50 transition-colors" title="編輯">
                                                <Icons.FilePenLine className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleDelete(note.id)} className="text-red-600 hover:text-red-800 p-1 rounded-full hover:bg-red-50 transition-colors" title="刪除">
                                                <Icons.Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {notes.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-8 text-center text-slate-400 italic">尚無資料</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            {isEditOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="text-lg font-semibold text-slate-900">{editingNote ? '編輯紀事' : '新增紀事'}</h3>
                            <button onClick={() => setIsEditOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors">
                                <Icons.X className="w-5 h-5" />
                            </button>
                        </div>
                        <form onSubmit={handleSave} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">日期</label>
                                <input
                                    type="date"
                                    value={formData.dateStr}
                                    onChange={e => setFormData({ ...formData, dateStr: e.target.value })}
                                    className={inputClassName}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">區域</label>
                                <input
                                    type="text"
                                    value={formData.area}
                                    onChange={e => setFormData({ ...formData, area: e.target.value })}
                                    className={inputClassName}
                                    required
                                    placeholder="例如: CT-1, BLR"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">藥品名稱</label>
                                <input
                                    type="text"
                                    value={formData.chemicalName}
                                    onChange={e => setFormData({ ...formData, chemicalName: e.target.value })}
                                    className={inputClassName}
                                    required
                                    placeholder="例如: 硫酸, 氨水"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">重要紀事</label>
                                <textarea
                                    value={formData.note}
                                    onChange={e => setFormData({ ...formData, note: e.target.value })}
                                    className={`${inputClassName} min-h-[100px] resize-none`}
                                    required
                                    placeholder="輸入說明..."
                                />
                            </div>
                            <div className="pt-4 flex space-x-3">
                                <Button type="button" variant="secondary" onClick={() => setIsEditOpen(false)} className="flex-1 justify-center">取消</Button>
                                <Button type="submit" className="flex-1 justify-center">儲存</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

const SettingsView: React.FC<{ tanks: Tank[], onRefresh: () => void }> = ({ tanks, onRefresh }) => {
    const [editingTank, setEditingTank] = useState<Tank | null>(null);

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
        }
        e.target.value = '';
    };

    const handleDelete = async (id: string) => {
        if (confirm('確定要刪除此儲槽及其所有相關設定嗎? (液位紀錄將保留)')) {
            await StorageService.deleteTank(id);
            await onRefresh();
        }
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingTank) return;

        // Update modification timestamps if params exist
        const tankToSave = { ...editingTank };
        if (tankToSave.cwsParams) {
            tankToSave.cwsParams.date = Date.now();
        }
        if (tankToSave.bwsParams) {
            tankToSave.bwsParams.date = Date.now();
        }

        await StorageService.saveTank(tankToSave);
        await onRefresh();
        setEditingTank(null);
        alert('儲槽設定已更新');
    };

    const updateTankField = (field: keyof Tank, value: any) => {
        if (!editingTank) return;
        setEditingTank({ ...editingTank, [field]: value });
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
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">容量 (L)</label>
                            <input type="number" value={editingTank.capacityLiters} onChange={e => updateTankField('capacityLiters', Number(e.target.value))} className={inputClassName} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">換算因子 (L/cm)</label>
                            <input type="number" step="0.1" value={editingTank.factor} onChange={e => updateTankField('factor', Number(e.target.value))} className={inputClassName} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">安全低液位警戒 (%)</label>
                            <input type="number" value={editingTank.safeMinLevel} onChange={e => updateTankField('safeMinLevel', Number(e.target.value))} className={inputClassName} />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">描述</label>
                            <input type="text" value={editingTank.description || ''} onChange={e => updateTankField('description', e.target.value)} className={inputClassName} />
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

                    {/* Param Forms */}
                    {editingTank.calculationMethod === 'CWS_BLOWDOWN' && (
                        <div className="bg-sky-50 p-4 rounded-lg border border-sky-100 space-y-4">
                            <h4 className="font-bold text-sky-900 flex items-center gap-2">
                                <Icons.Cooling className="w-4 h-4" /> 冷卻水理論參數設定
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-sky-700 mb-1">循環水量 R (m³/hr)</label>
                                    <input type="number" value={editingTank.cwsParams?.circulationRate || 0} onChange={e => updateCWSParam('circulationRate', Number(e.target.value))} className={inputClassName} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-sky-700 mb-1">溫差 ΔT (°C)</label>
                                    <input type="number" step="0.1" value={editingTank.cwsParams?.tempDiff || 0} onChange={e => updateCWSParam('tempDiff', Number(e.target.value))} className={inputClassName} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-sky-700 mb-1">濃縮倍數 N</label>
                                    <input type="number" step="0.1" value={editingTank.cwsParams?.concentrationCycles || 0} onChange={e => updateCWSParam('concentrationCycles', Number(e.target.value))} className={inputClassName} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-sky-700 mb-1">目標點 ppm</label>
                                    <input type="number" step="0.1" value={editingTank.cwsParams?.targetPpm || 0} onChange={e => updateCWSParam('targetPpm', Number(e.target.value))} className={inputClassName} />
                                </div>
                            </div>
                        </div>
                    )}

                    {editingTank.calculationMethod === 'BWS_STEAM' && (
                        <div className="bg-orange-50 p-4 rounded-lg border border-orange-100 space-y-4">
                            <h4 className="font-bold text-orange-900 flex items-center gap-2">
                                <Icons.Boiler className="w-4 h-4" /> 鍋爐水理論參數設定
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-orange-700 mb-1">每週蒸汽總產量 (Tons/Week)</label>
                                    <input type="number" value={editingTank.bwsParams?.steamProduction || 0} onChange={e => updateBWSParam('steamProduction', Number(e.target.value))} className={inputClassName} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-orange-700 mb-1">目標點 ppm</label>
                                    <input type="number" step="0.1" value={editingTank.bwsParams?.targetPpm || 0} onChange={e => updateBWSParam('targetPpm', Number(e.target.value))} className={inputClassName} />
                                </div>
                            </div>
                        </div>
                    )}

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
                        <span className="font-mono font-medium">{tank.safeMinLevel}%</span>
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
                <h2 className="text-2xl font-bold text-slate-800">系統設定</h2>
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
                        <h2 className="text-xl font-bold text-sky-900">冷卻水系統設定</h2>
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
                            <h2 className="text-xl font-bold text-orange-900">鍋爐水系統設定</h2>
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
                            <h2 className="text-xl font-bold text-emerald-900">脫銷系統設定</h2>
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
                        <h2 className="text-lg font-bold text-slate-700">其他系統設定</h2>
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

type ViewType = 'dashboard' | 'entry' | 'analysis' | 'settings' | 'notes';

const App: React.FC = () => {
    const [currentView, setCurrentView] = useState<ViewType>('dashboard');
    const [tanks, setTanks] = useState<Tank[]>([]);
    const [readings, setReadings] = useState<Reading[]>([]);



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
            case 'dashboard': return <DashboardView tanks={tanks} readings={readings} onRefresh={refreshData} />;
            case 'entry': return <DataEntryView tanks={tanks} readings={readings} onSave={handleSaveReading} onBatchSave={handleBatchSaveReadings} onUpdateTank={() => refreshData()} />;
            case 'analysis': return <AnalysisView tanks={tanks} readings={readings} />;
            case 'settings': return <SettingsView tanks={tanks} onRefresh={refreshData} />;
            case 'notes': return <ImportantNotesView />;
            default: return <DashboardView tanks={tanks} readings={readings} onRefresh={refreshData} />;
        }
    };

    const NavItem = ({ view, icon: Icon, label }: { view: ViewType, icon: React.ElementType, label: string }) => (
        <button
            onClick={() => setCurrentView(view)}
            className={`w-full flex items-center px-3 py-2 text-sm font-medium transition-colors
          ${currentView === view ? 'bg-brand-50 text-brand-700 border-r-4 border-brand-500' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
        >
            <Icon className={`w-5 h-5 mr-3 ${currentView === view ? 'text-brand-500' : 'text-slate-400'}`} />
            {label}
        </button>
    );

    return (
        <div className="flex h-screen bg-slate-50 overflow-hidden">
            {/* Sidebar */}
            <aside className="bg-white border-r border-slate-200 flex-shrink-0 w-48 flex flex-col">
                <div className="h-16 flex items-center px-4 border-b border-slate-100">
                    <img src="logo.png" alt="Logo" className="w-8 h-8 mr-3 object-contain" />
                    <span className="font-bold text-lg text-slate-800 tracking-tight">藥劑管理</span>
                </div>

                <nav className="flex-1 overflow-y-auto py-4 space-y-1">
                    <NavItem view="dashboard" icon={Icons.Dashboard} label="總覽看板" />
                    <NavItem view="entry" icon={Icons.Entry} label="數據輸入" />
                    <NavItem view="analysis" icon={Icons.Analysis} label="用量分析" />
                    <NavItem view="notes" icon={Icons.Notes} label="重要紀事" />
                    <NavItem view="settings" icon={Icons.Settings} label="系統設定" />
                </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 flex-shrink-0">
                    <h1 className="text-xl font-bold text-slate-800">
                        {currentView === 'dashboard' && '總覽看板'}
                        {currentView === 'entry' && '數據輸入'}
                        {currentView === 'analysis' && '用量趨勢分析'}
                        {currentView === 'settings' && '系統設定'}
                    </h1>
                    <div className="flex items-center gap-4">
                        <div className="text-sm text-slate-500">
                            {new Date().toLocaleDateString()}
                        </div>
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs">
                            OP
                        </div>
                    </div>
                </header>
                <div className="flex-1 overflow-auto p-8">
                    {renderContent()}
                </div>
            </main>
        </div>
    );
};

export default App;