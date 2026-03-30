const https = require('https');
const fs = require('fs');
const now = new Date('2026-03-29T22:53:00Z').getTime();
const prevPath = '/root/.openclaw/workspace/polymarket_prev_matches.json';

function fetch(url){
  return new Promise((resolve,reject)=>{
    https.get(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}},res=>{
      let data='';
      res.on('data',c=>data+=c);
      res.on('end',()=>{
        if(res.statusCode>=200 && res.statusCode<300) resolve(data);
        else reject(new Error('HTTP '+res.statusCode));
      });
    }).on('error',reject);
  });
}

function classify(m){
  const text = [m.question, m.description, m.slug, ...(m.events||[]).map(e=>e.title||''), ...(m.tags||[]).map(t=> typeof t==='string'?t:(t.label||t.name||''))].join(' ').toLowerCase();
  const sports = /(nba|nfl|mlb|nhl|soccer|football|tennis|golf|f1|formula\s*1|nascar|ufc|mma|boxing|champions league|premier league|la liga|serie a|bundesliga|world cup|olympics|wimbledon|super bowl|march madness|ncaa|baseball|basketball|hockey|cricket|rugby|atp|wta|mls|epl|stanley cup|playoffs?|grand prix|race winner|tournament|match|vs\.? )/;
  const politics = /(election|president|presidential|senate|house|governor|mayor|congress|parliament|prime minister|\bpm\b|trump|biden|harris|democrat|republican|gop|vote|voter|campaign|politic|approval|white house|cabinet|minister|supreme court|speaker of the house|eu election|midterm|ballot|polls? close|seat(s)? won)/;
  const crypto = /(bitcoin|\bbtc\b|ethereum|\beth\b|solana|\bsol\b|xrp|doge|crypto|token|coin\b|airdrop|binance|coinbase|kraken|blockchain|\bton\b|\bsui\b|aptos|cardano|\bada\b|avalanche|\bavax\b|polkadot|\bdot\b|litecoin|\bltc\b|ripple|memecoin|altcoin|onchain|stablecoin|usdt|usdc|defi|nft|layer 2|l2|arb|arbitrum|optimism)/;
  if (sports.test(text)) return '体育';
  if (politics.test(text)) return '政治';
  if (crypto.test(text)) return '加密';
  return null;
}

function parseJsonMaybe(v, fallback){
  try {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return JSON.parse(v);
  } catch {}
  return fallback;
}

(async()=>{
  let markets=[];
  for (const limit of [1000, 500]) {
    try {
      const txt = await fetch(`https://gamma-api.polymarket.com/markets?closed=false&limit=${limit}`);
      const arr = JSON.parse(txt);
      if (Array.isArray(arr) && arr.length) { markets = arr; break; }
    } catch {}
  }

  const matches=[];
  for(const m of markets){
    try {
      const cat = classify(m);
      if(!cat) continue;
      if(!m || !m.active || m.closed || m.archived) continue;
      if(m.acceptingOrders === false) continue;
      const end = new Date(m.endDate || m.end_date || '').getTime();
      if(!isFinite(end)) continue;
      const hours = (end-now)/36e5;
      if(hours < 2 || hours > 72) continue;

      const liq = Number(m.liquidityNum ?? m.liquidityClob ?? m.liquidity ?? 0);
      const vol = Number(m.volumeNum ?? m.volumeClob ?? m.volume ?? 0);
      const sizeMetric = Math.max(liq, vol);
      if(sizeMetric < 10000) continue;

      const prices = parseJsonMaybe(m.outcomePrices, []).map(Number).filter(x=>isFinite(x));
      if(prices.length < 2) continue;
      const outcomes = parseJsonMaybe(m.outcomes, []);
      let idx = 0, best = -1;
      for(let i=0;i<prices.length;i++) if(prices[i] > best){ best = prices[i]; idx = i; }
      if(best < 0.80 || best > 0.96) continue;

      const bid = Number(m.bestBid);
      const ask = Number(m.bestAsk);
      let spread = Number(m.spread);
      if(!isFinite(spread) || spread < 0){
        if(isFinite(bid) && isFinite(ask)) spread = ask - bid;
      }
      if(!isFinite(spread) || spread > 0.008) continue;

      matches.push({
        id: String(m.id),
        market: m.question,
        category: cat,
        direction: String(outcomes[idx] ?? `Outcome${idx+1}`),
        prob: Number(best.toFixed(4)),
        spread: Number(spread.toFixed(4)),
        liquidity: Math.round(sizeMetric),
        end: new Date(end).toISOString().replace('.000','')
      });
    } catch {}
  }

  matches.sort((a,b)=> a.end.localeCompare(b.end) || b.prob-a.prob || a.spread-b.spread || b.liquidity-a.liquidity);

  let prev=[];
  try { prev = JSON.parse(fs.readFileSync(prevPath,'utf8')); if(!Array.isArray(prev)) prev=[]; } catch {}
  const prevMap = new Map(prev.map(x=>[x.id, x]));
  const newOrChanged = matches.filter(x=>{
    const p = prevMap.get(x.id);
    if(!p) return true;
    return p.direction !== x.direction || Math.abs((p.prob||0)-x.prob) >= 0.01 || Math.abs((p.spread||0)-x.spread) >= 0.002 || Math.abs((p.liquidity||0)-x.liquidity) >= 5000 || p.end !== x.end;
  });

  fs.writeFileSync(prevPath, JSON.stringify(matches, null, 2));
  if(!newOrChanged.length){
    console.log('NO_REPLY');
    return;
  }
  console.log(newOrChanged.map(x=>`${x.market}｜${x.category}｜${x.direction}｜${x.prob.toFixed(4)}｜${x.spread.toFixed(4)}｜${x.liquidity}U｜${x.end}`).join('\n'));
})();
