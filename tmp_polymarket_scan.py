import requests, json, math, os
from datetime import datetime, timezone
from collections import defaultdict

NOW = datetime(2026,3,10,20,24,tzinfo=timezone.utc)
STATE_PATH = '/root/.openclaw/workspace/memory/polymarket-under1-near-expiry-state-v2.json'
OUT_PATH = '/root/.openclaw/workspace/memory/polymarket-under1-near-expiry-last-run.json'

sess = requests.Session()
sess.headers.update({'User-Agent':'Mozilla/5.0 OpenClaw/PolymarketScan'})

def get_json(url):
    r = sess.get(url, timeout=20)
    r.raise_for_status()
    return r.json()

markets=[]
limit=500
for offset in range(0, 4000, limit):
    url=f'https://gamma-api.polymarket.com/markets?active=true&closed=false&archived=false&limit={limit}&offset={offset}'
    try:
        batch=get_json(url)
        if not batch:
            break
        markets.extend(batch)
        if len(batch)<limit:
            break
    except Exception:
        continue

cache={}
book_fail=0

def get_book(token_id):
    global book_fail
    if token_id in cache:
        return cache[token_id]
    try:
        data=get_json(f'https://clob.polymarket.com/book?token_id={token_id}')
    except Exception:
        book_fail += 1
        data=None
    cache[token_id]=data
    return data

def parse_arr(v):
    if v is None:
        return []
    if isinstance(v, list):
        return v
    try:
        return json.loads(v)
    except Exception:
        return []

def bests(book):
    if not book:
        return None
    asks=[(float(x['price']), float(x['size'])) for x in book.get('asks',[]) if x.get('price') is not None and x.get('size') is not None]
    bids=[(float(x['price']), float(x['size'])) for x in book.get('bids',[]) if x.get('price') is not None and x.get('size') is not None]
    if not asks:
        return None
    ask_p, ask_s = min(asks, key=lambda t:t[0])
    bid_p, bid_s = (max(bids, key=lambda t:t[0]) if bids else (0.0,0.0))
    return {
        'ask': ask_p,
        'ask_size': ask_s,
        'bid': bid_p,
        'bid_size': bid_s,
        'spread': max(0.0, ask_p-bid_p),
        'depth_dollars': ask_p*ask_s,
    }

strict=[]
aggr=[]
for m in markets:
    try:
        end = datetime.fromisoformat(m['endDate'].replace('Z','+00:00'))
    except Exception:
        continue
    hours = (end-NOW).total_seconds()/3600
    if hours <= 2:
        continue
    outcomes=parse_arr(m.get('outcomes'))
    prices=parse_arr(m.get('outcomePrices'))
    token_ids=parse_arr(m.get('clobTokenIds'))
    if not outcomes or len(outcomes)!=len(token_ids):
        continue
    books=[]
    bad=False
    for tid in token_ids:
        book=get_book(tid)
        info=bests(book)
        if not info:
            bad=True
            break
        books.append(info)
    if bad:
        continue

    # strict
    if hours <= 72:
        sum_asks = sum(b['ask'] for b in books)
        bundle_depth = min(b['depth_dollars'] for b in books)
        net_margin = 1 - sum_asks - 0.01  # conservative 1% fee/slippage haircut
        if sum_asks < 1 and net_margin >= 0.012 and bundle_depth >= 5000:
            strict.append({
                'tier':'strict',
                'key': f"strict::{m.get('id')}",
                'market': m.get('question','').strip(),
                'direction': '互斥完备组合',
                'prob': 1 - sum_asks,
                'expiry': end.strftime('%Y-%m-%d %H:%M UTC'),
                'liquidity': bundle_depth,
                'spread': max(b['spread'] for b in books),
            })

    # aggressive
    if hours <= 24*7:
        text=' '.join(str(x) for x in [m.get('question',''), m.get('description',''), m.get('category',''), m.get('slug','')]).lower()
        tags=' '.join(str(x).lower() for x in parse_arr(m.get('tags')))
        ev=' '.join(str((e or {}).get('title','')).lower() for e in (m.get('events') or []))
        catblob=' '.join([text,tags,ev])
        if any(k in catblob for k in ['election','president','senate','house','trump','biden','fed','government','congress','politic','ukraine','ceasefire','democrat','republican','btc','bitcoin','ethereum','eth ','solana','sol ','crypto','sec','cpi','fomc','nfl','nba','mlb','nhl','soccer','champions league','premier league','la liga','serie a','tennis','ufc','f1','formula 1','world cup','super bowl','sport']):
            # choose dominant direction by best ask-implied probability, fallback current price
            entries=[]
            for i,name in enumerate(outcomes):
                p=float(prices[i]) if i < len(prices) and str(prices[i]).replace('.','',1).isdigit() else None
                if p is None:
                    p=max(0.0, min(1.0, 1-books[i]['ask']))
                entries.append((p, name, books[i]))
            p,name,book=max(entries, key=lambda t:t[0])
            if 0.70 <= p < 0.98 and book['depth_dollars'] >= 5000 and book['spread'] <= 0.01:
                aggr.append({
                    'tier':'aggressive',
                    'key': f"aggressive::{m.get('id')}::{name}",
                    'market': m.get('question','').strip(),
                    'direction': name,
                    'prob': p,
                    'expiry': end.strftime('%Y-%m-%d %H:%M UTC'),
                    'liquidity': book['depth_dollars'],
                    'spread': book['spread'],
                })

try:
    prev=json.load(open(STATE_PATH))
except Exception:
    prev={'items':{}}
prev_items=prev.get('items',{}) or {}
new_items={}
alerts=[]
for item in strict+aggr:
    key=item['key']
    new_items[key]=item
    old=prev_items.get(key)
    changed = old is None
    if not changed:
        changed = abs(item['prob']-old.get('prob',0)) >= 0.015 or \
                  (old.get('liquidity',0) > 0 and abs(item['liquidity']-old.get('liquidity',0))/old.get('liquidity',1) >= 0.2) or \
                  item['direction'] != old.get('direction')
    if changed:
        alerts.append(item)

state={
    'updatedAt': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'),
    'items': new_items,
    'counts': {
        'strict': len(strict),
        'aggressive': len(aggr),
        'processed': len(strict)+len(aggr),
        'marketsFetched': len(markets),
        'bookFailures': book_fail,
    }
}
json.dump(state, open(STATE_PATH,'w'), ensure_ascii=False, indent=2)
json.dump({'alerts':alerts,'state':state}, open(OUT_PATH,'w'), ensure_ascii=False, indent=2)
print(json.dumps({'alerts':alerts,'counts':state['counts']}, ensure_ascii=False))
