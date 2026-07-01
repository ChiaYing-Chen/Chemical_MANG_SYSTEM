import React, { useState, useEffect, useMemo } from 'react';
import { 
    fetchManualWaterQualityReadings,
    fetchManualWaterQualityLimits,
    updateManualWaterQualityLimits,
    fetchManualWaterQualityAliases,
    updateManualWaterQualityAliases,
    checkManualWaterQualityAdmin
} from '../services/apiService';
import { StorageService } from '../services/storageService';
import { ImportantNote } from '../types';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as ChartTooltip,
    Legend,
    ResponsiveContainer,
    ReferenceLine
} from 'recharts';
import { 
    Calendar, 
    Droplet, 
    Layers, 
    Search, 
    Activity,
    ChevronDown,
    RefreshCw,
    Settings,
    X,
    Save,
    Eye,
    EyeOff
} from 'lucide-react';

interface WaterQualityReading {
    id: string;
    water_type: 'CW' | 'BW';
    test_date: string;
    sample_point: string;
    data: Record<string, any>;
    created_at: string;
}

// 數據清洗函數，用於折線圖繪圖
const parseValueForChart = (val: any): number | null => {
    if (val === null || val === undefined) return null;
    const str = String(val).trim();
    if (!str || str.toLowerCase() === 'none' || str === '-') return null;

    // 處理 5*10^3 格式
    if (str.includes('*10^')) {
        const parts = str.split('*10^');
        const base = parseFloat(parts[0]);
        const exp = parseInt(parts[1], 10);
        if (!isNaN(base) && !isNaN(exp)) {
            return base * Math.pow(10, exp);
        }
    }

    // 去除非數字字元 (保留負號、小數點)
    const cleanStr = str.replace(/[^\d.-]/g, '');
    const parsed = parseFloat(cleanStr);
    return isNaN(parsed) ? null : parsed;
};

// 中文友好名稱映射 (DMP 已修正為 除礦水)
const SAMPLE_POINT_NAMES: Record<string, string> = {
    'TW': '補水 (TW)',
    'CW_1': '一階冷卻水 (CW_1)',
    'CW_2': '二階冷卻水 (CW_2)',
    'DMP': '除礦水 (DMP)',
    'BLR1_LP': 'BLR1 低壓 LP',
    'BLR2_LP': 'BLR2 低壓 LP',
    'BLR3_LP': 'BLR3 低壓 LP',
    'BLR4_LP': 'BLR4 低壓 LP',
    'BLR1_DEA': 'BLR1 脫氣 DEA',
    'BLR2_DEA': 'BLR2 脫氣 DEA',
    'BLR3_DEA': 'BLR3 脫氣 DEA',
    'BLR4_DEA': 'BLR4 脫氣 DEA',
    'BLR1_SS': 'BLR1 飽和蒸汽 SS',
    'BLR2_SS': 'BLR2 飽和蒸汽 SS',
    'BLR3_SS': 'BLR3 飽和蒸汽 SS',
    'BLR4_SS': 'BLR4 飽和蒸汽 SS',
    'BLR1_BFW': 'BLR1 給水 BFW',
    'BLR2_BFW': 'BLR2 給水 BFW',
    'BLR3_BFW': 'BLR3 給水 BFW',
    'BLR4_BFW': 'BLR4 給水 BFW',
    'BLR1_MS': 'BLR1 主蒸汽 MS',
    'BLR2_MS': 'BLR2 主蒸汽 MS',
    'BLR3_MS': 'BLR3 主蒸汽 MS',
    'BLR4_MS': 'BLR4 主蒸汽 MS',
    'BLR1_CBD': 'BLR1 爐水 CBD',
    'BLR2_CBD': 'BLR2 爐水 CBD',
    'BLR3_CBD': 'BLR3 爐水 CBD',
    'BLR4_CBD': 'BLR4 爐水 CBD',
    'BLR1_CD': 'BLR1 冷凝水 CD',
    'BLR2_CD': 'BLR2 冷凝水 CD',
    'BLR3_CD': 'BLR3 冷凝水 CD',
    'BLR4_CD': 'BLR4 冷凝水 CD',
};

