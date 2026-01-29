import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Button, Card } from '../App';
import { Icons } from '../components/Icons';
import { CWSParameterRecord, Tank, SystemType } from '../types';
import { StorageService } from '../services/storageService';

// --- Types ---

interface ExcelTemplateConfig {
    id: string;
    name: string;
    cells: {
        yearCell: string;   // e.g. 'A4'
        monthCell: string;  // e.g. 'B4'
        dayCell: string;    // e.g. 'C4'
        makeupHardness: string; // e.g. 'B14'
        ct1Hardness: string;    // e.g. 'C14'
        ct2Hardness: string;    // e.g. 'D14'
    };
    // Helper to parse date from the specific cells
    parseDate: (sheet: XLSX.WorkSheet, cells: ExcelTemplateConfig['cells']) => Date | null;
}

const TEMPLATES: ExcelTemplateConfig[] = [
    {
        id: 'type1',
        name: 'Type 1: 開廣CW週報',
        cells: {
            yearCell: 'A4',
            monthCell: 'B4',
            dayCell: 'C4',
            makeupHardness: 'B14',
            ct1Hardness: 'C14',
            ct2Hardness: 'D14'
        },
        parseDate: (sheet, cells) => {
            const getCellVal = (cellAddr: string) => {
                const cell = sheet[cellAddr];
                return cell ? cell.v : null;
            };

            const yearRaw = getCellVal(cells.yearCell);
            const monthRaw = getCellVal(cells.monthCell);
            const dayRaw = getCellVal(cells.dayCell);

            // Parse Year: "115年" -> 115 -> 2026
            let year = 0;
            if (typeof yearRaw === 'string') {
                const match = yearRaw.match(/(\d+)/);
                if (match) year = parseInt(match[1]);
            } else if (typeof yearRaw === 'number') {
                year = yearRaw;
            }

            // Parse Month: "1月" -> 1
            let month = 0;
            if (typeof monthRaw === 'string') {
                const match = monthRaw.match(/(\d+)/);
                if (match) month = parseInt(match[1]);
            } else if (typeof monthRaw === 'number') {
                month = monthRaw;
            }

            // Parse Day: "19日" -> 19
            let day = 0;
            if (typeof dayRaw === 'string') {
                const match = dayRaw.match(/(\d+)/);
                if (match) day = parseInt(match[1]);
            } else if (typeof dayRaw === 'number') {
                day = dayRaw;
            }

            if (year > 0 && month > 0 && day > 0) {
                // ROC Year check
                const fullYear = year < 1000 ? year + 1911 : year;
                return new Date(fullYear, month - 1, day);
            }
            return null;
        }
    }
];

// Helper: Get Monday of the week for a given date
const getMonday = (d: Date): Date => {
    d = new Date(d);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d.setDate(diff));
    mon.setHours(0, 0, 0, 0);
    return mon;
};

interface ParsedData {
    sheetName: string;
    date: Date;
    mondayDate: Date;
    makeupHardness: number;
    ct1CW: number;
    ct2CW: number;
}

// --- Component ---

