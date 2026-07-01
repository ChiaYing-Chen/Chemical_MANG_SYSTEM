-- 建立人工檢驗水質趨勢數據表
CREATE TABLE IF NOT EXISTS manual_water_quality_readings (
    id UUID PRIMARY KEY,
    water_type VARCHAR(10) NOT NULL, -- 'CW' (冷卻水) 或 'BW' (鍋爐水)
    test_date DATE NOT NULL,
    sample_point VARCHAR(50) NOT NULL, -- 如 'TW', 'CW_1', 'BLR1_DEA', 'DMP' 等
    data JSONB NOT NULL, -- 儲存所有指標的鍵值對 (包含原始值如 "<0.02")
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_type_date_point UNIQUE (water_type, test_date, sample_point)
);

-- 建立索引以優化查詢
CREATE INDEX IF NOT EXISTS idx_mwqr_type_date ON manual_water_quality_readings(water_type, test_date);
