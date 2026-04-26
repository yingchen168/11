#!/bin/zsh
set -euo pipefail

STATE_FILE="/root/.openclaw/cron/polymarket_direct_state.json"
API_URL="https://gamma-api.polymarket.com/events?active=true&closed=false&archived=false&order=liquidity&ascending=false&limit=1000"
BOT_TOKEN="8714365633:AAFcVNwLSzGQ27Z1ea21O4Y2v24gBYH6tik"
CHAT_ID="5684577282"

raw="$(curl -fsS "$API_URL")" || exit 0

current_json="$(printf '%s' "$raw" | jq -c '
  [ .[] as $e
    | (($e.title // "") + " " + ($e.slug // "")) as $eventTextRaw
    | ($eventTextRaw | ascii_downcase) as $eventText
    | ($e.markets // [])[] as $m
    | ((($m.tags // $e.tags // []) | map((.slug // "") | ascii_downcase))) as $tags
    | (($m.category // $e.category // "") | ascii_downcase) as $catRaw
    | (($m.question // "") | ascii_downcase) as $q
    | (($m.outcomes | if type=="string" then fromjson else . end) // []) as $outs
    | (($m.outcomePrices | if type=="string" then fromjson else . end) // []) as $prices
    | select(($outs|length) >= 2 and ($prices|length) >= 2)
    | ($prices[0] | tonumber?) as $p0
    | ($prices[1] | tonumber?) as $p1
    | select($p0 != null and $p1 != null)
    | (if ($catRaw == "politics") or (($tags | index("politics")) != null) then "政治"
       elif ($catRaw == "crypto") or (($tags | index("crypto")) != null) then "加密"
       elif ($catRaw == "sports") or ((($tags | join(",") + "," + $eventText + "," + $q) | test("nba|nfl|mlb|nhl|ufc|soccer|football|tennis|golf|baseball|basketball|hockey|f1|formula 1|champions league|premier league|laliga|bundesliga|serie a"; "i"))) then "体育"
       else "" end) as $cat
    | select($cat != "")
    | (if $p0 >= $p1 then {dir: ($outs[0]|tostring), prob: $p0} else {dir: ($outs[1]|tostring), prob: $p1} end) as $best
    | (($m.endDate // "") | fromdateiso8601?) as $endTs
    | select($endTs != null)
    | ($endTs - now) as $ttl
    | select($ttl >= 7200 and $ttl <= 259200)
    | (($m.spread // ((($m.bestAsk // 999) - ($m.bestBid // 0)))) | tonumber?) as $spread
    | select($spread != null and $spread <= 0.8)
    | (($m.volumeNum // 0) | tonumber?) as $vol
    | (($m.liquidityNum // 0) | tonumber?) as $liq
    | select((($vol // 0) >= 6000) or (($liq // 0) >= 6000))
    | select($best.prob >= 0.80 and $best.prob <= 0.96)
    | {
        slug: ($m.slug // ""),
        market: ($m.question // $e.title // ""),
        category: $cat,
        direction: $best.dir,
        prob: $best.prob,
        spread: $spread,
        volume: ($vol // 0),
        liquidity: ($liq // 0),
        endDate: ($m.endDate // "")
      }
  ]
  | unique_by(.slug)
  | sort_by(-.prob, -.volume, -.liquidity)
  | .[:20]
')"

[[ -n "$current_json" && "$current_json" != "null" ]] || current_json='[]'

mkdir -p "$(dirname "$STATE_FILE")"
prev_json='[]'
if [[ -f "$STATE_FILE" ]]; then
  prev_json="$(cat "$STATE_FILE" 2>/dev/null || printf '[]')"
fi

if [[ "${POLYMARKET_SEED_ONLY:-0}" == "1" ]]; then
  printf '%s' "$current_json" > "$STATE_FILE"
  exit 0
fi

new_json="$(jq -nc --argjson cur "$current_json" --argjson prev "$prev_json" '
  [ $cur[] as $item
    | select(([ $prev[]?.slug ] | index($item.slug)) | not)
    | $item
  ]
')"

printf '%s' "$current_json" > "$STATE_FILE"

count="$(printf '%s' "$new_json" | jq 'length')"
(( count > 0 )) || exit 0

message="$(printf '%s' "$new_json" | jq -r '
  ([
    "Polymarket 机会监控",
    (.[] | "\(.market)｜\(.category)｜\(.direction)｜\((.prob*100)|round/100)%｜差价:\((.spread*10000)|round/10000)｜V:\(.volume|floor)/L:\(.liquidity|floor)｜\(.endDate)")
  ] | .[:11]) | join("\n")
')"

curl -fsS -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendMessage"   --data-urlencode "chat_id=$CHAT_ID"   --data-urlencode "text=$message"   --data-urlencode "disable_web_page_preview=true"   >/dev/null
