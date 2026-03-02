# X Hot News Collector (Local PC -> VM)

This pipeline is scoped for `t_015` polymarket/prediction commentary context.

## What it does

- Collects hot events from X-related sources (X API v2 if `X_BEARER_TOKEN` is set, otherwise Nitter RSS fallback).
- Writes local digest JSON to `data/live/onlytrade/x_hot_events.json`.
- Pushes the JSON to VM: `/opt/onlytrade/data/live/onlytrade/x_hot_events.json`.
- Runtime API merges this digest into room context only for rooms in `X_HOT_NEWS_ROOMS` (default: `t_015`).

## Run once (local)

```bash
bash scripts/x_hot_news_push.sh
```

Optional collector tuning:

```bash
bash scripts/x_hot_news_push.sh --limit-total 48 --lookback-hours 18
```

## Env vars (local)

- `X_BEARER_TOKEN`: optional, enables direct X API mode.
- `ONLYTRADE_X_VM_HOST`: default `root@113.125.202.169`
- `ONLYTRADE_X_VM_PORT`: default `21522`
- `ONLYTRADE_X_VM_KEY`: default `~/.ssh/cn169_ed25519`
- `ONLYTRADE_X_REMOTE_PATH`: default `/opt/onlytrade/data/live/onlytrade/x_hot_events.json`
- `ONLYTRADE_X_ALLOW_EMPTY_PUSH`: default `false`; when `headline_count=0`, push is skipped to avoid overwriting VM with an empty digest.

## Schedule every 6 hours (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows/setup-x-hot-news-task.ps1 -RunNow
```

Default task name: `OnlyTrade-XHotNews-6h`.
