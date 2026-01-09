# MCP Server 與 Client 架構設計與實作指南 (IIS Environment)

本文件詳細說明如何設計與實作一個能穿透 IIS Reverse Proxy 環境的 MCP (Model Context Protocol) 架構。

## 1. 核心架構原理

在企業環境中，Node.js 應用通常託管於 Windows Server IIS 下。為了確保 Server-Sent Events (SSE) 的穩定性，我們採用 **IIS Reverse Proxy** 架構，而非傳統的 `iisnode` 直連。

### 架構圖

[Client (Antigravity/Claude)] <--> [IIS (Port 80/443)] <--> [Node.js Express App (Port 3002)]

*   **Client**: 透過 HTTP POST 發送指令，透過 SSE 接收結果與通知。
*   **IIS**: 作為反向代理，負責端口轉發、SSL 卸載、靜態檔案服務（可選）。
*   **Node.js**: 獨立進程運行，處理 MCP 邏輯與 SSE 連接。

## 2. IIS 配置 (Web.config)

這是最關鍵的部分。必須禁用 IIS 的所有緩衝機制，否則 SSE 連接會卡在 "Connecting" 狀態。

### `web.config` 關鍵配置

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    
    <!-- 1. 禁用快取和壓縮（SSE 絕對必要條件） -->
    <!-- 如果啟用壓縮，IIS 會等待收集足夠數據才發送，導致流式傳輸失敗 -->
    <urlCompression doStaticCompression="false" doDynamicCompression="false" />
    <caching enabled="false" enableKernelCache="false" />

    <!-- 2. 移除衝突模組 -->
    <modules>
      <remove name="WebDAVModule" />
    </modules>

    <!-- 3. URL Rewrite：配置反向代理 -->
    <rewrite>
      <rules>
        <!-- 靜態資源（可選：讓 IIS 處理靜態檔減輕 Node 負擔） -->
        <rule name="AssetsRedirect" stopProcessing="true">
          <match url="^assets/(.*)$" />
          <action type="Rewrite" url="../frontend/dist/assets/{R:1}" />
        </rule>
        
        <!-- API 與 MCP 請求：轉發到 Node.js -->
        <rule name="ReverseProxyToNode" stopProcessing="true">
          <match url="(.*)" />
          <!-- 假設 Node.js 運行在 3003 端口 -->
          <action type="Rewrite" url="http://localhost:3003/{R:1}" />
        </rule>
      </rules>
    </rewrite>

    <!-- 4. 認證設定：必須允許匿名訪問 -->
    <!-- 如果啟用 Windows Auth，NTLM 握手可能會阻斷 SSE 連接的建立 -->
    <security>
      <authentication>
        <anonymousAuthentication enabled="true" />
        <windowsAuthentication enabled="false" />
      </authentication>
    </security>

    <!-- 5. 錯誤處理 -->
    <httpErrors existingResponse="PassThrough" />
    
  </system.webServer>
</configuration>
```

**IIS Application Request Routing (ARR) 設定：**
*   在 IIS Manager -> Server Name -> Application Request Routing Cache -> Server Proxy Settings。
*   勾選 "Enable proxy"。
*   **Time-out (seconds)**: 建議設大一點（例如 300），避免長任務執行時連接斷開。

## 3. Server 端實作 (Node.js)

為了應對 IIS 和各種 Proxy 的行為，Node.js 代碼需要實作特殊的「防禦性」措施。

### 3.1 關鍵依賴

```bash
npm install @modelcontextprotocol/sdk express cors zod
```

### 3.2 Server.js - SSE 連接處理 (The "Bulletproof" Method)

以下代碼展示如何建立一個「防禦性」的 SSE 端點，包含 Padding、Monkey Patching 和 Keep-Alive。

```javascript
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const z = require('zod');

// 儲存活躍連接
const mcpTransports = new Map();
const mcpServers = new Map();

