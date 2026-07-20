import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    adjustInstrumentInventory,
    createInstrumentConfig,
    createInstrumentOpening,
    deleteInstrumentConfig,
    fetchInstrumentConfigs,
    fetchInstrumentInventoryItems,
    fetchInstrumentOpenings,
    updateInstrumentConfig,
    updateInstrumentOpening
} from '../services/apiService';
import {
    InstrumentConsumableConfig,
    InstrumentConsumableOpening,
    InstrumentManagementConfig,
    InstrumentWaterType,
    LiteInventoryItem
} from '../types';
import { CalendarDays, PackageCheck, Plus, RefreshCw, Save, Trash2, Wrench } from 'lucide-react';

const todayTaipei = () => {
    const now = new Date();
    const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return taipei.toISOString().slice(0, 10);
};

const createTempId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const emptyConfig = (waterType: InstrumentWaterType, sortOrder: number): InstrumentManagementConfig => ({
    waterType,
    testItemKey: '',
    instrumentItemKey: '',
    note: '',
    sortOrder,
    consumables: []
});

const waterTypeMeta: Record<InstrumentWaterType, { label: string; tone: string; badge: string }> = {
    CW: {
        label: '冷卻水',
        tone: 'border-sky-200 bg-sky-50 text-sky-800',
        badge: 'bg-sky-100 text-sky-700 border-sky-200'
    },
    BW: {
        label: '鍋爐水',
        tone: 'border-amber-200 bg-amber-50 text-amber-800',
        badge: 'bg-amber-100 text-amber-700 border-amber-200'
    }
};

const itemTooltip = (item?: LiteInventoryItem) => {
    if (!item) return '尚未設定物料';
    return `料號：${item.partNo || '-'}\n儲位：${item.binCode || '-'}\n區域：${item.area || '-'}\n股別：${item.section || '-'}`;
};

