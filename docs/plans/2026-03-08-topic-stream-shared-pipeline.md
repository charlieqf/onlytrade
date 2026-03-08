# Shared Topic Stream Commentary Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build one reusable topic-stream production and playback pipeline for `t_018` five-league and `t_019` china-bigtech, reusing the proven `t_017` local-generate -> MP3-prebuild -> VM-push -> audio-ended auto-advance model.

**Architecture:** Keep collection and generation on the local PC, emit one normalized topic feed JSON per program, push JSON/images/MP3 to VM, and serve them through one generic runtime API plus one shared mobile-first player page. Program differences live in config, adapters, prompt style, validator rules, and theme tokens rather than separate systems.

**Tech Stack:** Python collectors/generators, existing local Windows + Git Bash push flow, runtime-api Express server, React + Vite frontend, Vitest, Node test runner.

---

### Task 1: Define the shared topic-stream contract

**Files:**
- Modify: `docs/design/topic-stream-program-blueprints.md`
- Create: `docs/design/topic-stream-feed-contract.md`
- Create: `runtime-api/test/topicStreamContract.test.mjs`

**Step 1: Write the failing backend contract test**

Create `runtime-api/test/topicStreamContract.test.mjs` with assertions for one valid normalized payload:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

test('topic stream feed keeps only valid image-backed topics', async () => {
  const payload = {
    schema_version: 'topic.stream.feed.v1',
    room_id: 't_018',
    program_slug: 'five-league',
    topics: [
      {
        id: 'topic_1',
        entity_key: 'real_madrid',
        title: 'Madrid escape again',
        image_file: 'madrid.jpg',
        audio_file: 'topic_1.mp3',
      },
      {
        id: '',
        title: 'broken row',
      },
    ],
  }

  const normalized = normalizeTopicStreamPayload(payload)
  assert.equal(normalized.topic_count, 1)
  assert.equal(normalized.topics[0].image_api_url, '/api/topic-stream/images/t_018/madrid.jpg')
  assert.equal(normalized.topics[0].audio_api_url, '/api/topic-stream/audio/t_018/topic_1.mp3')
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix runtime-api test -- topicStreamContract`

Expected: FAIL because `normalizeTopicStreamPayload` and the new contract file do not exist yet.

**Step 3: Write the contract spec**

Add `docs/design/topic-stream-feed-contract.md` with the exact top-level and per-topic fields, based on `docs/design/topic-stream-program-blueprints.md` plus the real `t_017` lessons from `runtime-api/server.mjs:4184` and `runtime-api/server.mjs:4225`:

```json
{
  "schema_version": "topic.stream.feed.v1",
  "room_id": "t_018",
  "program_slug": "five-league",
  "program_title": "五大联赛每日评书",
  "program_style": "storytelling_sharp",
  "as_of": "2026-03-08T10:00:00Z",
  "topic_count": 10,
  "topics": [
    {
      "id": "topic_001",
      "entity_key": "real_madrid",
      "entity_label": "Real Madrid",
      "category": "football",
      "title": "Mbappe saves Madrid late again",
      "screen_title": "皇马这场又赢得不体面，但赢得很豪门",
      "summary_facts": "short factual digest",
      "commentary_script": "spoken commentary",
      "screen_tags": ["Late winner", "Title race", "Defensive wobble"],
      "source": "BBC Sport",
      "source_url": "https://example.com/story",
      "published_at": "2026-03-08T09:20:00Z",
      "image_file": "abc.jpg",
      "audio_file": "abc.mp3",
      "script_estimated_seconds": 74,
      "priority_score": 0.92,
      "topic_reason": "late winner + title-race attention"
    }
  ]
}
```

**Step 4: Update the blueprint doc to point at the canonical contract doc**

Keep `docs/design/topic-stream-program-blueprints.md` focused on product/program design, and move the precise runtime contract into `docs/design/topic-stream-feed-contract.md`.

**Step 5: Run the test again**

Run: `npm --prefix runtime-api test -- topicStreamContract`

Expected: still FAIL until Task 2 wires the normalizer into runtime-api.

### Task 2: Add generic topic-stream runtime API and storage handling

**Files:**
- Modify: `runtime-api/server.mjs`
- Create: `runtime-api/test/topicStreamRoutes.test.mjs`

**Step 1: Write the failing route test**

Create `runtime-api/test/topicStreamRoutes.test.mjs` to cover:
- `GET /api/topic-stream/live?room_id=t_018`
- `GET /api/topic-stream/images/t_018/example.jpg`
- `GET /api/topic-stream/audio/t_018/example.mp3`

The test fixture should verify:
- room-specific path resolution
- invalid file traversal rejection
- `topic_count` equals kept topics
- `image_api_url` / `audio_api_url` are populated in normalized rows

**Step 2: Run test to verify it fails**

Run: `npm --prefix runtime-api test -- topicStreamRoutes`

Expected: FAIL because the generic endpoints do not exist yet.

**Step 3: Implement the minimal backend support**

In `runtime-api/server.mjs`, add:
- `TOPIC_STREAM_ROOT`, `TOPIC_STREAM_FEED_DIR`, `TOPIC_STREAM_IMAGE_DIR`, `TOPIC_STREAM_AUDIO_DIR`
- a `topicStreamProviderByRoom` map using the existing `createLiveJsonFileProvider(...)` pattern already used by `englishClassroomProvider` at `runtime-api/server.mjs:2955`
- `normalizeTopicStreamTopicRow(...)`
- `normalizeTopicStreamPayload(...)`
- `toTopicStreamImageApiUrl(roomId, file)`
- `toTopicStreamAudioApiUrl(roomId, file)`
- the three generic routes described in `docs/design/topic-stream-program-blueprints.md`

Use this URL shape:

```js
`/api/topic-stream/images/${roomId}/${file}`
`/api/topic-stream/audio/${roomId}/${file}`
```

Map feeds as:
- `t_018` -> `data/live/onlytrade/topic_stream/five_league_live.json`
- `t_019` -> `data/live/onlytrade/topic_stream/china_bigtech_live.json`

**Step 4: Make the runtime normalization strict**

Reject rows lacking any of:
- `id`
- `title`
- `entity_key`
- `image_file`

Keep `audio_file` optional for transport robustness, but expose `audio_api_url` when present.

**Step 5: Run backend tests**

Run:
- `npm --prefix runtime-api test -- topicStreamContract`
- `npm --prefix runtime-api test -- topicStreamRoutes`

Expected: PASS.

### Task 3: Build one shared topic-commentary player page

**Files:**
- Modify: `onlytrade-web/src/App.tsx`
- Modify: `onlytrade-web/src/lib/api.ts`
- Create: `onlytrade-web/src/pages/design/TopicCommentaryPage.tsx`
- Create: `onlytrade-web/src/pages/design/TopicCommentaryPage.test.tsx`
- Modify: `docs/runbooks/phone-stream-pages.md`

**Step 1: Write the failing frontend test**

Create `onlytrade-web/src/pages/design/TopicCommentaryPage.test.tsx` to verify:
- `program=five-league` renders football theme label
- `program=china-bigtech` renders big-tech theme label
- the page uses fetched `screen_title` and `screen_tags`
- the page advances only after `audio.onended`, not on a blind timer

**Step 2: Run test to verify it fails**

Run: `npm --prefix onlytrade-web run test -- TopicCommentaryPage`

Expected: FAIL because the shared player page and API method do not exist yet.

**Step 3: Implement the shared player**

Base the component on the real playback logic in `onlytrade-web/src/pages/design/T017OralEnglishPage.tsx`, especially:
- fetch-live polling
- current + next audio prefetch
- `audio.onended` driven rotation
- autoplay unlock retry flow

Do **not** copy the `teaching_material` / `screen_vocabulary` naming. Use the new topic fields instead:

```ts
type TopicHeadline = {
  id: string
  title: string
  screenTitle: string
  summaryFacts: string
  commentaryScript: string
  screenTags: string[]
  source: string
  publishedAt: string
  imageApiUrl: string
  audioApiUrl: string
}
```

Theme must be config-driven from `program`:
- `five-league` -> stadium / tabloid urgency
- `china-bigtech` -> newsroom / app-war / warning-board

**Step 4: Wire routing and API**

Add to `onlytrade-web/src/App.tsx`:
- page key `topicCommentary`
- route `/stream/topic-commentary`
- render branch for `TopicCommentaryPage`

Add to `onlytrade-web/src/lib/api.ts`:

```ts
async getTopicStreamLive(options?: { room_id?: string })
```

Point it to `GET /api/topic-stream/live?room_id=...`.

**Step 5: Run frontend verification**

Run:
- `npm --prefix onlytrade-web run test -- TopicCommentaryPage`
- `npm --prefix onlytrade-web run build`

Expected: PASS.

### Task 4: Create reusable topic-stream config and normalization layer

**Files:**
- Create: `config/topic-stream/football_clubs.yaml`
- Create: `config/topic-stream/china_bigtech_entities.yaml`
- Modify: `config/topic-stream/football_clubs.example.yaml`
- Modify: `config/topic-stream/china_bigtech_entities.example.yaml`
- Create: `scripts/topic_stream/common.py`
- Create: `scripts/topic_stream/test_common.py`

**Step 1: Write the failing config/normalization test**

Create `scripts/topic_stream/test_common.py` covering:
- config load succeeds
- disabled entities are skipped
- alias matching resolves to one canonical `entity_key`
- per-program defaults produce `8-12` selected topics max

**Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/topic_stream/test_common.py -q`

Expected: FAIL because the shared topic-stream helpers do not exist yet.

**Step 3: Implement shared helpers**

In `scripts/topic_stream/common.py`, add reusable utilities for:
- YAML config load
- canonical entity lookup
- topic ranking
- script length estimation
- image/audio filename hashing
- final feed write

Expose one normalized internal row shape like:

```python
{
    "id": "five_league_real_madrid_20260308_01",
    "entity_key": "real_madrid",
    "entity_label": "Real Madrid",
    "category": "football",
    "title": "source-like headline",
    "summary_facts": "fact-only digest",
    "source": "BBC Sport",
    "source_url": "https://...",
    "published_at": "2026-03-08T09:20:00Z",
    "priority_score": 0.92,
}
```

**Step 4: Promote example configs into runnable configs**

Copy the current pools from:
- `config/topic-stream/football_clubs.example.yaml`
- `config/topic-stream/china_bigtech_entities.example.yaml`

into real runtime configs:
- `config/topic-stream/football_clubs.yaml`
- `config/topic-stream/china_bigtech_entities.yaml`

Keep `.example.yaml` as documented reference samples.

**Step 5: Run the Python test again**

Run: `python -m pytest scripts/topic_stream/test_common.py -q`

Expected: PASS.

### Task 5: Implement the two collectors on top of one shared generation pipeline

**Files:**
- Create: `scripts/topic_stream/run_five_league_cycle.py`
- Create: `scripts/topic_stream/run_china_bigtech_cycle.py`
- Create: `scripts/topic_stream/test_generation.py`

**Step 1: Write the failing generator test**

Create `scripts/topic_stream/test_generation.py` with fixtures proving:
- football collector emits only configured club topics
- big-tech collector emits only configured company/vehicle topics
- generated rows include `screen_title`, `commentary_script`, `screen_tags`, `topic_reason`
- weak rows are rejected when they are dry, hookless, or image-less

**Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/topic_stream/test_generation.py -q`

Expected: FAIL because the collectors do not exist yet.

**Step 3: Implement the shared generation pattern**

Each collector should follow the exact same stages:
1. pull raw source rows
2. filter to whitelist
3. rank candidates
4. generate JSON commentary block
5. validate style/length/persona
6. resolve image
7. pre-generate MP3
8. write final feed JSON

Reuse proven `t_017` ideas from `scripts/english/run_google_news_cycle.py`:
- prompt + JSON-only output
- validator + regeneration loop
- script duration estimate
- asset hashing and cache reuse

But switch field names to the topic-stream contract:

```json
{
  "screen_title": "...",
  "summary_facts": "...",
  "commentary_script": "...",
  "screen_tags": ["..."],
  "topic_reason": "..."
}
```

**Step 4: Add program-specific validator rules**

Football reject reasons:
- dry scoreboard recap
- no sharp angle
- no next-match hook

Big-tech reject reasons:
- press-release tone
- unsupported allegations
- facts/opinion not separated

**Step 5: Run Python verification**

Run:
- `python -m pytest scripts/topic_stream/test_generation.py -q`
- `python scripts/topic_stream/run_five_league_cycle.py --help`
- `python scripts/topic_stream/run_china_bigtech_cycle.py --help`

Expected: PASS for tests, CLI help prints usage.

### Task 6: Add shared local-PC to VM push flow and Windows automation

**Files:**
- Create: `scripts/topic_stream/local_collect_and_push_t018.sh`
- Create: `scripts/topic_stream/local_collect_and_push_t019.sh`
- Create: `scripts/windows/run-t018-local-push.ps1`
- Create: `scripts/windows/run-t019-local-push.ps1`
- Create: `scripts/windows/setup-t018-local-push-task.ps1`
- Create: `scripts/windows/setup-t019-local-push-task.ps1`
- Modify: `docs/runbooks/phone-stream-pages.md`

**Step 1: Write the failing push smoke test**

Add a small Python or shell smoke test that reads the generated JSON and ensures every referenced asset exists locally before upload.

**Step 2: Run it to verify it fails**

Run one collector against a temp output directory, then run the smoke test.

Expected: FAIL before the new push wrappers exist.

**Step 3: Implement the push wrappers by adapting `t_017`**

Use `scripts/english/local_collect_and_push_t017.sh` and `scripts/windows/run-t017-local-push.ps1` as the baseline. Keep the same principles:
- mutex/lock on Windows runner
- generate locally first
- collect actual referenced assets from JSON
- `scp` only referenced JSON/images/audio
- optional one-time frontend deploy flag

Remote layout:

```text
/opt/onlytrade/data/live/onlytrade/topic_stream/five_league_live.json
/opt/onlytrade/data/live/onlytrade/topic_stream/china_bigtech_live.json
/opt/onlytrade/data/live/onlytrade/topic_images/t_018/
/opt/onlytrade/data/live/onlytrade/topic_images/t_019/
/opt/onlytrade/data/live/onlytrade/topic_audio/t_018/
/opt/onlytrade/data/live/onlytrade/topic_audio/t_019/
```

**Step 4: Update the phone-stream runbook**

In `docs/runbooks/phone-stream-pages.md`, add the final routes, endpoint details, and Windows scheduler commands for `t_018` / `t_019`.

**Step 5: Run push smoke verification**

Run:
- `powershell -File scripts/windows/run-t018-local-push.ps1`
- `powershell -File scripts/windows/run-t019-local-push.ps1`

Expected: local generation completes and the log reports synced JSON/assets.

### Task 7: End-to-end verify the new stream pages

**Files:**
- Modify: `docs/runbooks/phone-stream-pages.md`
- Create: `docs/runbooks/topic-stream-ops.md`

**Step 1: Write the verification checklist first**

Add `docs/runbooks/topic-stream-ops.md` with checks for:
- feed freshness
- topic count in `8-12` range
- every row has image
- audio reaches natural end before switching
- first interaction unlock on WeCom still recovers autoplay
- no dry fallback rows in final feed

**Step 2: Run backend and frontend verification commands**

Run:
- `curl -fsS "http://127.0.0.1:18080/api/topic-stream/live?room_id=t_018"`
- `curl -fsS "http://127.0.0.1:18080/api/topic-stream/live?room_id=t_019"`
- `npm --prefix runtime-api test`
- `npm --prefix onlytrade-web run build`

Expected: both feeds return valid payloads; backend tests pass; frontend builds.

**Step 3: Run browser/manual playback checks**

Verify on:
- `/stream/topic-commentary?trader=t_018&program=five-league`
- `/stream/topic-commentary?trader=t_019&program=china-bigtech`
- `/onlytrade/stream/topic-commentary?trader=t_018&program=five-league`
- `/onlytrade/stream/topic-commentary?trader=t_019&program=china-bigtech`

Confirm:
- theme matches program
- page shows one topic at a time
- next topic waits for `ended`
- current and next audio preload cleanly

**Step 4: Verify content quality, not just transport**

Sample 5 generated topics per program and reject release if:
- football sounds like bland match notes
- big-tech sounds like bland PR copy
- repeated catchphrases dominate the host persona

**Step 5: Commit**

```bash
git add docs/design/topic-stream-feed-contract.md docs/design/topic-stream-program-blueprints.md docs/runbooks/phone-stream-pages.md docs/runbooks/topic-stream-ops.md config/topic-stream/football_clubs.yaml config/topic-stream/china_bigtech_entities.yaml scripts/topic_stream scripts/windows/run-t018-local-push.ps1 scripts/windows/run-t019-local-push.ps1 scripts/windows/setup-t018-local-push-task.ps1 scripts/windows/setup-t019-local-push-task.ps1 runtime-api/server.mjs runtime-api/test/topicStreamContract.test.mjs runtime-api/test/topicStreamRoutes.test.mjs onlytrade-web/src/App.tsx onlytrade-web/src/lib/api.ts onlytrade-web/src/pages/design/TopicCommentaryPage.tsx onlytrade-web/src/pages/design/TopicCommentaryPage.test.tsx
git commit -m "feat: add shared topic commentary pipeline"
```
