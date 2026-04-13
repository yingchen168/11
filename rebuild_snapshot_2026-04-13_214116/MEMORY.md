# Long-Term Memory

## Active monitors
- The only active automatic monitor right now is the direct systemd timer `polymarket-direct-monitor.timer`, not OpenClaw cron.
- It monitors Polymarket opportunities and sends directly to Telegram.
- Current filter:
  - Categories: politics, sports, crypto
  - Win probability: >= 0.80 and <= 0.96
  - Spread: <= 0.8%
  - Volume or liquidity: >= 10000U
  - Expiry window: between 2 and 72 hours
- If there are no new matches, it stays silent.

## OpenClaw cron state
- The cron job definitions still exist in `/root/.openclaw/cron/jobs.json`.
- They are all disabled right now.
- Do not say the tasks were lost.
- If the user asks why no message was sent, first explain whether there are currently zero qualifying matches.

## Telegram direct chat behavior
- The direct chat session may have been reset during repair work.
- If the user asks about monitoring, answer with the current active monitor and its exact thresholds before asking follow-up questions.
- A plain `1` from the user usually means a quick status check, not a brand new request.
