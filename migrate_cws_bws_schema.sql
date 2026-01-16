-- ================================================================
-- CWS/BWS 參數表結構升級腳本
-- 用於支援歷史記錄功能
-- ================================================================

-- 1. 為 cws_parameters 添加 id 和 date 欄位
-- 注意：先移除 tank_id 的主鍵約束，再添加 id 作為新主鍵

-- 步驟 1.1: 為 cws_parameters 添加 id 欄位（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'cws_parameters' AND column_name = 'id'
    ) THEN
        -- 先刪除 tank_id 的主鍵約束
        ALTER TABLE cws_parameters DROP CONSTRAINT IF EXISTS cws_parameters_pkey;
        -- 添加 id 欄位作為新主鍵
        ALTER TABLE cws_parameters ADD COLUMN id UUID DEFAULT gen_random_uuid();
        ALTER TABLE cws_parameters ADD PRIMARY KEY (id);
        -- 為 tank_id 添加索引（不再是主鍵，但仍需索引）
        CREATE INDEX IF NOT EXISTS idx_cws_parameters_tank_id ON cws_parameters(tank_id);
    END IF;
END $$;

-- 步驟 1.2: 為 cws_parameters 添加 date 欄位（如果不存在）
ALTER TABLE cws_parameters ADD COLUMN IF NOT EXISTS date BIGINT;

-- 步驟 1.3: 為現有記錄填充 date 值（使用當前時間戳）
UPDATE cws_parameters SET date = EXTRACT(EPOCH FROM COALESCE(updated_at, NOW())) * 1000 
WHERE date IS NULL;

-- ================================================================

-- 2. 為 bws_parameters 添加 id 和 date 欄位

-- 步驟 2.1: 為 bws_parameters 添加 id 欄位（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'bws_parameters' AND column_name = 'id'
    ) THEN
        -- 先刪除 tank_id 的主鍵約束
        ALTER TABLE bws_parameters DROP CONSTRAINT IF EXISTS bws_parameters_pkey;
        -- 添加 id 欄位作為新主鍵
        ALTER TABLE bws_parameters ADD COLUMN id UUID DEFAULT gen_random_uuid();
        ALTER TABLE bws_parameters ADD PRIMARY KEY (id);
        -- 為 tank_id 添加索引
        CREATE INDEX IF NOT EXISTS idx_bws_parameters_tank_id ON bws_parameters(tank_id);
    END IF;
END $$;

-- 步驟 2.2: 為 bws_parameters 添加 date 欄位（如果不存在）
ALTER TABLE bws_parameters ADD COLUMN IF NOT EXISTS date BIGINT;

-- 步驟 2.3: 為現有記錄填充 date 值
UPDATE bws_parameters SET date = EXTRACT(EPOCH FROM COALESCE(updated_at, NOW())) * 1000 
WHERE date IS NULL;

-- ================================================================
-- 完成！現在 CWS/BWS 參數表支援歷史記錄功能
-- ================================================================
