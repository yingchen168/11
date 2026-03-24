import json
from datetime import datetime, timezone
from pathlib import Path
import requests

NOW = datetime(2026, 3, 20, 11, 17, 0, tzinfo=timezone.utc)
STATE_PATH = Path('/root/.openclaw/workspace/memory/polymarket_state_31f537fa-b5ab-4914-8c51-9653f05c14ef.json')

TARGETS = {'政治', '体育', '加密'}
CATEGORY_MAP = {
    'crypto': '加密',
    'cryptocurrency': '加密',
    'bitcoin': '加密',
    'ethereum': '加密',
    'politics': '政治',
    'political': '政治',
    'election': '政治',
    'elections': '政治',
    'sports': '体育',
    'sport': '体育',
}
SPORT_HINTS = {'nba','nfl','mlb','nhl','ncaab','ncaaf','soccer','football','baseball','basketball','tennis','golf','f1','formula 1','ufc','mma','boxing','cricket','esports','premier league','champions league','la liga','serie a','bundesliga','mls','olympics','ncaa'}
POLITICS_HINTS = {'trump','biden','election','elections','congress','senate','house','mayor','governor','parliament','prime minister','president','presidential','government','minister','politics','macron','putin','zelensky'}
CRYPTO_HINTS = {'bitcoin','btc','eth','ethereum','solana','crypto','memecoin','dogecoin','xrp','bnb','defi','token','airdrop','kraken','coinbase','microstrategy'}

session = requests.Session()
session.headers.update({'User-Agent': 'Mozilla/5.0'})

def fetch_events(limit=500, offset=0):
    url = f'https://gamma-api.polymarket.com/events?active=true&closed=false&archived=false&limit={limit}&offset={offset}'
    r = session.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

def classify(event, market):
    texts = []
    for x in [event.get('title'), event.get('ticker'), market.get('question'), market.get('slug'), event.get('description')]:
        if x:
            texts.append(str(x).lower())
    text = ' '.join(texts)
    slugs, labels = set(), set()
    for t in (event.get('tags') or []):
        slug = str(t.get('slug') or '').lower()
        label = str(t.get('label') or '').lower()
        if slug: slugs.add(slug)
        if label: labels.add(label)
    for k,v in CATEGORY_MAP.items():
        if k in slugs or k in labels:
            return v
    if any(h in text for h in SPORT_HINTS) or slugs & {h.replace(' ','-') for h in SPORT_HINTS}:
        return '体育'
    if any(h in text for h in POLITICS_HINTS) or slugs & {h.replace(' ','-') for h in POLITICS_HINTS}:
        return '政治'
    if any(h in text for h in CRYPTO_HINTS) or slugs & {h.replace(' ','-') for h in CRYPTO_HINTS}:
        return '加密'
    return None

def parse_jsonish(v):
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return []

def pick_direction(market):
    outcomes = [str(x) for x in parse_jsonish(market.get('outcomes'))]
    prices = parse_jsonish(market.get('outcomePrices'))
    try:
        prices = [float(x) for x in prices]
    except Exception:
        return None
    if len(outcomes) != len(prices) or len(prices) < 2:
        return None
    pairs = sorted(zip(outcomes, prices), key=lambda x: x[1], reverse=True)
    direction, prob = pairs[0]
    second = pairs[1][1]
    return direction, prob, second

def passes(event, market):
    category = classify(event, market)
    if category not in TARGETS:
        return None
    if (not market.get('active')) or market.get('closed') or market.get('archived'):
        return None
    if not market.get('acceptingOrders'):
        return None
    end = market.get('endDate') or event.get('endDate')
    if not end:
        return None
    try:
        end_dt = datetime.fromisoformat(end.replace('Z', '+00:00'))
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
    picked = pick_direction(market)
    if not picked:
        return None
    direction, prob, second = picked
    if prob < 0.80 or prob > 0.96:
        return None
    if (prob - second) <= 0:
        return None
    return {
        'key': str(market.get('id')),
        'market': market.get('question') or event.get('title') or market.get('slug') or 'Unknown',
        'category': category,
        'direction': direction,
        'prob': float(prob),
        'probability': round(float(prob)*100,1),
        'spread': float(spread),
        'liquidity': float(liquidity),
        'end_iso': end_dt.astimezone(timezone.utc).isoformat().replace('+00:00','Z'),
        'expiry': end_dt.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
    }

all_events = []
for offset in range(0, 3000, 500):
    try:
        batch = fetch_events(offset=offset)
    except Exception:
        continue
    if not batch:
        break
    all_events.extend(batch)
    if len(batch) < 500:
        break

hits = []
seen = set()
for event in all_events:
    for market in (event.get('markets') or []):
        item = passes(event, market)
        if item and item['key'] not in seen:
            seen.add(item['key'])
            item['line'] = f"{item['market']}｜{item['category']}｜{item['direction']}｜{item['probability']:.1f}%｜{item['spread']:.4f}｜{item['liquidity']:.0f}｜{item['expiry']}"
            hits.append(item)

hits.sort(key=lambda x: (x['end_iso'], -x['prob'], x['market']))

prev_items = {}
if STATE_PATH.exists():
    try:
        prev_data = json.loads(STATE_PATH.read_text())
        prev_items = prev_data.get('items', {}) if isinstance(prev_data, dict) else {}
    except Exception:
        prev_items = {}

new_hits = [h for h in hits if h['key'] not in prev_items]

state = {
    'updatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
    'items': {h['key']: {k:v for k,v in h.items() if k != 'end_iso'} for h in hits},
    'count': len(hits)
}
STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2))

if not new_hits:
    print('NO_REPLY')
else:
    for h in new_hits:
        print(h['line'])
