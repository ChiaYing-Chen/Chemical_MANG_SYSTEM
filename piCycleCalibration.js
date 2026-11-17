import {findPiStalls} from './piDataQuality.js';
/** 離線補藥週期配對與固定關係建模；不讀取 APP 補藥欄位，不在日常 API 執行。 */
const H = 3600000;
const DAY = 24 * H;
export const median = values => {
    const a = [...values].sort((x, y) => x - y), n = a.length;
    return n ? (a[Math.floor((n - 1) / 2)] + a[Math.floor(n / 2)]) / 2 : NaN;
};
const quantile = (a, q) => [...a].sort((x,y)=>x-y)[Math.floor((a.length - 1) * q)];
const span = a => quantile(a, .95) - quantile(a, .05);
const day = t => new Date(t + 8 * H).toISOString().slice(0,10);

/** 高頻資料需先按固定時間抽樣；以持續上升確認事件，單點尖峰不算補藥。 */
export function findRefillEvents(points, { manual = false } = {}) {
    const p = points.filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.v)).sort((a,b)=>a.t-b.t);
    if (p.length < 10) return [];
    const threshold = Math.max(manual ? 3 : .01, span(p.map(x=>x.v)) * .08);
    const events = [];
    for (let i = manual ? 1 : 6; i < p.length - (manual ? 1 : 12); i++) {
        const before = manual ? p[i-1].v : median(p.slice(i-6,i).map(x=>x.v));
        const after = manual ? p[i].v : median(p.slice(i,i+6).map(x=>x.v));
        const persistent = manual ? p[i+1].v : median(p.slice(i+6,i+12).map(x=>x.v));
        const gap = manual ? p[i].t - p[i-1].t : p[i+11].t - p[i-6].t;
        if (gap > (manual ? 4 * DAY : 19 * H) || after - before < threshold || persistent - before < threshold * .6) continue;
        const event = { t:p[i].t, rise:after-before, before, after };
        const previous = events.at(-1);
        if (previous && event.t - previous.t < (manual ? 2 * DAY : DAY)) {
            if (event.rise > previous.rise) events[events.length-1] = event;
        } else events.push(event);
    }
    return events;
}

/** 大幅液位跨度配對的斜率中位數，降低單筆輸入錯誤的影響。 */
export function fitCycleLine(pairs) {
    if (pairs.length < 7) return null;
    const range = span(pairs.map(p=>p.x));
    if (!(range > 0)) return null;
    const slopes = [];
    for (let i=0;i<pairs.length;i++) for(let j=i+1;j<pairs.length;j++) {
        const dx=pairs[j].x-pairs[i].x;
        if (Math.abs(dx) >= range * .25) slopes.push((pairs[j].y-pairs[i].y)/dx);
    }
    const slope=median(slopes), intercept=median(pairs.map(p=>p.y-slope*p.x));
    return Number.isFinite(slope)&&slope>0&&Number.isFinite(intercept) ? {slope,intercept} : null;
}

