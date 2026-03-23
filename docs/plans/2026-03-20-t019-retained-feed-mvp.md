# t_019 Retained Feed MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `t_019` keep a rolling latest-20 feed on the VM so small or weak local generation cycles do not collapse the public room to only the newest batch.

**Architecture:** Keep the public runtime contract unchanged: the frontend and `/api/topic-stream/live` still read one canonical JSON file. Change only the publish path. The local PC will upload a generated batch JSON plus assets, then a VM-side merge script will upsert the incoming topics into the existing canonical feed, dedupe by `topic.id`, keep the newest 20 valid topics, and atomically rewrite `china_bigtech_live.json`.

**Tech Stack:** Python topic-stream scripts, Git Bash/SSH local push flow, VM filesystem JSON storage, existing runtime-api live JSON file provider, pytest.

---

### Task 1: Lock down retained-feed merge semantics with failing tests

**Files:**
- Create: `scripts/topic_stream/test_retained_feed_merge.py`

**Step 1: Write the failing test file**

Create `scripts/topic_stream/test_retained_feed_merge.py` with three focused tests against a not-yet-created helper `merge_retained_feed`:

```python
from scripts.topic_stream.retained_feed_merge import merge_retained_feed


def test_merge_keeps_existing_topics_when_incoming_batch_is_smaller():
    existing = {
        "room_id": "t_019",
        "program_slug": "china-bigtech",
        "topics": [
            {"id": "old_1", "published_at": "2026-03-20T04:00:00Z", "image_file": "a.jpg", "audio_file": "a.mp3"},
            {"id": "old_2", "published_at": "2026-03-20T03:00:00Z", "image_file": "b.jpg", "audio_file": "b.mp3"},
        ],
    }
    incoming = {
        "room_id": "t_019",
        "program_slug": "china-bigtech",
        "topics": [
            {"id": "new_1", "published_at": "2026-03-20T05:00:00Z", "image_file": "c.jpg", "audio_file": "c.mp3"},
        ],
    }
    merged = merge_retained_feed(existing, incoming, retain_limit=20)
    assert [row["id"] for row in merged["topics"]] == ["new_1", "old_1", "old_2"]
    assert merged["topic_count"] == 3


def test_merge_replaces_same_topic_id_with_newer_payload():
    existing = {"room_id": "t_019", "program_slug": "china-bigtech", "topics": [{"id": "topic_x", "published_at": "2026-03-20T04:00:00Z", "screen_title": "old", "image_file": "x.jpg", "audio_file": "x.mp3"}]}
    incoming = {"room_id": "t_019", "program_slug": "china-bigtech", "topics": [{"id": "topic_x", "published_at": "2026-03-20T05:00:00Z", "screen_title": "new", "image_file": "x2.jpg", "audio_file": "x2.mp3"}]}
    merged = merge_retained_feed(existing, incoming, retain_limit=20)
    assert merged["topics"][0]["screen_title"] == "new"
    assert merged["topics"][0]["audio_file"] == "x2.mp3"


def test_merge_caps_room_to_latest_twenty_topics():
    existing_topics = [
        {"id": f"topic_{i:02d}", "published_at": f"2026-03-20T{(i % 10):02d}:00:00Z", "image_file": f"{i}.jpg", "audio_file": f"{i}.mp3"}
        for i in range(25)
    ]
    merged = merge_retained_feed({"room_id": "t_019", "program_slug": "china-bigtech", "topics": existing_topics}, {"room_id": "t_019", "program_slug": "china-bigtech", "topics": []}, retain_limit=20)
    assert merged["topic_count"] == 20
```

**Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/topic_stream/test_retained_feed_merge.py -q`

Expected: FAIL with `ModuleNotFoundError` or missing `merge_retained_feed`.

**Step 3: Commit the failing test**

```bash
git add scripts/topic_stream/test_retained_feed_merge.py
git commit -m "test: define retained t019 feed merge behavior"
```

### Task 2: Implement the VM-side retained-feed merge helper

**Files:**
- Create: `scripts/topic_stream/retained_feed_merge.py`
- Test: `scripts/topic_stream/test_retained_feed_merge.py`

**Step 1: Implement the minimal merge helper**

Create `scripts/topic_stream/retained_feed_merge.py` with:

```python
from datetime import datetime, timezone


