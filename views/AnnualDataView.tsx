import React, { useState, useMemo, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Tank, Reading, ChemicalSupply, SystemType, CWSParameterRecord, BWSParameterRecord, ImportantNote } from '../types';
import { StorageService } from '../services/storageService';
import { calculateCWSUsage } from '../utils/calculationUtils';
import { Icons } from '../components/Icons';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#a4de6c', '#d0ed57', '#ffc658'];

interface AnnualDataViewProps {
    tanks: Tank[];
    readings: Reading[];
    onNavigate?: (tankId: string, month: number, year: number) => void;
}

const AnnualDataView: React.FC<AnnualDataViewProps> = ({ tanks, readings, onNavigate }) => {
    const [year, setYear] = useState<number>(new Date().getFullYear());
    const [selectedSystem, setSelectedSystem] = useState<SystemType | 'ALL'>(SystemType.COOLING);

    // Internal Data State
    const [supplies, setSupplies] = useState<ChemicalSupply[]>([]);
    const [notes, setNotes] = useState<ImportantNote[]>([]);
    const [cwsHistory, setCwsHistory] = useState<CWSParameterRecord[]>([]);
    const [bwsHistory, setBwsHistory] = useState<BWSParameterRecord[]>([]);
    const [loading, setLoading] = useState(true);

    // Load Data on Mount
    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                // Fetch Global Data
                const [fetchedSupplies, fetchedNotes] = await Promise.all([
                    StorageService.getSupplies(),
                    StorageService.getNotes()
                ]);
                setSupplies(fetchedSupplies);
                setNotes(fetchedNotes);

                // Fetch History for ALL tanks (This might be heavy, optimization: fetch only for active system?)
                // For now, fetch all in parallel.
                const cwsPromises = tanks.map(t => StorageService.getCWSParamsHistory(t.id));
                const bwsPromises = tanks.map(t => StorageService.getBWSParamsHistory(t.id));

                const cwsResults = await Promise.all(cwsPromises);
                const bwsResults = await Promise.all(bwsPromises);

                // Flatten results
                setCwsHistory(cwsResults.flat());
                setBwsHistory(bwsResults.flat());

            } catch (err) {
                console.error("Failed to load annual data dependencies", err);
            } finally {
                setLoading(false);
            }
        };

        if (tanks.length > 0) {
            loadData();
        }
    }, [tanks]); // Re-load if tanks change

    // Generate years option based on available data
    const years = useMemo(() => {
        const sYears = supplies.map(s => new Date(s.startDate).getFullYear());
        const nYears = notes.map(n => new Date(n.dateStr).getFullYear());
        const rYears = readings.map(r => new Date(r.timestamp).getFullYear()); // Also include reading years to ensure usage is visible

        const allYears = new Set([...sYears, ...nYears, ...rYears]);

        // Ensure at least current year exists if empty
        if (allYears.size === 0) {
            allYears.add(new Date().getFullYear());
        }

        return Array.from(allYears).sort((a, b) => b - a);
    }, [supplies, notes, readings]);

    // Helper: Format ROC Year
    const toROC = (y: number) => y - 1911;

    // --- Aggregation Logic ---
    const aggregatedData = useMemo(() => {
        if (loading) return [];

        const yearStart = new Date(year, 0, 1).getTime();
        const yearEnd = new Date(year + 1, 0, 1).getTime();

        // Filter data for the selected year
        const yearReadings = readings.filter(r => r.timestamp >= yearStart && r.timestamp < yearEnd);

        // Group by Tank -> Month
        // Result Structure: Map<TankId, { months: Array<MonthData>, tank: Tank }>

        const tankMap = new Map<string, {
            tank: Tank;
            months: any[];
        }>();

        // Initialize Tanks
        tanks.forEach(tank => {
            if (selectedSystem !== 'ALL' && tank.system !== selectedSystem) return;

            // Generate 12 months placeholder
            const months = Array.from({ length: 12 }, (_, i) => {
                const monthStart = new Date(year, i, 1);
                const monthEnd = new Date(year, i + 1, 1); // Exact start of next month

                return {
                    month: i + 1,
                    monthStart,
                    monthEnd,
                    actualUsage: 0,
                    theoryUsage: null as number | null,
                    price: null as number | null,
                    sg: null as number | null,
                    priceChanges: [] as { date: number, val: number }[],
                    sgChanges: [] as { date: number, val: number }[],
                    notes: [] as ImportantNote[],
                    hasTheory: false
                };
            });
            tankMap.set(tank.id, { tank, months });
        });

        // 1. Fill Actual Usage (採用逐日分攤計算，與 AnalysisView 一致)
        tanks.forEach(tank => {
            const tData = tankMap.get(tank.id);
            if (!tData) return;

            // Get all readings for this tank (forever)
            const tankReadings = readings
                .filter(r => r.tankId === tank.id)
                // 1. 去重 (Deduplication): 避免相同 ID 的讀數重複計算 (與 AnalysisView 一致)
                .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)
                .sort((a, b) => a.timestamp - b.timestamp);

            // 建立每日用量 Map (YYYY-MM-DD -> KG)
            const dailyActualMap = new Map<string, number>();

            for (let i = 1; i < tankReadings.length; i++) {
                const curr = tankReadings[i];
                const prev = tankReadings[i - 1];

                const diffMs = curr.timestamp - prev.timestamp;
                const diffDays = diffMs / (1000 * 60 * 60 * 24);

                if (diffDays <= 0) continue;

                // 計算區間總用量 (KG) - 與 AnalysisView 完全一致
                // 補充量記錄在「補充後」的那筆讀數(curr)上
                // 公式：(前重量 + 本次補充量) - 後重量 = 區間用量
                // 2. 嚴格計算 (Strict Calculation): 移除預設值，避免髒資料導致虛增 (與 AnalysisView 一致)
                // 若 SG 為 undefined，則整個 addedKg 為 NaN -> totalUsageKg 為 NaN -> 下方 Math.max(0, NaN) = 0 (忽略此筆)
                const addedKg = (curr.addedAmountLiters) * (curr.appliedSpecificGravity);
                const totalUsageKg = (prev.calculatedWeightKg + addedKg) - curr.calculatedWeightKg;

                // 使用 Math.max(0, ...) 與 AnalysisView 一致
                const dailyUsage = Math.max(0, totalUsageKg / diffDays);

                let iterDate = new Date(prev.timestamp);
                const endDate = new Date(curr.timestamp);

                // 從 prev 開始迭代到 curr (與 AnalysisView 一致)
                while (iterDate < endDate) {
                    // 使用本地時間手動建構 Key (YYYY-MM-DD)，確保與 lookup key 絕對一致且無 Locale 依賴
                    const Y = iterDate.getFullYear();
                    const M = String(iterDate.getMonth() + 1).padStart(2, '0');
                    const D = String(iterDate.getDate()).padStart(2, '0');
                    const dateKey = `${Y}-${M}-${D}`;

                    // 只設定一次，不累加 (與 AnalysisView 一致)
                    if (!dailyActualMap.has(dateKey)) {
                        dailyActualMap.set(dateKey, dailyUsage);
                    }

                    // 加一天
                    iterDate.setDate(iterDate.getDate() + 1);
                }
            }

            // 將每日用量匯總到對應月份
            tData.months.forEach(m => {
                const daysInMonth = new Date(year, m.month, 0).getDate();
                for (let d = 1; d <= daysInMonth; d++) {
                    // 使用 ISO 格式的日期 key (YYYY-MM-DD)
                    const dateKey = `${year}-${String(m.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    const dailyVal = dailyActualMap.get(dateKey);
                    if (dailyVal) {
                        m.actualUsage += dailyVal;
                    }
                }
            });
        });

        // 2. Fill Theoretical & Price/SG
        tankMap.forEach(({ tank, months }) => {
            months.forEach(m => {
                // --- Price & SG ---
                // Find all supplies active in this month
                // Active supply: Start Date <= Month End AND (Next Supply Start > Month Start or No Next)

                // Filter supplies for this tank
                const tankSupplies = supplies
                    .filter(s => s.tankId === tank.id)
                    .sort((a, b) => a.startDate - b.startDate); // Ascending

                // Find supplies effective during this month
                // A supply S is effective in [M_Start, M_End] if:
                // S.StartDate < M_End AND (NextS.StartDate > M_Start OR IsLast)

                const effectiveSupplies = tankSupplies.filter((s, idx) => {
                    const nextS = tankSupplies[idx + 1];
                    const endOfEffect = nextS ? nextS.startDate : Infinity;
                    return s.startDate < m.monthEnd.getTime() && endOfEffect > m.monthStart.getTime();
                });

                if (effectiveSupplies.length > 0) {
                    // Main value: The one active at end of month? Or most of the month?
                    // Plan says: "If multiple, gray out + tooltip".
                    // Use the latest one effective in the month as the "Display" value.
                    const latest = effectiveSupplies[effectiveSupplies.length - 1];
                    m.price = latest.price || 0;
                    m.sg = latest.specificGravity;

                    if (effectiveSupplies.length > 1 || effectiveSupplies.some(s => s.startDate >= m.monthStart.getTime() && s.startDate < m.monthEnd.getTime())) {
                        // Change detected in this month
                        // Collect changes
                        m.priceChanges = effectiveSupplies.map(s => ({ date: s.startDate, val: s.price || 0 }));
                        m.sgChanges = effectiveSupplies.map(s => ({ date: s.startDate, val: s.specificGravity }));
                    }
                }

                // --- Notes ---
                // Find notes in this month matching the tank's area/chemical?
                // Note: ImportantNote has 'area' and 'chemicalName'. Tank implies these.
                // Need to map Tank -> Area/Chemical.
                // Tank.system -> Area? 
                // Note schema uses simple string for area.
                // We'll simplistic match: Note date in month.
                // Display ALL notes for the month? Or filter by Tank?
                // User asked: "Monthly location, tooltip picks events from Important Notes".
                // Probably global notes or relevant to system.
                // Let's include ALL notes for that month for now, or filter if view is filtered.
                m.notes = notes.filter(n => {
                    const nDate = new Date(n.dateStr);
                    return nDate.getFullYear() === year && nDate.getMonth() + 1 === m.month;
                });

                // --- Theoretical （採用逐日計算，與 AnalysisView 一致）---
                if (tank.calculationMethod === 'CWS_BLOWDOWN' || tank.calculationMethod === 'BWS_STEAM') {
                    m.hasTheory = true;
                    const tankCwsHistory = cwsHistory.filter(p => p.tankId === tank.id);
                    const tankBwsHistory = bwsHistory.filter(p => p.tankId === tank.id);

                    // 遍歷月份中的每一天進行計算
                    const daysInMonth = new Date(year, m.month, 0).getDate();
                    const today = new Date();
                    today.setHours(23, 59, 59, 999); // 設定為今天結束
                    const todayTime = today.getTime();

                    let monthTheory = 0;
                    let hasAnyParam = false; // 追蹤是否有任何有效參數

                    for (let day = 1; day <= daysInMonth; day++) {
                        const dayTime = new Date(year, m.month - 1, day).getTime();

                        // 跳過未來日期
                        if (dayTime > todayTime) continue;

                        // 取得該日有效的藥劑合約
                        const activeSupply = tankSupplies.find(s => s.startDate <= dayTime);
                        const targetPpm = activeSupply?.targetPpm || 0;

                        if (!targetPpm) continue; // 無 PPM 設定則跳過

                        let dailyTheory = 0;

                        if (tank.calculationMethod === 'CWS_BLOWDOWN') {
                            // 查找覆蓋該日的週參數 (record.date <= dayTime < record.date + 7天)
                            // 不使用 fallback，確保只有真正有參數的日期才計算
                            const cwsParam = tankCwsHistory.find(p => {
                                const pDate = p.date || 0;
                                const pEnd = pDate + (7 * 24 * 60 * 60 * 1000);
                                return dayTime >= pDate && dayTime < pEnd;
                            });

                            if (cwsParam) {
                                hasAnyParam = true;
                                const R = cwsParam.circulationRate || 0;
                                const dT = cwsParam.tempDiff || 0;
                                let C = cwsParam.concentrationCycles || 1;
                                if (cwsParam.cwsHardness && cwsParam.makeupHardness && cwsParam.makeupHardness > 0) {
                                    C = cwsParam.cwsHardness / cwsParam.makeupHardness;
                                }
                                // 每日蒸發量
                                const E = (R * dT * 1.8 * 24) / 1000;
                                // 每日排放量
                                const B = C > 1 ? E / (C - 1) : 0;
                                // 每日理論用量 (KG)
                                dailyTheory = (B * targetPpm) / 1000;
                            }
                        } else if (tank.calculationMethod === 'BWS_STEAM') {
                            // 查找覆蓋該日的週參數
                            const bwsParam = tankBwsHistory.find(p => {
                                const pDate = p.date || 0;
                                const pEnd = pDate + (7 * 24 * 60 * 60 * 1000);
                                return dayTime >= pDate && dayTime < pEnd;
                            });

                            if (bwsParam?.steamProduction) {
                                hasAnyParam = true;
                                // 週蒸汽量除以 7 得到每日蒸汽量
                                const dailySteam = bwsParam.steamProduction / 7;
                                // 每日理論用量 (KG)
                                dailyTheory = (dailySteam * targetPpm) / 1000;
                            }
                        }

                        monthTheory += dailyTheory;
                    }

                    // 只有當有實際參數資料時才顯示理論值
                    m.theoryUsage = (monthTheory > 0 && hasAnyParam) ? monthTheory : null;
                }
            });
        });

        return Array.from(tankMap.values());
    }, [year, readings, tanks, supplies, cwsHistory, bwsHistory, notes, selectedSystem, loading]);

    if (loading) {
        return <div className="p-8 text-center text-slate-500">載入年度數據...</div>;
    }

    return (
        <div className="p-6 space-y-6 animate-fade-in pb-24">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600">
                        <Icons.Calendar className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">年度數據統計</h1>
                        <p className="text-slate-500 text-sm">Annual Chemical Usage Data</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <select
                        value={year}
                        onChange={e => setYear(Number(e.target.value))}
                        className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                    >
                        {years.map(y => (
                            <option key={y} value={y}>民國 {toROC(y)} 年 ({y})</option>
                        ))}
                    </select>

                    <select
                        value={selectedSystem}
                        onChange={e => setSelectedSystem(e.target.value as any)}
                        className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                    >
                        <option value={SystemType.COOLING}>冷卻水系統</option>
                        <option value={SystemType.BOILER}>鍋爐水系統</option>
                        <option value={SystemType.DENOX}>脫銷系統</option>
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
                {aggregatedData.reduce((acc, data) => {
                    const { tank } = data;
                    // Grouping Logic
                    // Default: Push to a single group if not Cooling
                    // If Cooling: Split into Left (CT-1) and Right (CT-2)

                    if (selectedSystem === SystemType.COOLING) {
                        const isGroup1 = tank.name.includes('CT-1') || tank.name.includes('CWS-1') || tank.description?.includes('一階');
                        // We want to force render into two columns.
                        // This reduce approach is tricky because we are inside the render loop.
                        // Better refactor: Do splitting OUTSIDE the map.
                        return acc;
                    }
                    return acc;
                }, [])}

                {(() => {
                    // Logic to split/render
                    // 1. Separate Cooling Tanks
                    const coolingGroup1 = aggregatedData.filter(d => d.tank.system === SystemType.COOLING && (d.tank.name.includes('CT-1') || d.tank.name.includes('CWS-1') || d.tank.description?.includes('一階')));
                    const coolingGroup2 = aggregatedData.filter(d => d.tank.system === SystemType.COOLING && !(d.tank.name.includes('CT-1') || d.tank.name.includes('CWS-1') || d.tank.description?.includes('一階')));
                    const others = aggregatedData.filter(d => d.tank.system !== SystemType.COOLING);

                    // 計算單個藥劑全年總金額
                    const calcTankYearlyTotal = (months: any[]) =>
                        months.reduce((sum, m) => sum + (m.actualUsage > 0 && m.price ? m.actualUsage * m.price : 0), 0);

                    // 計算群組總金額
                    const calcGroupTotal = (group: typeof aggregatedData) =>
                        group.reduce((sum, d) => sum + calcTankYearlyTotal(d.months), 0);



                    const renderTankCard = ({ tank, months }: { tank: Tank, months: any[] }) => (
                        <div key={tank.id} id={`tank-${tank.id}`} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden break-inside-avoid mb-8 scroll-mt-32">
                            <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-700">{tank.name}</span>
                                    <span className="text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-600">{tank.system}</span>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm text-left">
                                    <thead className="bg-slate-100 text-slate-600 uppercase text-xs">
                                        <tr>
                                            <th className="px-3 py-2">月份</th>
                                            {tank.calculationMethod !== 'NONE' && (
                                                <th className="px-3 py-2 text-right">理論</th>
                                            )}
                                            <th className="px-3 py-2 text-right">實際</th>
                                            {tank.calculationMethod !== 'NONE' && (
                                                <th className="px-3 py-2 text-right text-xs normal-case w-16">差異</th>
                                            )}
                                            <th className="px-3 py-2 text-right">單價</th>
                                            <th className="px-3 py-2 text-right">總金額</th>
                                            <th className="px-3 py-2 text-right">比重</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {months.map(m => {
                                            const diff = (m.theoryUsage && m.theoryUsage > 0)
                                                ? ((m.actualUsage - m.theoryUsage) / m.theoryUsage * 100)
                                                : 0;

                                            const hasChanges = m.priceChanges.length > 0 || m.sgChanges.length > 0;
                                            const hasNotes = m.notes.length > 0;

                                            return (
                                                <tr key={m.month} className="hover:bg-slate-50 transition-colors">
                                                    <td className="px-3 py-2 font-medium text-slate-700 group relative cursor-help">
                                                        {m.month}月
                                                        {hasNotes && (
                                                            <>
                                                                <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                                                                <div className="absolute left-0 top-full mt-1 z-50 hidden group-hover:block w-64 p-3 bg-slate-800 text-white text-xs rounded shadow-xl">
                                                                    <div className="font-bold mb-1 border-b border-slate-600 pb-1">重要紀事</div>
                                                                    <ul className="list-disc pl-4 space-y-1">
                                                                        {m.notes.map((n: ImportantNote) => (
                                                                            <li key={n.id}>
                                                                                <span className="text-slate-300">{n.dateStr}:</span> {n.note}
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            </>
                                                        )}
                                                    </td>

                                                    {/* Theoretical (Conditional) */}
                                                    {tank.calculationMethod !== 'NONE' && (
                                                        <td className="px-3 py-2 text-right font-mono text-slate-600 text-xs">
                                                            {m.theoryUsage ? m.theoryUsage.toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}
                                                        </td>
                                                    )}

                                                    {/* Actual Usage */}
                                                    <td
                                                        className="px-3 py-2 text-right font-bold text-blue-600 text-xs cursor-pointer hover:underline hover:text-blue-800 transition-colors"
                                                        onClick={() => onNavigate?.(tank.id, m.month, year)}
                                                        title="點擊查看詳細分析"
                                                    >
                                                        {m.actualUsage > 0 ? m.actualUsage.toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}
                                                    </td>

                                                    {/* Diff (Conditional) */}
                                                    {tank.calculationMethod !== 'NONE' && (
                                                        <td className={`px-3 py-2 text-right font-bold text-xs ${Math.abs(diff) > 20 ? 'text-red-500' : Math.abs(diff) > 10 ? 'text-amber-500' : 'text-green-500'}`}>
                                                            {m.theoryUsage ? `${diff > 0 ? '+' : ''}${diff.toFixed(0)}%` : '-'}
                                                        </td>
                                                    )}

                                                    {/* Price with Tooltip */}
                                                    <td className={`px-3 py-2 text-right font-mono text-xs group relative ${hasChanges ? 'text-slate-400' : 'text-slate-600'}`}>
                                                        {m.price ? m.price : '-'}
                                                        {m.priceChanges.length > 0 && (
                                                            <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block min-w-max p-2 bg-slate-800 text-white text-xs rounded shadow-xl">
                                                                <div className="font-bold mb-1">價格變更紀錄</div>
                                                                {m.priceChanges.map((c: any, i: number) => (
                                                                    <div key={i}>{new Date(c.date).toLocaleDateString()}: ${c.val}</div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </td>

                                                    {/* Total Price */}
                                                    <td className="px-3 py-2 text-right font-bold text-slate-700 text-xs">
                                                        {m.actualUsage > 0 && m.price ? (m.actualUsage * m.price).toLocaleString('zh-TW', { maximumFractionDigits: 0 }) : '-'}
                                                    </td>

                                                    {/* SG with Tooltip */}
                                                    <td className={`px-3 py-2 text-right font-mono text-xs group relative ${hasChanges ? 'text-slate-400' : 'text-slate-600'}`}>
                                                        {m.sg ? m.sg.toFixed(3) : '-'}
                                                        {m.sgChanges.length > 0 && (
                                                            <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block min-w-max p-2 bg-slate-800 text-white text-xs rounded shadow-xl">
                                                                <div className="font-bold mb-1">比重變更紀錄</div>
                                                                {m.sgChanges.map((c: any, i: number) => (
                                                                    <div key={i}>{new Date(c.date).toLocaleDateString()}: {c.val}</div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {/* 全年合計列 */}
                                        <tr className="bg-gradient-to-r from-blue-50 to-blue-100 font-bold border-t-2 border-blue-200">
                                            <td className="px-3 py-3 text-blue-700">全年合計</td>
                                            {tank.calculationMethod !== 'NONE' && <td className="px-3 py-3"></td>}
                                            <td className="px-3 py-3 text-right text-blue-700 font-mono">
                                                {months.reduce((s: number, m: any) => s + m.actualUsage, 0).toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                            </td>
                                            {tank.calculationMethod !== 'NONE' && <td className="px-3 py-3"></td>}
                                            <td className="px-3 py-3"></td>
                                            <td className="px-3 py-3 text-right text-blue-700 font-mono text-base">
                                                ${calcTankYearlyTotal(months).toLocaleString('zh-TW', { maximumFractionDigits: 0 })}
                                            </td>
                                            <td className="px-3 py-3"></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );

                    const renderSystemSummaryCard = (title: string, groupData: typeof aggregatedData, colorTheme: 'blue' | 'emerald' | 'amber') => {
                        const totalAmount = calcGroupTotal(groupData);

                        // Prepare Chart Data
                        const chartData = groupData.map(d => ({
                            name: d.tank.name,
                            value: calcTankYearlyTotal(d.months),
                            id: d.tank.id
                        })).filter(d => d.value > 0);

                        // Theme classes
                        const theme = {
                            blue: { bg: 'from-blue-50 to-blue-100', border: 'border-blue-200', textTitle: 'text-blue-600', textAmount: 'text-blue-800' },
                            emerald: { bg: 'from-emerald-50 to-emerald-100', border: 'border-emerald-200', textTitle: 'text-emerald-600', textAmount: 'text-emerald-800' },
                            amber: { bg: 'from-amber-50 to-amber-100', border: 'border-amber-200', textTitle: 'text-amber-600', textAmount: 'text-amber-800' }
                        }[colorTheme];

                        const handlePieClick = (data: any) => {
                            // Recharts event data structure can be tricky.
                            // data.payload usually contains the original data object { name, value, id }
                            // Sometimes 'data' itself is the object if passed directly.
                            const id = data?.payload?.id || data?.id;

                            if (id) {
                                const targetId = `tank-${id}`;
                                const element = document.getElementById(targetId);
                                if (element) {
                                    // 'center' align usually works best to bring it into view comfortably
                                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

                                    // Optional: Add a temporary highlight effect
                                    element.classList.add('ring-2', 'ring-blue-500');
                                    setTimeout(() => element.classList.remove('ring-2', 'ring-blue-500'), 2000);
                                } else {
                                    console.warn(`Element with id ${targetId} not found`);
                                }
                            }
                        };

                        const RADIAN = Math.PI / 180;
                        const renderCustomizedLabel = (props: any) => {
                            const { cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent, value } = props;
                            const sin = Math.sin(-midAngle * RADIAN);
                            const cos = Math.cos(-midAngle * RADIAN);
                            const sx = cx + (outerRadius + 0) * cos;
                            const sy = cy + (outerRadius + 0) * sin;
                            const mx = cx + (outerRadius + 30) * cos;
                            const my = cy + (outerRadius + 30) * sin;
                            const ex = mx + (cos >= 0 ? 1 : -1) * 22;
                            const ey = my;
                            const textAnchor = cos >= 0 ? 'start' : 'end';

                            const handleClick = (e: any) => {
                                e.stopPropagation();
                                handlePieClick({ payload });
                            };

                            return (
                                <g>
                                    <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={fill} fill="none" />
                                    <circle cx={ex} cy={ey} r={2} fill={fill} stroke="none" />
                                    <text
                                        x={ex + (cos >= 0 ? 1 : -1) * 8}
                                        y={ey}
                                        textAnchor={textAnchor}
                                        fill="#333"
                                        fontSize={11}
                                        fontWeight="500"
                                        dy={4}
                                        style={{ cursor: 'pointer' }}
                                        onClick={handleClick}
                                    >
                                        {`${payload.name} (${(percent * 100).toFixed(0)}%)`}
                                    </text>
                                </g>
                            );
                        };

                        // For single-chemical systems, show monthly line chart instead of pie
                        const isSingleChemical = groupData.length === 1;
                        const monthlyLineData = isSingleChemical ? Array.from({ length: 12 }, (_, i) => {
                            const monthData = groupData[0].months[i];
                            const monthAmount = monthData && monthData.actualUsage > 0 && monthData.price
                                ? monthData.actualUsage * monthData.price
                                : 0;
                            return {
                                month: `${i + 1}月`,
                                amount: monthAmount
                            };
                        }) : [];

                        return (
                            <div className={`bg-gradient-to-r ${theme.bg} rounded-xl p-6 border ${theme.border} shadow-sm relative overflow-visible`}>
                                <div className="flex flex-col items-center justify-center">
                                    {/* Moved Title to Top */}
                                    <div className={`text-lg font-bold ${theme.textTitle} mb-2`}>{title}</div>

                                    <div className="w-full flex justify-center items-center relative" style={{ height: isSingleChemical ? 250 : 350 }}>
                                        {/* Center Text Overlay - Only for Pie Chart */}
                                        {!isSingleChemical && (
                                            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none z-0">
                                                <div className={`text-xl font-bold ${theme.textAmount}`}>
                                                    ${totalAmount.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}
                                                </div>
                                            </div>
                                        )}

                                        {isSingleChemical ? (
                                            /* Single Chemical: Show Line Chart */
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={monthlyLineData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                                                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                                                    <YAxis
                                                        tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                                                        tick={{ fontSize: 11 }}
                                                    />
                                                    <RechartsTooltip
                                                        formatter={(value: number) => [`$${value.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}`, '金額']}
                                                    />
                                                    <Line
                                                        type="monotone"
                                                        dataKey="amount"
                                                        stroke={theme.textAmount.includes('blue') ? '#2563EB' : theme.textAmount.includes('emerald') ? '#10B981' : '#F59E0B'}
                                                        strokeWidth={2}
                                                        dot={{ r: 4 }}
                                                        activeDot={{ r: 6 }}
                                                    />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            /* Multiple Chemicals: Show Pie Chart */
                                            chartData.length > 0 && (
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <PieChart>
                                                        <Pie
                                                            data={chartData}
                                                            cx="50%"
                                                            cy="50%"
                                                            innerRadius={60}
                                                            outerRadius={80}
                                                            fill="#8884d8"
                                                            paddingAngle={2}
                                                            dataKey="value"
                                                            onClick={handlePieClick}
                                                            cursor="pointer"
                                                            label={renderCustomizedLabel}
                                                            labelLine={false}
                                                        >
                                                            {chartData.map((entry, index) => (
                                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                            ))}
                                                        </Pie>
                                                        <RechartsTooltip
                                                            formatter={(value: number) => `$${value.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}`}
                                                        />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                            )
                                        )}
                                    </div>

                                    {/* Show total amount below line chart for single chemical */}
                                    {isSingleChemical && (
                                        <div className={`text-xl font-bold ${theme.textAmount} mt-2`}>
                                            全年總金額: ${totalAmount.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    };

                    if (selectedSystem === SystemType.COOLING) {
                        return (
                            <>
                                {/* CT-1 系統總金額 */}
                                <div id="summary-section" className="space-y-4">
                                    {renderSystemSummaryCard("CT-1 藥劑，全年累計總金額", coolingGroup1, 'blue')}
                                    {coolingGroup1.map(renderTankCard)}
                                </div>
                                {/* CT-2 系統總金額 */}
                                <div className="space-y-4">
                                    {renderSystemSummaryCard("CT-2 藥劑，全年累計總金額", coolingGroup2, 'emerald')}
                                    {coolingGroup2.map(renderTankCard)}
                                </div>
                            </>
                        );
                    }

                    // For generic Systems (or All), we distribute them roughly evenly or just use naive masonry
                    // Simple split by index for balanced columns
                    const leftCol: typeof aggregatedData = [];
                    const rightCol: typeof aggregatedData = [];
                    // Using others OR aggregatedData (if not cooling)
                    const targetData = (selectedSystem === 'ALL' || selectedSystem !== SystemType.COOLING) ? aggregatedData : others; // Actually if selected is not Cooling, aggregatedData IS the data.

                    targetData.forEach((d, i) => {
                        if (i % 2 === 0) leftCol.push(d);
                        else rightCol.push(d);
                    });

                    return (
                        <>
                            {/* 系統總金額區塊 */}
                            {/* 系統總金額區塊 */}
                            <div className="col-span-2 mb-4">
                                {renderSystemSummaryCard(
                                    `${selectedSystem === SystemType.BOILER ? '鍋爐水系統藥劑' : selectedSystem === SystemType.DENOX ? '脫銷系統藥劑' : '全系統藥劑'}，全年累計總金額`,
                                    aggregatedData,
                                    'amber'
                                )}
                            </div>
                            <div className="space-y-6">
                                {leftCol.map(renderTankCard)}
                            </div>
                            <div className="space-y-6">
                                {rightCol.map(renderTankCard)}
                            </div>
                        </>
                    );
                })()}
            </div>

            {/* Floating Back-to-Top Button */}
            <button
                onClick={() => {
                    // Use same scrollIntoView method as pie chart navigation
                    const element = document.getElementById('summary-section');
                    if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }}
                className="fixed bottom-6 right-6 z-50 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full shadow-lg transition-all duration-200 hover:scale-110"
                title="返回頂部"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
            </button>
        </div>
    );
};

export default AnnualDataView;
