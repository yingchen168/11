#!/bin/zsh
set -euo pipefail

API_URL="https://gamma-api.polymarket.com/events?active=true&closed=false&archived=false&order=liquidity&ascending=false&limit=1000"

raw="$(curl -fsS "$API_URL")" || exit 1

printf '%s' "$raw" | jq -r '
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
  | if length == 0 then
      "当前没有符合条件的盘"
    else
      (.[] | "\(.market)｜\(.category)｜\(.direction)｜\((.prob*100)|round/100)%｜spread 差价:\((.spread*10000)|round/10000)｜V:\(.volume|floor)｜L:\(.liquidity|floor)｜\(.endDate)")
    end
'
