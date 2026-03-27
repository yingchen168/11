const fs = require('fs');

const NOW = new Date('2026-03-27T04:53:00Z');
const STATE_PATH = '/root/.openclaw/workspace/data/polymarket_under1_state.json';

function classify(m) {
  const text = [m.question, m.description, m.slug, ...(m.events||[]).map(e => [e.title,e.slug,e.description]).join(' ')].join(' ').toLowerCase();
  const sports = /(nba|nfl|mlb|nhl|ufc|mma|formula 1|f1|soccer|football|baseball|basketball|tennis|golf|cricket|olympic|champions league|premier league|la liga|serie a|bundesliga|ncaa|march madness|stanley cup|world cup|super bowl|wimbledon|race|match|fight|game [0-9]|wins?\?|vs\.? )/;
  const crypto = /(bitcoin|btc|ethereum|eth|solana|sol|xrp|doge|crypto|token|coin|binance|kraken|coinbase|base chain|airdrop|meme coin|market cap|onchain|staking|defi|nft|opensea|hyperliquid|satoshi)/;
  const politics = /(election|president|presidential|senate|house|governor|mayor|prime minister|parliament|congress|minister|campaign|gop|democrat|republican|white house|trump|biden|rfk|macron|putin|zelensky|vote share|approval|cabinet|politic)/;
  if (sports.test(text)) return '体育';
  if (crypto.test(text)) return '加密';
  if (politics.test(text)) return '政治';
  return null;
}

async function fetchAll(){
  let offset=0, all=[];
  while(offset<5000){
    const url=`https://gamma-api.polymarket.com/markets?closed=false&active=true&archived=false&limit=500&offset=${offset}`;
    const res=await fetch(url,{headers:{accept:'application/json'}});
    if(!res.ok) throw new Error('http '+res.status);
    const data=await res.json();
    if(!Array.isArray(data)||data.length===0) break;
    all.push(...data);
    if(data.length<500) break;
    offset += data.length;
  }
  return all;
}

function parseArr(v){
  if(Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return []; }
}

function fmtPct(x){ return (x*100).toFixed(1)+'%'; }
function fmtSpread(x){ return (x*100).toFixed(1)+'%'; }
function fmtLiq(x){ return (Math.round(x)).toString()+'U'; }

(async()=>{
  const all = await fetchAll();
  const out = [];
  for(const m of all){
    try{
      const category = classify(m);
      if(!category) continue;
      if(!m.acceptingOrders || m.closed || !m.active || m.archived) continue;
      const end = new Date(m.endDate);
      const hrs = (end - NOW)/36e5;
      if(!(hrs >= 2 && hrs <= 72)) continue;
      const liq = Number(m.liquidityNum ?? m.liquidityClob ?? m.liquidity ?? 0);
      const vol = Number(m.volumeNum ?? m.volumeClob ?? m.volume ?? 0);
      if(Math.max(liq, vol) < 10000) continue;
      const prices = parseArr(m.outcomePrices).map(Number);
      const outcomes = parseArr(m.outcomes);
      if(prices.length !== 2 || outcomes.length !== 2) continue;
      const bestIdx = prices[0] >= prices[1] ? 0 : 1;
      const win = prices[bestIdx];
      if(!(win >= 0.80 && win <= 0.96)) continue;
      const spread = Number(m.spread ?? 999);
      if(!(spread <= 0.008)) continue;
      const direction = outcomes[bestIdx];
      const line = `${m.question}｜${category}｜${direction}｜${fmtPct(win)}｜${fmtSpread(spread)}｜${fmtLiq(Math.max(liq, vol))}｜${end.toISOString().replace('.000','')}`;
      out.push({id:String(m.id), line, win, spread, liq:Math.max(liq,vol), end:end.toISOString()});
    }catch{}
  }
  out.sort((a,b)=> a.end.localeCompare(b.end) || b.win-a.win || a.spread-b.spread);

  let prev = {items:{}};
  try { prev = JSON.parse(fs.readFileSync(STATE_PATH,'utf8')); } catch {}
  const prevItems = prev.items || {};
  const nextItems = {};
  const lines = [];
  for(const item of out){
    nextItems[item.id] = {line:item.line, win:item.win, spread:item.spread, liq:item.liq, end:item.end};
    const p = prevItems[item.id];
    const changed = !p || p.line !== item.line;
    if(changed) lines.push(item.line);
  }

  fs.mkdirSync('/root/.openclaw/workspace/data',{recursive:true});
  fs.writeFileSync(STATE_PATH, JSON.stringify({updatedAt:new Date().toISOString(), items:nextItems}, null, 2));
  console.log(lines.length ? lines.join('\n') : 'NO_REPLY');
})().catch(()=>{ console.log('NO_REPLY'); });
