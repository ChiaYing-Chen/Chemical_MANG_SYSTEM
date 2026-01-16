# 數據輸入頁面 - 添加 B/C/D 歷史記錄編輯功能

## 目標
為 B (藥劑合約)、C (冷卻水生產數據)、D (鍋爐水生產數據) 添加與 A (液位數據) 相同的歷史記錄編輯功能。

## 已有基礎設施
✅ State 已經存在:
- `historySupplies` - B 類別歷史
- `historyCWS` - C 類別歷史  
- `historyBWS` - D 類別歷史
- `editingItem`, `editForm`, `isEditOpen` - 編輯對話框狀態
- `showMoreHistory` - 顯示更多歷史記錄開關

✅ 數據載入邏輯已存在 (`loadHistory` useEffect)

## 需要添加的功能

### 1. B - 藥劑合約歷史記錄
**位置**: B 表單之後  
**顯示欄位**: 
- 生效日期
- 供應商
- 藥劑名稱
- 比重
- 操作 (編輯/刪除)

**編輯功能**:
- 可編輯所有欄位
- 使用 EditDialog 組件
- 調用 `StorageService.updateSupply()`

### 2. C - 冷卻水生產數據歷史記錄
**位置**: C 表單之後
**顯示欄位**:
- 日期 (週起始日)
- 循環水量
- 溫差
- 目標濃度
- 操作 (編輯/刪除)

**編輯功能**:
- 可編輯所有欄位
- 使用 EditDialog 組件
- 調用 `StorageService.updateCWSParam()`

### 3. D - 鍋爐水生產數據歷史記錄
**位置**: D 表單之後
**顯示欄位**:
- 日期 (週起始日)
- 蒸汽總產量
- 目標濃度
- 操作 (編輯/刪除)

**編輯功能**:
- 可編輯所有欄位
- 使用 EditDialog 組件
- 調用 `StorageService.updateBWSParam()`

## 實施步驟

1. 在 B 表單之後添加歷史記錄列表
2. 在 C 表單之後添加歷史記錄列表
3. 在 D 表單之後添加歷史記錄列表
4. 修改 EditDialog 以支持不同類型的數據編輯
5. 測試所有編輯和刪除功能
