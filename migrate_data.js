// 資料遷移腳本：從 localStorage 匯出到 PostgreSQL
// 在瀏覽器 Console 中執行此腳本

// 1. 從 localStorage 讀取舊數據
const exportFromLocalStorage = () => {
    const oldTanks = JSON.parse(localStorage.getItem('tanks') || '[]');
    const oldReadings = JSON.parse(localStorage.getItem('readings') || '[]');
    const oldSupplies = JSON.parse(localStorage.getItem('chemicalSupplies') || '[]');

    console.log('=== 從 localStorage 匯出的數據 ===');
    console.log('儲槽數量:', oldTanks.length);
    console.log('液位紀錄數量:', oldReadings.length);
    console.log('藥劑合約數量:', oldSupplies.length);

    return {
        tanks: oldTanks,
        readings: oldReadings,
        supplies: oldSupplies
    };
};

// 2. 匯入資料到 PostgreSQL
const importToPostgreSQL = async (data) => {
    const API_BASE = '/WTCA/api';

    try {
        // 匯入儲槽
        console.log('開始匯入儲槽...');
        for (const tank of data.tanks) {
            const apiTank = {
                id: tank.id,
                name: tank.name,
                system_type: tank.system,
                capacity_liters: tank.capacityLiters,
                geo_factor: tank.factor,
                description: tank.description,
                safe_min_level: tank.safeMinLevel || 20,
                target_daily_usage: tank.targetDailyUsage,
                calculation_method: tank.calculationMethod
            };

            const response = await fetch(`${API_BASE}/tanks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(apiTank)
            });

            if (response.ok) {
                console.log(`✓ 儲槽 ${tank.name} 已匯入`);
            } else {
                console.error(`✗ 儲槽 ${tank.name} 匯入失敗:`, await response.text());
            }
        }

        // 匯入藥劑合約
        console.log('開始匯入藥劑合約...');
        for (const supply of data.supplies) {
            const apiSupply = {
                id: supply.id,
                tank_id: supply.tankId,
                supplier_name: supply.supplierName,
                chemical_name: supply.chemicalName,
                specific_gravity: supply.specificGravity,
                price: supply.price,
                start_date: supply.startDate,
                notes: supply.notes
            };

            const response = await fetch(`${API_BASE}/supplies`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(apiSupply)
            });

            if (response.ok) {
                console.log(`✓ 藥劑合約 ${supply.chemicalName} 已匯入`);
            } else {
                console.error(`✗ 藥劑合約匯入失敗:`, await response.text());
            }
        }

        // 匯入液位紀錄（分批，避免一次太多）
        console.log('開始匯入液位紀錄...');
        const batchSize = 50;
        for (let i = 0; i < data.readings.length; i += batchSize) {
            const batch = data.readings.slice(i, i + batchSize);
            const apiBatch = batch.map(reading => ({
                id: reading.id,
                tank_id: reading.tankId,
                timestamp: reading.timestamp,
                level_cm: reading.levelCm,
                calculated_volume: reading.calculatedVolume,
                calculated_weight_kg: reading.calculatedWeightKg,
                applied_sg: reading.appliedSpecificGravity,
                supply_id: reading.supplyId,
                added_amount_liters: reading.addedAmountLiters || 0,
                operator_name: reading.operatorName
            }));

            const response = await fetch(`${API_BASE}/readings/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ readings: apiBatch })
            });

            if (response.ok) {
                console.log(`✓ 已匯入 ${batch.length} 筆液位紀錄 (${i + 1} - ${i + batch.length})`);
            } else {
                console.error(`✗ 液位紀錄批次匯入失敗:`, await response.text());
            }
        }

        console.log('=== 匯入完成 ===');
        console.log('請重新整理頁面以查看數據');

    } catch (error) {
        console.error('匯入過程發生錯誤:', error);
    }
};

// 3. 執行完整遷移流程
const migrateData = async () => {
    console.log('========================================');
    console.log('開始資料遷移：localStorage → PostgreSQL');
    console.log('========================================');

    const data = exportFromLocalStorage();

    if (data.tanks.length === 0) {
        console.warn('警告：localStorage 中沒有找到任何儲槽數據');
        return;
    }

    const confirm = window.confirm(
        `即將匯入以下數據到 PostgreSQL:\n` +
        `- ${data.tanks.length} 個儲槽\n` +
        `- ${data.readings.length} 筆液位紀錄\n` +
        `- ${data.supplies.length} 筆藥劑合約\n\n` +
        `確定要繼續嗎？`
    );

    if (!confirm) {
        console.log('已取消匯入');
        return;
    }

    await importToPostgreSQL(data);
};

// 執行遷移
migrateData();
