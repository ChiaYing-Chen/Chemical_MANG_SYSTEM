import test from 'node:test';import assert from 'node:assert/strict';
import {findSustainedRises,evaluateDaily,dailyPeriod} from '../levelCheck.js';
const H=3600000,period=dailyPeriod('2026-10-05');
const make=f=>Array.from({length:31},(_,i)=>({t:period.start+(i-6)*H,v:f(i-6)}));
test('數小時逐步回升被攔下，不能算成低日用量',()=>{
 const series=make(h=>h<10?100-h:h<=16?90+(h-10)*1.5:99-(h-16)*.1);
 assert.equal(findSustainedRises(series,period).length,1);
 const r=evaluateDaily({tank:{inputUnit:'CM',piLevelUnit:'CM',factor:10},period,prev:{levelCm:100},inputValue:80,series});
 assert.equal(r.status,'NO_PI');assert.equal(r.dataQuality.status,'SUSTAINED_RISE');assert.equal(r.piUsagePer24h,undefined);
});
test('正常下降、單點尖峰與資料缺口不當成持續回升',()=>{
 for(const series of [make(h=>100-h*.1),make(h=>100-h*.1+(h===12?8:0)),make(h=>h<10?90:99).filter(p=>p.t!==period.start+10*H)]){
  assert.equal(findSustainedRises(series,period).length,0);
 }
});
test('跨午夜的持續回升影響本日，已於前日完成的上升不影響',()=>{
 assert.equal(findSustainedRises(make(h=>h<2?90+(h+4):96),period).length,1);
 assert.equal(findSustainedRises(make(h=>h<-4?90:96),period).length,0);
});
