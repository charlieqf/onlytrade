# VM 1-Day Autopilot Soak Report (2026-02-18)

## Scope

- Environment: Kamatera VM (`104.238.213.119`), runtime API on `:18080`.
- Replay data: 1-day CN-A pack for 10 popular A-share symbols.
- Agent test target: `t_001` only.
- Runtime loop: unattended replay with 5-minute pause/review checkpoints and auto-restore.

## Replay/Data Preparation

- Generated 1-day replay source from AKShare minute data (240 bars x 10 symbols = 2400 frames).
- Published replay files on VM:
  - `data/replay/cn-a/2026-02-13/frames.1m.json`
  - `data/replay/cn-a/2026-02-13/frames.1m.jsonl`
  - `onlytrade-web/public/replay/cn-a/latest/frames.1m.json`
  - `onlytrade-web/public/replay/cn-a/latest/meta.json`
- Final symbol set:
  - `002050.SZ`, `002131.SZ`, `002195.SZ`, `002342.SZ`, `300058.SZ`, `300059.SZ`, `600089.SH`, `600519.SH`, `600986.SH`, `601899.SH`

## News Preparation

- Refreshed CN-A market overview:
  - `data/live/onlytrade/market_overview.cn-a.json`
- Refreshed CN-A digest with category-aware hot news + symbol news:
  - `data/live/onlytrade/news_digest.cn-a.json`
- Built sectioned digest for requested categories:
  - `data/live/onlytrade/news_digest.cn-a.v2.json`
  - Sections: `market`, `domestic`, `global`, `tech`, `geopolitics`

## Soak Run

- Runner: `scripts/cn_a_autopilot_runner.py`
- Run ID: `20260217_231733_t_001`
- Artifacts: `/opt/onlytrade/logs/soak/20260217_231733_t_001`
- Parameters:
  - `duration=120min`
  - `probe_interval=30s`
  - `review_interval=5min`
  - `mention_interval=10min`
  - `replay_speed=12`

## Results

- Core endpoint success: `41/41` checks (`100%`).
- Review checkpoints executed: `3`.
- Mention reply checks: `1/1` passed; latency `747 ms`.
- LLM decision source ratio by checks: high after warmup windows.
- Replay completion: correctly stopped at one-day dataset end (same-day completion path).
- Restore: backend returned to `live_file` mode (`restore_data_mode=live_file`).

## Improvements Applied

- `scripts/cn_a_autopilot_runner.py`
  - Added Windows-safe `/proc` guard (script no longer breaks on local Windows runs).
  - Added `--replay-speed` support and enforcement in review checkpoints.
  - Added one-day completion fallback when replay stops at end-of-day without day transition.
  - Added richer summary metrics (LLM ratio, readiness rate, forced-hold rate, decision timestamp change count, audit-cap detection).
  - Replaced deprecated `datetime.utcnow()` usage with timezone-aware UTC timestamp.
- `scripts/akshare/run_news_digest_cycle.py` and `scripts/akshare/hot_news_module.py`
  - Synced enhanced news category support to VM.
- `docs/runbooks/cn-a-agent-room-autopilot-soak.md`
  - Added `--replay-speed` usage, completion fallback behavior, and public-IP API validation notes.

## Public URL Validation Notes

- Public API checks on `http://104.238.213.119:18080` succeeded for runtime/stream endpoints.
- Public IP root on `80/443` is currently routed to non-OnlyTrade services (returns 404/502 for OnlyTrade paths), so UI-level browser validation must use either:
  - dedicated OnlyTrade web domain/path behind nginx, or
  - exposed OnlyTrade frontend port.

## Follow-up Recommendations

- Add/confirm nginx route for OnlyTrade web UI on public 80/443 so full browser UX can be validated externally.
- Keep `news_digest.cn-a.v2.json` as canonical input for room prompts if category-specific narratives are required.
- For faster overnight soaks, keep `replay_speed=12` with 5-minute review interval; for realism, run `replay_speed=1`.
