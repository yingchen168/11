const slugs=['elon-musk-of-tweets-march-6-march-13','elon-musk-of-tweets-march-9-march-11'];
const apiG='https://gamma-api.polymarket.com';
const apiD='https://data-api.polymarket.com';

async function j(url){const r=await fetch(url); if(!r.ok) throw new Error(url+' '+r.status); return r.json();}

const events=[];
for(const slug of slugs){
  const e=(await j(`${apiG}/events?slug=${slug}`))[0];
  events.push(e);
}

const eventConditions=new Map();
for(const e of events){
  eventConditions.set(e.id, e.markets.map(m=>({conditionId:m.conditionId, question:m.question, marketId:m.id, slug:m.slug})));
}

const walletMap=new Map();
for(const e of events){
  for(const m of eventConditions.get(e.id)){
    let holders;
    try{ holders=await j(`${apiD}/holders?market=${m.conditionId}`);}catch{continue}
    for(const tokenObj of holders){
      for(const h of tokenObj.holders||[]){
        const w=h.proxyWallet.toLowerCase();
        if(!walletMap.has(w)) walletMap.set(w,{wallet:w,byEvent:new Set(),holds:[],names:new Set()});
        const rec=walletMap.get(w);
        rec.byEvent.add(e.id);
        rec.holds.push({eventId:e.id,eventSlug:e.slug,conditionId:m.conditionId,question:m.question,outcomeIndex:h.outcomeIndex,amount:h.amount,name:h.name||'',pseudonym:h.pseudonym||''});
        if(h.name) rec.names.add(h.name);
      }
    }
  }
}

let candidates=[...walletMap.values()].filter(x=>x.byEvent.size===2);

async function getActivity(user,maxPages=15){
  const out=[];
  for(let p=0;p<maxPages;p++){
    const arr=await j(`${apiD}/activity?user=${user}&limit=100&offset=${p*100}`);
    if(!Array.isArray(arr)||arr.length===0) break;
    out.push(...arr);
    if(arr.length<100) break;
  }
  return out;
}

function estimateProfits(acts){
  acts=acts.filter(a=>a.type==='TRADE').sort((a,b)=>a.timestamp-b.timestamp);
  const inv=new Map();
  const profits=[];
  for(const a of acts){
    const k=`${a.conditionId}:${a.outcomeIndex}`;
    if(!inv.has(k)) inv.set(k,{qty:0,cost:0});
    const p=inv.get(k);
    const qty=Number(a.size)||0;
    const usdc=Number(a.usdcSize)||0;
    if(qty<=0) continue;
    if(a.side==='BUY'){
      p.qty += qty;
      p.cost += usdc;
    }else if(a.side==='SELL'){
      const avg = p.qty>0 ? p.cost/p.qty : Number(a.price)||0;
      const profit = usdc - avg*qty;
      if(p.qty>0){
        const remove = Math.min(qty,p.qty);
        p.cost -= avg*remove;
        p.qty -= remove;
      }
      profits.push({profit,usdc,qty,conditionId:a.conditionId,outcomeIndex:a.outcomeIndex,timestamp:a.timestamp,title:a.title});
    }
  }
  const good=profits.filter(x=>x.profit>=500);
  const avgGood=good.length?good.reduce((s,x)=>s+x.profit,0)/good.length:0;
  return {profitTrades:profits.length,goodCount:good.length,avgGood,totalEst:profits.reduce((s,x)=>s+x.profit,0),good};
}

function topCommonPhase(acts,condSet){
  const m=new Map();
  for(const a of acts){
    if(a.type!=='TRADE'||a.side!=='BUY'||!condSet.has(a.conditionId)) continue;
    const k=`${a.conditionId}:${a.outcomeIndex}:${a.title}`;
    const v=m.get(k)||{key:k,title:a.title,conditionId:a.conditionId,outcomeIndex:a.outcomeIndex,buyUsdc:0,buyCount:0};
    v.buyUsdc += Number(a.usdcSize)||0;
    v.buyCount += 1;
    m.set(k,v);
  }
  return [...m.values()].sort((a,b)=>b.buyUsdc-a.buyUsdc)[0]||null;
}

const condSet=new Set(events.flatMap(e=>eventConditions.get(e.id).map(x=>x.conditionId)));

const results=[];
for(const c of candidates){
  try{
    const acts=await getActivity(c.wallet,12);
    const est=estimateProfits(acts);
    if(est.goodCount>=5){
      const common=topCommonPhase(acts,condSet);
      results.push({wallet:c.wallet,name:[...c.names][0]||'',goodCount:est.goodCount,avgGood:est.avgGood,totalEst:est.totalEst,common,acts});
    }
  }catch(e){/*ignore*/}
}

results.sort((a,b)=>b.avgGood-a.avgGood);
const top=results.slice(0,10);

const out=top.map((r,i)=>({
 rank:i+1,wallet:r.wallet,name:r.name,profitTradesGte500:r.goodCount,avgProfitGte500:r.avgGood,totalEstProfit:r.totalEst,
 commonPhase:r.common?{title:r.common.title,outcomeIndex:r.common.outcomeIndex,buyUsdc:r.common.buyUsdc,buyCount:r.common.buyCount}:null
}));

console.log(JSON.stringify({events:events.map(e=>({id:e.id,slug:e.slug,title:e.title})),candidates:candidates.length,qualified:results.length,top:out},null,2));
