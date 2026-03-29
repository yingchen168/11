const https = require('https');
const fs = require('fs');
const path = require('path');
const now = new Date('2026-03-29T07:53:00Z');
const statePath = '/root/.openclaw/workspace/.cache/polymarket-under1-near-expiry.json';

function fetchJson(url){
  return new Promise((resolve,reject)=>{
    https.get(url,res=>{
      let data='';
      res.on('data',c=>data+=c);
      res.on('end',()=>{
        try { resolve(JSON.parse(data)); } catch(e){ reject(e); }
      });
    }).on('error',reject);
  });
}

function catOf(m){
  const txt = [m.question, m.description, ...(m.events||[]).map(e=>[e.title,e.description,e.slug,e.ticker].join(' '))].join(' ').toLowerCase();
  const eventMeta = (m.events||[]).map(e=> (e.tags||[]).map(t=> (t.label||t.slug||t.name||'')).join(' ')).join(' ').toLowerCase();
  const s = txt + ' ' + eventMeta;
  const sports = ['nba','nfl','mlb','nhl','ufc','mma','soccer','football','baseball','basketball','tennis','golf','f1','formula 1','cricket','champions league','premier league','la liga','serie a','bundesliga','ncaa','super bowl','world cup','wimbledon','march madness'];
  const crypto = ['bitcoin','btc','ethereum','eth','solana','sol','xrp','doge','crypto','token','coin','binance','coinbase','polkadot','cardano','sui','avax','berachain','hyperliquid','aptos','tron','bnb'];
  const politics = ['election','president','prime minister','senate','house','congress','governor','mayor','parliament','democrat','republican','trump','biden','putin','zelensky','polls','approval','cabinet','minister','political'];
  if (sports.some(k=>s.includes(k))) return '体育';
  if (crypto.some(k=>s.includes(k))) return '加密';
  if (politics.some(k=>s.includes(k))) return '政治';
  return null;
}

function parseArr(x){ try { return JSON.parse(x); } catch { return []; } }

(async()=>{
  let all=[];
  for(let offset=0; offset<2500; offset+=500){
    try {
      const arr = await fetchJson('https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=500&offset='+offset);
      if(!Array.isArray(arr) || !arr.length) break;
      all = all.concat(arr);
      if(arr.length < 500) break;
    } catch(e) {
      break;
    }
  }

  const picks=[];
  for(const m of all){
    try {
      if(!m || m.closed || !m.active || !m.acceptingOrders) continue;
      const category = catOf(m);
      if(!category) continue;
      const end = new Date(m.endDate || m.endDateIso);
      if(isNaN(end)) continue;
      const hours = (end - now)/36e5;
      if(hours < 2 || hours > 72) continue;
      const liq = Number(m.liquidityNum || m.liquidity || 0);
      const vol = Number(m.volumeNum || m.volume || 0);
      if(Math.max(liq, vol) < 10000) continue;
      const spread = Number(m.spread ?? ((Number(m.bestAsk)||0) - (Number(m.bestBid)||0)));
      if(!(spread <= 0.008)) continue;
      const outcomes = parseArr(m.outcomes);
      const prices = parseArr(m.outcomePrices).map(Number);
      if(outcomes.length !== prices.length || !prices.length) continue;
      let idx = 0;
      for(let i=1;i<prices.length;i++) if(prices[i] > prices[idx]) idx=i;
      const p = prices[idx];
      if(!(p >= 0.80 && p <= 0.96)) continue;
      picks.push({
        id: String(m.id),
        market: m.question.trim(),
        category,
        direction: outcomes[idx],
        prob: p,
        spread,
        liquidity: Math.round(Math.max(liq, vol)),
        end: end.toISOString().replace('.000Z','Z')
      });
    } catch {}
  }

  picks.sort((a,b)=> a.end.localeCompare(b.end) || b.prob-a.prob || a.market.localeCompare(b.market));

  let prev={items:[]};
  try { prev = JSON.parse(fs.readFileSync(statePath,'utf8')); } catch {}
  const prevMap = new Map((prev.items||[]).map(x=>[x.id,x]));
  const changed = picks.filter(x=>{
    const p = prevMap.get(x.id);
    if(!p) return true;
    return p.direction !== x.direction || Math.abs((p.prob||0)-x.prob) >= 0.02 || Math.abs((p.spread||0)-x.spread) >= 0.002 || p.end !== x.end;
  });

  fs.mkdirSync(path.dirname(statePath), {recursive:true});
  fs.writeFileSync(statePath, JSON.stringify({items:picks, updatedAt:new Date().toISOString()}, null, 2));

  if(!changed.length){
    console.log('NO_REPLY');
    return;
  }

  for(const x of changed){
    console.log(x.market + '｜' + x.category + '｜' + x.direction + '｜' + (x.prob*100).toFixed(1) + '%｜' + (x.spread*100).toFixed(2) + '%｜' + x.liquidity + 'U｜' + x.end);
  }
})();
