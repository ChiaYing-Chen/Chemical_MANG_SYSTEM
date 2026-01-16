# 遠端伺服器部署指南 (IIS + PostgreSQL)

## 伺服器環境資訊
- **部署路徑**: `C:\inetpub\wwwroot\WTCA`
- **Node.js 後端**: 運行於 Port 3003
- **資料庫**: PostgreSQL (Port 5432)
- **IIS**: 作為反向代理

---

## 一、部署前準備

### 1. 確認伺服器已安裝
- Windows Server (建議 2019 或更新版本)
- IIS 10.0+ (包含 URL Rewrite 和 Application Request Routing)
- Node.js 18.x+ 
- PostgreSQL 14.x+

### 2. IIS 模組安裝
在 IIS Manager 中確認已安裝：
- **URL Rewrite Module**: [下載連結](https://www.iis.net/downloads/microsoft/url-rewrite)
- **Application Request Routing (ARR)**: [下載連結](https://www.iis.net/downloads/microsoft/application-request-routing)

安裝 ARR 後，啟用反向代理功能：
1. 打開 IIS Manager → 伺服器名稱 → Application Request Routing Cache
2. Server Proxy Settings → 勾選 **Enable proxy**
3. Time-out 設定為 **300 秒** (或更長)

---

## 二、檔案部署

### 1. 上傳檔案
將以下檔案上傳至 `C:\inetpub\wwwroot\WTCA`：

```
C:\inetpub\wwwroot\WTCA\
├── server.js              (後端主程式)
├── init_db.js             (資料庫初始化)
├── package.json           (依賴清單)
├── web.config             (IIS 配置)
├── migration_guide.md     (資料庫遷移文件)
├── API_README.md          (API 文件)
└── mcp_config.example.json (MCP Client 配置範例)
```

### 2. 安裝依賴套件
開啟 PowerShell (以管理員身分)，切換到專案目錄：

```powershell
cd C:\inetpub\wwwroot\WTCA
npm install
```

---

## 三、PostgreSQL 資料庫設定

### 1. 建立資料庫
登入 PostgreSQL：
```bash
psql -U postgres
```

執行以下 SQL：
```sql
CREATE DATABASE "WTCA";
CREATE USER pagesuser WITH PASSWORD 'P@ssw0rd';
GRANT ALL PRIVILEGES ON DATABASE "WTCA" TO pagesuser;
\q
```

### 2. 初始化表格
```powershell
node init_db.js
```

如果看到「所有表格建立完成！」訊息，表示成功。

---

## 四、將 Node.js 註冊為 Windows 服務

使用 `node-windows` 或 `PM2-Windows` 讓 Node.js 應用程式開機自啟動。

### 方法一：使用 PM2 (推薦)

1. 安裝 PM2 和 PM2-Windows-Service：
```powershell
npm install -g pm2
npm install -g pm2-windows-service
```

2. 註冊為 Windows 服務：
```powershell
pm2-service-install
```

3. 啟動應用程式：
```powershell
cd C:\inetpub\wwwroot\WTCA
pm2 start server.js --name "WTCA-Backend"
pm2 save
```

4. 確認狀態：
```powershell
pm2 list
```

### 方法二：使用 NSSM

1. 下載 NSSM: https://nssm.cc/download
2. 解壓縮後執行：
```powershell
nssm install WTCA-Backend
```

3. 在 GUI 中設定：
   - **Path**: `C:\Program Files\nodejs\node.exe`
   - **Startup directory**: `C:\inetpub\wwwroot\WTCA`
   - **Arguments**: `server.js`
   - **Service name**: `WTCA-Backend`

4. 啟動服務：
```powershell
nssm start WTCA-Backend
```

---

## 五、IIS 設定

### 1. 建立網站或應用程式
在 IIS Manager 中：
1. 右鍵 **Sites** → **Add Website** (或在現有網站下新增 Application)
2. 網站名稱: `WTCA`
3. 實體路徑: `C:\inetpub\wwwroot\WTCA`
4. 繫結設定:
   - Type: **http**
   - Port: **80** (或其他可用 port)
   - Host name: 留空或設定特定網域

### 2. 確認 `web.config` 正確放置
確保 `C:\inetpub\wwwroot\WTCA\web.config` 存在，並且內容正確配置 URL Rewrite 到 `http://localhost:3003`。

### 3. 設定應用程式池 (Application Pool)
1. 選擇 WTCA 的應用程式池
2. .NET CLR 版本: **No Managed Code** (因為是 Node.js)
3. Identity: **ApplicationPoolIdentity** 或 **NetworkService**

---

## 六、網路與防火牆設定

### 1. 開放防火牆 Port (如果需要外部訪問)
```powershell
New-NetFirewallRule -DisplayName "WTCA-HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

### 2. 確認 Node.js 可以連線到 PostgreSQL
測試連線：
```powershell
cd C:\inetpub\wwwroot\WTCA
node -e "import('pg').then(({default: pg}) => { const client = new pg.Client({user:'pagesuser',host:'localhost',database:'WTCA',password:'P@ssw0rd',port:5432}); client.connect().then(() => console.log('✓ DB 連線成功')).catch(err => console.error('✗ DB 連線失敗:', err)); });"
```

---

## 七、MCP Server 配置

### 1. 取得伺服器 IP 或網域
假設伺服器 IP 為 `192.168.1.100`，MCP 連線 URL 為：
```
http://192.168.1.100/WTCA/mcp-connect/wtca-secure-token-12345
```

### 2. 在本機 (開發機器) 配置 MCP Client
編輯 Antigravity 的 `mcp_config.json`：

```json
{
  "mcpServers": {
    "WTCA": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://192.168.1.100/WTCA/mcp-connect/wtca-secure-token-12345",
        "--allow-http-transport",
        "--allow-http-subpath"
      ]
    }
  }
}
```

> **安全提示**: Token (`wtca-secure-token-12345`) 應該設定為強密碼，避免未授權訪問。

### 3. 重新啟動 Antigravity
配置完成後，重新啟動 Antigravity，連線到 WTCA MCP Server。

---

## 八、測試與驗證

### 1. 測試後端 API
在瀏覽器或 curl 中測試：
```bash
curl http://192.168.1.100/WTCA/api/health
```

預期回應：
```json
{"status":"ok","message":"資料庫連線正常"}
```

### 2. 測試 MCP 連線
在 Antigravity 中測試 MCP Tools：
- `query-tanks`: 查詢所有儲槽
- `query-readings`: 查詢液位紀錄
- `get-database-stats`: 取得統計資訊

---

## 九、故障排除

### 問題 1: 503 Service Unavailable
**原因**: Node.js 服務未啟動或 IIS Rewrite 規則錯誤
**解決**:
```powershell
pm2 status  # 確認服務狀態
pm2 restart WTCA-Backend
```

### 問題 2: MCP 連線卡在 "Refreshing"
**原因**: IIS 壓縮或快取阻擋 SSE
**解決**: 確認 `web.config` 已禁用 `urlCompression` 和 `caching`

### 問題 3: 資料庫連線失敗
**原因**: PostgreSQL 未允許本地連線或密碼錯誤
**解決**: 
1. 檢查 `pg_hba.conf` 確認允許 `127.0.0.1` 連線
2. 確認 `server.js` 中的資料庫密碼正確

### 問題 4: CORS 錯誤
**原因**: 前端跨域請求被阻擋
**解決**: 在 `server.js` 的 CORS 設定中加入允許的來源：
```javascript
app.use(cors({
  origin: ['http://your-frontend-domain.com']
}));
```

---

## 十、維護與監控

### 查看 PM2 日誌
```powershell
pm2 logs WTCA-Backend
```

### 重新啟動服務
```powershell
pm2 restart WTCA-Backend
```

### 資料庫備份
```bash
pg_dump -U pagesuser -d WTCA > backup_$(date +%Y%m%d).sql
```

---

## 附錄：可用的 MCP Tools

| Tool 名稱 | 功能 | 參數 |
|----------|------|------|
| `query-tanks` | 查詢儲槽資料 | `tankId` (選填) |
| `query-readings` | 查詢液位紀錄 | `tankId` (選填), `limit` (預設50) |
| `query-supplies` | 查詢藥劑合約 | `tankId` (選填) |
| `execute-sql` | 執行 SQL 查詢 (僅 SELECT) | `sql` |
| `get-database-stats` | 取得資料庫統計 | 無 |

---

## 聯絡資訊
如有問題，請參考 `API_README.md` 或 `migration_guide.md`。