app.get('/mcp-connect/:token', async (req, res) => {
    const token = req.params.token;

    console.log(`[MCP] 連接請求: ${token}`);

    // 1. [關鍵] 立即設置 SSE Headers (在創建 Transport 之前)
    // 這是為了搶在任何其他中間件之前控制 Response
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // Nginx hint
    });

    // 2. [關鍵] 發送初始 Padding (4KB)
    // 強制 IIS/Proxy 沖刷緩衝區，讓 Client 立即收到 headers 並轉為 Connected 狀態
    res.write(":" + " ".repeat(4096) + "\n\n");

    // 3. [進階] Monkey Patch res.writeHead
    // MCP SDK 內部可能會嘗試重新調用 writeHead，導致 ERR_HTTP_HEADERS_SENT
    // 我們在這裡攔截它
    const originalWriteHead = res.writeHead;
    res.writeHead = (statusCode, headers) => {
        return res;
    };

    // 4. [進階] Monkey Patch res.write (可選，但建議)
    // 在每個 SSE 事件後添加 Padding，防止某些 Proxy 緩衝小封包
    // 同時可以解決 JSON 格式因為特殊字符導致的解析問題
    const originalWrite = res.write;
    res.write = function (chunk, ...args) {
        let strChunk = chunk.toString();
        // 簡單邏輯：如果是 SSE 事件結尾，附加 padding (例如 100 bytes)
        if (strChunk.endsWith("\n\n")) {
            strChunk += ":" + " ".repeat(100) + "\n\n";
        }
        return originalWrite.apply(res, [strChunk, ...args]);
    };

    // 5. 創建與註冊 Transport
    const messageEndpoint = `/eucDB/backend/messages/${token}`; // 確保路徑對應
    const transport = new SSEServerTransport(messageEndpoint, res);
    
    mcpTransports.set(token, transport);

    // 6. 初始化 MCP Server 與工具
    const server = new McpServer({ name: "MyServer", version: "1.0.0" });
    
    // --- 工具定義範例 ---
    server.tool('my-tool', 
        { arg: z.string() }, 
        async ({ arg }) => { return { content: [{ type: 'text', text: 'result' }] }; }
    );
    // ------------------

    mcpServers.set(token, server);

    // 7. Keep-Alive 機制
    // 定期發送心跳，防止連接因閒置被中間設備切斷
    const keepAlive = setInterval(() => {
        if (res.writableEnded) {
            clearInterval(keepAlive);
            return;
        }
        res.write(":" + " ".repeat(100) + "\n\n");
    }, 15000); // 15秒一次

    // 8. 清理機制 (延遲清理)
    req.on('close', () => {
        clearInterval(keepAlive);
        // 延遲清理以防止暫時性斷線造成的 Session 丟失
        setTimeout(() => {
            // 再次檢查是否仍然是同一個 transport (避免 race condition)
            if (mcpTransports.get(token) === transport) {
                mcpTransports.delete(token);
                mcpServers.delete(token);
            }
        }, 1000);
    });

    // 9. 連接
    try {
        await server.connect(transport);
    } catch (err) {
        console.error("Connection error:", err);
    }
});
```

### 3.3 Zod Schema 的陷阱

在定義工具時，請**避免**使用過於寬泛或複雜的 Zod 類型，這會導致 MCP SDK 在生成 JSON Schema 時失敗或超時（表現為 "Context Deadline Exceeded"）。

*   ❌ **避免**：`z.record(z.any())` - 這種動態結構會讓 JSON Schema 生成器卡住。
*   ✅ **推薦**：
    *   明確定義結構: `z.object({ key: z.string() })`
    *   傳遞 JSON 字串: `z.object({ filters: z.string().describe('JSON string of filters') })`，然後在函數內 `JSON.parse`。

### 3.4 訊息接收端點

```javascript
app.post('/messages/:token', async (req, res) => {
    const token = req.params.token;
    const transport = mcpTransports.get(token);

    if (!transport) {
        return res.status(404).json({ error: "Session not found" });
    }

    try {
        await transport.handleMessage(req.body);
        res.status(202).json({});
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});
```

## 4. Client 設定 (Antigravity/mcp-remote)

在 Antigravity 的 `mcp_config.json` 中配置：

```json
{
  "mcpServers": {
    "WTCA": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://your-server-ip/WTCA/mcp-connect/mytoken123",
        "--allow-http-transport",
        "--allow-http-subpath" 
      ]
    }
  }
}
```

## 5. 故障排除檢查清單

1.  **503 Service Unavailable**: 檢查 Node.js 是否運行，端口是否正確，URL Rewrite 規則是否正確。
2.  **SSE 連接卡住 (Refreshing)**: 
    *   檢查 `web.config` 是否禁用了 `urlCompression` 和 `caching`。
    *   確認 Server 是否發送了初始 4KB Padding。
3.  **Context Deadline Exceeded**: 
    *   Client 連接成功但獲取工具失敗。
    *   檢查 **Zod Schema**，移除 `z.any()` 或複雜嵌套類型。
    *   檢查 Server 日誌是否有報錯。
4.  **Session not found**: 
    *   SSE 連接被過早關閉。檢查 Keep-Alive，並確保沒有錯誤的 `mcpTransports.delete` 邏輯。
    *   檢查 IIS Connection Time-out 設置。
5.  **亂碼**: 
    *   確認 Server `Content-Type` 包含 `charset=utf-8`。
    *   資料庫查詢確保使用 UTF-8 client encoding。
