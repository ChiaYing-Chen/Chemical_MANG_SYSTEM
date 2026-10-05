import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const localRoot = 'D:\\WTCA';
const remoteRoot = '\\\\10.122.51.61\\c$\\inetpub\\wwwroot\\WTCA';

function formatDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    const taipei = new Date(d.getTime() + 8 * 3600000);
    return `${taipei.getUTCFullYear()}${pad(taipei.getUTCMonth() + 1)}${pad(taipei.getUTCDate())}-${pad(taipei.getUTCHours())}${pad(taipei.getUTCMinutes())}${pad(taipei.getUTCSeconds())}`;
}

const timestamp = formatDate(new Date());
const backupDir = path.join(remoteRoot, 'deploy-backups', `${timestamp}-level-check-calibration`);

console.log('==========================================');
console.log('開始佈署 WTCA 至遠端伺服器 (10.122.51.61)');
console.log('==========================================');

// 1. 建立備份目錄
console.log(`\n[1/5] 建立備份目錄: ${backupDir}`);
fs.mkdirSync(backupDir, { recursive: true });

// 2. 備份現有檔案
console.log('\n[2/5] 備份遠端現有檔案...');
const backendFiles = ['server.js', 'levelCheck.js', 'levelCheckPersistence.js', 'package.json'];
for (const file of backendFiles) {
    const remoteFile = path.join(remoteRoot, file);
    if (fs.existsSync(remoteFile)) fs.copyFileSync(remoteFile, path.join(backupDir, file));
}

const remoteDist = path.join(remoteRoot, 'dist');
if (fs.existsSync(remoteDist)) {
    const backupDist = path.join(backupDir, 'dist');
    try {
        execSync(`robocopy "${remoteDist}" "${backupDist}" /E /XO /NP /R:2 /W:3`, { stdio: 'ignore' });
    } catch (e) {
        if (typeof e.status !== 'number' || e.status >= 8) throw new Error('遠端備份失敗，停止佈署');
    }
    console.log('  - 已備份 dist 目錄');
}

// 3. 同步前端編譯檔案 (dist/)
console.log('\n[3/5] 同步前端編譯檔案 (dist/)...');
const localDist = path.join(localRoot, 'dist');
try {
    execSync(`robocopy "${localDist}" "${remoteDist}" /MIR /FFT /R:3 /W:5 /NP`, { stdio: 'inherit' });
} catch (e) {
    if (e.status >= 8) {
        throw new Error(`Robocopy 複製 dist 失敗，ExitCode=${e.status}`);
    }
}
console.log('  - 前端 dist 目錄同步完成！');

// 4. 佈署後端程式與核心模組
console.log('\n[4/5] 佈署後端程式與核心模組...');
for (const file of backendFiles) {
    const src = path.join(localRoot, file);
    const dst = path.join(remoteRoot, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
        const stat = fs.statSync(dst);
        console.log(`  - 已更新 ${file} (${stat.size} bytes)`);
    }
}

// 5. 同步前端原始碼檔案
console.log('\n[5/5] 同步原始碼檔案...');
const sourceFiles = [
    'App.tsx',
    'types.ts',
    path.join('components', 'ImportAnomalyModal.tsx'),
    path.join('components', 'PiCalibrationModal.tsx'),
    path.join('services', 'apiService.ts'),
    path.join('services', 'storageService.ts'),
    path.join('views', 'WaterQualityTrendsView.tsx')
];

for (const rel of sourceFiles) {
    const src = path.join(localRoot, rel);
    const dst = path.join(remoteRoot, rel);
    const parent = path.dirname(dst);
    if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
    }
    fs.copyFileSync(src, dst);
    console.log(`  - 已同步 ${rel}`);
}

console.log('\n==========================================');
console.log('🎉 WTCA 檔案已全數成功佈署至 10.122.51.61！');
console.log('==========================================');
