# 後端 API 說明文件

## 啟動步驟

### 1. 安裝依賴套件
```bash
npm install
```

### 2. 設定資料庫連線
修改 `server.js` 中的資料庫連線設定：
```javascript
const pool = new Pool({
  user: 'postgres',      // 您的資料庫使用者名稱
  host: 'localhost',     // 資料庫主機
  database: 'wtca_db',   // 資料庫名稱
  password: 'password',  // 您的密碼
  port: 5432,
});
```

### 3. 初始化資料庫
```bash
node init_db.js
```

### 4. 啟動後端伺服器
```bash
npm run server
```

伺服器將運行於 `http://localhost:3000`

---

## API 端點列表

### 儲槽管理 (Tanks)

#### 取得所有儲槽
- **GET** `/api/tanks`
- **回應**: 儲槽列表（包含 CWS/BWS 參數）

#### 取得單一儲槽
- **GET** `/api/tanks/:id`
- **回應**: 單一儲槽資料

#### 新增儲槽
- **POST** `/api/tanks`
- **請求 Body**:
```json
{
  "id": "tank_001",
  "name": "CWS-1 槽",
  "system_type": "冷卻水系統",
  "capacity_liters": 5000,
  "geo_factor": 25.5,
  "description": "一階冷卻水儲槽",
  "safe_min_level": 20.0,
  "target_daily_usage": 100,
  "calculation_method": "CWS_BLOWDOWN"
}
```

#### 更新儲槽
- **PUT** `/api/tanks/:id`
- **請求 Body**: 同新增儲槽

---

### 液位紀錄 (Readings)

#### 取得液位紀錄
- **GET** `/api/readings?tankId=tank_001`
- **查詢參數**:
  - `tankId` (選填): 篩選特定儲槽的紀錄

#### 新增液位紀錄
- **POST** `/api/readings`
- **請求 Body**:
```json
{
  "id": "reading_001",
  "tank_id": "tank_001",
  "timestamp": 1673568000000,
  "level_cm": 150.5,
  "calculated_volume": 3837.75,
  "calculated_weight_kg": 3837.75,
  "applied_sg": 1.0,
  "supply_id": "supply_001",
  "added_amount_liters": 0,
  "operator_name": "張三"
}
```

#### 批次新增液位紀錄
- **POST** `/api/readings/batch`
- **請求 Body**:
```json
{
  "readings": [
    { /* reading 資料 */ },
    { /* reading 資料 */ }
  ]
}
```

---

### 藥劑合約 (Chemical Supplies)

#### 取得藥劑合約
- **GET** `/api/supplies?tankId=tank_001`
- **查詢參數**:
  - `tankId` (選填): 篩選特定儲槽的合約

#### 新增藥劑合約
- **POST** `/api/supplies`
- **請求 Body**:
```json
{
  "id": "supply_001",
  "tank_id": "tank_001",
  "supplier_name": "台塑化工",
  "chemical_name": "防蝕劑",
  "specific_gravity": 1.05,
  "price": 25.5,
  "start_date": 1673568000000,
  "notes": "一年期合約"
}
```

#### 批次新增藥劑合約
- **POST** `/api/supplies/batch`
- **請求 Body**:
```json
{
  "supplies": [
    { /* supply 資料 */ },
    { /* supply 資料 */ }
  ]
}
```

---

### 冷卻水參數 (CWS Parameters)

#### 取得冷卻水參數
- **GET** `/api/cws-params/:tankId`

#### 新增/更新冷卻水參數
- **POST** `/api/cws-params`
- **請求 Body**:
```json
{
  "tank_id": "tank_001",
  "circulation_rate": 500,
  "temp_outlet": 35,
  "temp_return": 30,
  "temp_diff": 5,
  "cws_hardness": 120,
  "makeup_hardness": 100,
  "concentration_cycles": 3,
  "target_ppm": 50
}
```

---

### 鍋爐水參數 (BWS Parameters)

#### 取得鍋爐水參數
- **GET** `/api/bws-params/:tankId`

#### 新增/更新鍋爐水參數
- **POST** `/api/bws-params`
- **請求 Body**:
```json
{
  "tank_id": "tank_002",
  "steam_production": 1000,
  "target_ppm": 100
}
```

---

### 健康檢查

#### 檢查後端與資料庫狀態
- **GET** `/api/health`
- **回應**:
```json
{
  "status": "ok",
  "message": "資料庫連線正常"
}
```

---

## 常見問題

### Q: 如何測試 API？
使用 Postman、curl 或瀏覽器插件測試各端點。例如：
```bash
curl http://localhost:3000/api/health
```

### Q: 如何讓前端呼叫這些 API？
修改前端的 `StorageService`，將 localStorage 操作改為 `fetch` 呼叫：
```javascript
async function getTanks() {
  const response = await fetch('http://localhost:3000/api/tanks');
  return await response.json();
}
```

### Q: 生產環境部署需要注意什麼？
1. 修改 CORS 設定，限制允許的來源
2. 使用環境變數管理資料庫密碼
3. 加入身份驗證機制（JWT 等）
4. 使用 PM2 或類似工具管理 Node.js 進程
