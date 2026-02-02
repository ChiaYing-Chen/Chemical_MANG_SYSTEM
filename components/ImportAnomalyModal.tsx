
import React from 'react';
import { Icons } from './Icons';

export interface ImportAnomaly {
    id: string;
    tankId: string;
    date: string;
    tankName: string;
    reason: string;
    currentValue: number;
    prevDate?: string;
    prevValue?: number;
    nextDate?: string;
    nextValue?: number;
    isPossibleRefill?: boolean; // 當液位上升超過閾值15倍以上，判斷為可能補藥
}

interface ImportAnomalyModalProps {
    isOpen: boolean;
    anomalies: ImportAnomaly[];
    onConfirm: () => void;
    onCancel: () => void;
    onAddNote?: (anomaly: ImportAnomaly, note: string) => Promise<void>;
}

export const ImportAnomalyModal: React.FC<ImportAnomalyModalProps> = ({
    isOpen,
    anomalies,
    onConfirm,
    onCancel,
    onAddNote
}) => {
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [noteContent, setNoteContent] = React.useState<string>('');
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [notedIds, setNotedIds] = React.useState<Set<string>>(new Set());

    const startEditing = (item: ImportAnomaly) => {
        setEditingId(item.id);
        const defaultNote = `${item.reason} 檢查原因為 : `;
        setNoteContent(defaultNote);
    };

    const handleSaveNote = async () => {
        if (!editingId || !onAddNote) return;
        const item = anomalies.find(a => a.id === editingId);
        if (!item) return;

        setIsSubmitting(true);
        try {
            await onAddNote(item, noteContent);
            setEditingId(null);
            setNoteContent('');
            setNotedIds(prev => new Set(prev).add(item.id));
        } catch (e) {
            console.error(e);
            alert('儲存失敗');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCancelNote = () => {
        setEditingId(null);
        setNoteContent('');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 animate-fade-in">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="bg-red-50 px-6 py-4 border-b border-red-100 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-100 rounded-full text-red-600">
                            <Icons.Alert className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-red-900">發現異常數據</h2>
                            <p className="text-sm text-red-700">Import Data Anomaly Check</p>
                        </div>
                    </div>
                </div>

                {/* Content - Scrollable Table */}
                <div className="p-6 overflow-auto grow bg-slate-50">
                    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                        <table className="min-w-full divide-y divide-slate-200">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                                        儲槽 / 日期
                                    </th>
                                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                                        異常說明
                                    </th>
                                    <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-100/50">
                                        前日數據
                                    </th>
                                    <th scope="col" className="px-4 py-3 text-center text-xs font-bold text-red-600 uppercase tracking-wider bg-red-50/50">
                                        匯入數值 (異常)
                                    </th>
                                    <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wider bg-slate-100/50">
                                        次日數據
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-200">
                                {anomalies.map((item) => (
                                    <React.Fragment key={item.id}>
                                        <tr className="hover:bg-slate-50 transition-colors">
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <div className="font-bold text-slate-800">{item.tankName}</div>
                                                <div className="text-sm text-slate-500 flex items-center gap-1">
                                                    <Icons.Calendar className="w-3 h-3" />
                                                    {item.date}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className={`text-sm font-medium mb-1 ${item.isPossibleRefill ? 'text-blue-600' : 'text-red-600'}`}>
                                                    {item.reason}
                                                    {item.isPossibleRefill && (
                                                        <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-bold">
                                                            可能為補藥
                                                        </span>
                                                    )}
                                                </div>
                                                {onAddNote && (
                                                    <div className="flex items-center gap-2">
                                                        {notedIds.has(item.id) ? (
                                                            <div className="text-xs flex items-center gap-1 text-green-600 font-medium">
                                                                <Icons.Check className="w-4 h-4" />
                                                                已加入紀事
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => startEditing(item)}
                                                                className="text-xs flex items-center gap-1 text-slate-400 hover:text-blue-600 transition-colors"
                                                            >
                                                                <Icons.FilePenLine className="w-3 h-3" />
                                                                加入重要紀事
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-center bg-slate-50/30 whitespace-nowrap">
                                                {item.prevValue !== undefined ? (
                                                    <div className="flex flex-col items-center">
                                                        <span className="font-mono text-slate-700">{item.prevValue.toFixed(0)} L</span>
                                                        <span className="text-[10px] text-slate-400">{item.prevDate}</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-300">-</span>
                                                )}
                                            </td>
                                            <td className={`px-4 py-3 text-center whitespace-nowrap ${item.isPossibleRefill ? 'bg-blue-50/30' : 'bg-red-50/30'}`}>
                                                <div className={`font-bold font-mono text-lg ${item.isPossibleRefill ? 'text-blue-700' : 'text-red-700'}`}>
                                                    {item.currentValue.toFixed(0)} L
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center bg-slate-50/30 whitespace-nowrap">
                                                {item.nextValue !== undefined ? (
                                                    <div className="flex flex-col items-center">
                                                        <span className="font-mono text-slate-700">{item.nextValue.toFixed(0)} L</span>
                                                        <span className="text-[10px] text-slate-400">{item.nextDate}</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-300">-</span>
                                                )}
                                            </td>
                                        </tr>
                                        {/* Inline Edit Row */}
                                        {editingId === item.id && (
                                            <tr className="bg-blue-50/50 animate-fade-in">
                                                <td colSpan={5} className="px-4 py-3 border-b-2 border-blue-100">
                                                    <div className="flex gap-3 items-start">
                                                        <div className="flex-1">
                                                            <label className="block text-xs font-bold text-slate-700 mb-1">
                                                                新增重要紀事內容:
                                                            </label>
                                                            <textarea
                                                                value={noteContent}
                                                                onChange={(e) => setNoteContent(e.target.value)}
                                                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                                                                rows={2}
                                                                placeholder="輸入異常說明及原因..."
                                                                autoFocus
                                                            />
                                                        </div>
                                                        <div className="flex flex-col gap-2 pt-6">
                                                            <button
                                                                onClick={handleSaveNote}
                                                                disabled={isSubmitting}
                                                                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1"
                                                            >
                                                                <Icons.Save className="w-3 h-3" />
                                                                儲存
                                                            </button>
                                                            <button
                                                                onClick={handleCancelNote}
                                                                disabled={isSubmitting}
                                                                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-xs font-medium rounded hover:bg-slate-50"
                                                            >
                                                                取消
                                                            </button>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-white px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0">
                    <div className="text-sm text-slate-500">
                        共發現 <span className="font-bold text-slate-800">{anomalies.length}</span> 筆異常數據。請確認是否繼續匯入。
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-1 transition-colors"
                        >
                            取消匯入
                        </button>
                        <button
                            onClick={onConfirm}
                            className="px-6 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 transition-all flex items-center gap-2"
                        >
                            <Icons.Check className="w-5 h-5" />
                            確認並繼續
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
