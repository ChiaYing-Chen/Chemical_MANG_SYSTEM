import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const calcPath = path.resolve(__dirname, '../utils/calculationUtils.ts');

const bundled = esbuild.buildSync({
    entryPoints: [calcPath],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral'
});

const modUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`;
const { calculateLevelDifferenceUsage, calculateTankVolume, getRecentSupplyOptions } = await import(modUrl);

test('直立圓柱槽依起始與結束液位及選定比重正確換算用量 (kg)', () => {
    const verticalTank = {
        id: 't1',
        name: 'CT-1 漂白水',
        system: '冷卻水系統',
        capacityLiters: 10000,
        factor: 0,
        safeMinLevel: 30,
        shapeType: 'VERTICAL_CYLINDER',
        dimensions: { diameter: 200, height: 300 }
    };

    const result = calculateLevelDifferenceUsage(verticalTank, 150, 130, 1.2);
    // 半徑 100 cm -> 面積 = pi * 100^2 cm^2 = 10 * pi L/cm；20 cm = 200 * pi L
    const expectedVolDiff = (Math.PI * 100 * 100 * 20) / 1000;
    assert.equal(result.levelDiffCm, 20);
    assert.ok(Math.abs(result.volumeDiffL - expectedVolDiff) < 1e-6);
    assert.ok(Math.abs(result.usageKg - expectedVolDiff * 1.2) < 1e-6);
});

test('臥式圓柱槽依實際液位區間計算非線性體積差與重量', () => {
    const horizontalTank = {
        id: 't2',
        name: 'CT-1 硫酸',
        system: '冷卻水系統',
        capacityLiters: 30000,
        factor: 0,
        safeMinLevel: 40,
        shapeType: 'HORIZONTAL_CYLINDER',
        dimensions: { diameter: 220, length: 600, headType: 'SEMI_ELLIPTICAL_2_1' }
    };

    const midDrop = calculateLevelDifferenceUsage(horizontalTank, 120, 110, 1.84);
    const lowDrop = calculateLevelDifferenceUsage(horizontalTank, 30, 20, 1.84);

    assert.equal(midDrop.levelDiffCm, 10);
    assert.equal(lowDrop.levelDiffCm, 10);
    assert.ok(midDrop.volumeDiffL > lowDrop.volumeDiffL);
    assert.ok(Math.abs(midDrop.usageKg - (calculateTankVolume(horizontalTank, 120) - calculateTankVolume(horizontalTank, 110)) * 1.84) < 1e-6);
});

test('結束液位高於起始液位時保留負差值不強制歸零', () => {
    const tank = {
        id: 't3',
        name: 'BWS-1 藥槽',
        system: '鍋爐水系統',
        capacityLiters: 1000,
        factor: 10,
        safeMinLevel: 10
    };

    const result = calculateLevelDifferenceUsage(tank, 50, 75, 1.1);
    assert.equal(result.levelDiffCm, -25);
    assert.equal(result.volumeDiffL, -250);
    assert.ok(Math.abs(result.usageKg - (-275)) < 1e-6);
});

test('getRecentSupplyOptions 只取指定桶槽最近 4 筆有效比重且依生效日由新到舊排序', () => {
    const supplies = [
        { id: 's1', tankId: 't1', supplierName: 'A', chemicalName: '硫酸', specificGravity: 1.81, startDate: 1000 },
        { id: 's2', tankId: 't1', supplierName: 'A', chemicalName: '硫酸', specificGravity: 1.82, startDate: 3000 },
        { id: 's3', tankId: 't1', supplierName: 'B', chemicalName: '硫酸', specificGravity: 1.83, startDate: 5000 },
        { id: 's4', tankId: 't1', supplierName: 'B', chemicalName: '硫酸', specificGravity: 1.84, startDate: 2000 },
        { id: 's5', tankId: 't1', supplierName: 'C', chemicalName: '硫酸', specificGravity: 1.85, startDate: 4000 },
        { id: 's6', tankId: 't1', supplierName: 'C', chemicalName: '硫酸', specificGravity: 0, startDate: 6000 },
        { id: 's7', tankId: 'other', supplierName: 'X', chemicalName: '漂白水', specificGravity: 1.2, startDate: 9000 }
    ];

    const recent = getRecentSupplyOptions(supplies, 't1', 4);
    assert.deepEqual(
        recent.map(s => [s.id, s.specificGravity]),
        [
            ['s3', 1.83],
            ['s5', 1.85],
            ['s2', 1.82],
            ['s4', 1.84]
        ]
    );
});
