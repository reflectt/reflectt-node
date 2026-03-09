#!/usr/bin/env bash
# sync-openclaw-usage.sh — Stopgap: read OpenClaw session data and POST to /usage/report
# Runs periodically via cron/launchd to keep usage estimates current.
#
# Limitations:
# - Estimates cost from current session context, not actual per-call billing
# - Does not track historical usage across session resets
# - Cumulative input tokens estimated as totalTokens × messageCount (rough)

set -euo pipefail

NODE_API="${REFLECTT_API:-http://127.0.0.1:4445}"
OPENCLAW_BIN="${OPENCLAW_BIN:-openclaw}"

# Get all active sessions as JSON
sessions=$("$OPENCLAW_BIN" sessions --all-agents --json --active 120 2>/dev/null) || {
  echo "Failed to get OpenClaw sessions" >&2
  exit 1
}

# Parse and POST each session's usage
echo "$sessions" | python3 -c "
import json, sys, urllib.request, time

API = '${NODE_API}'
data = json.load(sys.stdin)
sessions = data if isinstance(data, list) else data.get('sessions', [])

# Pricing per 1M tokens (must match usage-tracking.ts MODEL_PRICING)
PRICING = {
    'claude-opus-4-6': {'input': 15.0, 'output': 75.0},
    'claude-opus-4': {'input': 15.0, 'output': 75.0},
    'claude-sonnet-4-6': {'input': 3.0, 'output': 15.0},
    'claude-sonnet-4': {'input': 3.0, 'output': 15.0},
    'gpt-5.4': {'input': 2.5, 'output': 10.0},
    'gpt-5.3': {'input': 2.0, 'output': 8.0},
    'gpt-5.3-codex': {'input': 2.0, 'output': 8.0},
    'gpt-4o-mini': {'input': 0.15, 'output': 0.60},
    'gpt-4o': {'input': 2.5, 'output': 10.0},
}

reported = 0
skipped = 0

for s in sessions:
    agent = s.get('agentId', '')
    model = s.get('model', '')
    total_tokens = s.get('totalTokens', 0)
    input_msgs = s.get('inputTokens', 0)  # message count
    output_msgs = s.get('outputTokens', 0)  # message count
    key = s.get('key', '')

    if not agent or not model or not total_tokens or total_tokens <= 0:
        skipped += 1
        continue

    # Estimate: each input message sends ~full context, output is proportional
    # Rough split: 80% input (context), 20% output
    est_input = int(total_tokens * 0.8)
    est_output = int(total_tokens * 0.2)

    # Strip provider prefix for pricing lookup
    model_short = model.split('/')[-1] if '/' in model else model
    pricing = PRICING.get(model_short, PRICING.get(model, {'input': 5.0, 'output': 20.0}))
    est_cost = (est_input * pricing['input'] + est_output * pricing['output']) / 1_000_000

    # Dedup key: agent + session key + date
    today = time.strftime('%Y-%m-%d')
    dedup_id = f'sync-{agent}-{key}-{today}'

    # Normalize model name to include provider prefix
    provider = s.get('modelProvider', 'unknown')
    if '/' not in model and provider and provider != 'unknown':
        full_model = f'{provider}/{model}'
    else:
        full_model = model

    event = {
        'agent': agent,
        'model': full_model,
        'provider': provider,
        'input_tokens': est_input,
        'output_tokens': est_output,
        'estimated_cost_usd': round(est_cost, 6),
        'category': 'chat',
        'timestamp': int(time.time() * 1000),
        'metadata': {
            'source': 'openclaw-session-sync',
            'session_key': key,
            'dedup_id': dedup_id,
            'total_context_tokens': total_tokens,
            'input_messages': input_msgs,
            'output_messages': output_msgs,
        }
    }

    try:
        req = urllib.request.Request(
            f'{API}/usage/report',
            data=json.dumps(event).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            reported += 1
    except Exception as e:
        print(f'  Failed to report {agent}/{model}: {e}', file=sys.stderr)

print(f'Usage sync: {reported} reported, {skipped} skipped')
"
