# AKShare to Agents Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a reliable file-based pipeline that collects AKShare data, converts it into OnlyTrade canonical frames, and serves it to agents without replay-engine resets.

**Architecture:** Use a two-stage Python pipeline (`collector` -> `converter`) writing atomic files, then a Node live-file provider in `runtime-api` that hot-refreshes canonical frames from disk by file mtime. Keep existing replay mode for deterministic competitions and add a separate live mode for 24x7 operation.

**Tech Stack:** Python (AKShare, stdlib), Node.js (Express, node:test), JSON/JSONL files, cron/systemd for scheduling.

---

### Task 1: Define data contracts and runtime modes

**Files:**
- Create: `docs/architecture/akshare-live-data-contract.md`
- Modify: `runtime-api/server.mjs`
- Test: `runtime-api/test/runtimeMode.test.mjs`

**Step 1: Write the failing test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRuntimeDataMode } from '../src/runtimeDataMode.mjs'

test('resolveRuntimeDataMode supports replay and live_file', () => {
  assert.equal(resolveRuntimeDataMode('replay'), 'replay')
  assert.equal(resolveRuntimeDataMode('live_file'), 'live_file')
  assert.equal(resolveRuntimeDataMode('unknown'), 'replay')
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix runtime-api test -- runtimeMode.test.mjs`
Expected: FAIL with `Cannot find module '../src/runtimeDataMode.mjs'`

**Step 3: Write minimal implementation**

Create `runtime-api/src/runtimeDataMode.mjs`:

```js
export function resolveRuntimeDataMode(value) {
  const v = String(value || '').trim().toLowerCase()
  if (v === 'live_file') return 'live_file'
  return 'replay'
}
```

**Step 4: Wire mode env in server**

In `runtime-api/server.mjs`, add:

```js
const RUNTIME_DATA_MODE = resolveRuntimeDataMode(process.env.RUNTIME_DATA_MODE || 'replay')
```

**Step 5: Run test to verify it passes**

Run: `npm --prefix runtime-api test -- runtimeMode.test.mjs`
Expected: PASS

**Step 6: Commit**

```bash
git add docs/architecture/akshare-live-data-contract.md runtime-api/src/runtimeDataMode.mjs runtime-api/server.mjs runtime-api/test/runtimeMode.test.mjs
git commit -m "feat: define runtime data modes for replay and live-file"
```

---

### Task 2: Implement AKShare collector (raw files)

**Files:**
- Create: `scripts/akshare/collector.py`
- Create: `scripts/akshare/common.py`
- Create: `scripts/akshare/tests/test_collector_transform.py`
- Test: `scripts/akshare/tests/test_collector_transform.py`

**Step 1: Write the failing test**

```python
import unittest
from scripts.akshare.common import to_onlytrade_symbol

class SymbolMapTest(unittest.TestCase):
    def test_symbol_mapping(self):
        self.assertEqual(to_onlytrade_symbol("600519"), "600519.SH")
        self.assertEqual(to_onlytrade_symbol("300750"), "300750.SZ")
```

**Step 2: Run test to verify it fails**

Run: `python -m unittest scripts.akshare.tests.test_collector_transform -v`
Expected: FAIL `ModuleNotFoundError: scripts.akshare.common`

**Step 3: Write minimal implementation**

In `scripts/akshare/common.py`, add:

```python
def to_onlytrade_symbol(code: str) -> str:
    code = str(code).zfill(6)
    if code.startswith("6"):
        return f"{code}.SH"
    return f"{code}.SZ"
```

**Step 4: Implement collector raw outputs**

In `scripts/akshare/collector.py`, implement:
- Fetch 1m data with `ak.stock_zh_a_hist_min_em(symbol=<code>, period='1', adjust='')`
- Optional quote snapshot with `ak.stock_bid_ask_em(symbol=<code>)`
- Write atomic files:
  - `data/live/akshare/raw_minute.jsonl`
  - `data/live/akshare/raw_quotes.json`
  - `data/live/akshare/checkpoint.json`

Atomic write helper:

```python
tmp = target.with_suffix(target.suffix + ".tmp")
tmp.write_text(payload, encoding="utf-8")
tmp.replace(target)
```

**Step 5: Run tests**

Run: `python -m unittest scripts.akshare.tests.test_collector_transform -v`
Expected: PASS

**Step 6: Commit**

```bash
git add scripts/akshare/common.py scripts/akshare/collector.py scripts/akshare/tests/test_collector_transform.py
git commit -m "feat: add akshare raw collector and symbol mapping"
```

---

### Task 3: Implement converter to canonical `market.frames.v1`

**Files:**
- Create: `scripts/akshare/converter.py`
- Create: `scripts/akshare/tests/test_converter.py`
- Test: `scripts/akshare/tests/test_converter.py`

**Step 1: Write failing test for volume/turnover mapping**

```python
import unittest
from scripts.akshare.converter import map_row_to_frame

class ConverterTest(unittest.TestCase):
    def test_map_row_to_frame(self):
        row = {
            "时间": "2026-02-12 14:58:00",
            "开盘": 10.98,
            "收盘": 10.96,
            "最高": 11.00,
            "最低": 10.95,
            "成交量": 5825,
            "成交额": 6384200.0,
        }
        f = map_row_to_frame("000001", row, seq=1)
        self.assertEqual(f["instrument"]["symbol"], "000001.SZ")
        self.assertEqual(f["bar"]["volume_shares"], 582500)
```

**Step 2: Run test to verify it fails**

Run: `python -m unittest scripts.akshare.tests.test_converter -v`
Expected: FAIL `ImportError`

**Step 3: Write minimal implementation**

Implement `map_row_to_frame` in `scripts/akshare/converter.py` producing:
- `schema_version: market.bar.v1`
- `interval: 1m`
- `window.start_ts_ms/end_ts_ms`
- `bar.open/high/low/close/volume_shares/turnover_cny/vwap`

**Step 4: Implement file conversion pipeline**

`converter.py` should:
- Read `data/live/akshare/raw_minute.jsonl`
- Deduplicate by `(symbol, window.start_ts_ms)`
- Sort ascending by `window.start_ts_ms`
- Write canonical payload atomically to:
  - `data/live/onlytrade/frames.1m.json`

Payload shape:

```json
{
  "schema_version": "market.frames.v1",
  "market": "CN-A",
  "mode": "real",
  "provider": "akshare",
  "frames": []
}
```

**Step 5: Run tests**

Run: `python -m unittest scripts.akshare.tests.test_converter -v`
Expected: PASS

**Step 6: Commit**

```bash
git add scripts/akshare/converter.py scripts/akshare/tests/test_converter.py
git commit -m "feat: convert akshare raw data to canonical market frames"
```

---

### Task 4: Add live-file provider in `runtime-api` (hot refresh, no replay reset)

**Files:**
- Create: `runtime-api/src/liveFileFrameProvider.mjs`
- Modify: `runtime-api/server.mjs`
- Test: `runtime-api/test/liveFileFrameProvider.test.mjs`

**Step 1: Write failing test for mtime-based refresh**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiveFileFrameProvider } from '../src/liveFileFrameProvider.mjs'

test('provider reloads when file mtime changes', async () => {
  // create temp frames file, load, update file, assert new frame visible
  assert.equal(true, false)
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix runtime-api test -- liveFileFrameProvider.test.mjs`
Expected: FAIL

**Step 3: Write minimal implementation**

Provider requirements:
- Inputs: `filePath`, `refreshMs`
- Caches parsed payload in memory
- On each call, reload only when mtime changed or refresh interval elapsed
- Returns symbol-filtered `1m` frames, `limit`-trimmed
- On parse/read failure: keep last good cache

Core API:

```js
const provider = createLiveFileFrameProvider({ filePath, refreshMs: 2000 })
const frames = await provider.getFrames({ symbol: '600519.SH', interval: '1m', limit: 180 })
const status = provider.getStatus()
```

**Step 4: Integrate into server runtime path**

In `runtime-api/server.mjs`:
- If `RUNTIME_DATA_MODE==='live_file'`, use live provider for `1m` query path.
- Keep replay engine path unchanged for `replay` mode.
- Add status to `/api/replay/runtime/status` payload when in live mode:
  - `data_mode`, `live_file.last_load_ts_ms`, `live_file.frame_count`, `live_file.stale`

**Step 5: Run tests**

Run: `npm --prefix runtime-api test -- liveFileFrameProvider.test.mjs`
Expected: PASS

**Step 6: Commit**

```bash
git add runtime-api/src/liveFileFrameProvider.mjs runtime-api/server.mjs runtime-api/test/liveFileFrameProvider.test.mjs
git commit -m "feat: add live-file frame provider for hot data refresh"
```

---

### Task 5: Add pipeline runner and scheduler wiring

**Files:**
- Create: `scripts/akshare/run_cycle.py`
- Create: `scripts/akshare/crontab.example`
- Modify: `scripts/onlytrade-ops.sh`
- Modify: `README.md`
- Test: manual run logs + output files

**Step 1: Implement single-cycle runner**

`run_cycle.py` should execute:
1) collector pull -> raw files
2) converter transform -> canonical file
3) print summary (`symbols_ok`, `rows_written`, `canonical_frames`)

