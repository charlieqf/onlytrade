# t_022 Content Factory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a new `t_022` `content-factory` room that reuses the `china-bigtech` upstream topic production from `t_019`, renders each topic into a self-contained `mp4`, and serves a retained latest-20 video manifest at `/stream/content-factory?trader=t_022&program=china-bigtech`.

**Architecture:** Split the work into a shared `TopicPackage` layer plus two publishers. `t_019` continues publishing retained image+audio topics from shared packages, while `t_022` consumes the same packages, selects three visual slots, renders Remotion `mp4` segments locally, and publishes a retained latest-20 video manifest on the VM. The frontend and runtime API stay manifest-based: one canonical JSON file per room, no client-side image/audio composition for `t_022`.

**Tech Stack:** Python topic-stream scripts, new Node/Remotion renderer package, existing Express runtime API, React/Vite frontend, local Windows scheduled task wrappers, pytest, Vitest, Node `--test`.

---

### Task 1: Define the shared `TopicPackage` contract and make `t_019` consume it

**Files:**
- Create: `scripts/topic_stream/china_bigtech_packages.py`
- Create: `scripts/topic_stream/test_china_bigtech_packages.py`
- Modify: `scripts/topic_stream/run_china_bigtech_cycle.py`

**Step 1: Write the failing Python tests**

Create `scripts/topic_stream/test_china_bigtech_packages.py` with focused tests for:

- package rows preserve the current `t_019` facts: `screen_title`, `summary_facts`, `commentary_script`, `audio_file`
- package rows expose `visual_candidates` and `selected_visuals`
- the `t_019` publisher still emits one `image_file` + one `audio_file` row from a package

Use a not-yet-created import such as:

```python
from scripts.topic_stream.china_bigtech_packages import (
    build_topic_packages,
    package_to_t019_row,
)
```

**Step 2: Run tests to verify they fail**

Run: `python -m pytest scripts/topic_stream/test_china_bigtech_packages.py -q`

Expected: FAIL with missing module or missing symbols.

**Step 3: Implement the minimal package module**

Create `scripts/topic_stream/china_bigtech_packages.py` with functions like:

```python
def build_topic_packages(...):
    return packages


def package_to_t019_row(package):
    return {
        "id": package["topic_id"],
        "title": package["title"],
        "screen_title": package["screen_title"],
        "summary_facts": package["summary_facts"],
        "commentary_script": package["commentary_script"],
        "image_file": package["t019_image_file"],
        "audio_file": package["audio_file"],
    }
```

Refactor `scripts/topic_stream/run_china_bigtech_cycle.py` so its current payload builder uses the package module instead of directly building `t_019` rows inline.

**Step 4: Run tests to verify they pass**

Run: `python -m pytest scripts/topic_stream/test_china_bigtech_packages.py -q`

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/topic_stream/china_bigtech_packages.py scripts/topic_stream/test_china_bigtech_packages.py scripts/topic_stream/run_china_bigtech_cycle.py
git commit -m "feat(stream): extract shared china-bigtech topic packages"
```

### Task 2: Add the three-slot visual selection pipeline

**Files:**
- Create: `scripts/topic_stream/content_factory_cards.py`
- Create: `scripts/topic_stream/test_content_factory_cards.py`
- Modify: `scripts/topic_stream/china_bigtech_packages.py`
- Create: `assets/content_factory/brands/README.md`

**Step 1: Write the failing tests**

Create `scripts/topic_stream/test_content_factory_cards.py` to lock down these rules:

- if there are 2 article images, slot 3 falls back to a brand asset or generated card
- if there is only 1 real image, the package still gets exactly 3 `selected_visuals`
- generated cards are only used as fallback, not ahead of valid article images

Example test shape:

```python
def test_selected_visuals_fill_three_slots_with_fallbacks(tmp_path):
    package = choose_visual_slots(
        article_images=[{"local_file": "hero.jpg", "score": 0.9}],
        brand_assets=[{"local_file": "brand.jpg", "score": 0.6}],
        generated_cards=[{"card_kind": "summary", "local_file": "summary.png", "score": 0.4}],
    )
    assert len(package["selected_visuals"]) == 3
```

**Step 2: Run tests to verify they fail**

Run: `python -m pytest scripts/topic_stream/test_content_factory_cards.py -q`

Expected: FAIL.

**Step 3: Implement the minimal selection helpers**

Create `scripts/topic_stream/content_factory_cards.py` with functions such as:

```python
def build_generated_cards(package, output_dir):
    ...


def choose_visual_slots(article_images, brand_assets, generated_cards):
    ...
