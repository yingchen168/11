import json, os, math
from datetime import datetime, timezone
from pathlib import Path
import requests

NOW = datetime(2026,3,19,2,47,0,tzinfo=timezone.utc)
STATE_PATH = Path('/root/.openclaw/workspace/.state/polymarket_under1_near_expiry.json')
STATE_PATH.parent.mkdir(parents=True, exist_ok=True)

CATEGORY_MAP = {
    'crypto': '加密',
    'sports': '体育',
    'politics': '政治',
    'political': '政治',
    'elections': '政治',
    'election': '政治',
    'congress': '政治',
    'senate': '政治',
    'house': '政治',
    'white-house': '政治',
    'president': '政治',
    'government': '政治',
}
SPORT_HINTS = {'nba','nfl','mlb','nhl','ncaa','ncaab','ncaaf','soccer','football','baseball','basketball','tennis','golf','f1','formula-1','ufc','mma','boxing','cricket','esports','champions-league','premier-league','la-liga','serie-a','bundesliga','mls','olympics'}
POLITICS_HINTS = {'us-politics','world-politics','trump','biden','election','elections','congress','senate','house','mayor','governor','parliament','prime-minister','president','presidential'}
CRYPTO_HINTS = {'bitcoin','btc','eth','ethereum','solana','crypto','memecoin','dogecoin','xrp','bnb','defi','token','airdrop'}

session = requests.Session()
session.headers.update({'User-Agent':'Mozilla/5.0'})

def fetch_events(limit=1000, offset=0):
    url = f'https://gamma-api.polymarket.com/events?active=true&closed=false&archived=false&limit={limit}&offset={offset}'
    r = session.get(url, timeout=30)
    r.raise_for_status()
    return r.json()


def classify(event, market):
    tags = event.get('tags') or []
    slugs = set()
    labels = set()
    for t in tags:
        slug = str(t.get('slug') or '').lower()
        label = str(t.get('label') or '').lower()
        if slug: slugs.add(slug)
        if label: labels.add(label)
    text = ' '.join([event.get('title') or '', market.get('question') or '', event.get('ticker') or '', market.get('slug') or '']).lower()
    # direct tags first
    for key, val in CATEGORY_MAP.items():
        if key in slugs or key in labels:
            return val
    if slugs & SPORT_HINTS or any(h in text for h in SPORT_HINTS):
        return '体育'
    if slugs & POLITICS_HINTS or any(h in text for h in POLITICS_HINTS):
        return '政治'
    if slugs & CRYPTO_HINTS or any(h in text for h in CRYPTO_HINTS):
        return '加密'
    return None


def parse_prices(market):
    prices = market.get('outcomePrices')
    outcomes = market.get('outcomes')
    try:
        if isinstance(prices, str):
            prices = json.loads(prices)
        if isinstance(outcomes, str):
            outcomes = json.loads(outcomes)
        prices = [float(x) for x in prices]
        outcomes = [str(x) for x in outcomes]
        return list(zip(outcomes, prices))
    except Exception:
        return []


def passes(market, category):
    if category not in {'政治','体育','加密'}:
        return None
    if not market.get('active') or market.get('closed') or market.get('archived'):
        return None
    if not market.get('acceptingOrders'):
        return None
    end = market.get('endDate') or market.get('umaEndDate')
    if not end:
        return None
    try:
        end_dt = datetime.fromisoformat(end.replace('Z','+00:00'))
    except Exception:
        return None
    hours = (end_dt - NOW).total_seconds() / 3600
    if hours < 2 or hours > 72:
        return None
    try:
        spread = float(market.get('spread'))
        liquidity = float(market.get('liquidityNum') or market.get('liquidity') or 0)
        volume = float(market.get('volumeNum') or market.get('volume') or 0)
    except Exception:
        return None
    if spread > 0.008:
        return None
    if liquidity < 10000 or volume < 10000:
        return None
    pairs = parse_prices(market)
    if len(pairs) < 2:
        return None
    pairs.sort(key=lambda x: x[1], reverse=True)
    direction, prob = pairs[0]
    if prob < 0.80 or prob > 0.98:
        return None
    # 明确方向优势：领先次高项至少 5pct；二元市场则天然使用次高项校验
    if len(pairs) > 1 and (prob - pairs[1][1]) < 0.05:
        return None
    return {
        'id': str(market.get('id')),
        'market': market.get('question') or market.get('slug') or event.get('title'),
        'category': category,
        'direction': direction,
        'prob': prob,
        'spread': spread,
        'liquidity': liquidity,
        'volume': volume,
        'end': end_dt.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
    }

all_events = []
for offset in (0, 500, 1000, 1500):
    try:
        batch = fetch_events(limit=500, offset=offset)
    except Exception:
        batch = []
    if not batch:
        break
    all_events.extend(batch)
    if len(batch) < 500:
        break

results = []
for event in all_events:
    category = None
    for m in event.get('markets') or []:
        category = classify(event, m)
        item = passes(m, category)
        if item:
            results.append(item)

# sort by expiry, then probability desc
results.sort(key=lambda x: (x['end'], -x['prob'], x['market']))

prev = {}
if STATE_PATH.exists():
    try:
        prev = json.loads(STATE_PATH.read_text())
    except Exception:
        prev = {}

current = {r['id']:{'prob':round(r['prob'],4),'spread':round(r['spread'],4),'liquidity':round(r['liquidity'],2),'end':r['end']} for r in results}

new_items = []
for r in results:
    old = prev.get(r['id'])
    if not old:
        new_items.append(r)
        continue
    # significant change thresholds, but task says only新增机会; ignore changed old items.

STATE_PATH.write_text(json.dumps(current, ensure_ascii=False, indent=2))

if not new_items:
    print('NO_REPLY')
else:
    for r in new_items:
        print(f"{r['market']}｜{r['category']}｜{r['direction']}｜{r['prob']:.1%}｜{r['spread']:.3f}｜{r['liquidity']:.0f}｜{r['end']}")
