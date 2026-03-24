#!/bin/bash
set -e

export PATH="/usr/local/bin:/usr/bin:/bin"

export OP_SERVICE_ACCOUNT_TOKEN="$(cat /root/.openclaw/.op-token)"
export OURA_TOKEN="$(op read 'op://hpeqvquh2cfua4brwrkvglne2q/cglsbirtzgcjpgca2ygobrlc4m/password')"

cd /root/.openclaw/workspace/skills/oura
python3 scripts/sync.py