```

Rules to encode:

- prefer `article_image` first
- fill missing slots with `brand_asset`
- final fallback is `generated_card`
- always produce exactly 3 slots or skip publishing the package

Document the brand asset naming convention in `assets/content_factory/brands/README.md`.

**Step 4: Wire the shared package builder to use the selector**

Update `scripts/topic_stream/china_bigtech_packages.py` so each package includes:

- `visual_candidates`
- `selected_visuals`
- `t019_image_file` chosen from the best single visual image

**Step 5: Run tests**

Run:

```bash
python -m pytest scripts/topic_stream/test_china_bigtech_packages.py scripts/topic_stream/test_content_factory_cards.py -q
```

Expected: PASS.

**Step 6: Commit**

```bash
git add scripts/topic_stream/content_factory_cards.py scripts/topic_stream/test_content_factory_cards.py scripts/topic_stream/china_bigtech_packages.py assets/content_factory/brands/README.md
git commit -m "feat(stream): add t022 visual slot selection"
```

### Task 3: Create the Remotion renderer package for one-topic `mp4` segments

**Files:**
- Create: `content-factory-renderer/package.json`
- Create: `content-factory-renderer/tsconfig.json`
- Create: `content-factory-renderer/remotion.config.ts`
- Create: `content-factory-renderer/src/index.ts`
- Create: `content-factory-renderer/src/Root.tsx`
- Create: `content-factory-renderer/src/ContentFactorySegment.tsx`
- Create: `content-factory-renderer/src/calculateMetadata.ts`
- Create: `content-factory-renderer/src/calculateMetadata.test.ts`

**Step 1: Write the failing metadata test**

Create `content-factory-renderer/src/calculateMetadata.test.ts` to assert:

- the composition duration follows audio duration exactly
- the composition size is `1080x1920`
- scene timing divides duration into `34/33/33` style buckets

**Step 2: Run test to verify it fails**

Run: `npm --prefix content-factory-renderer test -- src/calculateMetadata.test.ts`

Expected: FAIL because the package and helpers do not exist yet.

**Step 3: Create the package and install Remotion essentials**

Add `package.json` scripts like:

```json
{
  "scripts": {
    "test": "vitest run",
    "render:segment": "remotion render src/index.ts content-factory-segment"
  }
}
```

Use a dedicated package so Remotion does not bloat `onlytrade-web`.

**Step 4: Implement the minimal composition**

Build a single composition that accepts props:

```ts
type SegmentProps = {
  title: string
  summary: string
  audioSrc: string
  visuals: Array<{type: string; src: string}>
}
```

The composition should:

- display title at top
- display summary at bottom
- sequence 3 visuals
- embed audio with the full segment duration

**Step 5: Run the renderer tests**

Run: `npm --prefix content-factory-renderer test -- src/calculateMetadata.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add content-factory-renderer
git commit -m "feat(stream): add remotion content-factory renderer"
```

### Task 4: Add the `t_022` render + retained-manifest publish workflow on the local PC

**Files:**
- Create: `scripts/content_factory/retained_video_manifest_merge.py`
- Create: `scripts/content_factory/test_retained_video_manifest_merge.py`
- Create: `scripts/content_factory/render_publish_t022_from_packages.py`
- Create: `scripts/content_factory/local_render_and_push_t022.sh`
- Create: `scripts/windows/run-t022-local-push.ps1`
- Create: `scripts/windows/setup-t022-local-push-task.ps1`
- Modify: `scripts/windows/test_local_push_task_setup.py`

**Step 1: Write the failing retained-manifest tests**

Create `scripts/content_factory/test_retained_video_manifest_merge.py` covering:

- latest 20 segments retained by `topic_id`
- newer segment replaces older render for the same `topic_id`
- rows whose `video_file` does not exist are dropped when asset filtering is enabled

**Step 2: Run the failing test**

Run: `python -m pytest scripts/content_factory/test_retained_video_manifest_merge.py -q`

Expected: FAIL.

**Step 3: Implement the merge helper**

Create `scripts/content_factory/retained_video_manifest_merge.py` similar to the `t_019` retained helper, but for segment rows:

```python
def merge_retained_segments(existing_payload, incoming_payload, *, retain_limit=20, video_dir=None, poster_dir=None):
    ...