export function buildCycleRelationship(piPoints, manualPoints, {manualMinCm = null} = {}) {
    const pi = piPoints.filter(p=>Number.isFinite(p.v)).sort((a,b)=>a.t-b.t);
    const manual = manualPoints.filter(p=>Number.isFinite(p.v)).sort((a,b)=>a.t-b.t);
    const excludedTimeRanges=pi.length?findPiStalls(pi,{start:pi[0].t,end:pi.at(-1).t+1}):[];
    const contaminated=(a,b)=>excludedTimeRanges.some(r=>a<=r.end&&b>=r.start);
    const piEvents=findRefillEvents(pi).filter(e=>!contaminated(e.t-6*H,e.t+12*H)), manualEvents=findRefillEvents(manual,{manual:true});
    const cycles=[], rejected=[], used=new Set();
    for(let i=0;i<piEvents.length-1;i++) {
        const start=piEvents[i].t, end=piEvents[i+1].t;
        if(end-start<10*DAY) continue;
        const section=pi.filter(p=>p.t>=start&&p.t<=end);
        if(section.some((p,k)=>k>0&&p.t-section[k-1].t>3*H)) {rejected.push({start:day(start),end:day(end),reason:'PI 週期內資料中斷超過 3 小時'});continue;}
        const candidates=[];
        for(let j=0;j<manualEvents.length-1;j++) {
            if(used.has(j))continue;
            const ms=manualEvents[j].t, me=manualEvents[j+1].t;
            if(Math.abs(start-ms)>4*DAY||Math.abs(end-me)>4*DAY)continue;
            // 每個完整週期只能用一個位移；不逐日挑最相近的讀值。
            const anchor=t=>Math.ceil((t+8*H)/DAY)*DAY-8*H;
            const shiftDays=Math.round(((anchor(start)-ms)+(anchor(end)-me))/(2*DAY));
            if(Math.abs(shiftDays)>3)continue;
            const edgeError=(Math.abs(start-ms-shiftDays*DAY)+Math.abs(end-me-shiftDays*DAY))/DAY;
            if(edgeError>2.5)continue;
            const manualSection=manual.filter(p=>p.t>=ms&&p.t<=me);
            if(manualSection.length / ((me-ms)/DAY+1) < .5)continue;
            const pairs=[];
            for(const m of manual) {
                const t=m.t+shiftDays*DAY;
                if(m.t<=ms+DAY||m.t>=me-DAY||t<=start+DAY||t>=end-DAY)continue;
                if(manualMinCm!==null&&m.v<=manualMinCm)continue;
                if(contaminated(t-2*H,t+2*H))continue;
                const w=pi.filter(p=>Math.abs(p.t-t)<=2*H);
                if(w.length<4||w[0].t>t-H||w.at(-1).t<t+H||w.some((p,k)=>k>0&&p.t-w[k-1].t>1.5*H))continue;
                pairs.push({t,manualT:m.t,x:median(w.map(p=>p.v)),y:m.v});
            }
            if(pairs.length<manualSection.length*.5)continue;
            const fit=fitCycleLine(pairs);
            if(!fit)continue;
            const range=span(pairs.map(p=>p.y));
            if(range<10)continue;
            const error=median(pairs.map(p=>Math.abs(p.y-fit.slope*p.x-fit.intercept)));
            candidates.push({start,end,manualStart:ms,manualEnd:me,shiftDays,pairs,...fit,error,range,j,score:edgeError+error/range});
        }
        candidates.sort((a,b)=>a.score-b.score);
        if(!candidates.length){rejected.push({start:day(start),end:day(end),reason:'找不到兩端補藥時間及跨度相符的人工完整週期'});continue;}
        if(candidates[1]&&candidates[1].score-candidates[0].score<.1){rejected.push({start:day(start),end:day(end),reason:'多個人工區間同樣合理，配對不明確'});continue;}
        const best=candidates[0]; used.add(best.j);cycles.push(best);
    }
    // 固定採最近五個完整週期；遇到相鄰週期比例跳變超過 25%，只用較新的連續區段。
    let recent=cycles.slice(-5);
    for(let i=recent.length-1;i>0;i--) {
        if(Math.abs(recent[i-1].slope/recent[i].slope-1)>.25) {recent=recent.slice(i);break;}
    }
    const summary = recent.map(c=>({start:day(c.start),end:day(c.end),manualStart:day(c.manualStart),manualEnd:day(c.manualEnd),shiftDays:c.shiftDays,n:c.pairs.length,slope:c.slope,intercept:c.intercept,medianErrorCm:c.error}));
    const excludedCycles=cycles.filter(c=>!recent.includes(c)).map(c=>({start:day(c.start),end:day(c.end),reason:'較舊週期或歷史比例區段，不參與本版公式'}));
    const result={status:'PENDING',reason:'沒有足夠的有效配對資料',piEventCount:piEvents.length,manualEventCount:manualEvents.length,cycles:summary,rejected,excludedCycles,excludedTimeRanges,manualMinCm,excludedManualCount:manual.filter(p=>manualMinCm!==null&&p.v<=manualMinCm).length};
    if(!recent.length)return result;
    let train,validation,validationMode;
    if(recent.length===1) {
        // 慢速桶槽只有一個完整週期時，保留後段驗證；不可宣稱跨週期驗證通過。
        const c=recent[0],cut=c.start+(c.end-c.start)*2/3;
        const a=c.pairs.filter(p=>p.t<cut),b=c.pairs.filter(p=>p.t>=cut);
        const fit=fitCycleLine(a);
        if(!fit||b.length<7||span(a.map(p=>p.y))<10)return result;
        train=[{...c,...fit,pairs:a}];validation=[{...c,pairs:b}];validationMode='WITHIN_CYCLE';
        summary[0].role='SPLIT';result.holdoutStart=day(cut);
    } else {
        const split=Math.max(1,Math.floor(recent.length*2/3));
        train=recent.slice(0,split);validation=recent.slice(split);validationMode='CROSS_CYCLE';
        summary.forEach((c,i)=>{c.role=i<split?'TRAIN':'VALIDATION';});
    }
    const slope=median(train.map(c=>c.slope));
    // 斜率確定後，從建模樣本重算截距，避免組合不相容的兩個中位數。
    const intercept=median(train.map(c=>median(c.pairs.map(p=>p.y-slope*p.x))));
    const errors=validation.flatMap(c=>c.pairs.map(p=>Math.abs(p.y-slope*p.x-intercept)));
    const slopeDrift=Math.max(...recent.map(c=>Math.abs(c.slope/slope-1)));
    const validationMedianErrorCm=median(errors), validationP90ErrorCm=quantile(errors,.9);
    const levelSpan=span(recent.flatMap(c=>c.pairs.map(p=>p.y)));
    Object.assign(result,{slope,intercept,validationMode,trainCycleCount:validationMode==='WITHIN_CYCLE'?0:train.length,validationCycleCount:validationMode==='WITHIN_CYCLE'?0:validation.length,trainPointCount:train.reduce((n,c)=>n+c.pairs.length,0),validationPointCount:errors.length,validationMedianErrorCm,validationP90ErrorCm,slopeDrift,levelSpan,rawRange:{min:Math.min(...train.flatMap(c=>c.pairs.map(p=>p.x))),max:Math.max(...train.flatMap(c=>c.pairs.map(p=>p.x)))},periodStart:summary[0].start,periodEnd:summary.at(-1).end});
    const verified=recent.length>=3&&slopeDrift<=.10&&validationMedianErrorCm<=2&&validationP90ErrorCm<=5;
    // 有限驗證採用仍保留誤差上限，不能以「全部啟用」跳過明顯不相符的資料。
    const usable=slopeDrift<=.20&&validationMedianErrorCm<=5&&validationP90ErrorCm<=10&&validationP90ErrorCm/levelSpan<=.10;
    if(!usable){result.reason='保留資料誤差或跨週期比例變動仍過大，暫不採用';return result;}
    return {...result,status:'ACTIVE',validationGrade:verified?'VERIFIED':'LIMITED',reason:verified?'近期完整補藥週期及獨立週期驗證通過':validationMode==='WITHIN_CYCLE'?'有限驗證採用：僅一個完整週期，以前段建模、後段驗證；尚未跨週期驗證':'有限驗證採用：已保留獨立週期驗證，但週期數或精度未達完整驗證標準'};
}
