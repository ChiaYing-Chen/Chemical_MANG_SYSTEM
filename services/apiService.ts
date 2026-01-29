// API 服務層 - 連接到後端 PostgreSQL API

// 根據環境自動選擇 API 基礎路徑
// 開發環境: 指向生產伺服器 API（因為本地無法連接資料庫）
// 生產環境: /WTCA/api (透過 IIS 反向代理)
const isDev = window.location.hostname === 'localhost' && window.location.port !== '';
// Use relative path for both Dev (via Proxy) and Prod
const API_BASE_URL = '/WTCA/api';

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
export const fetchCWSParamsHistory = async (tankId: string): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/cws-params/history/${tankId}`);
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

export const deleteCWSParams = async (tankId: string): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/cws-params/${tankId}`, {
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

// ==================== Helper Functions ====================


// 取得指定時間點的有效藥劑合約
export const getActiveSupply = async (tankId: string, timestamp: number): Promise<any | null> => {
    const supplies = await fetchSupplies(tankId);
    const validSupplies = supplies
        .filter((s: any) => s.start_date <= timestamp)
        .sort((a: any, b: any) => b.start_date - a.start_date);
    return validSupplies.length > 0 ? validSupplies[0] : null;
};
