import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCycleRelationship,findRefillEvents} from '../piCycleCalibration.js';
import {getDailyPiConversion,PI_CYCLE_MODELS} from '../piDailyConversions.js';
const H=3600000,D=24*H,start=Date.parse('2025-04-06T00:00:00+08:00');
const value=t=>100-((t-start)/D%30)*1.5;
const pi=Array.from({length:181*24},(_,i)=>({t:start+i*H,v:value(start+i*H)}));
const manual=Array.from({length:179},(_,i)=>({t:start+(i+2)*D,v:2*value(start+i*D)+5}));

test('跨月份多週期搜尋找回整段兩天位移，保留完整週期獨立驗證',()=>{
    const r=buildCycleRelationship(pi,manual);
    assert.equal(r.status,'ACTIVE');
    assert.ok(Math.abs(r.slope-2)<.02);
    assert.ok(Math.abs(r.intercept-5)<1);
    assert.ok(r.cycles.every(c=>c.shiftDays===-2));
    assert.ok(r.validationCycleCount>=1&&r.trainCycleCount>=2);
    assert.ok(r.cycles.filter(c=>c.role==='TRAIN').at(-1).end<=r.cycles.find(c=>c.role==='VALIDATION').start);
});
test('PI 單點尖峰不算補藥，資料不足不冒充可靠模型',()=>{
    const flat=pi.slice(0,24*25).map((p,i)=>({...p,v:100-i/100+(i===100?50:0)}));
    assert.equal(findRefillEvents(flat).length,0);
    assert.equal(buildCycleRelationship(pi.slice(0,24*60),manual.slice(0,58)).status,'PENDING');
});
test('歷史比例分段只用最新區段，週期不足不得宣稱完整驗證',()=>{
    const changed=manual.map(p=>({...p,v:p.t>start+120*D?p.v*1.6:p.v}));
    const r=buildCycleRelationship(pi,changed);
    assert.ok(r.excludedCycles.length>0);
    assert.notEqual(r.validationGrade,'VERIFIED');
    if(r.status==='ACTIVE') assert.ok(Math.abs(r.slope-3.2)<.05);
});
test('跨資料中斷週期排除，不將缺測資料當完整耗用區間',()=>{
    const missing=pi.filter(p=>p.t<start+70*D||p.t>start+73*D);
    const r=buildCycleRelationship(missing,manual);
    assert.ok(r.rejected.some(c=>c.reason.includes('中斷')));
});
test('發布模型只使用近18個月；待驗證、換Tag與單位變更均不啟用',()=>{
    for(const [id,m] of Object.entries(PI_CYCLE_MODELS)){
        assert.equal(m.dataPeriodStart,'2025-04-06');assert.equal(m.dataPeriodEnd,'2026-10-06');
        assert.ok(m.cycles.every(c=>c.start>=m.dataPeriodStart&&c.end<=m.dataPeriodEnd));
        const t={id,piLevelTag:m.tag,piLevelUnit:m.unit};
        assert.equal(Boolean(getDailyPiConversion(t)),m.status==='ACTIVE');
        assert.equal(getDailyPiConversion({...t,piLevelTag:'OTHER'}),null);
    }
});

test('人工每週缺填兩天保留有效樣本，不排除整個週期',()=>{
    const sparse=manual.filter((p,i)=>i%7<5);
    const r=buildCycleRelationship(pi,sparse);
    assert.equal(r.status,'ACTIVE');assert.ok(Math.abs(r.slope-2)<.02);
});
test('新比例有多個週期時採用最新五段，舊比例不混入',()=>{
    const p=Array.from({length:361*24},(_,i)=>({t:start+i*H,v:value(start+i*H)}));
    const m=Array.from({length:359},(_,i)=>({t:start+(i+2)*D,v:(i<150?1:2)*value(start+i*D)+5}));
    const r=buildCycleRelationship(p,m);
    assert.equal(r.status,'ACTIVE');assert.equal(r.validationGrade,'VERIFIED');
    assert.equal(r.cycles.length,5);assert.ok(Math.abs(r.slope-2)<.02);assert.ok(r.excludedCycles.length>0);
});
test('有限驗證的單一長週期保留後段，不冒稱獨立完整週期',()=>{
    const r=buildCycleRelationship(pi.slice(0,100*24),manual.slice(0,69));
    assert.equal(r.status,'ACTIVE');assert.equal(r.validationGrade,'LIMITED');assert.equal(r.validationMode,'WITHIN_CYCLE');assert.equal(r.validationCycleCount,0);assert.ok(r.validationPointCount>=7);
});

test('新公式不改動已啟用模型；九個待驗證桶槽均有保留資料驗證',()=>{
    for(const id of ['tb_1','tb_3','tc1_3','tc1_4','tc1_5','tc2_1','tc2_3','tc2_4','tc2_5']){
        const m=PI_CYCLE_MODELS[id];assert.equal(m.status,'ACTIVE');assert.ok(m.validationPointCount>=7);
        assert.ok(['VERIFIED','LIMITED'].includes(m.validationGrade));
    }
    assert.ok(Math.abs(PI_CYCLE_MODELS.tc2_1.slope-1.99)<.03);
    assert.ok(PI_CYCLE_MODELS.tc2_1.cycles.every(c=>c.start>='2026-01-01'));
});
test('明顯錯誤的後段資料不能用有限驗證強制啟用',()=>{
    const bad=manual.slice(0,69).map(p=>({...p,v:p.t>start+53*D?p.v-35:p.v}));
    const r=buildCycleRelationship(pi.slice(0,100*24),bad);
    assert.equal(r.status,'PENDING');
});

test('建模排除PI停滯及恢復區間，剩餘配對仍可恢復正確比例',()=>{
 const stalled=pi.map(p=>({...p,v:p.t>=start+70*D&&p.t<=start+75*D?value(start+70*D):p.v}));
 const r=buildCycleRelationship(stalled,manual);
 assert.ok(r.excludedTimeRanges.some(x=>x.hours>=120));
 assert.equal(r.status,'ACTIVE');assert.ok(Math.abs(r.slope-2)<.02);
});
test('CT2分散劑建模排除不可讀液位，其他槽不套用28cm下限',()=>{
 const restricted=buildCycleRelationship(pi,manual,{manualMinCm:160});
 assert.ok(restricted.excludedManualCount>0);
 assert.equal(buildCycleRelationship(pi,manual).excludedManualCount,0);
 assert.equal(PI_CYCLE_MODELS.tc2_4.manualMinCm,28);
});