// 自訂 Tooltip 組件，以呈現水質化驗數值與當日標記重要紀事
const CustomTooltip = ({ active, payload, label, activeEvents }: any) => {
    if (active && payload && payload.length) {
        // 尋找當天是否有標記的事件
        const dayEvents = activeEvents.filter((e: any) => e.dateStr === label);
        return (
            <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-lg max-w-sm">
                <p className="text-xs font-bold text-slate-800 mb-1.5">{label}</p>
                
                {/* 顯示水質指標數據 */}
                <div className="space-y-1 mb-2">
                    {payload.map((item: any) => {
                        const rawVal = item.payload.rawValues?.[item.name];
                        return (
                            <div key={item.name} className="flex justify-between items-center text-xs gap-4">
                                <span className="text-slate-500 flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: item.color }} />
                                    {SAMPLE_POINT_NAMES[item.name] || item.name}:
                                </span>
                                <span className="font-bold text-slate-700">
                                    {rawVal !== undefined ? rawVal : item.value}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {/* 顯示當日重要紀事 */}
                {dayEvents.length > 0 && (
                    <div className="border-t border-slate-100 pt-1.5 mt-1.5">
                        <p className="text-[10px] font-bold text-purple-650 mb-1 flex items-center gap-1">
                            <span>✨ 當日重要紀事</span>
                        </p>
                        <div className="space-y-1.5">
                            {dayEvents.map((e: any, idx: number) => (
                                <div key={idx} className="bg-purple-50/70 p-1.5 rounded border border-purple-100 text-[10px]">
                                    <div className="font-semibold text-purple-800">
                                        [{e.area}] {e.chemicalName && `${e.chemicalName}`}
                                    </div>
                                    <div className="text-purple-700 mt-0.5 whitespace-pre-wrap">{e.note}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }
    return null;
};

// 折線圖配色
const CHART_COLORS = [
    '#3B82F6', // Blue
    '#10B981', // Emerald/Green
    '#F59E0B', // Amber
    '#8B5CF6', // Violet
    '#EC4899', // Pink
    '#06B6D4', // Cyan
    '#F97316', // Orange
    '#14B8A6', // Teal
    '#6366F1'  // Indigo
];

export const WaterQualityTrendsView: React.FC = () => {
    const [waterType, setWaterType] = useState<'CW' | 'BW'>('CW');
    const [readings, setReadings] = useState<WaterQualityReading[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    // 控制標準與別名 state
    const [limits, setLimits] = useState<any[]>([]);
    const [aliases, setAliases] = useState<any[]>([]);
    const [isAdmin, setIsAdmin] = useState<boolean>(false);
    const [notes, setNotes] = useState<ImportantNote[]>([]);
    const [showEventsOnChart, setShowEventsOnChart] = useState<boolean>(true);
    const [hiddenEventIds, setHiddenEventIds] = useState<string[]>([]);
    const toggleEventVisibility = (id: string) => {
        setHiddenEventIds(prev => 
            prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
        );
    };
    
    // 設定 Modal 控制
    const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);
    const [configTab, setConfigTab] = useState<'limits' | 'aliases'>('limits');
    const [limitsEditing, setLimitsEditing] = useState<any[]>([]);
    const [aliasesEditing, setAliasesEditing] = useState<any[]>([]);
    const [configSpFilter, setConfigSpFilter] = useState<string>(''); // 設定彈窗中的取樣點過濾
    const [savingConfig, setSavingConfig] = useState<boolean>(false);

    // 篩選狀態
    const [selectedPoints, setSelectedPoints] = useState<string[]>([]);
    const [selectedMetric, setSelectedMetric] = useState<string>('');

    // 時間範圍 ('custom' | 30 | 90 | 0)
    const [dateRange, setDateRange] = useState<number | 'custom'>(90); 
    const [customStartDate, setCustomStartDate] = useState<string>('');
    const [customEndDate, setCustomEndDate] = useState<string>('');

    // 載入數據 (包含 Limits, Aliases, Admin SSO 狀態)
    const loadAllData = async () => {
        setLoading(true);
        setError(null);
        try {
            const currentUserName = localStorage.getItem('appUserName') || 'OP';
            const [readingsData, limitsData, aliasesData, adminData, notesData] = await Promise.all([
                fetchManualWaterQualityReadings(waterType),
                fetchManualWaterQualityLimits(),
                fetchManualWaterQualityAliases(),
                checkManualWaterQualityAdmin(currentUserName).catch(() => ({ isAdmin: false, username: '' })),
                StorageService.getNotes().catch(() => [])
            ]);
            
            setReadings(readingsData);
            setLimits(limitsData);
            setAliases(aliasesData);
            setIsAdmin(adminData.isAdmin);
            setNotes(notesData);

            // 當水質大類切換時，自動初始化預設取樣點
            if (waterType === 'CW') {
                setSelectedPoints(['CW_1', 'CW_2']);
            } else {
                setSelectedPoints(['BLR1_DEA', 'BLR2_DEA']);
            }
        } catch (err: any) {
            setError(err.message || '無法獲取水質檢驗數據');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAllData();
    }, [waterType]);

    // 動態收集該水質大類中所有出現過的水質指標 Key
    const allMetrics = useMemo(() => {
        const metricsSet = new Set<string>();
        readings.forEach(r => {
            if (r.data && typeof r.data === 'object') {
                Object.keys(r.data).forEach(key => {
                    metricsSet.add(key);
                });
            }
        });
        const list = Array.from(metricsSet);
        
        // 優先排序常見項目
        const priority = ['pH', 'Specific', 'Conductance', 'TDS', 'Hardness', 'Silica', 'Iron'];
        list.sort((a, b) => {
            const indexA = priority.findIndex(p => a.toLowerCase().includes(p.toLowerCase()));
            const indexB = priority.findIndex(p => b.toLowerCase().includes(p.toLowerCase()));
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return a.localeCompare(b, 'zh-Hant');
        });
        
        return list;
    }, [readings]);

    // 當指標清單載入後，自動預設選取第一個項目
    useEffect(() => {
        if (allMetrics.length > 0) {
            if (!selectedMetric || !allMetrics.includes(selectedMetric)) {
                setSelectedMetric(allMetrics[0]);
            }
        } else {
            setSelectedMetric('');
        }
    }, [allMetrics, selectedMetric]);

    // 別名 Map 對照表
    const aliasMap = useMemo(() => {
        const map: Record<string, string> = {};
        aliases.forEach(a => {
            if (a.water_type === waterType) {
                map[a.original_name] = a.display_name;
            }
        });
        return map;
    }, [aliases, waterType]);

    // 【指標動態取樣點過濾】：只列出包含當前指標數據的取樣點
    const availablePoints = useMemo(() => {
        const pointsSet = new Set<string>();
        readings.forEach(r => {
            if (selectedMetric && r.data && r.data[selectedMetric] !== undefined && r.data[selectedMetric] !== null) {
                pointsSet.add(r.sample_point);
            }
        });
        
        return Array.from(pointsSet).sort((a, b) => {
            if (a === 'DMP') return -1;
            if (b === 'DMP') return 1;
            return a.localeCompare(b);
        });
    }, [readings, selectedMetric]);

    // 當動態過濾後的取樣點清單改變，防呆校正當前勾選的 selectedPoints
    useEffect(() => {
        if (availablePoints.length > 0) {
            const validSelected = selectedPoints.filter(p => availablePoints.includes(p));
            if (validSelected.length === 0) {
                // 預設勾選前兩個
                setSelectedPoints(availablePoints.slice(0, Math.min(availablePoints.length, 2)));
            } else if (validSelected.length !== selectedPoints.length) {
                setSelectedPoints(validSelected);
            }
        } else {
            setSelectedPoints([]);
        }
    }, [availablePoints, selectedMetric]);

    // 依系統分類的取樣點 (DMP 已修正為 除礦水)
    const pointsByCategory = useMemo(() => {
        if (waterType === 'CW') return null;
        
        const categories: Record<string, string[]> = {
            '除礦水 / LP': [],
            'DEA / 飽和蒸汽': [],
            '給水 / 主蒸汽': [],
            '爐水 / CD 冷凝': []
        };

        availablePoints.forEach(p => {
            if (p === 'DMP' || p.endsWith('_LP')) {
                categories['除礦水 / LP'].push(p);
            } else if (p.endsWith('_DEA') || p.endsWith('_SS')) {
                categories['DEA / 飽和蒸汽'].push(p);
            } else if (p.endsWith('_BFW') || p.endsWith('_MS')) {
                categories['給水 / 主蒸汽'].push(p);
            } else if (p.endsWith('_CBD') || p.endsWith('_CD')) {
                categories['爐水 / CD 冷凝'].push(p);
            } else {
                if (!categories['未分類']) categories['未分類'] = [];
                categories['未分類'].push(p);
            }
        });

        return categories;
    }, [availablePoints, waterType]);

    // 時間篩選後的數據 (新增 'custom' 支援)
    const filteredReadings = useMemo(() => {
        if (dateRange === 'custom') {
            return readings.filter(r => {
                let match = true;
                if (customStartDate) match = match && r.test_date >= customStartDate;
                if (customEndDate) match = match && r.test_date <= customEndDate;
                return match;
            });
        }
        if (dateRange === 0) return readings;
        const now = new Date();
        const limitDate = new Date(now.getTime() - (dateRange as number) * 24 * 60 * 60 * 1000);
        const limitStr = limitDate.toISOString().split('T')[0];
        
        return readings.filter(r => r.test_date >= limitStr);
    }, [readings, dateRange, customStartDate, customEndDate]);

    // 篩選當前時間區間及水質類型的標記重要事件
    const activeEvents = useMemo(() => {
        return notes.filter(n => {
            if (n.markedWaterType !== waterType) return false;
            
            let match = true;
            if (dateRange === 'custom') {
                if (customStartDate) match = match && n.dateStr >= customStartDate;
                if (customEndDate) match = match && n.dateStr <= customEndDate;
            } else if (dateRange !== 0) {
                const now = new Date();
                const limitDate = new Date(now.getTime() - (dateRange as number) * 24 * 60 * 60 * 1000);
                const limitStr = limitDate.toISOString().split('T')[0];
                match = n.dateStr >= limitStr;
            }
            return match;
        }).sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    }, [notes, waterType, dateRange, customStartDate, customEndDate]);

    // 格式化為 Recharts 折線圖所需的數據格式
    const chartData = useMemo(() => {
        if (!selectedMetric) return [];
        
        const dateMap: Record<string, { date: string; [key: string]: any; rawValues: Record<string, any> }> = {};
        
        // 1. 初始化所有事件的日期，確保事件垂直虛線 ReferenceLine 能在 X 軸上成功渲染
        activeEvents.forEach(e => {
            if (!dateMap[e.dateStr]) {
                dateMap[e.dateStr] = {
                    date: e.dateStr,
                    rawValues: {}
                };
            }
        });

        // 2. 寫入實際化驗數據
        filteredReadings.forEach(r => {
            const dateStr = r.test_date;
            if (selectedPoints.includes(r.sample_point)) {
                const rawVal = r.data[selectedMetric];
                if (rawVal !== undefined && rawVal !== null) {
                    if (!dateMap[dateStr]) {
                        dateMap[dateStr] = {
                            date: dateStr,
                            rawValues: {}
                        };
                    }
                    const numVal = parseValueForChart(rawVal);
                    if (numVal !== null) {
                        dateMap[dateStr][r.sample_point] = numVal;
                    }
                    dateMap[dateStr].rawValues[r.sample_point] = rawVal;
                }
            }
        });
        
        return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
    }, [filteredReadings, selectedPoints, selectedMetric, activeEvents]);

    // 控制標準對照 Map
    const limitsMap = useMemo(() => {
        const map: Record<string, { min?: number; max?: number }> = {};
        limits.forEach(l => {
            if (l.water_type === waterType) {
                map[`${l.sample_point}_${l.metric_name}`] = {
                    min: l.min_value !== null ? parseFloat(l.min_value) : undefined,
                    max: l.max_value !== null ? parseFloat(l.max_value) : undefined
                };
            }
        });
        return map;
    }, [limits, waterType]);

    // 計算 Recharts 的 ReferenceLines 標記虛線 (自動防重疊)
    const chartReferenceLines = useMemo(() => {
        const lines: { y: number; type: 'min' | 'max'; label: string; stroke: string }[] = [];
        const addedLimits = new Set<string>();
        
        selectedPoints.forEach(point => {
            const key = `${point}_${selectedMetric}`;
            const limit = limitsMap[key];
            if (limit) {
                const ptName = SAMPLE_POINT_NAMES[point] || point;
                if (limit.max !== undefined && limit.max !== null) {
                    const lKey = `max_${limit.max}`;
                    if (!addedLimits.has(lKey)) {
                        addedLimits.add(lKey);
                        lines.push({
                            y: limit.max,
                            type: 'max',
                            label: `${ptName} 上限: ${limit.max}`,
                            stroke: '#EF4444' // 紅色
                        });
                    }
                }
                if (limit.min !== undefined && limit.min !== null) {
                    const lKey = `min_${limit.min}`;
                    if (!addedLimits.has(lKey)) {
                        addedLimits.add(lKey);
                        lines.push({
                            y: limit.min,
                            type: 'min',
                            label: `${ptName} 下限: ${limit.min}`,
                            stroke: '#F97316' // 橘色
                        });
                    }
                }
            }
        });
        return lines;
    }, [selectedPoints, selectedMetric, limitsMap]);

    // 處理取樣點核取方塊切換
    const togglePoint = (point: string) => {
        setSelectedPoints(prev => 
            prev.includes(point)
                ? prev.filter(p => p !== point)
                : [...prev, point]
        );
    };

    const handleSelectAllPoints = () => {
        setSelectedPoints(availablePoints);
    };

    const handleClearPoints = () => {
        setSelectedPoints([]);
    };

    // 表格數據
    const tableData = useMemo(() => {
        return filteredReadings
            .filter(r => selectedPoints.includes(r.sample_point) && r.data[selectedMetric] !== undefined)
            .sort((a, b) => b.test_date.localeCompare(a.test_date) || a.sample_point.localeCompare(b.sample_point));
    }, [filteredReadings, selectedPoints, selectedMetric]);

    // 打開設定彈窗，初始化編輯暫存檔
    const handleOpenConfig = () => {
        const limitsCopy = limits.map(l => ({ ...l }));
        setLimitsEditing(limitsCopy);

        const aliasList: any[] = [];
        allMetrics.forEach(m => {
            const match = aliases.find(a => a.water_type === waterType && a.original_name === m);
            aliasList.push({
                water_type: waterType,
                original_name: m,
                display_name: match ? match.display_name : m
            });
        });
        setAliasesEditing(aliasList);
        
        if (waterType === 'CW') {
            setConfigSpFilter('CW_1');
        } else {
            setConfigSpFilter('DMP');
        }
        
        setConfigTab('limits');
        setIsConfigOpen(true);
    };

    // 儲存設定
    const handleSaveConfig = async () => {
        setSavingConfig(true);
        const currentUserName = localStorage.getItem('appUserName') || 'OP';
        try {
            if (configTab === 'limits') {
                const prepared = limitsEditing.map(l => ({
                    ...l,
                    min_value: l.min_value === '' || l.min_value === undefined || l.min_value === null ? null : parseFloat(l.min_value),
                    max_value: l.max_value === '' || l.max_value === undefined || l.max_value === null ? null : parseFloat(l.max_value)
                }));
                await updateManualWaterQualityLimits(prepared, currentUserName);
            } else {
                await updateManualWaterQualityAliases(aliasesEditing, currentUserName);
            }
            
            const [limitsData, aliasesData] = await Promise.all([
                fetchManualWaterQualityLimits(),
                fetchManualWaterQualityAliases()
            ]);
            setLimits(limitsData);
            setAliases(aliasesData);
            setIsConfigOpen(false);
            alert('設定儲存成功！');
        } catch (e: any) {
            alert(e.message || '儲存設定失敗，請檢查權限');
        } finally {
            setSavingConfig(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* 標題與大分類切換 */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center space-x-3">
                    <div className="p-2 bg-brand-50 rounded-lg text-brand-600">
                        <Activity className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <span>人工水質檢驗數據趨勢</span>
                        </h1>
                        <p className="text-sm text-slate-500">檢視每週 Outlook 週報表人工化驗歷史數據與變化趨勢</p>
                    </div>
                </div>

                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => setWaterType('CW')}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                            waterType === 'CW'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                    >
                        冷卻水人工數據 (CW)
                    </button>
                    <button
                        onClick={() => setWaterType('BW')}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                            waterType === 'BW'
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                    >
                        鍋爐水人工數據 (BW)
                    </button>
                    
                    <button
                        onClick={handleOpenConfig}
                        title={isAdmin ? "設定水質控制標準與指標別名" : "僅限網站管理者修改設定"}
                        className={`p-2 rounded-lg transition-all border flex items-center gap-1.5 text-xs font-bold ${
                            isAdmin 
                                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200 shadow-sm' 
                                : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                        }`}
                    >
                        <Settings className="w-4 h-4" />
                        <span>標準/名稱設定</span>
                        {!isAdmin && <span className="text-[10px] font-normal text-slate-400">(唯讀)</span>}
                    </button>

                    <button
                        onClick={loadAllData}
                        title="重新載入"
                        className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-all border border-slate-200"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center h-96 bg-white rounded-2xl border border-slate-200 shadow-sm">
                    <RefreshCw className="w-10 h-10 text-brand-500 animate-spin mb-4" />
                    <p className="text-slate-500">正在下載並載入檢驗數據與控制標準...</p>
                </div>
            ) : error ? (
                <div className="bg-red-50 text-red-700 p-6 rounded-2xl border border-red-200 shadow-sm flex flex-col items-center">
                    <p className="font-semibold text-lg mb-2">發生錯誤</p>
                    <p className="text-sm mb-4">{error}</p>
                    <button onClick={loadAllData} className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700">
                        重試載入
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* 左側篩選器控制面板 */}
                    <div className="lg:col-span-1 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-5">
                        {/* 1. 化驗指標單選 */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center space-x-1.5">
                                <Droplet className="w-4 h-4 text-blue-500" />
                                <span>水質指標</span>
                            </label>
                            <div className="relative">
                                <select
                                    value={selectedMetric}
                                    onChange={(e) => setSelectedMetric(e.target.value)}
                                    className="w-full pl-3 pr-8 py-2 text-sm text-slate-700 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 appearance-none cursor-pointer font-semibold"
                                >
                                    {allMetrics.length === 0 ? (
                                        <option value="">無可用數據</option>
                                    ) : (
                                        allMetrics.map(m => (
                                            <option key={m} value={m}>
                                                {aliasMap[m] || m}
                                            </option>
                                        ))
                                    )}
                                </select>
                                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                            </div>
                        </div>

                        {/* 2. 時間範圍篩選 */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center space-x-1.5">
                                <Calendar className="w-4 h-4 text-emerald-500" />
                                <span>時間範圍</span>
                            </label>
                            <div className="grid grid-cols-4 gap-1">
                                {[
                                    { label: '30 天', val: 30 },
                                    { label: '90 天', val: 90 },
                                    { label: '全部', val: 0 },
                                    { label: '自訂', val: 'custom' }
                                ].map(t => (
                                    <button
                                        key={t.val}
                                        onClick={() => setDateRange(t.val as any)}
                                        className={`py-1.5 text-[11px] font-bold rounded-md border transition-all ${
                                            dateRange === t.val
                                                ? 'bg-slate-800 text-white border-slate-850 shadow-sm'
                                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                        }`}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                            </div>
                            
                            {/* 自訂時間起訖 UI */}
                            {dateRange === 'custom' && (
                                <div className="space-y-1.5 pt-2 border-t border-slate-100">
                                    <div className="flex items-center justify-between gap-1.5">
                                        <input
                                            type="date"
                                            value={customStartDate}
                                            onChange={(e) => setCustomStartDate(e.target.value)}
                                            className="w-full rounded-md border border-slate-300 p-1.5 text-xs text-slate-700 bg-white"
                                        />
                                        <span className="text-slate-400 text-xs">至</span>
                                        <input
                                            type="date"
                                            value={customEndDate}
                                            onChange={(e) => setCustomEndDate(e.target.value)}
                                            className="w-full rounded-md border border-slate-300 p-1.5 text-xs text-slate-700 bg-white"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 3. 取樣點多選 */}
                        <div className="space-y-3 flex-1 flex flex-col min-h-[300px]">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-bold text-slate-700 flex items-center space-x-1.5">
                                    <Layers className="w-4 h-4 text-brand-500" />
                                    <span>取樣點 <span className="text-[10px] text-slate-400 font-normal">({availablePoints.length}個有資料)</span></span>
                                </label>
                                <div className="space-x-1.5">
                                    <button onClick={handleSelectAllPoints} className="text-xs text-brand-600 font-bold hover:underline">全選</button>
                                    <span className="text-slate-300 text-xs">|</span>
                                    <button onClick={handleClearPoints} className="text-xs text-slate-500 font-bold hover:underline">清空</button>
                                </div>
                            </div>

                            <div className="pr-1 space-y-3">
                                {waterType === 'CW' || !pointsByCategory ? (
                                    // CW 簡單列表
                                    <div className="space-y-1.5">
                                        {availablePoints.map(p => (
                                            <label key={p} className="flex items-center p-2 rounded-md hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-100">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedPoints.includes(p)}
                                                    onChange={() => togglePoint(p)}
                                                    className="w-4 h-4 text-brand-600 border-slate-350 rounded focus:ring-brand-500"
                                                />
                                                <span className="ml-2.5 text-xs font-medium text-slate-700">
                                                    {SAMPLE_POINT_NAMES[p] || p}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                ) : (
                                    // BW 分類列表展示 (已修正除鐵水名稱)
                                    Object.entries(pointsByCategory).map(([catName, pts]) => {
                                        if (pts.length === 0) return null;
                                        return (
                                            <div key={catName} className="space-y-1 bg-slate-50/50 p-2 rounded-lg border border-slate-100">
                                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-1">{catName}</div>
                                                <div className="space-y-1">
                                                    {pts.map(p => (
                                                        <label key={p} className="flex items-center p-1.5 rounded hover:bg-white cursor-pointer transition-all">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedPoints.includes(p)}
                                                                onChange={() => togglePoint(p)}
                                                                className="w-3.5 h-3.5 text-brand-600 border-slate-300 rounded focus:ring-brand-500"
                                                            />
                                                            <span className="ml-2 text-xs font-semibold text-slate-750">
                                                                {SAMPLE_POINT_NAMES[p] || p}
                                                            </span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 右側圖表與明細表格 */}
                    <div className="lg:col-span-3 flex flex-col gap-6">
                        {/* 趨勢折線圖 */}
                        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                            <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center space-x-2">
                                <span className="w-1.5 h-4 bg-brand-500 rounded-full"></span>
                                <span>{aliasMap[selectedMetric] || selectedMetric} 歷史趨勢變化折線圖</span>
                            </h2>

                            {chartData.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-80 bg-slate-50/50 border border-dashed border-slate-200 rounded-xl">
                                    <Search className="w-8 h-8 text-slate-300 mb-2" />
                                    <p className="text-sm text-slate-400 font-bold">目前沒有符合篩選條件的檢驗數據</p>
                                    <p className="text-[11px] text-slate-400 mt-1">選定的指標：「{aliasMap[selectedMetric] || selectedMetric}」在選取的取樣點或日期內無數據</p>
                                </div>
                            ) : (
                                <div className="h-80 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart
                                            data={chartData}
                                            margin={{ top: 15, right: 15, left: -20, bottom: 0 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                                            <XAxis 
                                                dataKey="date" 
                                                stroke="#94A3B8" 
                                                fontSize={11}
                                                tickLine={false}
                                                axisLine={false}
                                            />
                                            <YAxis 
                                                stroke="#94A3B8" 
                                                fontSize={11}
                                                tickLine={false}
                                                axisLine={false}
                                                domain={['auto', 'auto']}
                                            />
                                            <ChartTooltip
                                                content={<CustomTooltip activeEvents={activeEvents} />}
                                            />
                                            <Legend 
                                                iconType="circle"
                                                iconSize={8}
                                                wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                                                formatter={(value) => SAMPLE_POINT_NAMES[value] || value}
                                            />
                                            
                                            {/* 繪製資料庫控制上限與下限 ReferenceLines */}
                                            {chartReferenceLines.map((line, idx) => (
                                                <ReferenceLine
                                                    key={idx}
                                                    y={line.y}
                                                    stroke={line.stroke}
                                                    strokeDasharray="4 4"
                                                    strokeWidth={1.5}
                                                    label={{
                                                        value: line.label,
                                                        fill: line.stroke,
                                                        position: line.type === 'max' ? 'top' : 'bottom',
                                                        fontSize: 10,
                                                        fontWeight: 'bold'
                                                    }}
                                                />
                                            ))}

                                            {/* 繪製重要紀事垂直事件 ReferenceLines */}
                                            {showEventsOnChart && activeEvents.filter(e => !hiddenEventIds.includes(e.id)).map(event => (
                                                <ReferenceLine
                                                    key={event.id}
                                                    x={event.dateStr}
                                                    stroke="#8B5CF6"
                                                    strokeWidth={1.5}
                                                    strokeDasharray="3 3"
                                                    label={{
                                                        value: event.chemicalName ? `✨ ${event.chemicalName}` : '✨ 紀事',
                                                        position: 'insideTopLeft',
                                                        fill: '#7C3AED',
                                                        fontSize: 9,
                                                        fontWeight: 'bold',
                                                        backgroundColor: 'rgba(255, 255, 255, 0.85)'
                                                    }}
                                                />
                                            ))}

                                            {selectedPoints.map((point, index) => (
                                                <Line
                                                    key={point}
                                                    type="monotone"
                                                    dataKey={point}
                                                    name={point}
                                                    stroke={CHART_COLORS[index % CHART_COLORS.length]}
                                                    strokeWidth={2}
                                                    activeDot={{ r: 5 }}
                                                    dot={{ r: 3 }}
                                                    connectNulls={true}
                                                />
                                            ))}
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>

                        {/* 下半部：詳細明細表格與區間重要事件 (上下排列，事件在上，明細在下) */}
                        <div className="flex flex-col gap-6">
                            {/* 區間內關聯重要事件 */}
                            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                                <div className="flex justify-between items-center mb-4">
                                    <h2 className="text-base font-bold text-slate-800 flex items-center space-x-2">
                                        <span className="w-1.5 h-4 bg-purple-500 rounded-full"></span>
                                        <span>區間內關聯重要事件 ({activeEvents.length} 筆)</span>
                                    </h2>
                                    <button 
                                        onClick={() => setShowEventsOnChart(!showEventsOnChart)}
                                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold transition-all ${
                                            showEventsOnChart 
                                                ? 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100 hover:border-purple-300' 
                                                : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 hover:border-slate-350'
                                        }`}
                                    >
                                        {showEventsOnChart ? (
                                            <>
                                                <EyeOff className="w-3.5 h-3.5" />
                                                <span>隱藏標記</span>
                                            </>
                                        ) : (
                                            <>
                                                <Eye className="w-3.5 h-3.5" />
                                                <span>顯示標記</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                                <div className="flex-1 overflow-auto max-h-72 border border-slate-100 rounded-xl p-2 space-y-3 bg-slate-50/30">
                                    {activeEvents.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center py-12 text-slate-400 text-xs">
                                            <span>目前時間範圍內無標記事件</span>
                                        </div>
                                    ) : (
                                        activeEvents.map(event => (
                                            <div 
                                                key={event.id} 
                                                className={`bg-white p-3 rounded-lg border shadow-sm transition-all duration-200 ${
                                                    hiddenEventIds.includes(event.id) 
                                                        ? 'border-slate-200 opacity-60 bg-slate-50/50' 
                                                        : 'border-slate-150 hover:border-purple-300'
                                                }`}
                                            >
                                                <div className="flex justify-between items-center mb-1.5">
                                                    <span className="text-[10px] font-bold text-slate-400">{event.dateStr}</span>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-purple-50 text-purple-700 border border-purple-100">
                                                            {event.area}
                                                        </span>
                                                        <button 
                                                            onClick={() => toggleEventVisibility(event.id)}
                                                            className={`p-1 rounded transition-all border ${
                                                                hiddenEventIds.includes(event.id)
                                                                    ? 'bg-slate-100 border-slate-350 text-slate-400 hover:bg-slate-200 hover:text-slate-650'
                                                                    : 'bg-purple-50 border-purple-150 text-purple-600 hover:bg-purple-100 hover:text-purple-800'
                                                            }`}
                                                            title={hiddenEventIds.includes(event.id) ? "在圖表上開啟此標記" : "在圖表上隱藏此標記"}
                                                        >
                                                            {hiddenEventIds.includes(event.id) ? (
                                                                <EyeOff className="w-3 h-3" />
                                                            ) : (
                                                                <Eye className="w-3 h-3" />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                                {event.chemicalName && (
                                                    <div className="text-[11px] font-bold text-slate-700 mb-1">
                                                        藥品: {event.chemicalName}
                                                    </div>
                                                )}
                                                <p className="text-[11px] text-slate-600 whitespace-pre-wrap">{event.note}</p>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* 化驗詳細數據明細 */}
                            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                                <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center space-x-2">
                                    <span className="w-1.5 h-4 bg-emerald-500 rounded-full"></span>
                                    <span>化驗詳細數據明細 ({tableData.length} 筆)</span>
                                </h2>

                                <div className="flex-1 overflow-auto max-h-72 border border-slate-100 rounded-xl">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 text-slate-500 border-b border-slate-150 sticky top-0 font-bold">
                                                <th className="px-4 py-2.5">檢驗日期</th>
                                                <th className="px-4 py-2.5">取樣點</th>
                                                <th className="px-4 py-2.5">水質指標</th>
                                                <th className="px-4 py-2.5 text-right">化驗檢驗值 (原始值)</th>
                                                <th className="px-4 py-2.5 text-right">趨勢數值 (清洗值)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 text-slate-750">
                                            {tableData.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-xs">
                                                        查無詳細化驗明細數據
                                                    </td>
                                                </tr>
                                            ) : (
                                                tableData.map(row => {
                                                    const rawVal = row.data[selectedMetric];
                                                    const chartVal = parseValueForChart(rawVal);
                                                    
                                                    // 判定是否超標高亮
                                                    const limitKey = `${row.sample_point}_${selectedMetric}`;
                                                    const limit = limitsMap[limitKey];
                                                    let isExceeded = false;
                                                    if (limit && chartVal !== null) {
                                                        if (limit.max !== undefined && chartVal > limit.max) isExceeded = true;
                                                        if (limit.min !== undefined && chartVal < limit.min) isExceeded = true;
                                                    }

                                                    return (
                                                        <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                                                            <td className="px-4 py-2.5 font-medium flex items-center gap-1.5">
                                                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                                                <span>{row.test_date}</span>
                                                            </td>
                                                            <td className="px-4 py-2.5 font-bold">
                                                                {SAMPLE_POINT_NAMES[row.sample_point] || row.sample_point}
                                                            </td>
                                                            <td className="px-4 py-2.5 text-slate-500">{aliasMap[selectedMetric] || selectedMetric}</td>
                                                            <td className="px-4 py-2.5 text-right font-bold bg-slate-50/30">
                                                                {isExceeded ? (
                                                                    <span className="text-red-600 font-bold bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                                                                        {rawVal !== undefined ? String(rawVal) : '-'} (超標)
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-slate-900">
                                                                        {rawVal !== undefined ? String(rawVal) : '-'}
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-2.5 text-right font-bold text-blue-600">
                                                                {chartVal !== null ? chartVal : '-'}
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 管理者設定對話框 (Modal) */}
            {isConfigOpen && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh] border border-slate-200 overflow-hidden">
                        
                        {/* Header */}
                        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                                <Settings className="w-5 h-5 text-brand-600" />
                                <h3 className="font-bold text-slate-800 text-base">水質控制標準與指標別名設定</h3>
                            </div>
                            <button onClick={() => setIsConfigOpen(false)} className="p-1.5 hover:bg-slate-200 text-slate-400 hover:text-slate-600 rounded-lg transition-all">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Tabs */}
                        <div className="flex border-b border-slate-200 bg-white">
                            <button
                                onClick={() => setConfigTab('limits')}
                                className={`px-6 py-3 text-xs font-bold border-b-2 transition-all ${
                                    configTab === 'limits'
                                        ? 'border-brand-600 text-brand-600'
                                        : 'border-transparent text-slate-500 hover:text-slate-700'
                                }`}
                            >
                                水質控制限值 (Limits)
                            </button>
                            <button
                                onClick={() => setConfigTab('aliases')}
                                className={`px-6 py-3 text-xs font-bold border-b-2 transition-all ${
                                    configTab === 'aliases'
                                        ? 'border-brand-600 text-brand-600'
                                        : 'border-transparent text-slate-500 hover:text-slate-700'
                                }`}
                            >
                                指標顯示別名 (Aliases)
                            </button>
                        </div>

                        {/* Content Area */}
                        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
                            {configTab === 'limits' ? (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg gap-4">
                                        <div className="text-xs font-bold text-slate-600 flex items-center space-x-2">
                                            <span>請選擇取樣點進行設定：</span>
                                        </div>
                                        <select
                                            value={configSpFilter}
                                            onChange={(e) => setConfigSpFilter(e.target.value)}
                                            className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-brand-500 font-bold"
                                        >
                                            {availablePoints.map(p => (
                                                <option key={p} value={p}>{SAMPLE_POINT_NAMES[p] || p}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Limits Rows */}
                                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                                        <div className="grid grid-cols-6 gap-4 p-3 bg-slate-50 text-slate-500 text-[10px] font-bold">
                                            <div className="col-span-3">指標項目</div>
                                            <div className="col-span-1.5 text-center">控制下限 (Min)</div>
                                            <div className="col-span-1.5 text-center">控制上限 (Max)</div>
                                        </div>
                                        
                                        {allMetrics.map(m => {
                                            let limitItem = limitsEditing.find(
                                                l => l.water_type === waterType && 
                                                     l.sample_point === configSpFilter && 
                                                     l.metric_name === m
                                            );

                                            if (!limitItem) {
                                                limitItem = {
                                                    water_type: waterType,
                                                    sample_point: configSpFilter,
                                                    metric_name: m,
                                                    min_value: '',
                                                    max_value: ''
                                                };
                                                limitsEditing.push(limitItem);
                                            }

                                            return (
                                                <div key={m} className="grid grid-cols-6 gap-4 p-3 items-center text-xs">
                                                    <div className="col-span-3 font-semibold text-slate-700">
                                                        {aliasMap[m] || m}
                                                        <span className="text-[10px] text-slate-400 block font-normal mt-0.5">{m}</span>
                                                    </div>
                                                    <div className="col-span-1.5">
                                                        <input
                                                            type="number"
                                                            step="any"
                                                            placeholder="無"
                                                            value={limitItem.min_value !== null && limitItem.min_value !== undefined ? limitItem.min_value : ''}
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                limitItem.min_value = val === '' ? null : val;
                                                                setLimitsEditing([...limitsEditing]);
                                                            }}
                                                            className="w-full text-center border border-slate-300 rounded p-1 text-xs text-slate-700"
                                                        />
                                                    </div>
                                                    <div className="col-span-1.5">
                                                        <input
                                                            type="number"
                                                            step="any"
                                                            placeholder="無"
                                                            value={limitItem.max_value !== null && limitItem.max_value !== undefined ? limitItem.max_value : ''}
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                limitItem.max_value = val === '' ? null : val;
                                                                setLimitsEditing([...limitsEditing]);
                                                            }}
                                                            className="w-full text-center border border-slate-300 rounded p-1 text-xs text-slate-700"
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : (
                                // Tab: Aliases
                                <div className="space-y-4">
                                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                                        <div className="grid grid-cols-6 gap-4 p-3 bg-slate-50 text-slate-500 text-[10px] font-bold">
                                            <div className="col-span-3">原始 Excel 欄位名稱</div>
                                            <div className="col-span-3">自訂指標顯示名稱 (藥劑更換在此修改)</div>
                                        </div>
                                        
                                        {aliasesEditing.map((item, idx) => (
                                            <div key={item.original_name} className="grid grid-cols-6 gap-4 p-3 items-center text-xs">
                                                <div className="col-span-3 font-semibold text-slate-500">
                                                    {item.original_name}
                                                </div>
                                                <div className="col-span-3 flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={item.display_name}
                                                        onChange={(e) => {
                                                            aliasesEditing[idx].display_name = e.target.value;
                                                            setAliasesEditing([...aliasesEditing]);
                                                        }}
                                                        className="w-full border border-slate-300 rounded p-1.5 text-xs text-slate-800 font-bold"
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                            <span className="text-[10px] text-slate-400">
                                * 所有設定將會即時儲存至遠端 PostgreSQL 資料庫，多人連線可同步生效。
                            </span>
                            <div className="flex items-center space-x-2">
                                <button
                                    onClick={() => setIsConfigOpen(false)}
                                    className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-100 text-xs font-semibold"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleSaveConfig}
                                    disabled={savingConfig}
                                    className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold flex items-center space-x-1 disabled:opacity-50"
                                >
                                    <span>{savingConfig ? '正在儲存...' : '儲存設定'}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