def merge_retained_feed(existing_payload, incoming_payload, *, retain_limit=20):
    # validate same room/program
    # upsert by topic id
    # sort newest first by published_at, then by existing/incoming order
    # keep retain_limit rows
    # rewrite topic_count and as_of
    return merged_payload
```

Implementation rules:
- require matching `room_id` and `program_slug`
- ignore rows missing `id`, `image_file`, or `audio_file`
- incoming row wins when `id` already exists
- newest `published_at` first; if parse fails, send that row to the end
- set `topic_count = len(topics)`
- set `as_of` to the incoming payload `as_of` when present, otherwise current UTC ISO string

**Step 2: Run tests to verify they pass**

Run: `python -m pytest scripts/topic_stream/test_retained_feed_merge.py -q`

Expected: PASS.

**Step 3: Commit**

```bash
git add scripts/topic_stream/retained_feed_merge.py scripts/topic_stream/test_retained_feed_merge.py
git commit -m "feat: add retained topic feed merge helper"
```

### Task 3: Add a CLI merge script that rewrites the canonical VM feed atomically

**Files:**
- Modify: `scripts/topic_stream/retained_feed_merge.py`
- Test: `scripts/topic_stream/test_retained_feed_merge.py`

**Step 1: Extend the helper with file-based CLI entrypoints**

Add a small CLI to `scripts/topic_stream/retained_feed_merge.py`:

```python
if __name__ == "__main__":
    # args: --existing, --incoming, --output, --retain-limit, --room-id, --program-slug
    # load existing if present, else start empty
    # merge
    # atomic write to --output
```

Use the same atomic-write pattern already used by topic generators so the runtime API never reads a partial file.

**Step 2: Add one CLI smoke test**

In `scripts/topic_stream/test_retained_feed_merge.py`, add one temp-dir test that writes a small existing JSON and incoming JSON, runs the module as a subprocess, and asserts the output file contains both retained topics.

**Step 3: Run tests**

Run: `python -m pytest scripts/topic_stream/test_retained_feed_merge.py -q`

Expected: PASS.

**Step 4: Commit**

```bash
git add scripts/topic_stream/retained_feed_merge.py scripts/topic_stream/test_retained_feed_merge.py
git commit -m "feat: add retained feed merge CLI"
```

### Task 4: Change the `t_019` local push flow to publish batches into the retained VM feed

**Files:**
- Modify: `scripts/topic_stream/local_collect_and_push_t019.sh`
- Modify: `scripts/topic_stream/test_local_push_scripts.py`

**Step 1: Write the failing script regression**

Add one test to `scripts/topic_stream/test_local_push_scripts.py` asserting the push script uses a remote incoming batch file plus the merge CLI instead of copying the local JSON straight over the canonical file:

```python
def test_t019_push_script_merges_remote_batch_into_retained_feed() -> None:
    content = _read_script("local_collect_and_push_t019.sh")
    assert "REMOTE_INCOMING_JSON" in content
    assert "retained_feed_merge.py" in content
    assert '--retain-limit "${T019_RETAIN_LIMIT:-20}"' in content or 'T019_RETAIN_LIMIT' in content
```

**Step 2: Run the test to verify it fails**

Run: `python -m pytest scripts/topic_stream/test_local_push_scripts.py -q`

Expected: FAIL because the script still publishes only the current batch.

**Step 3: Implement the minimal script change**

Update `scripts/topic_stream/local_collect_and_push_t019.sh` to:
- keep local generation exactly as-is
- upload the batch JSON to something like `/opt/onlytrade/data/live/onlytrade/topic_stream/china_bigtech_live.incoming.json`
- upload/extract assets as before
- run remote merge:

```bash
python3 "$REMOTE_ROOT/scripts/topic_stream/retained_feed_merge.py" \
  --existing "$REMOTE_JSON" \
  --incoming "$REMOTE_INCOMING_JSON" \
  --output "$REMOTE_JSON" \
  --room-id t_019 \
  --program-slug china-bigtech \
  --retain-limit "${T019_RETAIN_LIMIT:-20}"
