
const fs = require('fs');
const now = new Date('2026-03-26T17:23:00Z');
const headers = {
  'accept': 'application/json',
  'user-agent': 'Mozilla/5.0',
  'origin': 'https://polymarket.com',
  'referer': 'https://polymarket.com/'
};
function hoursUntil(end){ return (new Date(end) - now)/36e5; }
function classify(m){
  const txt = [m.category, m.question, m.description, m.slug, ...(m.events||[]).map(e=>e?.title||''), ...(m.tags||[]).map(t=>t?.label||t?.name||'')].join(' ').toLowerCase();
  if (/(election|president|senate|house|governor|mayor|minister|parliament|politic|government|congress|trump|biden|rfk|democrat|republican|prime minister|supreme court|campaign)/.test(txt)) return '政治';
  if (/(nba|nfl|mlb|nhl|soccer|football|baseball|basketball|tennis|golf|f1|formula 1|ufc|boxing|championship|playoff|tournament|world cup|champions league|europa|serie a|premier league|la liga|bundesliga|cricket|ncaa|march madness)/.test(txt)) return '体育';
  if (/(bitcoin|btc|eth|ethereum|solana|sol|xrp|crypto|cryptocurrency|doge|bnb|sui|ada|cardano|token|coin|stablecoin|defi|binance|coinbase|kraken|ripple|bitboy|pump.fun|hyperliquid)/.test(txt)) return '加密';
  return null;
}
function safeJsonParse(v, fallback=null){ try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fallback; } }
(async () => {
  let all = [];
  for (let offset=0; offset<2000; offset+=500) {
    const url = 'https://gamma-api.polymarket.com/markets?closed=false&active=true&archived=false&limit=500&offset='+offset;
    const res = await fetch(url, {headers});
    if (!res.ok) break;
    const arr = await res.json();
    all = all.concat(arr);
    if (arr.length < 500) break;
  }
  const matches = [];
  for (const m of all) {
    if (!m || m.closed || m.archived || m.active === false) continue;
    const category = classify(m);
    if (!category) continue;
    const h = hoursUntil(m.endDate);
    if (!(h >= 2 && h <= 72)) continue;
    const outcomes = safeJsonParse(m.outcomes, []);
    const prices = (safeJsonParse(m.outcomePrices, []) || []).map(Number);
    if (!Array.isArray(outcomes) || outcomes.length < 2 || prices.length < 2) continue;
    let bestIdx = -1, bestPrice = -1;
    for (let i=0;i<prices.length;i++) if (prices[i] > bestPrice) { bestPrice = prices[i]; bestIdx = i; }
    if (!(bestPrice >= 0.80 && bestPrice <= 0.96)) continue;
    const bestBid = Number(m.bestBid ?? NaN), bestAsk = Number(m.bestAsk ?? NaN), spreadField = Number(m.spread ?? NaN);
    let spread = Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? (bestAsk - bestBid) : spreadField;
    if (!Number.isFinite(spread)) continue;
    if (spread > 0.008) continue;
    const liq = Number(m.liquidityNum ?? m.liquidity ?? 0);
    const vol = Number(m.volumeNum ?? m.volume ?? 0);
    const metric = Math.max(liq, vol);
    if (metric < 10000) continue;
    matches.push({
      id: String(m.id),
      slug: m.slug,
      question: m.question,
      category,
      direction: outcomes[bestIdx],
      win: bestPrice,
      spread,
      liquidity: liq || vol,
      volume: vol,
      endDate: m.endDate
    });
  }
  matches.sort((a,b)=> new Date(a.endDate)-new Date(b.endDate));
  console.log(JSON.stringify({count: all.length, matches}, null, 2));
})();
