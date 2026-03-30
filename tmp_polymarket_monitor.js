
async function fetchAll(){
  let all=[];
  for (let offset=0; offset<2500; offset+=500){
    const url='https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=500&offset='+offset;
    const res=await fetch(url);
    const data=await res.json();
    if (!Array.isArray(data) || !data.length) break;
    all=all.concat(data);
    if (data.length<500) break;
  }
  return all;
}
function classify(m){
  const t=((m.question||'')+' '+(m.events||[]).map(e=>e.title||'').join(' ')+' '+(m.events||[]).map(e=>e.slug||'').join(' ')+' '+(m.slug||'')).toLowerCase();
  const sports = /(nba|nfl|mlb|nhl|ncaa|soccer|football|basketball|baseball|tennis|golf|f1|formula 1|ufc|boxing|cricket|ipl|champion|tournament|playoff|world cup|olympic|epl|la liga|serie a|bundesliga|mavericks|bucks|thunder|spurs|natus|sk gaming|lol|esports)/;
  const crypto = /(bitcoin|btc|eth|ethereum|solana|sol|xrp|doge|crypto|token|airdrop|fdv|launch|binance|coinbase|opbnb|memecoin|stablecoin)/;
  const politics = /(trump|president|presidential|prime minister|election|nominee|democrat|republican|senate|house|government|gov shutdown|fed decision|fed |ukraine|russia|iran|ceasefire|netanyahu|hungary|diplomatic|regime|visit china|us forces|dhs shutdown|hormuz|parliamentary)/;
  if (sports.test(t)) return '体育';
  if (crypto.test(t)) return '加密';
  if (politics.test(t)) return '政治';
  return null;
}
function parseJSONMaybe(x){ if (Array.isArray(x)) return x; try{return JSON.parse(x)}catch{return null}}
(async()=>{
  const now = new Date('2026-03-30T13:23:00Z').getTime();
  const markets = await fetchAll();
  const out=[];
  for (const m of markets){
    if (!m.active || m.closed || !m.acceptingOrders) continue;
    const cat=classify(m); if (!cat) continue;
    const end = new Date(m.endDate || m.endDateIso || 0).getTime();
    if (!end || Number.isNaN(end)) continue;
    const hours=(end-now)/36e5;
    if (hours < 2 || hours > 72) continue;
    const liq = Number(m.liquidityNum ?? m.liquidity ?? 0);
    const vol = Number(m.volumeNum ?? m.volume ?? 0);
    if (Math.max(liq,vol) < 10000) continue;
    const spread = Number(m.spread ?? ((m.bestAsk!=null && m.bestBid!=null)? (Number(m.bestAsk)-Number(m.bestBid)) : NaN));
    if (!(spread <= 0.008)) continue;
    const outcomes = parseJSONMaybe(m.outcomes) || [];
    const prices = (parseJSONMaybe(m.outcomePrices) || []).map(Number);
    if (outcomes.length!==2 || prices.length!==2) continue;
    let idx= prices[0]>=prices[1]?0:1;
    const p=prices[idx];
    if (!(p>=0.80 && p<=0.96)) continue;
    out.push({
      id:m.id,
      q:m.question.replace(/s+/g,' ').trim(),
      cat,
      dir:outcomes[idx],
      p,
      spread,
      liq: Math.max(liq,vol),
      end:new Date(end).toISOString().replace('.000Z','Z')
    });
  }
  out.sort((a,b)=>new Date(a.end)-new Date(b.end));
  console.log(JSON.stringify(out,null,2));
})();
