// API 服務層 - 連接到後端 PostgreSQL API
import type { InstrumentConsumableOpening, InstrumentManagementConfig, LiteInventoryItem } from '../types';

// 根據環境自動選擇 API 基礎路徑
// 開發環境: 指向生產伺服器 API（因為本地無法連接資料庫）
// 生產環境: /WTCA/api (透過 IIS 反向代理)
const isDev = window.location.hostname === 'localhost' && window.location.port !== '';
// Use relative path for both Dev (via Proxy) and Prod
const API_BASE_URL = '/WTCA/api';

// ==================== App Settings ====================

export const fetchAppSettings = async (): Promise<any> => {
    try {
        const response = await fetch(`${API_BASE_URL}/settings`);
        if (!response.ok) {
            throw new Error('Failed to fetch app settings');
        }
        return await response.json();
    } catch (error) {
        console.error('API fetchAppSettings error:', error);
        throw error;
    }
};

export const saveAppSettings = async (settings: any): Promise<any> => {
    try {
        const response = await fetch(`${API_BASE_URL}/settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(settings),
        });
        if (!response.ok) {
            throw new Error('Failed to save app settings');
        }
        return await response.json();
    } catch (error) {
        console.error('API saveAppSettings error:', error);
        throw error;
    }
};

// ==================== Tanks ====================

export const fetchTanks = async (): Promise<any[]> => {
    const response = await fetch(`${API_BASE_URL}/tanks`);
    if (!response.ok) throw new Error('Failed to fetch tanks');
    return await response.json();
};

export const createTank = async (tank: any): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/tanks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tank)
    });
    if (!response.ok) throw new Error('Failed to create tank');
    return await response.json();
};

export const createTanksBatch = async (tanks: any[]): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/tanks/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tanks)
    });
    if (!response.ok) throw new Error('Failed to create tanks batch');
    return await response.json();
};

export const updateTank = async (id: string, tank: any): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/tanks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tank)
    });
    if (!response.ok) throw new Error('Failed to update tank');
    return await response.json();
};

export const deleteTank = async (id: string): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/tanks/${id}`, {
        method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete tank');
    return await response.json();
};

export const reorderTanks = async (updates: { id: string, sort_order: number }[]): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/tanks-reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
    });
    if (!response.ok) throw new Error('Failed to reorder tanks');
    return await response.json();
};

// ==================== Readings ====================

export const fetchReadings = async (tankId?: string): Promise<any[]> => {
    const url = tankId
        ? `${API_BASE_URL}/readings?tankId=${tankId}`
        : `${API_BASE_URL}/readings`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch readings');
    const data = await response.json();
    return data;
};

export const createReading = async (reading: any): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reading)
    });
    if (!response.ok) throw new Error('Failed to create reading');
    return await response.json();
};

export const createReadingsBatch = async (readings: any[]): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/readings/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readings })
    });
    if (!response.ok) throw new Error('Failed to create readings batch');
    return await response.json();
};

export const updateReading = async (id: string, reading: any): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/readings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reading)
    });
    if (!response.ok) throw new Error('Failed to update reading');
    return await response.json();
};

export const deleteReading = async (id: string): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/readings/${id}`, {
        method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete reading');
    return await response.json();
};

// ==================== Chemical Supplies ====================

export const fetchSupplies = async (tankId?: string): Promise<any[]> => {
    const url = tankId
        ? `${API_BASE_URL}/supplies?tankId=${tankId}`
        : `${API_BASE_URL}/supplies`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch supplies');
    return await response.json();
};

export const createSupply = async (supply: any): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/supplies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supply)
    });
    if (!response.ok) throw new Error('Failed to create supply');
    return await response.json();
};

export const createSuppliesBatch = async (supplies: any[]): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/supplies/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplies })
    });
    if (!response.ok) throw new Error('Failed to create supplies batch');
    return await response.json();
};

export const updateSupply = async (id: string, supply: any): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/supplies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supply)
    });
    if (!response.ok) throw new Error('Failed to update supply');
    return await response.json();
};

export const deleteSupply = async (id: string): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/supplies/${id}`, {
        method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete supply');
    return await response.json();
};

// ==================== CWS Parameters ====================

export const fetchCWSParams = async (tankId: string): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/cws-params/${tankId}`);
    if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch CWS params');
    }
    return await response.json();
};

// New: Fetch CWS History
export const fetchCWSParamsHistory = async (tankId?: string): Promise<any> => {
    const targetId = tankId || 'all';
    const response = await fetch(`${API_BASE_URL}/cws-params/history/${targetId}`);
    if (!response.ok) throw new Error('Failed to fetch CWS params history');
    return await response.json();
};

export const saveCWSParams = async (params: any): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/cws-params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    if (!response.ok) throw new Error('Failed to save CWS params');
    return await response.json();
};

// New: Update CWS Params
export const updateCWSParams = async (params: any): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/cws-params/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    if (!response.ok) throw new Error('Failed to update CWS params');
    return await response.json();
};

export const deleteCWSParams = async (id: string): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/cws-params/${id}`, {
        method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete CWS params');
    return await response.json();
};

