
const https = require('https');
const now = new Date('2026-03-25T16:53:00Z');
function get(url){
  return new Promise((resolve,reject)=>{
    https.get(url,res=>{
      let data='';
      res.on('data',c=>data+=c);
      res.on('end',()=>{
        try{ resolve({status:res.statusCode, data: JSON.parse(data)}); }
        catch(e){ reject(new Error('parse:'+e.message+' body:'+data.slice(0,200))); }
      });
    }).on('error',reject);
  });
}
(async()=>{
  let all=[];
  for(let offset=0; offset<2000; offset+=500){
    const url = 'https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=500&offset='+offset;
    const resp = await get(url);
    if(resp.status!==200) throw new Error('http '+resp.status);
    if(!Array.isArray(resp.data) || !resp.data.length) break;
    all = all.concat(resp.data);
    if(resp.data.length<500) break;
  }
  const picks=[];
  for(const m of all){
    try{
      const cat = String(m.category||m.categories||'').toLowerCase();
      const question = m.question || m.title || '';
      const end = new Date(m.endDate || m.end_date || m.expirationDate || m.expiration_date);
      if(!question || !end || isNaN(end)) continue;
      const hours = (end - now)/36e5;
      if(hours < 2 || hours > 72) continue;
      const liquidity = Number(m.liquidity || m.liquidityNum || 0);
      const volume = Number(m.volume || m.volumeNum || m.volume24hr || 0);
      const lv = Math.max(liquidity, volume);
      if(lv < 10000) continue;
      const tokens = m.tokens || [];
      if(tokens.length < 2) continue;
      const prices = tokens.map(t => ({outcome:t.outcome, price:Number(t.price)})).filter(t => Number.isFinite(t.price));
      if(prices.length < 2) continue;
      prices.sort((a,b)=>b.price-a.price);
      const top=prices[0], second=prices[1];
      if(top.price < 0.80 || top.price > 0.96) continue;
      const spread = Number(m.spread ?? m.bestAskMinusBestBid ?? m.priceSpread ?? NaN);
      const useSpread = Number.isFinite(spread) ? spread : Math.abs(top.price + second.price - 1);
      if(useSpread > 0.008) continue;
      const text = (cat + ' ' + (m.events||[]).map(e=>e?.title||'').join(' ') + ' ' + question).toLowerCase();
      let klass = null;
      if(/politic|election|president|senate|house|governor|mayor|minister|parliament|trump|biden|rfk|民主|共和/.test(text)) klass='政治';
      else if(/sport|soccer|football|nba|nfl|mlb|nhl|tennis|golf|ufc|fight|f1|formula 1|champions league|premier league|laliga|serie a|bundesliga|ncaa|march madness/.test(text)) klass='体育';
      else if(/crypto|bitcoin|btc|eth|ethereum|solana|xrp|doge|token|airdrop|fed rate cut|blockchain|stablecoin|binance|coinbase/.test(text)) klass='加密';
      else continue;
      if(m.closed || m.archived || m.enableOrderBook === false) continue;
      picks.push({
        id:m.id,
        market:question.replace(/s+/g,' ').trim(),
        category:klass,
        direction:top.outcome,
        prob:top.price,
        spread:useSpread,
        liquidity:liquidity,
        end:end.toISOString()
      });
    }catch{}
  }
  picks.sort((a,b)=>new Date(a.end)-new Date(b.end));
  console.log(JSON.stringify({count:all.length,picks},null,2));
})().catch(err=>{ console.error(String(err.stack||err)); process.exit(1); });
