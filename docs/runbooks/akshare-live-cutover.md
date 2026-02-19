# AKShare Live Mode Cutover Runbook

## Scope

Switch OnlyTrade market data for agents from replay mode to live-file mode backed by AKShare collector/converter outputs.

## Preconditions

- `scripts/akshare/run_cycle.py` can run successfully on host.
- Canonical output exists at `data/live/onlytrade/frames.1m.json`.
- Breadth output exists at `data/live/onlytrade/market_breadth.cn-a.json`.
- Legal/compliance sign-off completed for AKShare usage in your environment.

## Enable live mode

1. Run one full cycle:

```bash
python scripts/akshare/run_cycle.py
python scripts/akshare/run_red_blue_cycle.py
```

2. Set environment for backend:

```bash
RUNTIME_DATA_MODE=live_file
LIVE_FRAMES_PATH=data/live/onlytrade/frames.1m.json
LIVE_FILE_REFRESH_MS=10000
```

3. Restart `runtime-api`.

4. Ensure scheduler includes both jobs:
   - `scripts/akshare/run_cycle_if_market_open.py`
   - `scripts/akshare/run_red_blue_if_market_open.py`

## Verify live mode

```bash
curl -fsS "http://127.0.0.1:18080/api/replay/runtime/status"
curl -fsS "http://127.0.0.1:18080/api/market/frames?symbol=600519.SH&interval=1m&limit=5"
curl -fsS "http://127.0.0.1:18080/api/agent/context?trader_id=t_001"
curl -fsS "http://127.0.0.1:18080/api/rooms/t_001/stream-packet?decision_limit=2"
```

Expected:

- Replay status includes `data_mode: live_file`.
- Replay status `live_file.last_load_ts_ms` is recent.
- `provider: akshare` with non-empty `frames` for watched symbols.
- Stream packet has `market_breadth.source_kind = breadth_file` and non-stale status.

## Runtime checks

- If `live_file.stale=true`, inspect collector/converter logs immediately.
- If canonical parse fails, backend should continue serving last good cache.
- During market close, stale alerts should use broader thresholds.

## Rollback

1. Set `RUNTIME_DATA_MODE=replay`.
2. Restart backend.
3. Verify replay controls/status operate normally:

```bash
curl -fsS "http://127.0.0.1:18080/api/replay/runtime/status"
```

4. If needed, run clean replay reset:

```bash
bash scripts/onlytrade-ssh-ops.sh start-3day --single-run --speed 60 --cadence 10
```
