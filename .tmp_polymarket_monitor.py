import requests, json, math, os
from datetime import datetime, timezone

NOW = datetime(2026,3,17,10,17,tzinfo=timezone.utc)
BASE='https://gamma-api.polymarket.com/events'
CACHE='/root/.openclaw/workspace/.polymarket_under1_cache.json'

ALLOWED_TAGS = {
    'politics': '政治',
    'sports': '体育',
    'crypto': '加密',
}
FALLBACK_SPORT_TAGS={'nba','nfl','mlb','nhl','soccer','ufc','tennis','golf','cricket','march-madness','champions-league','premier-league','formula-1','f1'}
FALLBACK_CRYPTO_TAGS={'bitcoin','ethereum','solana','xrp','dogecoin','binance','coinbase','kraken','microstrategy'}

session = requests.Session()
session.headers.update({'User-Agent':'Mozilla/5.0 OpenClaw Polymarket Monitor'})

def classify_event(ev):
    tags = ev.get('tags') or []
    slugs = {str(t.get('slug','')).lower() for t in tags}
    labels = {str(t.get('label','')).lower() for t in tags}
    if 'politics' in slugs or 'politics' in labels or 'geopolitics' in slugs:
        return '政治'
    if 'sports' in slugs or 'sports' in labels or slugs & FALLBACK_SPORT_TAGS or labels & FALLBACK_SPORT_TAGS:
        return '体育'
    if 'crypto' in slugs or 'crypto' in labels or slugs & FALLBACK_CRYPTO_TAGS or labels & FALLBACK_CRYPTO_TAGS:
        return '加密'
    return None

def parse_json_field(v, default):
    if isinstance(v, list): return v
    if not v: return default
    try:
        return json.loads(v)
    except Exception:
        return default

def fnum(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return default

ops=[]
offset=0
limit=200
for _ in range(20):
    try:
        r=session.get(BASE, params={'limit':limit,'offset':offset,'closed':'false'}, timeout=30)
        r.raise_for_status()
        batch=r.json()
    except Exception:
        break
    if not isinstance(batch, list) or not batch:
        break
    for ev in batch:
        category=classify_event(ev)
        if not category:
            continue
        for m in ev.get('markets') or []:
            try:
                if not (m.get('active') and not m.get('closed')):
                    continue
                if m.get('acceptingOrders') is False:
                    continue
                end = datetime.fromisoformat(m['endDate'].replace('Z','+00:00'))
                hours=(end-NOW).total_seconds()/3600
                if hours < 2 or hours > 72:
                    continue
                outcomes=parse_json_field(m.get('outcomes'), [])
                prices=[fnum(x) for x in parse_json_field(m.get('outcomePrices'), [])]
                if len(outcomes) != len(prices) or not prices:
                    continue
                idx=max(range(len(prices)), key=lambda i: prices[i])
                prob=prices[idx]
                if prob < 0.80 or prob > 0.98:
                    continue
                spread=fnum(m.get('spread'), 999)
                if spread > 0.008:
                    continue
                volume=fnum(m.get('volumeNum') if m.get('volumeNum') is not None else m.get('volume'))
                liquidity=fnum(m.get('liquidityNum') if m.get('liquidityNum') is not None else m.get('liquidity'))
                if volume < 10000 or liquidity < 10000:
                    continue
                ops.append({
                    'id': str(m.get('id') or m.get('conditionId') or m.get('slug')),
                    'market': m.get('question') or ev.get('title') or '',
                    'category': category,
                    'direction': outcomes[idx],
                    'prob': prob,
                    'spread': spread,
                    'liquidity': liquidity,
                    'volume': volume,
                    'end': end.strftime('%Y-%m-%d %H:%M UTC'),
                })
            except Exception:
                continue
    if len(batch) < limit:
        break
    offset += limit

ops.sort(key=lambda x:(x['end'], -x['prob'], -x['liquidity'], x['market']))

prev={}
if os.path.exists(CACHE):
    try:
        prev=json.load(open(CACHE,'r',encoding='utf-8'))
    except Exception:
        prev={}

new=[]
cur={}
for o in ops:
    key=o['id']
    cur[key]=o
    old=prev.get(key)
    if not old:
        new.append(o)
        continue
    # significant change threshold
    if abs(o['prob']-old.get('prob',-99)) >= 0.02 or abs(o['spread']-old.get('spread',-99)) >= 0.002 or o['direction'] != old.get('direction'):
        new.append(o)

with open(CACHE,'w',encoding='utf-8') as f:
    json.dump(cur,f,ensure_ascii=False,indent=2)

print(json.dumps({'count':len(ops),'new_count':len(new),'items':new}, ensure_ascii=False))
