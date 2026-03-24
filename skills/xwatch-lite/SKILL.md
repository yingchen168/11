---
name: xwatch-lite
version: 0.1.0
description: "Monitor a small set of X accounts for high-signal posts (policy/regulation/product launch/major viewpoint) and return concise 4-line items. Failures are skipped."
user-invocable: true
metadata:
  openclaw:
    notes: |
      This skill is intentionally minimal: it defines the monitoring rules and output format.
      Execution is typically via OpenClaw cron (agentTurn message can reference these rules).
---

# xwatch-lite

A tiny, rules-only skill for monitoring a few high-signal X accounts.

## Scope

- Accounts (default set):
  - @elonmusk
  - @cz_binance
  - @turingou
  - @bwenews
  - (optional) @realDonaldTrump, @nntaleb, @naval, @heyibinance

## What to report (STRICT)

Only report posts that are clearly one of:
- **Policy / regulation**
- **Product release / major product signal**
- **Major viewpoint** (macro narrative with clear market implications)

Ignore routine chatter, memes, and low-signal engagement.

## Time window

- Default: last 24 hours.

## Output format

Each item must be **exactly 4 lines**:
1) `@account`
2) `link`
3) `核心信息：...`
4) `影响判断：...`

## De-duplication

- If the current cycle has no *new* qualifying items, output `NO_REPLY`.
- If items are identical to the previous cycle, output `NO_REPLY`.

## Failure handling (important)

- **Any single source failure must be skipped** and must not fail the whole cycle.
- Do **not** output technical errors (no "web fetch failed" / stack traces).
- If all sources fail or no qualifying items exist: `NO_REPLY`.

## Recommended cron settings

- Interval: every 60 minutes
- Timeout: 360s (mirrors often slow)
- Delivery: announce to Telegram chat

