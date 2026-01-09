# 系統資料庫遷移計畫 (Mock DB -> PostgreSQL)

## 1. 現況分析 (As-Is)
經過程式碼 (`App.tsx`, `types.ts`) 檢查，目前的應用程式架構如下：
- **資料庫**: 採用前端模擬 (Mock Database) 或瀏覽器 `LocalStorage`，並非真實的後端資料庫。
- **資料存取**: `StorageService` 使用同步 (Synchronous) 方法存取資料，這確認了資料僅存在於前端。
- **限制**: 資料無法跨裝置共享，且瀏覽器快取清除後資料會遺失。

## 2. 遷移目標 (To-Be)
將資料儲存層移轉至 **PostgreSQL**，需要進行架構調整：
1. **建立後端 API Server**: 作為前端與資料庫的中介 (例如使用 Node.js + Express 或 NestJS)。
2. **建置 PostgreSQL 資料庫**: 執行 SQL Schema 建立表格。
3. **前端重構**: 將 `StorageService` 改寫為非同步 (Async)，並透過 API (Fetch/Axios) 呼叫後端。

---

## 3. PostgreSQL 資料庫建置指南 (SQL Schema)

請在 PostgreSQL 資料庫中執行以下 SQL 指令，以建立對應 TypeScript `types.ts` 的資料表結構。

### 3.1 建立主要表格

#### A. 儲槽基本資料 (Tanks)
對應 `Tank` 介面。
```sql
CREATE TABLE tanks (
    id VARCHAR(50) PRIMARY KEY, -- 或改用 SERIAL/UUID
    name VARCHAR(100) NOT NULL,
    system_type VARCHAR(50) NOT NULL, -- Coolling, Boiler, etc.
    capacity_liters NUMERIC(10, 2) NOT NULL,
    geo_factor NUMERIC(10, 4) NOT NULL, -- Factor
    description TEXT,
    safe_min_level NUMERIC(5, 2) DEFAULT 20.0,
    target_daily_usage NUMERIC(10, 2),
    calculation_method VARCHAR(50)
);

-- 建立索引以加速查詢
CREATE INDEX idx_tanks_system ON tanks(system_type);
```

#### B. 藥劑合約/供應商 (Chemical Supplies)
對應 `ChemicalSupply` 介面。
```sql
CREATE TABLE chemical_supplies (
    id VARCHAR(50) PRIMARY KEY,
    tank_id VARCHAR(50) NOT NULL REFERENCES tanks(id),
    supplier_name VARCHAR(100) NOT NULL,
    chemical_name VARCHAR(100),
    specific_gravity NUMERIC(6, 4) NOT NULL, -- 比重
    price NUMERIC(10, 2),
    start_date BIGINT NOT NULL, -- 儲存 Timestamp (毫秒) 或改用 TIMESTAMP 型別
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_supplies_tank ON chemical_supplies(tank_id);
```

#### C. 液位抄表紀錄 (Readings)
對應 `Reading` 介面。
```sql
CREATE TABLE readings (
    id VARCHAR(50) PRIMARY KEY,
    tank_id VARCHAR(50) NOT NULL REFERENCES tanks(id),
    timestamp BIGINT NOT NULL, -- 抄表時間 (Timestamp)
    level_cm NUMERIC(10, 2) NOT NULL,
    calculated_volume NUMERIC(10, 2) NOT NULL,
    calculated_weight_kg NUMERIC(10, 2) NOT NULL,
    applied_sg NUMERIC(6, 4) NOT NULL, -- 當下使用的比重
    supply_id VARCHAR(50) REFERENCES chemical_supplies(id), -- 連結到當時的合約
    added_amount_liters NUMERIC(10, 2) DEFAULT 0,
    operator_name VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_readings_tank_time ON readings(tank_id, timestamp DESC);
```

### 3.2 建立參數表格 (Parameters)

#### D. 冷卻水參數 (CWS Parameters)
對應 `CWSParameterRecord` (推測與 Tank 為 1:1 或 1:N，此處以 Tank ID 為主鍵範例)。
```sql
CREATE TABLE cws_parameters (
    tank_id VARCHAR(50) PRIMARY KEY REFERENCES tanks(id),
    circulation_rate NUMERIC(10, 2), -- R
    temp_outlet NUMERIC(5, 2), -- T1
    temp_return NUMERIC(5, 2), -- T2
    temp_diff NUMERIC(5, 2), -- Delta T
    cws_hardness NUMERIC(10, 2),
    makeup_hardness NUMERIC(10, 2),
    concentration_cycles NUMERIC(5, 2),
    target_ppm NUMERIC(10, 2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### E. 鍋爐水參數 (BWS Parameters)
對應 `BWSParameterRecord`。
```sql
CREATE TABLE bws_parameters (
    tank_id VARCHAR(50) PRIMARY KEY REFERENCES tanks(id),
    steam_production NUMERIC(10, 2), -- Steam
    target_ppm NUMERIC(10, 2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. 下一步建議 (Next Steps)

要在「PostgreSQL 端」完成準備後，你需要進行以下工作：

1.  **資料庫連線**: 確認你的後端伺服器 (Node.js/Python) 可以連線到此 PostgreSQL 資料庫 (設定 Host, Port, User, Password)。
2.  **API 開發**:
    - 開發 `GET /api/tanks` (讀取儲槽)
    - 開發 `POST /api/readings` (寫入抄表)
    - 開發 `GET /api/history/:tankId` (讀取歷史)
3.  **前端介接**: 修改 `App.tsx` 中的 `StorageService`，將原本存取 LocalStorage 的程式碼替換為 `fetch` API 呼叫。

我還可以協助你：
- 撰寫 Node.js (Express) 的後端程式碼範本。
- 修改前端 `StorageService` 使其能夠呼叫真實 API。
