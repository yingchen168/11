
const https = require('https');
function get(url){
  return new Promise((resolve,reject)=>{
    https.get(url, res=>{
      let data='';
      res.on('data', c=>data+=c);
      res.on('end', ()=>{
        try { resolve({status:res.statusCode, data: JSON.parse(data)}); }
        catch(e){ reject(new Error('parse:'+e.message+' body:'+data.slice(0,200))); }
      });
    }).on('error', reject);
  });
}
(async()=>{
  let all=[];
  for(let offset=0; offset<2000; offset+=500){
    const url = 'https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=500&offset='+offset;
    const r = await get(url);
    if(!Array.isArray(r.data) || !r.data.length) break;
    all = all.concat(r.data);
    if(r.data.length < 500) break;
  }
  console.log('count', all.length);
  const sample = all.slice(0,3).map(m => ({
    q:m.question,
    endDate:m.endDate,
    liquidity:m.liquidity,
    volume:m.volume,
    spread:m.spread,
    category:m.category,
    tags:m.tags,
    outcomes:m.outcomes,
    outcomePrices:m.outcomePrices,
    active:m.active,
    closed:m.closed,
    archived:m.archived,
    acceptingOrders:m.acceptingOrders,
    marketType:m.marketType,
    events:m.events
  }));
  console.log(JSON.stringify(sample,null,2));
})();
