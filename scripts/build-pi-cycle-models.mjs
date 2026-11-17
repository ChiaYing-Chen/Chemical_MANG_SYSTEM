/** 離線一次性建模：node scripts/build-pi-cycle-models.mjs <資料目錄> <輸出 JS> <台北截止日期>。不寫入資料庫或自動部署。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {buildCycleRelationship} from '../piCycleCalibration.js';
const [directory,output,asOf,previousFile]=process.argv.slice(2);
const previous=previousFile?(await import(pathToFileURL(path.resolve(previousFile)).href)).PI_CYCLE_MODELS:{};
if(!directory||!output||!/^\d{4}-\d{2}-\d{2}$/.test(asOf || ''))throw new Error('請提供資料目錄、輸出 JS 與台北截止日期 YYYY-MM-DD');
const end=Date.parse(asOf+'T00:00:00+08:00');
const calendar=new Date(asOf+'T00:00:00Z');
const originalDay=calendar.getUTCDate(); calendar.setUTCDate(1); calendar.setUTCMonth(calendar.getUTCMonth()-18);
calendar.setUTCDate(Math.min(originalDay,new Date(Date.UTC(calendar.getUTCFullYear(),calendar.getUTCMonth()+1,0)).getUTCDate()));
const fromDate=calendar.toISOString().slice(0,10),start=Date.parse(fromDate+'T00:00:00+08:00');
const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8').replace(/^\uFEFF/,''));
const hash=name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex');
const tanks=read('tanks.json'), readings=read('readings.json'), models={};
const algorithmHash=crypto.createHash('sha256').update(fs.readFileSync(new URL('../piCycleCalibration.js',import.meta.url))).update(fs.readFileSync(new URL('../piDataQuality.js',import.meta.url))).digest('hex');
const createdAt=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Taipei'}).replace(' ','T')+'+08:00';
for(const tank of tanks) {
    if(!tank.pi_level_tag||/氨水|微生物分散劑|非氧化型殺菌劑|消泡劑/.test(tank.name))continue;
    // 已發布的有效固定模型沿用；本次只補足尚未啟用者。
    if(previous[tank.id]?.status==='ACTIVE'&&previous[tank.id].algorithmHash===algorithmHash&&previous[tank.id].tag===tank.pi_level_tag&&previous[tank.id].unit===tank.pi_level_unit){models[tank.id]=previous[tank.id];console.log(tank.id,'沿用已發布固定模型');continue;}
    const source=tank.id+'.json';
    const pi=read(source).filter(p=>p.Good&&!p.Questionable&&typeof p.Value==='number').map(p=>({t:Date.parse(p.Timestamp),v:p.Value})).filter(p=>p.t>=start&&p.t<=end);
    // 人工紀錄日期為用量所屬日，期末液位概略落在次日台北午夜。
    const manual=readings.filter(r=>r.tank_id===tank.id).map(r=>({t:Math.floor((+r.timestamp+28800000)/86400000)*86400000-28800000+86400000,v:+r.level_cm})).filter(p=>p.t>=start&&p.t<=end);
    const result=buildCycleRelationship(pi,manual,{manualMinCm:tank.id==='tc2_4'?28:null});
    models[tank.id]={...result,name:tank.name,tag:tank.pi_level_tag,unit:tank.pi_level_unit,createdAt,dataPeriodStart:fromDate,dataPeriodEnd:asOf,version:'cycle-v3-quality-18m-'+asOf+'-'+algorithmHash.slice(0,8)+'-'+hash(source).slice(0,8)+'-'+hash('readings.json').slice(0,8),algorithmHash,sourceHash:hash(source),manualSourceHash:hash('readings.json'),smoothingMinutes:tank.id==='tc1_1'?15:undefined};
    console.log(tank.id,result.status,'PI 事件',result.piEventCount,'APP 事件',result.manualEventCount,'配對',result.cycles.length,'比例變動',result.slopeDrift?.toFixed(3),'驗證',result.validationMedianErrorCm?.toFixed(2),result.validationP90ErrorCm?.toFixed(2));
}
fs.writeFileSync(output,'// 由離線補藥週期建模產生；日常輸入不得重算或覆寫。\nexport const PI_CYCLE_MODELS = '+JSON.stringify(models,null,2)+';\n');
