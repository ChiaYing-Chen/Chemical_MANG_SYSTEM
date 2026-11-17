import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChemicalSupply, Tank } from '../types';
import { StorageService } from '../services/storageService';
import { calculateLevelDifferenceUsage, getRecentSupplyOptions } from '../utils/calculationUtils';
import { Icons } from './Icons';

interface TankCardData extends Tank {
    lastReading?: {
        levelCm: number;
        calculatedVolume: number;
        calculatedWeightKg: number;
        appliedSpecificGravity: number;
        timestamp: number;
    };
}

interface LevelUsageCalculatorModalProps {
    tank: TankCardData;
    onClose: () => void;
}

const parseNonNegativeLevel = (raw: string): { valid: boolean; value: number | null; error?: string } => {
    const trimmed = raw.trim();
    if (trimmed === '') return { valid: true, value: null };
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
        return { valid: false, value: null, error: '請輸入有效數字' };
    }
    if (parsed < 0) {
        return { valid: false, value: null, error: '液位不可小於 0 cm' };
    }
    return { valid: true, value: parsed };
};

const formatTaipeiDate = (timestamp: number): string => {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
    return new Date(timestamp).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
};

export const LevelUsageCalculatorModal: React.FC<LevelUsageCalculatorModalProps> = ({ tank, onClose }) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const startInputId = useId();
    const endInputId = useId();
    const startErrorId = useId();
    const endErrorId = useId();
    const sgSelectId = useId();

    const [startLevelInput, setStartLevelInput] = useState('');
    const [endLevelInput, setEndLevelInput] = useState('');
    const [startTouched, setStartTouched] = useState(false);
    const [endTouched, setEndTouched] = useState(false);

    const [recentSupplies, setRecentSupplies] = useState<ChemicalSupply[]>([]);
    const [selectedSupplyId, setSelectedSupplyId] = useState<string>('');
    const [loadingSupplies, setLoadingSupplies] = useState(true);

    const fallbackSg = tank.lastReading?.appliedSpecificGravity || 1;
    const latestLevelCm = tank.lastReading?.levelCm;

    // 開啟原生 <dialog> modal，並為不支援 closedby 的瀏覽器提供點擊背景關閉 fallback
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        if (!dialog.open) {
            dialog.showModal();
        }

        if ('closedBy' in HTMLDialogElement.prototype) return;

        const isOutside = (e: PointerEvent) => {
            const rect = dialog.getBoundingClientRect();
            return (
                e.clientX < rect.left ||
                e.clientX > rect.right ||
                e.clientY < rect.top ||
                e.clientY > rect.bottom
            );
        };

        let pressedOutside = false;
        const handlePointerDown = (e: PointerEvent) => {
            pressedOutside = isOutside(e);
        };
        const handlePointerUp = (e: PointerEvent) => {
            if (pressedOutside && isOutside(e)) {
                dialog.close();
            }
            pressedOutside = false;
        };

        dialog.addEventListener('pointerdown', handlePointerDown);
        dialog.addEventListener('pointerup', handlePointerUp);
        return () => {
            dialog.removeEventListener('pointerdown', handlePointerDown);
            dialog.removeEventListener('pointerup', handlePointerUp);
        };
    }, []);

    // 載入該桶槽最近 4 筆藥劑批次比重
    useEffect(() => {
        let isMounted = true;
        const loadSupplies = async () => {
            setLoadingSupplies(true);
            try {
                const supplies = await StorageService.getSupplies(tank.id);
                if (!isMounted) return;
                const recent = getRecentSupplyOptions(supplies, tank.id, 4);
                setRecentSupplies(recent);
                setSelectedSupplyId(recent.length > 0 ? recent[0].id : '__fallback__');
            } finally {
                if (isMounted) setLoadingSupplies(false);
            }
        };
        loadSupplies();
        return () => {
            isMounted = false;
        };
    }, [tank.id]);

    const handleNativeClose = () => {
        const dialog = dialogRef.current;
        if (dialog) {
            dialog.returnValue = '';
        }
        onClose();
    };

    const requestClose = () => {
        dialogRef.current?.close();
    };

    const selectedSg = useMemo(() => {
        const found = recentSupplies.find(s => s.id === selectedSupplyId);
        return found ? found.specificGravity : fallbackSg;
    }, [recentSupplies, selectedSupplyId, fallbackSg]);

    const startParsed = useMemo(() => parseNonNegativeLevel(startLevelInput), [startLevelInput]);
    const endParsed = useMemo(() => parseNonNegativeLevel(endLevelInput), [endLevelInput]);

    const showStartError = startTouched && !startParsed.valid;
    const showEndError = endTouched && !endParsed.valid;

    const calculation = useMemo(() => {
        if (!startParsed.valid || !endParsed.valid) return null;
        if (startParsed.value === null || endParsed.value === null) return null;
        return calculateLevelDifferenceUsage(tank, startParsed.value, endParsed.value, selectedSg);
    }, [tank, startParsed, endParsed, selectedSg]);

    const handleClear = () => {
        setStartLevelInput('');
        setEndLevelInput('');
        setStartTouched(false);
        setEndTouched(false);
    };

    return (
        <dialog
            ref={dialogRef}
            closedby="any"
            aria-labelledby={titleId}
            className="level-calc-dialog"
            onClose={handleNativeClose}
        >
            <div className="overflow-hidden">
                <div className="trend-modal-header px-6 py-4 border-b flex items-center justify-between gap-3">
                    <h2 id={titleId} className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Icons.Calculator className="w-5 h-5 text-sky-400 shrink-0" />
                        <span>液位差用量換算 - {tank.name}</span>
                    </h2>
                    <button
                        type="button"
                        onClick={requestClose}
                        aria-label="關閉"
                        className="text-slate-400 hover:text-slate-200 p-1 rounded-lg transition-colors"
                    >
                        <Icons.X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={e => e.preventDefault()} className="p-6 space-y-5">
                    <div className="bg-slate-50 rounded-lg p-3.5 text-xs flex flex-wrap items-center justify-between gap-2 border border-slate-200">
                        <span className="text-slate-500">
                            目前最新液位：
                            <strong className="text-slate-800 ml-1">
                                {latestLevelCm !== undefined ? `${latestLevelCm} cm` : '無紀錄'}
                            </strong>
                        </span>
                        <span className="text-slate-500">
                            目前換算比重：
                            <strong className="text-sky-400 ml-1">{selectedSg}</strong>
                        </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-2">
                                <label htmlFor={startInputId} className="text-sm font-medium text-slate-700">
                                    起始液位 (cm)
                                </label>
                                {latestLevelCm !== undefined && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setStartLevelInput(String(latestLevelCm));
                                            setStartTouched(true);
                                        }}
                                        className="text-xs text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
                                    >
                                        帶入目前
                                    </button>
                                )}
                            </div>
                            <input
                                id={startInputId}
                                name="startLevelCm"
                                type="number"
                                step="any"
                                min="0"
                                inputMode="decimal"
                                enterKeyHint="next"
                                autoFocus
                                value={startLevelInput}
                                onChange={e => setStartLevelInput(e.target.value)}
                                onBlur={() => setStartTouched(true)}
                                aria-invalid={showStartError ? 'true' : undefined}
                                aria-describedby={showStartError ? startErrorId : undefined}
                                placeholder={latestLevelCm !== undefined ? `例: ${latestLevelCm}` : '例: 142'}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 min-h-[44px]"
                            />
                            {showStartError && (
                                <span id={startErrorId} className="text-xs text-red-500" role="alert">
                                    {startParsed.error}
                                </span>
                            )}
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-2">
                                <label htmlFor={endInputId} className="text-sm font-medium text-slate-700">
                                    結束液位 (cm)
                                </label>
                                {latestLevelCm !== undefined && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEndLevelInput(String(latestLevelCm));
                                            setEndTouched(true);
                                        }}
                                        className="text-xs text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
                                    >
                                        帶入目前
                                    </button>
                                )}
                            </div>
                            <input
                                id={endInputId}
                                name="endLevelCm"
                                type="number"
                                step="any"
                                min="0"
                                inputMode="decimal"
                                enterKeyHint="done"
                                value={endLevelInput}
                                onChange={e => setEndLevelInput(e.target.value)}
                                onBlur={() => setEndTouched(true)}
                                aria-invalid={showEndError ? 'true' : undefined}
                                aria-describedby={showEndError ? endErrorId : undefined}
                                placeholder="例: 120"
                                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 min-h-[44px]"
                            />
                            {showEndError && (
                                <span id={endErrorId} className="text-xs text-red-500" role="alert">
                                    {endParsed.error}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label htmlFor={sgSelectId} className="text-sm font-medium text-slate-700">
                            換算比重（最近 4 筆批次）
                        </label>
                        <select
                            id={sgSelectId}
                            name="specificGravityId"
                            value={selectedSupplyId}
                            onChange={e => setSelectedSupplyId(e.target.value)}
                            disabled={loadingSupplies}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 min-h-[44px]"
                        >
                            {loadingSupplies ? (
                                <option value="">載入比重紀錄中...</option>
                            ) : recentSupplies.length > 0 ? (
                                recentSupplies.map((supply, index) => (
                                    <option key={supply.id} value={supply.id}>
                                        {index === 0 ? '最新｜' : `第 ${index + 1} 筆｜`}
                                        比重 {supply.specificGravity}（{formatTaipeiDate(supply.startDate)}
                                        {supply.supplierName ? ` · ${supply.supplierName}` : ''}）
                                    </option>
                                ))
                            ) : (
                                <option value="__fallback__">
                                    預設比重 {fallbackSg}（尚無批次紀錄）
                                </option>
                            )}
                        </select>
                    </div>

                    <div className="computed-output border rounded-xl p-4 space-y-3" aria-live="polite">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <div className="text-xs text-slate-400">液位差（起始 - 結束）</div>
                                <div className={`text-lg font-bold mt-0.5 ${calculation && calculation.levelDiffCm < 0 ? 'text-amber-400' : 'text-slate-800'}`}>
                                    {calculation ? `${calculation.levelDiffCm.toFixed(2)} cm` : '--'}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-xs text-slate-400">體積差</div>
                                <div className="text-lg font-bold text-slate-800 mt-0.5">
                                    {calculation ? `${calculation.volumeDiffL.toFixed(1)} L` : '--'}
                                </div>
                            </div>
                        </div>

                        <div className="border-t border-slate-200 pt-3 flex items-baseline justify-between gap-2">
                            <div>
                                <div className="text-xs text-slate-400">換算用量</div>
                                {calculation && (
                                    <div className="text-[11px] text-slate-400 mt-0.5">
                                        {calculation.startVolumeL.toFixed(1)} L → {calculation.endVolumeL.toFixed(1)} L × SG {selectedSg}
                                    </div>
                                )}
                            </div>
                            <div className={`text-2xl font-bold ${calculation ? (calculation.usageKg < 0 ? 'text-amber-400' : 'text-sky-400') : 'text-slate-500'}`}>
                                {calculation ? `${calculation.usageKg.toFixed(1)} kg` : '--'}
                            </div>
                        </div>

                        {!calculation && (
                            <p className="text-xs text-slate-400">
                                請輸入起始與結束液位，系統會依儲槽幾何形狀換算體積與重量。
                            </p>
                        )}
                        {calculation && calculation.levelDiffCm < 0 && (
                            <p className="text-xs text-amber-400">
                                提示：結束液位高於起始液位，差值為負（液位上升）。
                            </p>
                        )}
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-200">
                        <button
                            type="button"
                            onClick={handleClear}
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                        >
                            清除
                        </button>
                        <button
                            type="button"
                            onClick={requestClose}
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white transition-colors"
                        >
                            關閉
                        </button>
                    </div>
                </form>
            </div>
        </dialog>
    );
};