```

**Step 4: Implement the local render/publish orchestrator**

Create `scripts/content_factory/render_publish_t022_from_packages.py` to:

- read shared `TopicPackage[]`
- render one `mp4` per package via `npm --prefix content-factory-renderer ...`
- create/update a batch manifest
- upload batch assets + manifest to the VM
- invoke the retained-manifest merge helper on the VM

Create `scripts/content_factory/local_render_and_push_t022.sh` as the shell entrypoint used by Windows PowerShell.

**Step 5: Add Windows wrappers**

Mirror the current `t_019` task runner pattern with:

- `scripts/windows/run-t022-local-push.ps1`
- `scripts/windows/setup-t022-local-push-task.ps1`

Extend `scripts/windows/test_local_push_task_setup.py` so `t_022` is included in the staggered scheduled-task assertions.

**Step 6: Run tests**

Run:

```bash
python -m pytest scripts/content_factory/test_retained_video_manifest_merge.py scripts/windows/test_local_push_task_setup.py -q
```

Expected: PASS.

**Step 7: Commit**

```bash
git add scripts/content_factory scripts/windows/run-t022-local-push.ps1 scripts/windows/setup-t022-local-push-task.ps1 scripts/windows/test_local_push_task_setup.py
git commit -m "feat(stream): add t022 local render and retained manifest publish"
```

### Task 5: Add runtime-api support for `content-factory` manifest, video, and poster routes

**Files:**
- Modify: `runtime-api/server.mjs`
- Create: `runtime-api/test/contentFactoryRoutes.test.mjs`

**Step 1: Write the failing route test**

Create `runtime-api/test/contentFactoryRoutes.test.mjs` covering:

- `GET /api/content-factory/live?room_id=t_022` returns the room manifest
- `GET /api/content-factory/videos/t_022/<file>.mp4` serves video content
- `GET /api/content-factory/posters/t_022/<file>.jpg` serves poster content
- path traversal is rejected

Model it after `runtime-api/test/topicStreamRoutes.test.mjs`.

**Step 2: Run the test to verify it fails**

Run: `node --test runtime-api/test/contentFactoryRoutes.test.mjs`

Expected: FAIL because routes do not exist yet.

**Step 3: Implement the routes in `runtime-api/server.mjs`**

Add new env-driven directories:

- `CONTENT_FACTORY_FEED_DIR`
- `CONTENT_FACTORY_VIDEO_DIR`
- `CONTENT_FACTORY_POSTER_DIR`

Add a live-json provider for `china_bigtech_factory_live.json` and expose:

- `/api/content-factory/live`
- `/api/content-factory/videos/:roomId/:file`
- `/api/content-factory/posters/:roomId/:file`

Use the same room-scoped path hardening pattern as the topic-stream routes.

**Step 4: Run the route test**

Run: `node --test runtime-api/test/contentFactoryRoutes.test.mjs`

Expected: PASS.

**Step 5: Run the full backend test suite**

Run: `npm --prefix runtime-api test`

Expected: PASS.

**Step 6: Commit**

```bash
git add runtime-api/server.mjs runtime-api/test/contentFactoryRoutes.test.mjs
git commit -m "feat(api): serve t022 content-factory manifests and assets"
```

### Task 6: Add the `t_022` frontend page and route

**Files:**
- Modify: `onlytrade-web/src/App.tsx`
- Modify: `onlytrade-web/src/lib/api.ts`
- Create: `onlytrade-web/src/pages/design/T022ContentFactoryPage.tsx`
- Create: `onlytrade-web/src/pages/design/T022ContentFactoryPage.test.tsx`

**Step 1: Write the failing frontend test**

Create `onlytrade-web/src/pages/design/T022ContentFactoryPage.test.tsx` to assert:

- the page requests `room_id: 't_022'` regardless of selected trader mismatch
- the page renders current segment title/poster state
- the page only advances after video ended

Use a fake `HTMLVideoElement`-style stub similar to the `Audio` stubs in `T020MarketRadarLabPage.test.tsx`.

**Step 2: Run the failing test**

Run: `npm --prefix onlytrade-web test -- src/pages/design/T022ContentFactoryPage.test.tsx`

Expected: FAIL.

**Step 3: Implement the page**

Add a new page that:

- fetches `/api/content-factory/live?room_id=t_022` every 15 seconds
- keeps the current segment if still present in the refreshed manifest
- renders the current poster while the video loads
- advances on `ended`
- skips on video error

Add `api.getContentFactoryLive()` in `onlytrade-web/src/lib/api.ts`.

Update `onlytrade-web/src/App.tsx` to:

- extend the `Page` union with `contentFactory`
- map `/stream/content-factory` to `contentFactory`
- render `T022ContentFactoryPage`
- show the empty-state hint `?trader=t_022`

**Step 4: Run frontend tests**

Run:

```bash
npm --prefix onlytrade-web test -- src/pages/design/T022ContentFactoryPage.test.tsx
npm --prefix onlytrade-web test -- src/pages/design/T020MarketRadarLabPage.test.tsx src/pages/design/TopicCommentaryPage.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add onlytrade-web/src/App.tsx onlytrade-web/src/lib/api.ts onlytrade-web/src/pages/design/T022ContentFactoryPage.tsx onlytrade-web/src/pages/design/T022ContentFactoryPage.test.tsx
git commit -m "feat(web): add t022 content-factory room page"
```

### Task 7: Register `t_022` and document the new room

**Files:**
- Create: `agents/t_022/agent.json`
- Modify: `data/agents/registry.json`
- Modify: `docs/runbooks/topic-stream-ops.md`
- Modify: `skills/six-room-stream-ops/SKILL.md`

**Step 1: Add the agent manifest and registry entry**

Create `agents/t_022/agent.json` using the current style of the other non-trading commentary rooms:

```json
{
  "agent_id": "t_022",
  "agent_name": "内容工厂",
  "ai_model": "gpt-4o-mini",
  "exchange_id": "sim-cn",
  "strategy_name": "China bigtech short video content factory",
  "trading_style": "event_driven",
  "risk_profile": "conservative"
}
```

Add `t_022` to `data/agents/registry.json` as lobby-visible and running.

**Step 2: Update the ops docs**

Document:

- the new route and room ID
- local render + push commands
- VM retained manifest path
- public `200 video/mp4` checks
- how `t_022` shares upstream quality improvements with `t_019`

**Step 3: Run minimal static verification**

Run:

```bash
python -m json.tool agents/t_022/agent.json >nul
python -m json.tool data/agents/registry.json >nul
```

Expected: PASS.

**Step 4: Commit**

```bash
git add agents/t_022/agent.json data/agents/registry.json docs/runbooks/topic-stream-ops.md skills/six-room-stream-ops/SKILL.md
git commit -m "feat(stream): register t022 content-factory room"
```

### Task 8: End-to-end verification on local PC, VM, and public URL

**Files:**
- Verify only; no new files required

**Step 1: Run all focused automated tests**

Run:

```bash
python -m pytest scripts/topic_stream/test_china_bigtech_packages.py scripts/topic_stream/test_content_factory_cards.py scripts/content_factory/test_retained_video_manifest_merge.py scripts/windows/test_local_push_task_setup.py -q
npm --prefix content-factory-renderer test
npm --prefix onlytrade-web test -- src/pages/design/T022ContentFactoryPage.test.tsx
npm --prefix runtime-api test
```

Expected: all PASS.

**Step 2: Run one local manual `t_022` publish**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\work\code\onlytrade\scripts\windows\run-t022-local-push.ps1" -RepoRoot "C:\work\code\onlytrade" -BashExe "C:\Program Files\Git\bin\bash.exe"
```

