import React, { useState, useMemo, useEffect } from 'react';
import { Tank, Reading, ChemicalSupply, SystemType, CWSParameterRecord, BWSParameterRecord, ImportantNote } from '../types';
import { StorageService } from '../services/storageService';
import { calculateCWSUsage } from '../utils/calculationUtils';
import { Icons } from '../components/Icons';

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

        // 1. Fill Actual Usage
        // Simplified Usage Calculation:
        // Sort readings by time for each tank.
        tanks.forEach(tank => {
            const tData = tankMap.get(tank.id);
            if (!tData) return;

            // Get all readings for this tank (forever) to ensure we have continuity at boundaries
            const tankReadings = readings
                .filter(r => r.tankId === tank.id)
                .sort((a, b) => a.timestamp - b.timestamp);

            for (let i = 1; i < tankReadings.length; i++) {
                const curr = tankReadings[i];
                const prev = tankReadings[i - 1];

                // If curr is in this year
                if (curr.timestamp < yearStart) continue;
                if (curr.timestamp >= yearEnd) break;

                // Calculate usage for this interval
                const usage = (prev.calculatedVolume - curr.calculatedVolume) + (curr.addedAmountLiters || 0);
                // What if usage < 0 (Level increased without record)? 
                // Ignore or Treat as 0.

                const mIdx = new Date(curr.timestamp).getMonth(); // Attribute usage to the month of the "Current" reading (end of interval)
                // Or attribute by time proportion? Simple: Attribute to recording date.

                if (usage > 0) {
                    tData.months[mIdx].actualUsage += usage;
                }
            }
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

                // --- Theoretical ---
                if (tank.calculationMethod === 'CWS_BLOWDOWN') {
                    m.hasTheory = true;
                    const tankCwsHistory = cwsHistory.filter(p => p.tankId === tank.id);
                    // Calculate for the month
                    // Need 'targetPpm'. Use latest supply.
                    if (effectiveSupplies.length > 0) {
                        const activeS = effectiveSupplies[effectiveSupplies.length - 1]; // Use latest
                        if (activeS.targetPpm) {
                            // Find CWS Params
                            // Use average or latest?
                            // Standard: Latest relative to month?
                            // Reuse utility with single param?
                            // Find param active in month
                            let param = tankCwsHistory.find(p => (p.date || 0) >= m.monthStart.getTime() && (p.date || 0) < m.monthEnd.getTime());
                            if (!param) {
                                // fallback to most recent before month
                                const sorted = tankCwsHistory.filter(p => (p.date || 0) < m.monthStart.getTime()).sort((a, b) => (b.date || 0) - (a.date || 0));
                                param = sorted[0];
                            }
                            // fallback to tank current
                            if (!param && tank.cwsParams) param = tank.cwsParams;

                            if (param) {
                                const days = new Date(year, m.month, 0).getDate(); // Days in month
                                m.theoryUsage = calculateCWSUsage(
                                    param.circulationRate || 0,
                                    param.tempDiff || 0,
                                    param.concentrationCycles || 1,
                                    activeS.targetPpm,
                                    days
                                );
                            }
                        }
                    }
                }
                // TODO: BWS Logic if needed
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

                    const renderTankCard = ({ tank, months }: { tank: Tank, months: any[] }) => (
                        <div key={tank.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden break-inside-avoid mb-8">
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
                                                            {m.theoryUsage ? m.theoryUsage.toFixed(0) : '-'}
                                                        </td>
                                                    )}

                                                    {/* Actual Usage */}
                                                    <td
                                                        className="px-3 py-2 text-right font-bold text-blue-600 text-xs cursor-pointer hover:underline hover:text-blue-800 transition-colors"
                                                        onClick={() => onNavigate?.(tank.id, m.month, year)}
                                                        title="點擊查看詳細分析"
                                                    >
                                                        {m.actualUsage > 0 ? m.actualUsage.toFixed(0) : '-'}
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
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );

                    if (selectedSystem === SystemType.COOLING) {
                        return (
                            <>
                                <div className="space-y-6">
                                    {coolingGroup1.map(renderTankCard)}
                                </div>
                                <div className="space-y-6">
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
        </div>
    );
};

export default AnnualDataView;