export const ExcelImportView: React.FC<{ tanks: Tank[], onComplete: () => void }> = ({ tanks, onComplete }) => {
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>(TEMPLATES[0].id);
    const [previewData, setPreviewData] = useState<ParsedData[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const template = TEMPLATES.find(t => t.id === selectedTemplateId);
        if (!template) return;

        setLogs([]);
        setPreviewData([]);

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const results: ParsedData[] = [];

            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];

                // Parse Date
                const date = template.parseDate(sheet, template.cells);

                if (!date) {
                    setLogs(prev => [...prev, `[略過] Sheet '${sheetName}': 無法辨識日期 (A4, B4, C4)`]);
                    continue;
                }

                // Parse Values
                const getVal = (addr: string) => {
                    const c = sheet[addr];
                    let v = c ? c.v : 0;
                    if (typeof v === 'string') v = parseFloat(v);
                    return isNaN(v) ? 0 : v;
                };

                const makeup = getVal(template.cells.makeupHardness);
                const ct1 = getVal(template.cells.ct1Hardness);
                const ct2 = getVal(template.cells.ct2Hardness);

                if (makeup === 0 && ct1 === 0 && ct2 === 0) {
                    setLogs(prev => [...prev, `[略過] Sheet '${sheetName}': 數值均為 0`]);
                    continue;
                }

                results.push({
                    sheetName,
                    date,
                    mondayDate: getMonday(date),
                    makeupHardness: makeup,
                    ct1CW: ct1,
                    ct2CW: ct2
                });
            }

            setPreviewData(results);
            if (results.length === 0) {
                setLogs(prev => [...prev, `注意: 此檔案中沒有找到符合格式的資料。`]);
            }

        } catch (err: any) {
            console.error(err);
            setLogs(prev => [...prev, `讀取失敗: ${err.message}`]);
        }
    };

    const handleImport = async () => {
        if (!confirm(`確定要匯入 ${previewData.length} 筆資料嗎？\n這將會寫入該日期所屬週次的所有冷卻水參數。`)) return;

        setIsProcessing(true);
        setLogs(prev => [...prev, '開始匯入...']);

        try {
            const cwsTanks = tanks.filter(t => t.system === SystemType.COOLING);
            // Logic to split CT-1 and CT-2
            // Based on App.tsx logic: 
            // CT-1: name includes 'CWS-1', 'CT-1', or desc includes '一階'
            // CT-2: remaining
            const ct1Tanks = cwsTanks.filter(t => t.name.includes('CWS-1') || t.name.includes('CT-1') || (t.description || '').includes('一階'));
            const ct2Tanks = cwsTanks.filter(t => !ct1Tanks.find(ct1 => ct1.id === t.id));

            let count = 0;

            for (const item of previewData) {
                const dateTs = item.mondayDate.getTime();
                const logPrefix = `[${item.mondayDate.toLocaleDateString()}]`;

                // Calculate Cycles
                const ct1Cycles = item.makeupHardness > 0 ? item.ct1CW / item.makeupHardness : 0;
                const ct2Cycles = item.makeupHardness > 0 ? item.ct2CW / item.makeupHardness : 0;

                // Update CT-1 Tanks
                for (const tank of ct1Tanks) {
                    // Check if record exists specifically for this date to update, or create new
                    // Using generateUUID fallback if needed, relying on StorageService (which calls API)
                    // We need to fetch ID if we want to update precisely, but saveCWSParam usually handles logic.
                    // However, we probably want to upsert based on date. Support is needed on API or we query first.
                    // To keep it simple and consistent with "Batch Import" logic in App.tsx:
                    // Query history -> Find match -> Update OR Create
                    const history = await StorageService.getCWSParamsHistory(tank.id);
                    const existing = history.find(h => h.date === dateTs);

                    const record: CWSParameterRecord = {
                        id: existing?.id, // undefined means new
                        tankId: tank.id,
                        date: dateTs,
                        // Preserve existing flow/temp data if it exists? 
                        // The User Requirement specifically mentions importing Hardness. 
                        // If we overwrite, we might lose PI data (Temp/Flow).
                        // Ideally we merge.
                        circulationRate: existing?.circulationRate || 0,
                        tempOutlet: existing?.tempOutlet,
                        tempReturn: existing?.tempReturn,
                        tempDiff: existing?.tempDiff || 0,

                        // New Data
                        makeupHardness: item.makeupHardness,
                        cwsHardness: item.ct1CW,
                        concentrationCycles: ct1Cycles
                    };
                    await StorageService.saveCWSParam(record);
                }

                // Update CT-2 Tanks
                for (const tank of ct2Tanks) {
                    const history = await StorageService.getCWSParamsHistory(tank.id);
                    const existing = history.find(h => h.date === dateTs);

                    const record: CWSParameterRecord = {
                        id: existing?.id,
                        tankId: tank.id,
                        date: dateTs,
                        circulationRate: existing?.circulationRate || 0,
                        tempOutlet: existing?.tempOutlet,
                        tempReturn: existing?.tempReturn,
                        tempDiff: existing?.tempDiff || 0,

                        makeupHardness: item.makeupHardness,
                        cwsHardness: item.ct2CW, // Use CT-2 Hardness
                        concentrationCycles: ct2Cycles // Use CT-2 Cycles
                    };
                    await StorageService.saveCWSParam(record);
                }
                count++;
            }

            setLogs(prev => [...prev, `匯入完成，共處理 ${count} 個日期的資料。`]);
            alert('匯入成功！');
            onComplete(); // Refresh parent?
        } catch (err: any) {
            setLogs(prev => [...prev, `匯入錯誤: ${err.message}`]);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in p-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-slate-800">Excel 辨識匯入</h2>
                <div className="w-64">
                    <select
                        className="w-full rounded-lg border-slate-300 border p-2 bg-white"
                        value={selectedTemplateId}
                        onChange={(e) => setSelectedTemplateId(e.target.value)}
                    >
                        {TEMPLATES.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            <Card className="bg-slate-50 border-dashed border-2 border-slate-300">
                <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                    <Icons.FileText className="w-12 h-12 mb-4 text-slate-400" />
                    <p className="mb-4">拖放 Excel 檔案至此，或點擊上傳</p>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        accept=".xlsx, .xls"
                        className="hidden"
                    />
                    <Button onClick={() => fileInputRef.current?.click()}>
                        選擇檔案
                    </Button>
                </div>
            </Card>

            {previewData.length > 0 && (
                <Card title={`預覽資料 (${previewData.length} 筆)`}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-slate-600">
                            <thead className="text-xs text-slate-700 uppercase bg-slate-100">
                                <tr>
                                    <th className="px-4 py-3">Sheet</th>
                                    <th className="px-4 py-3">日期</th>
                                    <th className="px-4 py-3">平移後日期</th>
                                    <th className="px-4 py-3 text-right">補水硬度</th>
                                    <th className="px-4 py-3 text-right">CT-1 硬度</th>
                                    <th className="px-4 py-3 text-right">CT-2 硬度</th>
                                </tr>
                            </thead>
                            <tbody>
                                {previewData.map((row, idx) => (
                                    <tr key={idx} className="border-b bg-white hover:bg-slate-50">
                                        <td className="px-4 py-3 font-medium text-slate-900">{row.sheetName}</td>
                                        <td className="px-4 py-3">{row.date.toLocaleDateString()}</td>
                                        <td className="px-4 py-3 font-medium text-blue-600">{row.mondayDate.toLocaleDateString()}</td>
                                        <td className="px-4 py-3 text-right">{row.makeupHardness}</td>
                                        <td className="px-4 py-3 text-right">{row.ct1CW}</td>
                                        <td className="px-4 py-3 text-right">{row.ct2CW}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-4 flex justify-end">
                        <Button onClick={handleImport} disabled={isProcessing}>
                            {isProcessing ? '匯入中...' : '確認匯入資料庫'}
                        </Button>
                    </div>
                </Card>
            )}

            {logs.length > 0 && (
                <div className="bg-slate-900 text-slate-300 p-4 rounded-lg font-mono text-xs max-h-60 overflow-y-auto">
                    {logs.map((log, i) => (
                        <div key={i}>{log}</div>
                    ))}
                </div>
            )}
        </div>
    );
};
