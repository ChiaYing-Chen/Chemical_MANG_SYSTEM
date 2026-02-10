import React, { useState, useEffect } from 'react';
import { Icons } from './Icons';
import { ImportAnomaly } from './ImportAnomalyModal';
import { StorageService } from '../services/storageService';
import { Tank, FluctuationAlert } from '../types';

interface FluctuationAlertsViewProps {
    alerts: FluctuationAlert[];
    onAddNote: (alert: FluctuationAlert, note: string) => Promise<void>;
    onDelete: () => void; // Callback to refresh alerts after delete
    thresholdWarningText?: string;
}

export const FluctuationAlertsView: React.FC<FluctuationAlertsViewProps> = ({ alerts, onAddNote, onDelete, thresholdWarningText }) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [noteContent, setNoteContent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [tanks, setTanks] = useState<Tank[]>([]);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    useEffect(() => {
        const loadTanks = async () => {
            const data = await StorageService.getTanks();
            setTanks(data);
        };
        loadTanks();
    }, []);

    const getTankSG = (tankId: string) => {
        const tank = tanks.find(t => t.id === tankId);
        // Default to 1 if not found or undefined
        return tank?.bwsParams?.specificGravity || 1.0;
    };

    const convertToKg = (liters?: number, tankId?: string) => {
        if (liters === undefined || !tankId) return undefined;
        const sg = getTankSG(tankId);
        return liters * sg;
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === alerts.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(alerts.map(a => a.id)));
        }
    };

    const toggleSelect = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const handleDeleteBatch = async () => {
        if (selectedIds.size === 0) return;
        if (!window.confirm(`確定要刪除選取的 ${selectedIds.size} 筆警報嗎？`)) return;

        try {
            await StorageService.deleteAlertsBatch(Array.from(selectedIds));
            setSelectedIds(new Set());
            onDelete();
        } catch (e) {
            alert('刪除失敗');
        }
    };

    const handleDeleteSingle = async (id: string) => {
        if (!window.confirm('確定要刪除此筆警報嗎？')) return;
        try {
            await StorageService.deleteAlert(id);
            onDelete();
        } catch (e) {
            alert('刪除失敗');
        }
    };

    const startEditing = (alertItem: FluctuationAlert) => {
        setEditingId(alertItem.id);
        setNoteContent(alertItem.note || `${alertItem.reason} 檢查原因為 : `);
    };

    const handleSave = async (alertItem: FluctuationAlert) => {
        setIsSubmitting(true);
        try {
            await onAddNote(alertItem, noteContent);
            setEditingId(null);
            setNoteContent('');
        } catch (e) {
            console.error(e);
            window.alert('儲存失敗');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Calculate displayed alerts for pagination
    const displayedAlerts = alerts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    return (
        <div className="flex flex-col bg-white">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={alerts.length > 0 && selectedIds.size === alerts.length}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-slate-600">全選</span>
                </div>
                {selectedIds.size > 0 && (
                    <button
                        onClick={handleDeleteBatch}
                        className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 flex items-center gap-1 shadow-sm transition-all"
                    >
                        <Icons.Trash2 className="w-4 h-4" />
                        刪除選取 ({selectedIds.size})
                    </button>
                )}
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th scope="col" className="px-4 py-3 w-10"></th>
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                                儲槽 / 日期
                            </th>
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                                異常說明
                            </th>
                            <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wider">
                                數值 (kg)
                            </th>
                            <th scope="col" className="px-4 py-3 w-20"></th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {alerts.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                                    尚無警報紀錄
                                </td>
                            </tr>
                        ) : (
                            displayedAlerts.map((alert) => {
                                const valKg = convertToKg(alert.currentValue, alert.tankId);
                                const prevKg = convertToKg(alert.prevValue, alert.tankId);
                                const nextKg = convertToKg(alert.nextValue, alert.tankId);

                                return (
                                    <React.Fragment key={alert.id}>
                                        <tr className={`hover:bg-slate-50 transition-colors ${alert.note ? 'bg-green-50/30' : ''} ${selectedIds.has(alert.id) ? 'bg-blue-50' : ''}`}>
                                            <td className="px-4 py-3 align-top pt-4">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(alert.id)}
                                                    onChange={() => toggleSelect(alert.id)}
                                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                />
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap align-top">
                                                <div className="font-bold text-slate-800">{alert.tankName}</div>
                                                <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                                                    <Icons.Calendar className="w-3 h-3" />
                                                    {alert.dateStr}
                                                </div>
                                                <div className="mt-1">
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${alert.source === 'IMPORT' ? 'bg-purple-50 text-purple-600 border-purple-100' : 'bg-orange-50 text-orange-600 border-orange-100'}`}>
                                                        {alert.source === 'IMPORT' ? '匯入' : '手動'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 align-top">
                                                <div className={`text-sm font-medium mb-1 ${alert.isPossibleRefill ? 'text-blue-600' : 'text-red-600'}`}>
                                                    <div className={`text-sm font-medium mb-1 ${alert.isPossibleRefill ? 'text-blue-600' : 'text-red-600'}`}>
                                                        {(() => {
                                                            // 1. Convert Units (L -> kg)
                                                            let text = alert.reason.replace(/(\d+)\s*L/g, (match, p1) => {
                                                                const kg = convertToKg(parseFloat(p1), alert.tankId);
                                                                return kg ? `${kg.toFixed(0)} kg` : match;
                                                            });

                                                            // 2. Apply Configurable Warning Text (Formatting)
                                                            if (thresholdWarningText && text.startsWith('日均變動')) {
                                                                // Transform: "日均變動 A (超過閾值 B)" -> "Warning (日均變動 A > B)"
                                                                if (text.includes('超過閾值')) {
                                                                    text = text.replace(/日均變動\s+(.+)\s+\(超過閾值\s+(.+)\)/, `${thresholdWarningText} (日均變動 $1 > $2)`);
                                                                } else {
                                                                    // Fallback prepend
                                                                    text = `${thresholdWarningText} (${text})`;
                                                                }
                                                            }

                                                            return text;
                                                        })()}
                                                    </div>
                                                </div>

                                                {alert.note && (
                                                    <div className="mt-2 p-2 bg-yellow-50 border border-yellow-100 rounded text-xs text-yellow-800 flex gap-2 items-start">
                                                        <Icons.Notes className="w-3 h-3 mt-0.5 shrink-0" />
                                                        <span>{alert.note}</span>
                                                    </div>
                                                )}

                                                {!editingId && (
                                                    <button
                                                        onClick={() => startEditing(alert)}
                                                        className="mt-2 text-xs flex items-center gap-1 text-slate-400 hover:text-blue-600 transition-colors"
                                                    >
                                                        <Icons.FilePenLine className="w-3 h-3" />
                                                        {alert.note ? '修改紀事' : '加入重要紀事'}
                                                    </button>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-center align-top whitespace-nowrap">
                                                <div className="font-mono text-sm font-bold text-slate-700">
                                                    {valKg?.toFixed(0)} kg
                                                </div>
                                                {(prevKg !== undefined || nextKg !== undefined) && (
                                                    <div className="text-[10px] text-slate-400 mt-1 space-y-0.5">
                                                        {prevKg !== undefined && <div>前: {prevKg.toFixed(0)}</div>}
                                                        {nextKg !== undefined && <div>後: {nextKg.toFixed(0)}</div>}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 align-top pt-4 text-right">
                                                <button
                                                    onClick={() => handleDeleteSingle(alert.id)}
                                                    className="text-slate-400 hover:text-red-600 transition-colors tooltip"
                                                    title="刪除"
                                                >
                                                    <Icons.Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                        {/* Inline Edit Row */}
                                        {editingId === alert.id && (
                                            <tr className="bg-blue-50/50 animate-fade-in">
                                                <td colSpan={5} className="px-4 py-3 border-b border-blue-100">
                                                    <div className="flex flex-col gap-2">
                                                        <textarea
                                                            value={noteContent}
                                                            onChange={(e) => setNoteContent(e.target.value)}
                                                            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 text-sm"
                                                            rows={2}
                                                            placeholder="輸入異常說明..."
                                                            autoFocus
                                                        />
                                                        <div className="flex justify-end gap-2">
                                                            <button
                                                                onClick={() => setEditingId(null)}
                                                                disabled={isSubmitting}
                                                                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-xs rounded hover:bg-slate-50"
                                                            >
                                                                取消
                                                            </button>
                                                            <button
                                                                onClick={() => handleSave(alert)}
                                                                disabled={isSubmitting}
                                                                className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                                                            >
                                                                {isSubmitting ? '儲存中...' : '儲存'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div >

            {/* Pagination Controls */}
            {
                alerts.length > 0 && (
                    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 flex-shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500">
                                顯示 {((currentPage - 1) * itemsPerPage) + 1} 至 {Math.min(currentPage * itemsPerPage, alerts.length)} 筆，共 {alerts.length} 筆
                            </span>
                            <select
                                value={itemsPerPage}
                                onChange={e => {
                                    setItemsPerPage(Number(e.target.value));
                                    setCurrentPage(1);
                                }}
                                className="ml-2 text-xs border-slate-300 rounded shadow-sm focus:border-brand-500 focus:ring-brand-500 py-1"
                            >
                                <option value={10}>10 筆</option>
                                <option value={20}>20 筆</option>
                                <option value={50}>50 筆</option>
                            </select>
                        </div>
                        <div className="flex gap-1">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                上一頁
                            </button>
                            <span className="flex items-center text-xs font-medium text-slate-700 px-2">
                                {currentPage} / {Math.ceil(alerts.length / itemsPerPage)}
                            </span>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(Math.ceil(alerts.length / itemsPerPage), p + 1))}
                                disabled={currentPage >= Math.ceil(alerts.length / itemsPerPage)}
                                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                下一頁
                            </button>
                        </div>
                    </div>
                )
            }
        </div >
    );
};
