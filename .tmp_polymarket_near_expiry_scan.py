import requests, json, os
from datetime import datetime, timezone

NOW = datetime(2026,3,20,19,47,tzinfo=timezone.utc)
BASE='https://gamma-api.polymarket.com/events'
STATE='/root/.openclaw/workspace/memory/polymarket_state_31f537fa-b5ab-4914-8c51-9653f05c14ef.json'

FALLBACK_SPORT_TAGS={
    'nba','nfl','mlb','nhl','soccer','ufc','tennis','golf','cricket','march-madness','champions-league',
    'premier-league','formula-1','f1','ncaa','baseball','basketball','football','hockey'
}
FALLBACK_CRYPTO_TAGS={'bitcoin','ethereum','solana','xrp','dogecoin','binance','coinbase','kraken','microstrategy'}

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
    try: return json.loads(v)
    except Exception: return default

def fnum(v, default=0.0):
    try: return float(v)
    except Exception: return default

session = requests.Session()
session.headers.update({'User-Agent':'Mozilla/5.0 OpenClaw Polymarket Monitor'})

ops=[]
offset=0
limit=200
for _ in range(10):
    try:
        r=session.get(BASE, params={'limit':limit,'offset':offset,'closed':'false','active':'true'}, timeout=30)
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
                if not (m.get('active') and not m.get('closed') and m.get('acceptingOrders')):
                    continue
                end_raw=m.get('endDate') or ev.get('endDate')
                if not end_raw:
                    continue
                end = datetime.fromisoformat(end_raw.replace('Z','+00:00'))
                hours=(end-NOW).total_seconds()/3600
                if hours < 2 or hours > 72:
                    continue
                outcomes=parse_json_field(m.get('outcomes'), [])
                prices=[fnum(x) for x in parse_json_field(m.get('outcomePrices'), [])]
                if len(outcomes) != len(prices) or not prices:
                    continue
                idx=max(range(len(prices)), key=lambda i: prices[i])
                prob=prices[idx]
                if prob < 0.80 or prob > 0.96:
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
                    'market': (m.get('question') or ev.get('title') or '').replace('\n',' ').strip(),
                    'category': category,
                    'direction': outcomes[idx],
                    'prob': round(prob,4),
                    'spread': round(spread,4),
                    'liquidity': round(liquidity,2),
                    'volume': round(volume,2),
                    'end': end.strftime('%Y-%m-%d %H:%M UTC'),
                })
            except Exception:
                continue
    if len(batch) < limit:
        break
    offset += limit

ops.sort(key=lambda x:(x['end'], -x['prob'], -x['liquidity'], x['market']))

prev={'items':{}}
if os.path.exists(STATE):
    try:
        prev=json.load(open(STATE,'r',encoding='utf-8'))
    except Exception:
        prev={'items':{}}
prev_items=prev.get('items',{}) if isinstance(prev,dict) else {}

new=[]
cur={}
for o in ops:
    key=o['id']
    cur[key]=o
    old=prev_items.get(key)
    if not old:
        new.append(o)
        continue
    if abs(o['prob']-float(old.get('prob',-99))) >= 0.02 or abs(o['spread']-float(old.get('spread',-99))) >= 0.002 or o['direction'] != old.get('direction'):
        new.append(o)

with open(STATE,'w',encoding='utf-8') as f:
    json.dump({'updatedAt': NOW.isoformat().replace('+00:00','Z'), 'items': cur, 'count': len(cur)}, f, ensure_ascii=False, indent=2)

print(json.dumps({'count':len(ops),'new_count':len(new),'items':new[:50]}, ensure_ascii=False))
