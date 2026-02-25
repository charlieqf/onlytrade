# CN-A Open-Day Ops Checklist

Use this checklist to keep pre-open and open cutover smooth.

## T-30 to T-10 min (Pre-open)

1. Confirm backend health and single listener:

```bash
bash scripts/onlytrade-ssh-ops.sh health-restart-probe
```

2. Confirm mode and runtime state:

```bash
bash scripts/onlytrade-ssh-ops.sh status
```

3. Refresh CN news and overview material:

```bash
bash scripts/onlytrade-ssh-ops.sh preopen-cn-refresh
```

4. Keep stream agents active for chatter:

```bash
bash scripts/onlytrade-ssh-ops.sh agent-start t_003
bash scripts/onlytrade-ssh-ops.sh agent-start t_004
```

## T-5 min to Open

1. Confirm cron block exists:

```bash
ssh -i ~/.ssh/kamatera root@104.238.213.119 \
  "crontab -l | sed -n '/# BEGIN ONLYTRADE_AKSHARE_CRON/,/# END ONLYTRADE_AKSHARE_CRON/p'"
```

2. Confirm gated collector behavior before open is expected:

```bash
ssh -i ~/.ssh/kamatera root@104.238.213.119 \
  "cd /opt/onlytrade && /opt/onlytrade/.venv-akshare/bin/python scripts/akshare/run_cycle_if_market_open.py"
```

Expected pre-open: `{"status":"skip","reason":"outside_cn_a_session"}`.

3. Optional: confirm pre-open digest guard job behavior:

```bash
ssh -i ~/.ssh/kamatera root@104.238.213.119 \
  "cd /opt/onlytrade && /opt/onlytrade/.venv-akshare/bin/python scripts/akshare/run_news_digest_if_preopen.py"
```

## At Open (Go / No-Go)

1. Run one gated cycle and verify it no longer skips.
2. Run strict freshness:

```bash
bash scripts/onlytrade-ssh-ops.sh check-live-freshness --strict
```

3. Verify live preflight:

```bash
bash scripts/onlytrade-ssh-ops.sh live-preflight
```

4. Verify stream endpoints:

```bash
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" \
  "http://104.238.213.119:8000/onlytrade/api/rooms/t_003/events?decision_limit=5"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" \
  "http://104.238.213.119:8000/onlytrade/api/rooms/t_003/stream-packet?decision_limit=5"
```

Go when all checks pass. Hold if required CN files are stale for >3 minutes.

## Voice/BGM Quick Checks

```bash
curl -fsS "http://104.238.213.119:8000/onlytrade/api/chat/tts/config"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" \
  "http://104.238.213.119:8000/onlytrade/audio/bgm/room_loop.mp3"
```

If TTS synthesis returns `openai_tts_http_429`, fix OpenAI billing/quota first.

## Incident Fast Path

1. Pause agents:

```bash
bash scripts/onlytrade-ssh-ops.sh pause
```

2. Capture diagnostics:

```bash
bash scripts/onlytrade-ssh-ops.sh status
bash scripts/onlytrade-ssh-ops.sh live-preflight
bash scripts/onlytrade-ssh-ops.sh check-live-freshness --strict
```

3. Recover data pipeline, then resume:

```bash
bash scripts/onlytrade-ssh-ops.sh resume
```