Expected: local log shows package build -> Remotion render -> VM sync -> retained manifest success.

**Step 3: Verify VM retained manifest and asset files**

Run:

```bash
ssh -p 21522 -i ~/.ssh/cn169_ed25519 root@113.125.202.169 'python3 - <<"PY"
import json
from pathlib import Path
p = Path("/opt/onlytrade/data/live/onlytrade/content_factory/china_bigtech_factory_live.json")
data = json.loads(p.read_text(encoding="utf-8"))
print(data.get("segment_count"))
print((data.get("segments") or [])[0].get("video_file"))
PY'
```

Expected:

- `segment_count <= 20`
- first segment has a real `video_file`

**Step 4: Verify the public room**

Run:

```bash
curl -fsS -I "http://zhibo.quickdealservice.com:18000/onlytrade/stream/content-factory?trader=t_022&program=china-bigtech"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/content-factory/live?room_id=t_022"
curl -fsS -I "http://zhibo.quickdealservice.com:18000/onlytrade/api/content-factory/videos/t_022/<segment>.mp4"
```

Expected:

- page returns `200`
- live manifest returns `200`
- segment video returns `200 video/mp4`

**Step 5: Verify the shared-upstream promise**

Run one same-cycle comparison and confirm:

- `t_019` and `t_022` share matching `topic_id` values for at least the latest few items
- a shared summary/script change in the package layer affects both rooms without duplicating business logic

**Step 6: Commit the final verification note only if requested**

No code commit is required here unless the user explicitly asks for a verification-only commit.

### Deferred Task 9: Local MP4 slice manager web app

**Files:**
- Defer until `t_022` MVP is stable

**Intent:**

After the core `t_022` room ships, add a separate local-PC web app for managing generated `mp4` slices across rooms. This app is explicitly **not** deployed on `http://zhibo.quickdealservice.com:18000`; it lives on the resource generation server and focuses on browsing, search, playback, and future publishing workflows.

**Scope for the deferred phase:**

- browse generated segments by room and program
- search by title, entity, topic id, and time range
- preview poster + play `mp4`
- later extend to platform publishing actions and publish status tracking

**Preparation work already required in the MVP:**

- stable `mp4` filenames
- rich segment metadata in the retained manifest / package index
- poster generation and predictable storage layout
- room-scoped segment directories on the local PC

---

Plan complete and saved to `docs/plans/2026-03-21-t022-content-factory-implementation.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
