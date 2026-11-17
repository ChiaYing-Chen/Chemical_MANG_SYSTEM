import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateDaily,estimateMidnightLevel,dailyPeriod} from '../levelCheck.js';
const H=3600000,period=dailyPeriod('2026-09-10');
const series=Array.from({length:29},(_,i)=>({t:period.start+(i-2)*H,v:100-(i-2)}));
const args={tank:{piLevelUnit:'CM',inputUnit:'CM',factor:10},period,prev:{levelCm:100},inputValue:76,series,boundaryMode:'WINDOW'};
test('午夜中位數排除單點偏差，仍只算原業務日且不改17%門檻',()=>{
 const noisy=series.map(p=>{const hours=(p.t-period.start)/H;return {...p,v:(hours<=2?100:hours>=22?76:100-(hours-2)*1.2)+(p.t===period.start?3:0)};});
 const old=evaluateDaily({...args,series:noisy,boundaryMode:'POINT'}),r=evaluateDaily({...args,series:noisy});
 assert.equal(old.piUsagePer24h,270);assert.equal(r.piUsagePer24h,240);
 assert.equal(r.periodStart,period.start);assert.equal(r.periodEnd,period.end);assert.equal(r.usageThresholdPercent,17);
});
test('缺兩端覆蓋不退回單點，午夜時窗跳變不能平滑成通過',()=>{
 assert.equal(evaluateDaily({...args,series:series.slice(2)}).status,'NO_PI');
 const jump=series.map(p=>({...p,v:p.v+(p.t>=period.end+H?20:0)}));
 const r=evaluateDaily({...args,series:jump});assert.equal(r.status,'NO_PI');assert.ok(r.messages.some(x=>x.includes('跳變')));
});
test('不規則密集歸檔不改變固定時點取樣中位數',()=>{
 const dense=[...series,...Array.from({length:100},(_,i)=>({t:period.start+H/2+i*1000,v:99.5-i/3600}))].sort((a,b)=>a.t-b.t);
 assert.equal(estimateMidnightLevel(dense,period.start,v=>v).value,100);
});
test('尚未完成的午夜後兩小時不能提前產生估計',()=>{
 assert.ok(estimateMidnightLevel([],Date.now(),v=>v).error.includes('尚未結束'));
});
