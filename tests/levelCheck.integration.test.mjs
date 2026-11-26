import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const root = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(n, predicate) {
    if (predicate(n)) return n;
    let result;
    ts.forEachChild(n, c => { if (!result) result = find(c, predicate); });
    return result;
}
const node = find(root, n => ts.isVariableDeclaration(n) && n.name.getText(root) === 'handleSubmitReadings');
const js = ts.transpileModule('const handler = ' + node.initializer.getText(root), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function setup(tank, existing=[], confirmed=true) {
    const calls = {saved:[],confirm:0,loading:[],saving:[]};
    const dependencies = {
        date:'2026-10-05', batchLevels:{A:'1.5'}, readings:existing, tanks:[{id:'A',name:'測試槽',...tank}], operator:'測試',
        window:{confirm(){calls.confirm++;return confirmed;}}, alert(){},
        onLoading:x=>calls.loading.push(x),setBatchSaving:x=>calls.saving.push(x),
        API:new Proxy({}, {get(){throw Error('不得呼叫 PI');}}),
        StorageService:{getActiveSupply:async()=>({specificGravity:1.2})},
        calculateTankVolume:(_t,cm)=>cm*10,generateUUID:()=> 'new',
        checkAnomalies:()=>[],buildBatchUsageSummaries:()=>[],onBatchSave:async rows=>calls.saved.push(...rows),setBatchLevels(){},
    };
    const handler = new Function(...Object.keys(dependencies),js+';return handler;')(...Object.values(dependencies));
    return {calls,handler};
}
for(const [unit,factor,expected] of [['CM',undefined,1.5],['PERCENT',undefined,150],['LIQUID_PERCENT',4,6]]) {
    test(`批次儲存 ${unit} 不呼叫 PI 且保留換算`,async()=>{
        const {calls,handler}=setup({inputUnit:unit,piPercentFactor:factor});
        await handler({preventDefault(){}});
        assert.equal(calls.saved.length,1);
        assert.equal(calls.saved[0].levelCm,expected);
        assert.equal(calls.saved[0].calculatedVolume,expected*10);
        assert.equal(calls.saved[0].piCheck,undefined);
        assert.equal(calls.saved[0].piLevelCm,undefined);
        assert.equal(calls.confirm,0);
        assert.deepEqual(calls.saving,[true,false]);
    });
}
test('覆蓋確認仍有效，取消不儲存；同意保留補藥量與紀錄 ID',async()=>{
    const existing=[{id:'old',tankId:'A',timestamp:Date.parse('2026-10-05T00:00:00+08:00'),addedAmountLiters:20}];
    const cancel=setup({},existing,false);await cancel.handler({preventDefault(){}});assert.equal(cancel.calls.saved.length,0);
    const accept=setup({},existing,true);await accept.handler({preventDefault(){}});assert.equal(accept.calls.saved[0].id,'old');assert.equal(accept.calls.saved[0].addedAmountLiters,20);
});
test('參數頁與後端均已退役液位比對，啟動時不再修復或校正 PI 資料',()=>{
    assert.doesNotMatch(source,/DailyRateModal|PiRelationshipPanel|API\.checkLevels|piLiveChecks|piCheckToleranceCm/);
    const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
    assert.doesNotMatch(server,/repairLevelCheckData|piRecordedFetch|recalculateTank|import .*levelCheck/);
    assert.match(server,/res.status\(410\)/);
    assert.match(server,/app.post\('\/api\/readings/);
});
