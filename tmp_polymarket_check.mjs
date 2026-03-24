import fs from 'fs';

const NOW = new Date('2026-03-20T10:47:00Z');
const LOWER = new Date(NOW.getTime() + 2*3600*1000);
const UPPER = new Date(NOW.getTime() + 72*3600*1000);
const STATE = '/root/.openclaw/workspace/memory/polymarket_state_31f537fa-b5ab-4914-8c51-9653f05c14ef.json';
const PAGE = 500;

function parseJsonField(v){
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return [];
  try { return JSON.parse(v); } catch { return []; }
}
function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function fmtUtc(s){
  const d = new Date(s);
  const pad=x=>String(x).padStart(2,'0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
function categoryOf(m){
  const text = [m.question,m.description,m.slug,JSON.stringify(m.events||[]),JSON.stringify(parseJsonField(m.tags))]
    .filter(Boolean).join(' ').toLowerCase();
  const sports = [
    /\bvs\.?\b/, /\bnba\b/, /\bnfl\b/, /\bmlb\b/, /\bnhl\b/, /\bncaa\b/, /\bsoccer\b/, /\bfootball\b/, /\btennis\b/, /\bgolf\b/, /\bufc\b/, /\bmma\b/, /\bboxing\b/, /\bf1\b/, /formula 1/, /premier league/, /champions league/, /world cup/, /boilermakers/, /cyclones/, /cougars/, /illini/, /huskies/
  ];
  const crypto = [
    /bitcoin/, /ethereum/, /\bbtc\b/, /\beth\b/, /solana/, /\bsol\b/, /doge/, /xrp/, /cardano/, /crypto/, /token/, /airdrop/, /memecoin/, /stablecoin/, /binance coin/, /\bbnb\b/
  ];
  const politics = [
    /election/, /president/, /prime minister/, /congress/, /senate/, /house of representatives/, /governor/, /mayor/, /parliament/, /republican/, /democrat/, /white house/, /trump/, /biden/, /xi jinping/, /putin/, /zelensky/, /ceasefire/, /israel/, /gaza/, /ukraine/, /tariff/, /cabinet/
  ];
  if (sports.some(r=>r.test(text))) return '体育';
  if (crypto.some(r=>r.test(text))) return '加密';
  if (politics.some(r=>r.test(text))) return '政治';
  return null;
}
function materiallyChanged(oldItem, newItem){
  if (!oldItem) return true;
  const oldDirection = oldItem.direction ?? (oldItem.line ? oldItem.line.split('｜')[2] : undefined);
  const oldProb = oldItem.probability ?? oldItem.prob ?? null;
  const oldSpread = oldItem.spread ?? oldItem.priceDiff ?? null;
  const oldLiquidity = oldItem.liquidity ?? 0;
  const oldExpiry = oldItem.expiry ?? oldItem.end ?? null;
  if (oldDirection !== newItem.direction) return true;
  if (oldProb != null && Math.abs(oldProb - newItem.prob) >= 0.01) return true;
  if (oldSpread != null && Math.abs(oldSpread - newItem.spread) >= 0.002) return true;
  if (oldLiquidity > 0 && Math.abs(newItem.liquidity - oldLiquidity) / oldLiquidity >= 0.2) return true;
  if (oldExpiry !== newItem.end) return true;
  return false;
}

async function j(url){
  const r = await fetch(url, {headers:{'accept':'application/json','user-agent':'OpenClaw Polymarket monitor'}});
  if(!r.ok) throw new Error(String(r.status));
  return r.json();
}

const markets=[];
for(let offset=0; offset<=6000; offset+=PAGE){
  let arr=[];
  try{
    arr = await j(`https://gamma-api.polymarket.com/markets?active=true&closed=false&archived=false&order=endDate&ascending=true&limit=${PAGE}&offset=${offset}`);
  }catch{
    continue;
  }
  if(!Array.isArray(arr) || arr.length===0) break;
  const lastEnd = new Date(arr[arr.length-1].endDate);
  for(const m of arr){
    const end = new Date(m.endDate);
    if(end >= LOWER && end <= UPPER) markets.push(m);
  }
  if(lastEnd > UPPER) break;
}

const current=[];
for(const m of markets){
  try{
    const end = new Date(m.endDate);
    if(!(end >= LOWER && end <= UPPER)) continue;
    if(m.closed || m.archived || m.active === false || m.acceptingOrders === false) continue;
    const category = categoryOf(m);
    if(!category) continue;
    const outcomes = parseJsonField(m.outcomes);
    const prices = parseJsonField(m.outcomePrices).map(num);
    const tokenIds = parseJsonField(m.clobTokenIds);
    if(outcomes.length < 2 || outcomes.length !== prices.length || outcomes.length !== tokenIds.length) continue;
    let idx = -1, bestP = -1;
    for(let i=0;i<prices.length;i++){
      if(prices[i] != null && prices[i] > bestP){ bestP = prices[i]; idx=i; }
    }
    if(idx < 0) continue;
    if(!(bestP >= 0.80 && bestP <= 0.96)) continue;
    const liquidity = Math.max(num(m.liquidityNum) ?? num(m.liquidity) ?? 0, num(m.volume24hr) ?? 0, num(m.volumeNum) ?? num(m.volume) ?? 0);
    if(liquidity < 10000) continue;
    let spread = num(m.spread);
    const tokenId = tokenIds[idx];
    try{
      const book = await j(`https://clob.polymarket.com/book?token_id=${tokenId}`);
      const bids = (book.bids||[]).map(x=>num(x.price)).filter(x=>x!=null);
      const asks = (book.asks||[]).map(x=>num(x.price)).filter(x=>x!=null);
      if(!asks.length) continue;
      const bestAsk = Math.min(...asks);
      const bestBid = bids.length ? Math.max(...bids) : 0;
      spread = Math.max(0, bestAsk - bestBid);
    }catch{
      if(spread == null) continue;
    }
    if(spread > 0.008) continue;
    current.push({
      key: String(m.id),
      market: (m.question||'').trim(),
      category,
      direction: outcomes[idx],
      prob: +bestP.toFixed(4),
      probability: +(bestP*100).toFixed(1),
      spread: +spread.toFixed(4),
      liquidity: +liquidity.toFixed(4),
      end: m.endDate,
      expiry: fmtUtc(m.endDate),
      line: `${(m.question||'').trim()}｜${category}｜${outcomes[idx]}｜${(bestP*100).toFixed(1)}%｜${spread.toFixed(4)}｜${Math.round(liquidity)}｜${fmtUtc(m.endDate)}`
    });
  }catch{}
}

let prev={items:{}};
try{ prev = JSON.parse(fs.readFileSync(STATE,'utf8')); }catch{}
const prevItems = prev.items || {};
const currentItems = Object.fromEntries(current.map(x=>[x.key,x]));
const alerts = current.filter(x=>materiallyChanged(prevItems[x.key], x));
fs.writeFileSync(STATE, JSON.stringify({updatedAt:new Date().toISOString(), items: currentItems, count: current.length}, null, 2));
console.log(JSON.stringify({alerts, currentCount: current.length}, null, 2));