const ItemSummary: React.FC<{ item?: LiteInventoryItem; placeholder?: string }> = ({ item, placeholder = '尚未設定' }) => {
    if (!item) return <span className="text-slate-400 text-xs">{placeholder}</span>;
    return (
        <span title={itemTooltip(item)} className="inline-flex max-w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs">
            <span className="truncate font-semibold text-slate-800">{item.name || item.key}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 font-bold ${item.quantity <= 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                {item.quantity}
            </span>
        </span>
    );
};

const InventoryPicker: React.FC<{
    value?: string;
    items: LiteInventoryItem[];
    itemMap: Map<string, LiteInventoryItem>;
    onChange: (key: string) => void;
    onItemsLoaded: (items: LiteInventoryItem[]) => void;
    placeholder?: string;
}> = ({ value, items, itemMap, onChange, onItemsLoaded, placeholder = '搜尋品名、料號或儲位' }) => {
    const [term, setTerm] = useState('');
    const [open, setOpen] = useState(false);
    const [options, setOptions] = useState<LiteInventoryItem[]>([]);
    const [searching, setSearching] = useState(false);
    const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const selected = value ? itemMap.get(value) : undefined;

    const updateDropdownPosition = () => {
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.min(Math.max(rect.width, 460), window.innerWidth - 24);
        const left = Math.min(Math.max(rect.left, 12), window.innerWidth - width - 12);
        const spaceBelow = window.innerHeight - rect.bottom - 12;
        const maxHeight = Math.max(220, Math.min(360, spaceBelow > 220 ? spaceBelow : rect.top - 18));
        const top = spaceBelow > 220 ? rect.bottom + 6 : Math.max(12, rect.top - maxHeight - 6);

        setDropdownStyle({
            position: 'fixed',
            top,
            left,
            width,
            maxHeight,
            zIndex: 10000
        });
    };

    useEffect(() => {
        if (!open) return;
        updateDropdownPosition();
        window.addEventListener('resize', updateDropdownPosition);
        window.addEventListener('scroll', updateDropdownPosition, true);
        return () => {
            window.removeEventListener('resize', updateDropdownPosition);
            window.removeEventListener('scroll', updateDropdownPosition, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node;
            if (wrapperRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
            setOpen(false);
            setTerm('');
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const query = term.trim();

        if (!query) {
            setOptions(items.slice(0, 20));
            return;
        }

        let active = true;
        setSearching(true);
        const timer = window.setTimeout(async () => {
            try {
                const result = await fetchInstrumentInventoryItems(query);
                if (!active) return;
                setOptions(result.slice(0, 50));
                onItemsLoaded(result);
            } catch {
                if (active) setOptions([]);
            } finally {
                if (active) setSearching(false);
            }
        }, 250);

        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [open, term, onItemsLoaded]);

    useEffect(() => {
        if (open) updateDropdownPosition();
    }, [options, open]);

    const dropdown = open ? createPortal(
        <div
            ref={dropdownRef}
            className="overflow-auto rounded-lg border border-slate-200 bg-white shadow-2xl"
            style={dropdownStyle}
            onMouseDown={event => event.preventDefault()}
        >
            {searching ? (
                <div className="px-3 py-4 text-center text-xs text-slate-400">搜尋中...</div>
            ) : options.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-slate-400">找不到符合的物料</div>
            ) : (
                options.map(item => (
                    <button
                        key={item.key}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                        title={itemTooltip(item)}
                        onClick={() => {
                            onItemsLoaded([item]);
                            onChange(item.key);
                            setOpen(false);
                            setTerm('');
                        }}
                    >
                        <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-slate-800">{item.name || item.key}</span>
                            <span className="block truncate text-[11px] text-slate-500">{item.partNo || '-'} / {item.binCode || '-'}</span>
                        </span>
                        <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{item.quantity}</span>
                    </button>
                ))
            )}
            <button
                type="button"
                className="sticky bottom-0 w-full border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800"
                onClick={() => {
                    setOpen(false);
                    setTerm('');
                }}
            >
                關閉
            </button>
        </div>,
        document.body
    ) : null;

    return (
        <div ref={wrapperRef} className="relative min-w-[14rem]">
            <input
                value={open ? term : selected ? `${selected.name || selected.key} / ${selected.quantity}` : ''}
                onFocus={() => {
                    setOpen(true);
                    setTerm('');
                    setOptions(items.slice(0, 20));
                }}
                onChange={event => {
                    setTerm(event.target.value);
                    setOpen(true);
                }}
                placeholder={placeholder}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                title={itemTooltip(selected)}
            />
            {value && (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    className="absolute right-2 top-2 text-xs font-bold text-slate-400 hover:text-slate-700"
                    title="清除"
                >
                    X
                </button>
            )}
            {dropdown}
        </div>
    );
};

const InstrumentManagementView: React.FC = () => {
    const [items, setItems] = useState<LiteInventoryItem[]>([]);
    const [configs, setConfigs] = useState<InstrumentManagementConfig[]>([]);
    const [openings, setOpenings] = useState<InstrumentConsumableOpening[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [message, setMessage] = useState<string>('');
    const [error, setError] = useState<string>('');

    const itemMap = useMemo(() => new Map(items.map(item => [item.key, item])), [items]);

    const mergeInventoryItems = useCallback((newItems: LiteInventoryItem[]) => {
        if (newItems.length === 0) return;
        setItems(prev => {
            const merged = new Map(prev.map(item => [item.key, item]));
            newItems.forEach(item => merged.set(item.key, item));
            return Array.from(merged.values());
        });
    }, []);

    const loadAll = async () => {
        setLoading(true);
        setError('');
        try {
            const [inventoryItems, configRows, openingRows] = await Promise.all([
                fetchInstrumentInventoryItems(),
                fetchInstrumentConfigs(),
                fetchInstrumentOpenings()
            ]);
            setItems(inventoryItems);
            setConfigs(configRows);
            setOpenings(openingRows);
        } catch (err: any) {
            setError(err.message || '載入儀器管理資料失敗');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAll();
    }, []);

    const updateConfig = (index: number, patch: Partial<InstrumentManagementConfig>) => {
        setConfigs(prev => prev.map((config, i) => i === index ? { ...config, ...patch } : config));
    };

    const updateConsumable = (configIndex: number, consumableIndex: number, patch: Partial<InstrumentConsumableConfig>) => {
        setConfigs(prev => prev.map((config, i) => {
            if (i !== configIndex) return config;
            return {
                ...config,
                consumables: config.consumables.map((item, cIndex) => cIndex === consumableIndex ? { ...item, ...patch } : item)
            };
        }));
    };

    const addConsumable = (configIndex: number) => {
        setConfigs(prev => prev.map((config, i) => {
            if (i !== configIndex) return config;
            return {
                ...config,
                consumables: [
                    ...config.consumables,
                    { id: `temp-${createTempId()}`, consumableItemKey: '', usageType: 'general', shelfLifeDays: null, sortOrder: config.consumables.length }
                ]
            };
        }));
    };

    const removeConsumable = (configIndex: number, consumableIndex: number) => {
        setConfigs(prev => prev.map((config, i) => {
            if (i !== configIndex) return config;
            return { ...config, consumables: config.consumables.filter((_, cIndex) => cIndex !== consumableIndex) };
        }));
    };

    const validateConfig = (config: InstrumentManagementConfig) => {
        const validConsumables = config.consumables.filter(item => item.consumableItemKey);
        if (!config.testItemKey && !config.instrumentItemKey && validConsumables.length === 0) {
            return '至少需設定檢驗項目、手持儀器或耗材其中一項';
        }
        if (config.instrumentItemKey && !validConsumables.some(item => item.usageType === 'calibration')) {
            return '有設定手持儀器時，必須設定至少一項校正耗材';
        }
        return '';
    };

    const saveConfig = async (config: InstrumentManagementConfig, index: number) => {
        const validationError = validateConfig(config);
        if (validationError) {
            setError(validationError);
            return;
        }

        const cleanConfig = {
            ...config,
            sortOrder: config.sortOrder ?? index,
            consumables: config.consumables
                .filter(item => item.consumableItemKey)
                .map((item, cIndex) => ({
                    ...item,
                    id: item.id?.startsWith('temp-') ? undefined : item.id,
                    shelfLifeDays: item.shelfLifeDays === null || item.shelfLifeDays === undefined ? null : Number(item.shelfLifeDays),
                    sortOrder: cIndex
                }))
        };

        setSavingId(config.id || `new-${index}`);
        setError('');
        try {
            const saved = config.id
                ? await updateInstrumentConfig(config.id, cleanConfig)
                : await createInstrumentConfig(cleanConfig);
            setConfigs(prev => prev.map((item, i) => i === index ? saved : item));
            setMessage('設定已儲存');
        } catch (err: any) {
            setError(err.message || '儲存失敗');
        } finally {
            setSavingId(null);
        }
    };

    const deleteConfigRow = async (config: InstrumentManagementConfig, index: number) => {
        if (!window.confirm('確定要刪除此筆設定嗎？')) return;
        if (!config.id) {
            setConfigs(prev => prev.filter((_, i) => i !== index));
            return;
        }
        try {
            await deleteInstrumentConfig(config.id);
            setConfigs(prev => prev.filter((_, i) => i !== index));
        } catch (err: any) {
            setError(err.message || '刪除失敗');
        }
    };

    const openConsumable = async (config: InstrumentManagementConfig, consumable: InstrumentConsumableConfig) => {
        if (!consumable.consumableItemKey) return;
        const openedDate = window.prompt('請輸入開封日期', todayTaipei());
        if (!openedDate) return;

        try {
            const opening = await createInstrumentOpening({
                configId: config.id,
                consumableId: consumable.id?.startsWith('temp-') ? undefined : consumable.id,
                consumableItemKey: consumable.consumableItemKey,
                openedDate,
                shelfLifeDays: consumable.shelfLifeDays
            });
            setOpenings(prev => [opening, ...prev]);

            if (window.confirm('是否同步調整 LiteInventory 庫存？')) {
                const diffText = window.prompt('請輸入庫存調整量，扣庫存請輸入負數', '-1');
                if (diffText) {
                    const result = await adjustInstrumentInventory({
                        itemKey: consumable.consumableItemKey,
                        diff: Number(diffText),
                        refId: opening.id,
                        note: 'WTCA 儀器管理耗材開封'
                    });
                    const updated = await updateInstrumentOpening(opening.id, {
                        adjustedInventory: true,
                        inventoryAdjustLogId: result.logId
                    });
                    setOpenings(prev => prev.map(item => item.id === updated.id ? updated : item));
                    await loadAll();
                }
            }
            setMessage('耗材開封紀錄已建立');
        } catch (err: any) {
            setError(err.message || '開封耗材失敗');
        }
    };

    const renderSection = (waterType: InstrumentWaterType) => {
        const rows = configs
            .map((config, index) => ({ config, index }))
            .filter(({ config }) => config.waterType === waterType);
        const meta = waterTypeMeta[waterType];

        return (
            <section className="space-y-4">
                <div className={`flex items-center justify-between rounded-lg border px-4 py-3 ${meta.tone}`}>
                    <div className="flex items-center gap-3">
                        <PackageCheck className="h-5 w-5" />
                        <h2 className="text-lg font-bold">{meta.label}</h2>
                    </div>
                    <button
                        type="button"
                        onClick={() => setConfigs(prev => [...prev, emptyConfig(waterType, prev.filter(item => item.waterType === waterType).length)])}
                        className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                        <Plus className="h-4 w-4" />
                        新增
                    </button>
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                    <table className="min-w-[1120px] w-full border-collapse text-left text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-500">
                                <th className="w-[18%] px-4 py-3">檢驗項目</th>
                                <th className="w-[18%] px-4 py-3">手持儀器</th>
                                <th className="w-[34%] px-4 py-3">對應耗材</th>
                                <th className="w-[18%] px-4 py-3">備註</th>
                                <th className="w-[12%] px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">尚未建立設定</td>
                                </tr>
                            ) : rows.map(({ config, index }) => (
                                <tr key={config.id || `new-${index}`} className="align-top">
                                    <td className="px-4 py-3">
                                        <div className="space-y-2">
                                            <input
                                                type="text"
                                                value={config.testItemKey}
                                                onChange={event => updateConfig(index, { testItemKey: event.target.value })}
                                                placeholder="例如：pH、電導度、餘氯"
                                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                                            />
                                            <span className="block text-xs text-slate-400">對應手動輸入欄位</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="space-y-2">
                                            <InventoryPicker
                                                value={config.instrumentItemKey}
                                                items={items}
                                                itemMap={itemMap}
                                                onItemsLoaded={mergeInventoryItems}
                                                onChange={key => updateConfig(index, { instrumentItemKey: key })}
                                            />
                                            <ItemSummary item={itemMap.get(config.instrumentItemKey)} />
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="space-y-3">
                                            {config.consumables.map((consumable, cIndex) => (
                                                <div key={consumable.id || cIndex} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                                    <div className="grid grid-cols-[1fr_auto_auto_auto] items-start gap-2">
                                                        <div className="space-y-2">
                                                            <InventoryPicker
                                                                value={consumable.consumableItemKey}
                                                                items={items}
                                                                itemMap={itemMap}
                                                                onItemsLoaded={mergeInventoryItems}
                                                                onChange={key => updateConsumable(index, cIndex, { consumableItemKey: key })}
                                                            />
                                                            <ItemSummary item={itemMap.get(consumable.consumableItemKey)} />
                                                        </div>
                                                        <select
                                                            value={consumable.usageType}
                                                            onChange={event => updateConsumable(index, cIndex, { usageType: event.target.value as any })}
                                                            className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-700"
                                                        >
                                                            <option value="calibration">校正耗材</option>
                                                            <option value="general">一般耗材</option>
                                                        </select>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={consumable.shelfLifeDays ?? ''}
                                                            onChange={event => updateConsumable(index, cIndex, { shelfLifeDays: event.target.value === '' ? null : Number(event.target.value) })}
                                                            placeholder="保存天數"
                                                            className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs text-slate-700"
                                                        />
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => openConsumable(config, consumable)}
                                                                disabled={!consumable.consumableItemKey}
                                                                className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                                                                title="開封耗材"
                                                            >
                                                                <CalendarDays className="h-4 w-4" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => removeConsumable(index, cIndex)}
                                                                className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700 hover:bg-red-100"
                                                                title="移除耗材"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => addConsumable(index)}
                                                className="inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                            >
                                                <Plus className="h-4 w-4" />
                                                新增耗材
                                            </button>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <textarea
                                            value={config.note || ''}
                                            onChange={event => updateConfig(index, { note: event.target.value })}
                                            rows={4}
                                            className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() => saveConfig(config, index)}
                                                disabled={savingId === (config.id || `new-${index}`)}
                                                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                                            >
                                                <Save className="h-4 w-4" />
                                                儲存
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => deleteConfigRow(config, index)}
                                                className="rounded-lg border border-red-200 bg-white p-2 text-red-600 hover:bg-red-50"
                                                title="刪除"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        );
    };

    const dueSoonOpenings = openings
        .filter(opening => opening.status === 'OPEN')
        .sort((a, b) => String(a.expiresDate || '').localeCompare(String(b.expiresDate || '')));

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-slate-100 p-2 text-slate-700">
                        <Wrench className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">儀器管理</h1>
                        <p className="text-sm text-slate-500">手持儀器、檢驗項目與耗材開封期限管理</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={loadAll}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    重新整理
                </button>
            </div>

            {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</div>}
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

            {loading ? (
                <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-slate-500">載入儀器管理資料...</div>
            ) : (
                <>
                    {renderSection('CW')}
                    {renderSection('BW')}

                    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                            <h2 className="text-base font-bold text-slate-800">耗材開封紀錄</h2>
                            <span className="text-xs text-slate-500">共 {dueSoonOpenings.length} 筆未結案</span>
                        </div>
                        <div className="max-h-80 overflow-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="sticky top-0 bg-slate-50 text-xs font-bold text-slate-500">
                                    <tr>
                                        <th className="px-4 py-3">耗材</th>
                                        <th className="px-4 py-3">開封日</th>
                                        <th className="px-4 py-3">到期日</th>
                                        <th className="px-4 py-3">庫存</th>
                                        <th className="px-4 py-3 text-right">狀態</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {dueSoonOpenings.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-8 text-center text-slate-400">沒有未結案開封紀錄</td>
                                        </tr>
                                    ) : dueSoonOpenings.map(opening => {
                                        const item = itemMap.get(opening.consumableItemKey);
                                        const expired = opening.expiresDate ? opening.expiresDate <= todayTaipei() : false;
                                        return (
                                            <tr key={opening.id}>
                                                <td className="px-4 py-3"><ItemSummary item={item} placeholder={opening.consumableItemKey} /></td>
                                                <td className="px-4 py-3 text-slate-600">{opening.openedDate}</td>
                                                <td className={`px-4 py-3 font-semibold ${expired ? 'text-red-600' : 'text-slate-700'}`}>{opening.expiresDate || '-'}</td>
                                                <td className="px-4 py-3 text-slate-600">{opening.adjustedInventory ? '已調整' : '未調整'}</td>
                                                <td className="px-4 py-3 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={async () => {
                                                            const updated = await updateInstrumentOpening(opening.id, { status: 'CLOSED' });
                                                            setOpenings(prev => prev.map(item => item.id === updated.id ? updated : item));
                                                        }}
                                                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                                    >
                                                        結案
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
};

export default InstrumentManagementView;