```

- delete the incoming batch file after success

**Step 4: Run tests**

Run: `python -m pytest scripts/topic_stream/test_local_push_scripts.py scripts/topic_stream/test_retained_feed_merge.py -q`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/topic_stream/local_collect_and_push_t019.sh scripts/topic_stream/test_local_push_scripts.py scripts/topic_stream/retained_feed_merge.py scripts/topic_stream/test_retained_feed_merge.py
git commit -m "feat: retain latest twenty t019 topics on vm"
```

### Task 5: Document the new room behavior and operator checks

**Files:**
- Modify: `docs/runbooks/topic-stream-ops.md`
- Modify: `docs/design/topic-stream-feed-contract.md`

**Step 1: Update the docs**

Document that for `t_019` MVP:
- the VM canonical feed is a retained rolling buffer, not a direct mirror of the newest batch
- the local PC still generates batches, but VM merge keeps the latest 20 valid topics
- a weak batch with only 1 topic should not collapse the live room to 1 if older valid topics still exist

**Step 2: Add operator verification commands**

Include checks like:

```bash
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/topic-stream/live?room_id=t_019"
ssh -p 21522 -i ~/.ssh/cn169_ed25519 root@113.125.202.169 'python3 scripts/topic_stream/retained_feed_merge.py --help'
```

**Step 3: Commit**

```bash
git add docs/runbooks/topic-stream-ops.md docs/design/topic-stream-feed-contract.md
git commit -m "docs: describe retained t019 topic feed behavior"
```

### Task 6: End-to-end verification on the local PC + VM

**Files:**
- Verify only; no new files required

**Step 1: Run automated tests**

Run:

```bash
python -m pytest scripts/topic_stream/test_retained_feed_merge.py scripts/topic_stream/test_local_push_scripts.py scripts/windows/test_local_push_task_setup.py -q
```

Expected: all PASS.

**Step 2: Run one manual local push**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\work\code\onlytrade\scripts\windows\run-t019-local-push.ps1" -RepoRoot "C:\work\code\onlytrade" -BashExe "C:\Program Files\Git\bin\bash.exe" -StartHour 8 -EndHour 23
```

Expected log signal in `logs/t019_local_push.log`:
- one generation JSON summary line
- one merge/publish success line

**Step 3: Verify retained behavior on the VM**

Run:

```bash
ssh -p 21522 -i ~/.ssh/cn169_ed25519 root@113.125.202.169 'python3 - <<"PY"
import json
from pathlib import Path
p = Path("/opt/onlytrade/data/live/onlytrade/topic_stream/china_bigtech_live.json")
data = json.loads(p.read_text(encoding="utf-8"))
print(data.get("topic_count"))
print([row.get("id") for row in (data.get("topics") or [])[:5]])
PY'
```

Expected:
- `topic_count <= 20`
- older valid topics remain when incoming batch is smaller than the retained list

**Step 4: Verify the public room still works**

Run:

```bash
python - <<'PY'
import json, urllib.request
with urllib.request.urlopen('http://zhibo.quickdealservice.com:18000/onlytrade/api/topic-stream/live?room_id=t_019', timeout=20) as r:
    live = json.loads(r.read().decode('utf-8'))['data']['live']
print(live['topic_count'])
print(live['as_of'])
PY
```

Expected:
- endpoint returns `200`
- topic count is at most `20`
- the room remains playable with valid image/audio URLs

---

Plan complete and saved to `docs/plans/2026-03-20-t019-retained-feed-mvp.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