**Step 2: Add schedule examples**

In `scripts/akshare/crontab.example`:

```cron
CRON_TZ=Asia/Shanghai
* 9-11 * * 1-5 /usr/bin/python3 /opt/onlytrade/scripts/akshare/run_cycle.py >> /var/log/onlytrade/akshare.log 2>&1
* 13-15 * * 1-5 /usr/bin/python3 /opt/onlytrade/scripts/akshare/run_cycle.py >> /var/log/onlytrade/akshare.log 2>&1
```

**Step 3: Add ops command wrappers**

In `scripts/onlytrade-ops.sh`, add commands:
- `akshare-on` (set `RUNTIME_DATA_MODE=live_file` + restart)
- `akshare-run-once` (invoke `run_cycle.py`)
- `akshare-status` (print canonical file mtime/frame count)

**Step 4: Verify local run**

Run:

```bash
python scripts/akshare/run_cycle.py
```

Expected output includes non-zero `canonical_frames` and writes:
- `data/live/onlytrade/frames.1m.json`

**Step 5: Commit**

```bash
git add scripts/akshare/run_cycle.py scripts/akshare/crontab.example scripts/onlytrade-ops.sh README.md
git commit -m "chore: add akshare cycle runner and scheduler examples"
```

---

### Task 6: End-to-end verification and rollback safety