// --- BWS Params ---
export const fetchBWSParams = async (tankId: string): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/bws-params/${tankId}`);
    if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch BWS params');
    }
    return await response.json();
};

// New: Fetch BWS History
export const fetchBWSParamsHistory = async (tankId: string): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/bws-params/history/${tankId}`);
    if (!response.ok) throw new Error('Failed to fetch BWS params history');
    return await response.json();
};

export const saveBWSParams = async (params: any): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/bws-params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to save BWS params: ${response.status} ${errText}`);
    }
    return await response.json();
};

// New: Update BWS Params
export const updateBWSParams = async (params: any): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/bws-params/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    if (!response.ok) throw new Error('Failed to update BWS params');
    return await response.json();
};

export const deleteBWSParams = async (id: string): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/bws-params/${id}`, {
        method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete BWS params');
    return await response.json();
};


// ==================== Important Notes ====================

export const fetchNotes = async (): Promise<any[]> => {
    const response = await fetch(`${API_BASE_URL}/notes`);
    if (!response.ok) throw new Error('Failed to fetch notes');
    return await response.json();
};

export const createNote = async (note: any): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note)
    });
    if (!response.ok) throw new Error('Failed to create note');
    return await response.json();
};

export const updateNote = async (id: string, note: any): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/notes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note)
    });
    if (!response.ok) throw new Error('Failed to update note');
    return await response.json();
};

export const deleteNote = async (id: string): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/notes/${id}`, {
        method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete note');
    return await response.json();
};

export const createNotesBatch = async (notes: any[]): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/notes/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes })
    });
    if (!response.ok) throw new Error('Failed to create notes batch');
    return await response.json();
};

// ==================== Fluctuation Alerts ====================

export const fetchAlerts = async (): Promise<any[]> => {
    const response = await fetch(`${API_BASE_URL}/alerts`);
    if (!response.ok) throw new Error('Failed to fetch alerts');
    return await response.json();
};

export const createAlert = async (alert: any): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert)
    });
    if (!response.ok) throw new Error('Failed to create alert');
    return await response.json();
};

export const createAlertsBatch = async (alerts: any[]): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/alerts/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alerts })
    });
    if (!response.ok) throw new Error('Failed to create alerts batch');
    return await response.json();
};

export const updateAlert = async (id: string, note: string): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/alerts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note })
    });
    if (!response.ok) throw new Error('Failed to update alert');
    return await response.json();
};

export const deleteAlert = async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/alerts/${id}`, {
        method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete alert');
};

export const deleteAlertsBatch = async (ids: string[]): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/alerts/batch-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
    });
    if (!response.ok) throw new Error('Failed to batch delete alerts');
};

// ==================== Instrument Management ====================

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
    try {
        const data = await response.json();
        return data.message || data.error || fallback;
    } catch {
        return fallback;
    }
};

const getUnifiedUserHeaders = (): HeadersInit => {
    const userId =
        localStorage.getItem('unified_user_name') ||
        localStorage.getItem('pages_manual_user') ||
        localStorage.getItem('appUserName') ||
        '';
    // Fetch headers can only carry ISO-8859-1 compatible values. The unified header may
    // store a Chinese display name, which is not a permission identifier and breaks fetch.
    return userId && /^[\x20-\x7E]+$/.test(userId) ? { 'X-User-Id': userId } : {};
};

export const fetchInstrumentInventoryItems = async (query?: string): Promise<LiteInventoryItem[]> => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    const url = `${API_BASE_URL}/instrument-management/inventory-items${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await fetch(url, { headers: getUnifiedUserHeaders() });
    if (!response.ok) throw new Error(await readErrorMessage(response, '取得庫存物料失敗'));
    return await response.json();
};

export const fetchInstrumentConfigs = async (): Promise<InstrumentManagementConfig[]> => {
    const response = await fetch(`${API_BASE_URL}/instrument-management/configs`);
    if (!response.ok) throw new Error(await readErrorMessage(response, '取得儀器管理設定失敗'));
    return await response.json();
};

export const createInstrumentConfig = async (config: InstrumentManagementConfig): Promise<InstrumentManagementConfig> => {
    const response = await fetch(`${API_BASE_URL}/instrument-management/configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, '新增儀器管理設定失敗'));
    return await response.json();
};

