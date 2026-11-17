import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const root=ts.createSourceFile('server.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function find(n,p){if(p(n))return n;let found;ts.forEachChild(n,c=>{if(!found)found=find(c,p)});return found;}
const route=find(root,n=>ts.isCallExpression(n)&&n.expression.getText(root)==='app.post'&&n.arguments[0]?.text==='/api/readings/batch');
function setup({failure,notificationFailure}={}) {
    const events=[];
    const client={release(){},async query(sql,args){
        if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){events.push(sql);return {rows:[]};}
        if(sql.includes('INSERT INTO readings')){events.push('reading');if(failure==='reading')throw Error('save failed');return {rows:[{id:'r',tank_id:'A',timestamp:Date.parse('2026-10-06T00:00:00+08:00')}]};}
        if(sql.includes('INSERT INTO fluctuation_alerts')){events.push('alert');if(failure==='alert')throw Error('alert failed');return {rows:[{tank_name:'測試槽',reason:'液位變動異常'}]};}
        throw Error('unexpected SQL');
    }};
    const handler=new Function('pool','notifyBatchReadingResult','crypto','console','return '+route.arguments[1].getText(root))(
        {connect:async()=>client},async(readings,alerts)=>{events.push({notification:true,count:readings.length,alerts:alerts.length});return notificationFailure?{sent:false,error:'通知失敗'}:{sent:true};},{randomUUID:()=> 'alert-id'},{error(){}}
    );
    const res={code:200,status(code){this.code=code;return this;},json(value){this.body=value;}};
    return {events,handler,res};
}
const reading={id:'r',tank_id:'A',timestamp:Date.parse('2026-10-06T00:00:00+08:00'),level_cm:50};
const alert={tank_id:'A',tank_name:'測試槽',date_str:'2026-10-06',reason:'液位變動異常'};
test('正常批次儲存後也通知，且必須先提交',async()=>{
    const {handler,events,res}=setup();await handler({body:{readings:[reading],notification:{alerts:[]}}},res);
    assert.deepEqual(events,['BEGIN','reading','COMMIT',{notification:true,count:1,alerts:0}]);assert.equal(res.body.notification.sent,true);
});
test('異常與液位在同筆交易儲存，僅通知一次',async()=>{
    const {handler,events,res}=setup();await handler({body:{readings:[reading],notification:{alerts:[alert]}}},res);
    assert.deepEqual(events,['BEGIN','reading','alert','COMMIT',{notification:true,count:1,alerts:1}]);assert.equal(res.code,201);
});
for(const failure of ['reading','alert'])test(`${failure} 寫入失敗時回滾且不通知`,async()=>{
    const {handler,events,res}=setup({failure});await handler({body:{readings:[reading],notification:{alerts:[alert]}}},res);
    assert.equal(res.code,500);assert.ok(events.includes('ROLLBACK'));assert.ok(!events.includes('COMMIT'));assert.ok(!events.some(e=>e.notification));
});
test('通知失敗仍回報液位已儲存，不回滾或要求重存',async()=>{
    const {handler,events,res}=setup({notificationFailure:true});await handler({body:{readings:[reading],notification:{alerts:[]}}},res);
    assert.equal(res.code,201);assert.equal(res.body.notification.sent,false);assert.ok(!events.includes('ROLLBACK'));
});
test('舊匯入與重新計算不增加通知',async()=>{
    const {handler,events,res}=setup();await handler({body:{readings:[reading]}},res);
    assert.equal(res.code,201);assert.ok(!events.some(e=>e.notification));
});
import { notifyBatchReadingResult } from '../batchReadingNotification.js';
for (const alerts of [[],[alert]]) test(`通知內容與燈號：${alerts.length ? '異常' : '正常'}`,async()=>{
    let payload,endpoint;
    const result=await notifyBatchReadingResult([reading],alerts,{env:{PIMCP_SUBSCRIPTION_ID:'3',PIMCP_API_URL:'http://pimcp/'},fetch:async(url,options)=>{
        endpoint=url;payload=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({success:true})};
    }});
    assert.equal(result.sent,true);assert.equal(endpoint,'http://pimcp/api/notifications/external-api');assert.equal(payload.subscriptionId,3);
    assert.match(payload.message,/2026-10-06/);assert.match(payload.message,/已儲存 1 筆/);
    assert.equal(payload.status,alerts.length?'warning':'success');
    assert.match(payload.message,alerts.length?/測試槽：液位變動異常/:/本批次未發現/);
});
for(const mode of ['http','business','network'])test(`通知 ${mode} 失敗不得回報成功`,async()=>{
    const result=await notifyBatchReadingResult([reading],[],{env:{PIMCP_SUBSCRIPTION_ID:'3'},fetch:async()=>{
        if(mode==='network')throw Error('offline');return {ok:mode!=='http',status:mode==='http'?500:200,json:async()=>({success:false})};
    }});assert.equal(result.sent,false);assert.match(result.error,/已儲存/);
});
test('人工異常確認只走批次儲存，避免舊警報 API 重複通知',async()=>{
    const app=fs.readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
    const tree=ts.createSourceFile('App.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const n=find(tree,n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)==='handleConfirmImport');
    const code=ts.transpileModule('const handler='+n.initializer.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const sent=[];
    const deps={pendingReadings:[reading],importAnomalies:[{tankId:'A',tankName:'測試槽',date:'2026/10/06',reason:'液位變動異常'}],tanks:[{id:'A',name:'測試槽'}],anomalySource:'MANUAL',onLoading(){},
        StorageService:{saveAlertsBatch(){throw Error('不得重複送警報');}},onBatchSave:async(rs,alerts)=>sent.push({rs,alerts}),setBatchLevels(){},alert(){},setShowAnomalyModal(){},setPendingReadings(){},setImportAnomalies(){},onUpdateTank(){},console:{error(e){throw e;}}};
    const handler=new Function(...Object.keys(deps),code+';return handler;')(...Object.values(deps));await handler();
    assert.equal(sent.length,1);assert.equal(sent[0].alerts.length,1);assert.equal(sent[0].alerts[0].dateStr,'2026-10-06');
});
