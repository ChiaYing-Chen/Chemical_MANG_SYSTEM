import React, { useEffect, useState } from 'react';
import { Icons } from './Icons';
import { TankCalibration, TankCalibrationLog } from '../types';
import * as API from '../services/apiService';

interface PiCalibrationModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const PiCalibrationModal: React.FC<PiCalibrationModalProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState<'formulas' | 'logs'>('formulas');
    const [calibrations, setCalibrations] = useState<TankCalibration[]>([]);
    const [logs, setLogs] = useState<TankCalibrationLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [editingItem, setEditingItem] = useState<TankCalibration | null>(null);
    const [editForm, setEditForm] = useState({ slope: '1.0', intercept: '0.0', note: '', reason: '' });
    const [backfilling, setBackfilling] = useState(false);

    const handleBackfill = async () => {
        if (!window.confirm('確定要回補過去 35 天具有實際抄表時間的 PI 配對資料並重算公式嗎？\n不足 3 筆保留原公式；3～6 筆或量程不足僅校正偏移。耗時取決於資料量與 PI 連線。')) return;
        setBackfilling(true);
        try {
            const resp = await API.backfillPiLevels(35);
            const details = (resp.details || []).map((d: any) => `${d.tankName}：回補 ${d.updated} 筆，略過 ${d.skipped} 筆${d.error ? '；' + d.error : ''}`);
            const fits = (resp.calibrations || []).filter((c: any) => !c.updated).map((c: any) => `${c.tankName}：${c.reason}`);
            alert(`${resp.success ? '回補完成' : '回補未全部完成'}：共回補 ${resp.totalUpdated || 0} 筆\n${[...details, ...fits].join('\n')}`);
            await loadData();
        } catch (e: any) {
            console.error(e);
            alert('回補失敗: ' + (e.message || String(e)));
        } finally {
            setBackfilling(false);
        }
    };

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await API.fetchTankCalibrations();
            setCalibrations(data.calibrations || []);
            setLogs(data.logs || []);
        } catch (e: any) {
            console.error(e);
            alert('載入校正公式失敗: ' + (e.message || String(e)));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            loadData();
        }
    }, [isOpen]);

    const handleRecalculateAll = async () => {
        if (!window.confirm('確定要針對所有具備 PI Tag 的儲槽，以歷史配對數據重新計算線性回歸公式嗎？')) return;
        setActionLoading(true);
        try {
            const resp = await API.recalculateTankCalibration(undefined, '管理員手動批次觸發重新回歸計算');
            alert(`已更新 ${resp.count} 槽公式\n${(resp.data || []).filter((c: any) => !c.updated).map((c: any) => `${c.tankName}：${c.reason}`).join('\n')}`);
            await loadData();
        } catch (e: any) {
            alert('重新計算失敗: ' + (e.message || String(e)));
        } finally {
            setActionLoading(false);
        }
    };

    const handleRecalculateSingle = async (tank: TankCalibration) => {
        setActionLoading(true);
        try {
            const resp = await API.recalculateTankCalibration(tank.tankId, `單槽手動觸發: ${tank.tankName}`);
            alert(resp.count ? `已更新「${tank.tankName}」公式` : (resp.data?.[0]?.reason || '沒有可更新的公式'));
            await loadData();
        } catch (e: any) {
            alert('重新計算失敗: ' + (e.message || String(e)));
        } finally {
            setActionLoading(false);
        }
    };

    const startEdit = (item: TankCalibration) => {
        setEditingItem(item);
        setEditForm({
            slope: item.slope.toString(),
            intercept: item.intercept.toString(),
            note: item.note || '',
            reason: '現場儀表微調'
        });
    };

    const handleSaveEdit = async () => {
        if (!editingItem) return;
        const s = parseFloat(editForm.slope);
        const i = parseFloat(editForm.intercept);
        if (isNaN(s) || isNaN(i)) {
            alert('請輸入有效的數字');
            return;
        }

        setActionLoading(true);
        try {
            await API.updateTankCalibration(editingItem.tankId, {
                slope: s,
                intercept: i,
                note: editForm.note,
                reason: editForm.reason || '手動微調'
            });
            alert('公式更新成功！');
            setEditingItem(null);
            await loadData();
        } catch (e: any) {
            alert('更新失敗: ' + (e.message || String(e)));
        } finally {
            setActionLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 animate-fade-in">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[92vh]">
                {/* Header */}
                <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-600 rounded-lg text-white">
                            <Icons.Calculator className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold tracking-wide">PI 線上液位線性校正公式與歷程紀錄</h2>
                            <p className="text-xs text-slate-300">
                                線上 PI 數據轉換為桶槽現場液位（現場液位 = 斜率 a × PI液位 + 截距 b）
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                        <Icons.X className="w-5 h-5" />
                    </button>
                </div>

                {/* Navigation Tabs */}
                <div className="flex items-center justify-between border-b border-slate-200 px-6 bg-slate-50 shrink-0">
                    <div className="flex gap-2 pt-2">
                        <button
                            onClick={() => setActiveTab('formulas')}
                            className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
                                activeTab === 'formulas'
                                    ? 'border-blue-600 text-blue-600 bg-white rounded-t-lg'
                                    : 'border-transparent text-slate-500 hover:text-slate-800'
                            }`}
                        >
                            <Icons.Analysis className="w-4 h-4" />
                            目前回歸公式清單 ({calibrations.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('logs')}
                            className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
                                activeTab === 'logs'
                                    ? 'border-blue-600 text-blue-600 bg-white rounded-t-lg'
                                    : 'border-transparent text-slate-500 hover:text-slate-800'
                            }`}
                        >
                            <Icons.FileText className="w-4 h-4" />
                            調校歷程紀錄 ({logs.length})
                        </button>
                    </div>

                    {activeTab === 'formulas' && (
                        <div className="py-2 flex items-center gap-2">
                            <button
                                onClick={handleBackfill}
                                disabled={backfilling || actionLoading || loading}
                                className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5 shadow"
                                title="自 PI 歷史資料庫回補過去 35 天的線上儀表數據並自動執行線性回歸"
                            >
                                <Icons.Download className={`w-3.5 h-3.5 ${backfilling ? 'animate-spin' : ''}`} />
                                {backfilling ? '回補與回歸中...' : '回補 35 天歷史數據'}
                            </button>
                            <button
                                onClick={handleRecalculateAll}
                                disabled={backfilling || actionLoading || loading}
                                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 shadow"
                            >
                                <Icons.Recycle className={`w-3.5 h-3.5 ${actionLoading ? 'animate-spin' : ''}`} />
                                全部重新回歸計算
                            </button>
                            <button
                                onClick={loadData}
                                disabled={loading}
                                className="p-1.5 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-200 transition-colors"
                                title="重新整理"
                            >
                                <Icons.Recycle className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    )}
                </div>

                {/* Content Area */}
                <div className="p-6 overflow-auto grow bg-slate-100/50">
                    {loading ? (
                        <div className="py-20 text-center text-slate-400 font-medium">載入數據中...</div>
                    ) : activeTab === 'formulas' ? (
                        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                            <table className="min-w-full divide-y divide-slate-200">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">儲槽 / 系統</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">回歸校正公式 (y = ax + b)</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-600 uppercase">相關係數 R²</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-600 uppercase">殘差標準差 σ</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-600 uppercase">樣本數 / 模式</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">備註</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-600 uppercase">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                    {calibrations.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-8 text-center text-slate-400">尚無儲槽校正資料</td>
                                        </tr>
                                    ) : (
                                        calibrations.map((item) => {
                                            const sign = item.intercept >= 0 ? '+' : '-';
                                            const absInt = Math.abs(item.intercept).toFixed(2);
                                            const formulaDisplay = `現場液位 = ${item.slope.toFixed(3)} × PI ${sign} ${absInt} cm`;

                                            return (
                                                <tr key={item.tankId} className="hover:bg-slate-50 transition-colors">
                                                    <td className="px-4 py-3 whitespace-nowrap">
                                                        <div className="font-bold text-slate-800 text-sm">{item.tankName}</div>
                                                        <div className="text-[11px] text-slate-400">{item.system}</div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="font-mono text-sm font-bold text-blue-700 bg-blue-50 px-2 py-1 rounded inline-block">
                                                            {formulaDisplay}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-center whitespace-nowrap">
                                                        <span className="font-mono text-xs font-semibold text-slate-700">
                                                            {item.rSquared !== undefined ? item.rSquared.toFixed(3) : '-'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center whitespace-nowrap">
                                                        <span className="font-mono text-xs font-semibold text-slate-700">
                                                            {item.residualStd !== undefined ? `±${item.residualStd.toFixed(1)} cm` : '-'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center whitespace-nowrap">
                                                        <span className="text-xs text-slate-600 font-medium">{item.sampleCount} 筆</span>
                                                        <span className={`ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded ${
                                                            item.mode === 'MANUAL'
                                                                ? 'bg-amber-100 text-amber-700'
                                                                : 'bg-green-100 text-green-700'
                                                        }`}>
                                                            {item.mode === 'MANUAL' ? '手動設定' : item.mode === 'LINEAR' || (item.mode === 'AUTO' && item.rSquared !== undefined && item.sampleCount >= 7) ? '線性回歸' : item.sampleCount >= 3 ? '偏移校正' : '樣本不足'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[160px] truncate" title={item.note}>
                                                        {item.note || '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-center whitespace-nowrap">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <button
                                                                onClick={() => startEdit(item)}
                                                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded transition-colors flex items-center gap-1"
                                                            >
                                                                <Icons.FilePenLine className="w-3 h-3 text-slate-500" />
                                                                微調
                                                            </button>
                                                            <button
                                                                onClick={() => handleRecalculateSingle(item)}
                                                                disabled={actionLoading}
                                                                className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium rounded transition-colors flex items-center gap-1"
                                                                title="使用近期數據重新回歸"
                                                            >
                                                                <Icons.Recycle className="w-3 h-3 text-blue-600" />
                                                                重算
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        /* Logs Tab */
                        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                            <table className="min-w-full divide-y divide-slate-200">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">時間 (台北時間)</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">儲槽名稱</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-600 uppercase">調校動作</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">公式變更歷程</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">調整原因 / 備註</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                    {logs.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-8 text-center text-slate-400">尚無調校歷程紀錄</td>
                                        </tr>
                                    ) : (
                                        logs.map((log) => {
                                            const timeStr = log.createdAt
                                                ? new Date(log.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
                                                : '-';
                                            const oldFormula = log.oldSlope !== undefined
                                                ? `${log.oldSlope.toFixed(3)}x + ${log.oldIntercept?.toFixed(2)}`
                                                : '未設定';
                                            const newFormula = `${log.newSlope.toFixed(3)}x + ${log.newIntercept.toFixed(2)}`;

                                            return (
                                                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap font-mono">
                                                        {timeStr}
                                                    </td>
                                                    <td className="px-4 py-3 font-bold text-slate-800 text-sm whitespace-nowrap">
                                                        {log.tankName}
                                                    </td>
                                                    <td className="px-4 py-3 text-center whitespace-nowrap">
                                                        <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                                                            log.actionType === 'MANUAL_UPDATE'
                                                                ? 'bg-amber-100 text-amber-800'
                                                                : 'bg-blue-100 text-blue-800'
                                                        }`}>
                                                            {log.actionType === 'MANUAL_UPDATE' ? '手動微調' : log.actionType === 'RESET_INVALID_TAG' ? '錯配修復' : '自動校正'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 font-mono text-xs">
                                                        <span className="text-slate-400">{oldFormula}</span>
                                                        <span className="mx-2 text-slate-600 font-bold">➔</span>
                                                        <span className="text-blue-700 font-bold">{newFormula}</span>
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-slate-600">
                                                        {log.reason || '-'}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="bg-white px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0">
                    <div className="text-xs text-slate-500 flex items-center gap-1.5">
                        <Icons.Info className="w-4 h-4 text-blue-500 shrink-0" />
                        <span>校正公式每日前端輸入時自動比對，有助於降低液位計零點偏移誤差並抓出數值/欄位錯誤。</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-5 py-2 bg-slate-800 text-white font-bold text-sm rounded-lg hover:bg-slate-900 transition-colors"
                    >
                        關閉視窗
                    </button>
                </div>
            </div>

            {/* Edit Modal Sub-dialog */}
            {editingItem && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-[10000] p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-scale-up">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
                            <h3 className="font-bold text-slate-800 text-base">
                                手動微調校正公式：{editingItem.tankName}
                            </h3>
                            <button onClick={() => setEditingItem(null)} className="text-slate-400 hover:text-slate-600">
                                <Icons.X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    斜率 (Slope, a)
                                </label>
                                <input
                                    type="number"
                                    step="0.001"
                                    value={editForm.slope}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, slope: e.target.value }))}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-[11px] text-slate-400">一般接近 1.0 (例如 0.95 ~ 1.05)</span>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    截距 (Intercept, b) [公分]
                                </label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={editForm.intercept}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, intercept: e.target.value }))}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-[11px] text-slate-400">正負偏移量 (公分)</span>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    調整原因 / 歷程說明 (必填)
                                </label>
                                <input
                                    type="text"
                                    value={editForm.reason}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, reason: e.target.value }))}
                                    placeholder="例如：現場液位計校正調整後偏差修正"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    儲槽備註
                                </label>
                                <input
                                    type="text"
                                    value={editForm.note}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, note: e.target.value }))}
                                    placeholder="備註文字..."
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-100">
                            <button
                                onClick={() => setEditingItem(null)}
                                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600 text-xs font-medium hover:bg-slate-50"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleSaveEdit}
                                disabled={actionLoading}
                                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 shadow"
                            >
                                儲存並記錄歷程
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
