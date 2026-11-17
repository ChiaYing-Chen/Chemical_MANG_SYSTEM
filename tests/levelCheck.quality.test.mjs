import test from 'node:test';import assert from 'node:assert/strict';
import {findPiStalls,evaluateDaily,dailyPeriod} from '../levelCheck.js';
import {PI_CYCLE_MODELS} from '../piDailyConversions.js';
const H=3600000,p=dailyPeriod('2026-09-26');
test('Good數值持續重複12小時，含恢復點的日期皆標為疑似停滯',()=>{
 const s=Array.from({length:40},(_,i)=>({t:p.start+(i-13)*H,v:i<30?50:50-(i-29)}));
 const runs=findPiStalls(s,p);assert.equal(runs.length,1);assert.equal(runs[0].recovered,true);assert.equal(runs[0].hours,29);
 const recovery=findPiStalls(s,{start:p.start+17*H,end:p.start+41*H});assert.equal(recovery.length,1);
});
test('緩慢下降、短暫不動與缺測不可冒充連續停滯',()=>{
 for(const s of [Array.from({length:25},(_,i)=>({t:p.start+i*H,v:50-i*.0001})),[{t:p.start,v:50},{t:p.start+24*H,v:50}],Array.from({length:10},(_,i)=>({t:p.start+i*H,v:50}))])assert.equal(findPiStalls(s,p).length,0);
});
test('實際查核遇停滯不產生用量差距或零用量通過',()=>{
 const m=PI_CYCLE_MODELS.tc1_4,tank={id:'tc1_4',piLevelTag:m.tag,piLevelUnit:m.unit,inputUnit:'CM',factor:10};
 const r=evaluateDaily({tank,period:p,prev:{levelCm:60},inputValue:55,series:Array.from({length:39},(_,i)=>({t:p.start+(i-13)*H,v:20}))});
 assert.equal(r.status,'NO_PI');assert.equal(r.dataQuality.status,'SUSPECTED_STALL');assert.equal(r.usageDeviationPercent,undefined);
});
test('CT2分散劑任一人工端點不高於28cm不判定，28以上正常查核',()=>{
 const m=PI_CYCLE_MODELS.tc2_4,tank={id:'tc2_4',piLevelTag:m.tag,piLevelUnit:m.unit,inputUnit:'CM',factor:10};
 for(const [prev,end,expected]of [[29,28,'NO_PI'],[28,29,'NO_PI'],[27,26,'NO_PI'],[30,29,'OK']]){
 const r=evaluateDaily({tank,period:p,prev:{levelCm:prev},inputValue:end,series:Array.from({length:27},(_,i)=>({t:p.start+(i-1)*H,v:(prev-(prev-end)*(i-1)/24-m.intercept)/m.slope}))});assert.equal(r.status,expected);if(expected==='NO_PI')assert.equal(r.dataQuality.status,'MANUAL_BELOW_READABLE_RANGE');
 }
});
