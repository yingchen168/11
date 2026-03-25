const fs=require('fs');
const now = new Date('2026-03-25T13:53:00Z');
function classify(m){
  const vals=[];
  const add=v=>{ if(v) vals.push(String(v).toLowerCase()); };
  add(m.category); add(m.slug); add(m.question); add(m.description);
  if(Array.isArray(m.tags)) m.tags.forEach(t=>add(t));
  const s=vals.join(' | ');
  if (/(crypto|bitcoin|btc|eth|ethereum|solana|xrp|doge|bnb|token|coin|airdrop|sec|etf|stablecoin|defi|nft|altcoin)/i.test(s)) return '加密';
  if (/(nba|nfl|mlb|nhl|ncaa|soccer|football|baseball|basketball|tennis|golf|ufc|mma|f1|formula 1|champions league|premier league|la liga|serie a|bundesliga|world cup|olympics|march madness|sport)/i.test(s)) return '体育';
  if (/(election|president|presidential|senate|house|governor|mayor|parliament|prime minister|trump|biden|democrat|republican|politic|government|tariff|fed chair|congress|cabinet|white house|minister)/i.test(s)) return '政治';
  return null;
}
function fmtPct(x){return (x*100).toFixed(1)+'%';}
function fmtSpread(x){return (x*100).toFixed(2)+'%';}
async function getJson(url){ const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'application/json'}}); if(!r.ok) throw new Error('http '+r.status); return r.json(); }
(async()=>{
  let cursor='';
  const candidates=[];
  for(let i=0;i<80;i++){
    let url='https://clob.polymarket.com/markets';
    if(cursor) url += '?next_cursor='+encodeURIComponent(cursor);
    else url += '?next_cursor=MA==';
    let j;
    try{ j=await getJson(url); }catch(e){ break; }
    const data=j.data||[];
    for(const m of data){
      try{
        if(!m.active || m.closed || m.archived || !m.accepting_orders) continue;
        const cat=classify(m);
        if(!cat) continue;
        const end=new Date(m.end_date_iso || m.endDate || m.end_date);
        if(isNaN(end)) continue;
        const hrs=(end-now)/36e5;
        if(hrs < 2 || hrs > 72) continue;
        const toks=Array.isArray(m.tokens)?m.tokens:[];
        if(toks.length<2) continue;
        let best=toks[0];
        for(const t of toks){ if((Number(t.price)||0) > (Number(best.price)||0)) best=t; }
        const p=Number(best.price||0);
        if(p < 0.80 || p > 0.96) continue;
        const spread = Number(m.minimum_tick_size||0.01);
        if(spread > 0.008) continue;
        const liq = Number(m.liquidity ?? m.liquidity_num ?? 0);
        const vol = Number(m.volume ?? m.volume_num ?? 0);
        if(Math.max(liq,vol) < 10000) continue;
        candidates.push({
          id:m.condition_id||m.question_id||m.market_slug,
          market:m.question,
          category:cat,
          direction:best.outcome,
          prob:p,
          spread,
          liquidity: Math.max(liq,vol),
          end: end.toISOString().replace('.000','')
        });
      }catch{}
    }
    cursor=j.next_cursor;
    if(!cursor || cursor==='LTE=' || data.length===0) break;
  }
  candidates.sort((a,b)=> new Date(a.end)-new Date(b.end));
  const statePath='/root/.openclaw/workspace/.polymarket_under1_state.json';
  let prev={items:{}};
  try{ prev=JSON.parse(fs.readFileSync(statePath,'utf8')); }catch{}
  const next={items:{}};
  const out=[];
  for(const c of candidates){
    const line=`${c.market}｜${c.category}｜${c.direction}｜${fmtPct(c.prob)}｜${fmtSpread(c.spread)}｜${Math.round(c.liquidity)}U｜${c.end}`;
    next.items[c.id]={line,prob:c.prob,spread:c.spread,liquidity:c.liquidity,end:c.end};
    const p=prev.items[c.id];
    if(!p){ out.push(line); continue; }
    if(Math.abs((p.prob??0)-c.prob)>=0.02 || Math.abs((p.spread??0)-c.spread)>=0.002 || Math.abs((p.liquidity??0)-c.liquidity)>=5000 || p.end!==c.end){ out.push(line); }
  }
  fs.writeFileSync(statePath, JSON.stringify(next,null,2));
  console.log(out.length?out.join('\n'):'NO_REPLY');
})();