export const updateInstrumentConfig = async (id: string, config: InstrumentManagementConfig): Promise<InstrumentManagementConfig> => {
    const response = await fetch(`${API_BASE_URL}/instrument-management/configs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, '更新儀器管理設定失敗'));
    return await response.json();
};

export const deleteInstrumentConfig = async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/instrument-management/configs/${id}`, {
        method: 'DELETE'
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, '刪除儀器管理設定失敗'));
};

export const fetchInstrumentOpenings = async (): Promise<InstrumentConsumableOpening[]> => {
    const response = await fetch(`${API_BASE_URL}/instrument-management/openings`);
    if (!response.ok) throw new Error(await readErrorMessage(response, '取得耗材開封紀錄失敗'));
    return await response.json();
};

export const createInstrumentOpening = async (opening: {
    configId?: string;
    consumableId?: string;
    consumableItemKey: string;
    openedDate: string;
    shelfLifeDays?: number | null;
}): Promise<InstrumentConsumableOpening> => {
    const response = await fetch(`${API_BASE_URL}/instrument-management/openings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opening)
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, '新增耗材開封紀錄失敗'));
    return await response.json();
};

export const updateInstrumentOpening = async (id: string, patch: Partial<InstrumentConsumableOpening>): Promise<InstrumentConsumableOpening> => {
    const response = await fetch(`${API_BASE_URL}/instrument-management/openings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, '更新耗材開封紀錄失敗'));
    return await response.json();
};

export const adjustInstrumentInventory = async (payload: {
    itemKey: string;
    diff: number;
    note?: string;
    refId?: string;
}): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/instrument-management/inventory-adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getUnifiedUserHeaders() },
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, '調整庫存失敗'));
    return await response.json();
};

export const runInstrumentExpiryCheck = async (): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/instrument-management/expiry-check`, { method: 'POST' });
    if (!response.ok) throw new Error(await readErrorMessage(response, '耗材到期檢查失敗'));
    return await response.json();
};

// ==================== Helper Functions ====================


// 取得指定時間點的有效藥劑合約
export const getActiveSupply = async (tankId: string, timestamp: number): Promise<any | null> => {
    const supplies = await fetchSupplies(tankId);
    const validSupplies = supplies
        .filter((s: any) => s.start_date <= timestamp)
        .sort((a: any, b: any) => b.start_date - a.start_date);
    return validSupplies.length > 0 ? validSupplies[0] : null;
};

// ==================== Manual Water Quality Readings ====================

export const fetchManualWaterQualityReadings = async (waterType?: string): Promise<any[]> => {
    try {
        const url = waterType
            ? `${API_BASE_URL}/manual-water-quality?waterType=${waterType}`
            : `${API_BASE_URL}/manual-water-quality`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Failed to fetch manual water quality readings');
        }
        return await response.json();
    } catch (error) {
        console.error('API fetchManualWaterQualityReadings error:', error);
        throw error;
    }
};

// ==================== Manual Water Quality Limits & Aliases (SSO Auth) ====================

// 取得控制標準
export const fetchManualWaterQualityLimits = async (): Promise<any[]> => {
    const response = await fetch(`${API_BASE_URL}/manual-water-quality/limits`);
    if (!response.ok) throw new Error('Failed to fetch manual water quality limits');
    return await response.json();
};

// 儲存/更新控制標準 (僅限管理者)
export const updateManualWaterQualityLimits = async (limits: any[], userId?: string): Promise<any> => {
    const url = userId
        ? `${API_BASE_URL}/manual-water-quality/limits?userId=${encodeURIComponent(userId)}`
        : `${API_BASE_URL}/manual-water-quality/limits`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(limits)
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to update manual water quality limits');
    }
    return await response.json();
};

// 取得指標名稱顯示別名
export const fetchManualWaterQualityAliases = async (): Promise<any[]> => {
    const response = await fetch(`${API_BASE_URL}/manual-water-quality/metric-aliases`);
    if (!response.ok) throw new Error('Failed to fetch manual water quality aliases');
    return await response.json();
};

// 儲存/更新指標名稱顯示別名 (僅限管理者)
export const updateManualWaterQualityAliases = async (aliases: any[], userId?: string): Promise<any> => {
    const url = userId
        ? `${API_BASE_URL}/manual-water-quality/metric-aliases?userId=${encodeURIComponent(userId)}`
        : `${API_BASE_URL}/manual-water-quality/metric-aliases`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aliases)
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to update manual water quality aliases');
    }
    return await response.json();
};

// 檢查目前使用者是否為網站管理者 (PIMCP SSO 權限判定)
export const checkManualWaterQualityAdmin = async (userId?: string): Promise<{ isAdmin: boolean, username: string }> => {
    const url = userId
        ? `${API_BASE_URL}/manual-water-quality/is-admin?userId=${encodeURIComponent(userId)}`
        : `${API_BASE_URL}/manual-water-quality/is-admin`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to check manual water quality admin status');
    return await response.json();
};
