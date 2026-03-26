import requests, json, datetime as dt, os, re, sys
NOW=dt.datetime(2026,3,26,2,53,tzinfo=dt.timezone.utc)
STATE='/root/.openclaw/workspace/data/polymarket_under1_state.json'

sports_allow = [
    'nba','nfl','mlb','nhl','soccer','football','champions league','premier league','laliga','la liga','serie a','bundesliga','tennis','golf','ufc','mma','f1','formula 1','nascar','cricket','olympic','world cup','ncaa','march madness','dreamhack','blast open','counter-strike','cs2','esports','valorant','dota'
]
crypto_allow = [
    'bitcoin','btc','ethereum','eth','solana','sol','xrp','crypto','cryptocurrency','token','coin','doge','polkadot','chainlink','ripple','bnb','binance','base ','arbitrum','arb ','berachain','aptos','sui','cardano','ada','litecoin','ltc','defi'
]
politics_allow = [
    'election','president','presidential','senate','house','governor','mayor','politic','policy','congress','parliament','prime minister','trump','biden','democrat','republican','white house','government','minister','supreme court','fed chair'
]


def category(text):
    t=text.lower()
    if any(k in t for k in politics_allow): return '政治'
    if any(k in t for k in sports_allow): return '体育'
    if any(k in t for k in crypto_allow): return '加密'
    return None

all_events=[]
offset=0
while True:
    try:
        r=requests.get(f'https://gamma-api.polymarket.com/events?closed=false&archived=false&limit=500&offset={offset}',timeout=30)
        arr=r.json()
    except Exception:
        break
    if not arr: break
    all_events.extend(arr)
    if len(arr)<500 or offset>=2500: break
    offset+=500

items=[]
for ev in all_events:
    text=' '.join([
        ev.get('title',''),
        ev.get('description',''),
        ' '.join((t.get('label','') if isinstance(t,dict) else str(t)) for t in ev.get('tags',[]))
    ])
    cat=category(text)
    if not cat: continue
    end=ev.get('endDate')
    if not end: continue
    try:
        enddt=dt.datetime.fromisoformat(end.replace('Z','+00:00'))
    except Exception:
        continue
    hours=(enddt-NOW).total_seconds()/3600
    if not (2 <= hours <= 72):
        continue
    liq=float(ev.get('liquidityClob') or ev.get('liquidity') or 0)
    vol=float(ev.get('volume24hr') or ev.get('volume') or 0)
    if max(liq, vol) < 10000:
        continue
    for m in ev.get('markets',[]):
        try:
            if (not m.get('active')) or m.get('closed') or (m.get('acceptingOrders') is False):
                continue
            outcomes=json.loads(m.get('outcomes','[]')) if isinstance(m.get('outcomes'),str) else (m.get('outcomes') or [])
            prices=json.loads(m.get('outcomePrices','[]')) if isinstance(m.get('outcomePrices'),str) else (m.get('outcomePrices') or [])
            prices=[float(x) for x in prices]
            if len(outcomes)!=2 or len(prices)!=2:
                continue
            idx=0 if prices[0] >= prices[1] else 1
            p=prices[idx]
            if not (0.80 <= p <= 0.96):
                continue
            spread=float(m.get('spread'))
            if spread > 0.008:
                continue
        except Exception:
            continue
        items.append({
            'key': str(m.get('id') or m.get('question') or ev.get('id')),
            'line': f"{(m.get('question') or ev.get('title')).strip()}｜{cat}｜{outcomes[idx]}｜{p:.4f}｜{spread:.4f}｜{int(round(liq))}U｜{enddt.strftime('%Y-%m-%d %H:%M UTC')}",
            'p': round(p,4),
            'spread': round(spread,4),
        })

items.sort(key=lambda x:(x['key']))
prev={}
if os.path.exists(STATE):
    try:
        prev=json.load(open(STATE,'r'))
    except Exception:
        prev={}
current={x['key']:{'p':x['p'],'spread':x['spread'],'line':x['line']} for x in items}
json.dump(current, open(STATE,'w'), ensure_ascii=False, indent=2)

new=[]
for x in items:
    old=prev.get(x['key'])
    if not old:
        new.append(x['line'])
    else:
        if old.get('line') != x['line'] and (abs(old.get('p',0)-x['p'])>=0.01 or abs(old.get('spread',0)-x['spread'])>=0.002):
            new.append(x['line'])

if new:
    print('\n'.join(new))
else:
    print('NO_REPLY')