**Files:**
- Modify: `README.md`
- Create: `docs/runbooks/akshare-live-cutover.md`
- Test: live API checks

**Step 1: Write cutover runbook**

Document:
- pre-checks (legal approval flag, AKShare reachability)
- enable live mode
- verify freshness
- rollback to replay mode

**Step 2: Verify live mode APIs**

Run:

```bash
curl -fsS "http://127.0.0.1:18080/api/replay/runtime/status"
curl -fsS "http://127.0.0.1:18080/api/market/frames?symbol=600519.SH&interval=1m&limit=5"
curl -fsS "http://127.0.0.1:18080/api/agent/context?trader_id=t_001"
```

Expected:
- `data_mode=live_file`
- `provider=akshare`
- recent `event_ts_ms` and non-empty frames

**Step 3: Test rollback**

Switch `RUNTIME_DATA_MODE=replay`, restart backend, and verify replay status returns expected replay fields and competition can run as before.

**Step 4: Commit**

```bash
git add README.md docs/runbooks/akshare-live-cutover.md
git commit -m "docs: add akshare live cutover and rollback runbook"
```

---

### Task 7: Final validation matrix

**Files:**
- Test only

**Step 1: Run backend test suite**

Run: `npm --prefix runtime-api test`
Expected: PASS all tests

**Step 2: Run Python unit tests**

Run:

```bash
python -m unittest scripts.akshare.tests.test_collector_transform -v
python -m unittest scripts.akshare.tests.test_converter -v
```

Expected: PASS

**Step 3: Run one live cycle and inspect canonical output**

Run:

```bash
python scripts/akshare/run_cycle.py
```

Expected: canonical file exists and contains `schema_version: market.frames.v1`.

**Step 4: Commit test evidence updates (if docs/log snapshots tracked)**

```bash
git add <only-if-tracked-verification-artifacts>
git commit -m "test: verify akshare to agents live-file workflow"
```

---

## Notes and constraints

- Keep replay competition workflow intact (`RUNTIME_DATA_MODE=replay`) and use live-file mode only for realtime operations.
- Do not reset replay engine as part of canonical file refresh.
- Use atomic file writes everywhere to prevent partial read corruption.
- Treat AKShare failures as normal; always retain and serve last good canonical cache.
- Add a legal/compliance sign-off checkbox in cutover runbook before enabling commercial production traffic.
