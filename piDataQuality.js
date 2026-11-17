/** PI 資料品質共用規則：線上查核與離線建模使用相同門檻。 */
const HOUR=3600000;
const isNum=v=>typeof v==='number'&&Number.isFinite(v);
const round=(v,d)=>Math.round(v*10**d)/10**d;
/** 連續 12 小時完全重複視為疑似停滯；包含恢復第一點，不能算作當日耗用。 */
export function findPiStalls(series, period) {
    const p=series.filter(x=>isNum(x.t)&&isNum(x.v)).sort((a,b)=>a.t-b.t),runs=[];
    let start=0;
    const finish=(last,recovery)=>{
        if(last>start&&p[last].t-p[start].t>=12*HOUR) {
            const end=recovery ?? p[last].t;
            if(p[start].t<period.end&&end>=period.start)runs.push({start:p[start].t,lastRepeated:p[last].t,end,hours:round((p[last].t-p[start].t)/HOUR,1),recovered:recovery!=null});
        }
    };
    for(let i=1;i<p.length;i++) {
        if(p[i].t-p[i-1].t>2*HOUR){finish(i-1,null);start=i;}
        else if(Math.abs(p[i].v-p[start].v)>1e-9){finish(i-1,p[i].t);start=i;}
    }
    if(p.length)finish(p.length-1,null);
    return runs;
}

