# Local MP4 Slice Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a separate local-only web app on the resource generation PC that indexes generated `mp4` slices across rooms, supports browse/search/playback/status updates, and prepares the data model for later multi-platform publishing.

**Architecture:** Create a standalone `local-slice-manager/` app with an Express API, a React/Vite frontend, and a SQLite database. The app scans local retained manifests plus local `content_videos/` and `content_posters/` directories, upserts segment records into SQLite, serves media through safe backend routes, and provides a local browser UI for review and status management. It does not depend on zhibo VM availability and does not modify the live streaming frontend.

**Tech Stack:** Node.js, Express, React, Vite, TypeScript, SQLite, Vitest, Playwright or lightweight API/browser verification.

---

### Task 1: Scaffold the standalone `local-slice-manager` app and database schema

**Files:**
- Create: `local-slice-manager/package.json`
- Create: `local-slice-manager/tsconfig.json`
- Create: `local-slice-manager/vite.config.ts`
- Create: `local-slice-manager/index.html`
- Create: `local-slice-manager/server/config.ts`
- Create: `local-slice-manager/server/db.ts`
- Create: `local-slice-manager/server/schema.sql`
- Create: `local-slice-manager/server/db.test.ts`

**Step 1: Write the failing DB schema test**

Create `local-slice-manager/server/db.test.ts` to assert:

- the database initializes `segments`
- the database initializes `segment_publish_targets`
- a helper like `openSliceManagerDb()` creates `data/local_slice_manager/slice_manager.db` automatically

Use a not-yet-created import such as:

```ts
import {openSliceManagerDb, listTables} from './db'
```

**Step 2: Run the test to verify it fails**

Run: `npm --prefix local-slice-manager test -- server/db.test.ts`

Expected: FAIL because the package and DB helpers do not exist yet.

**Step 3: Create the package and schema**

Add `local-slice-manager/package.json` with scripts:

```json
{
  "scripts": {
    "dev": "node server/dev.mjs",
    "test": "vitest run",
    "build": "vite build"
  }
}
```

Create `server/schema.sql` with the `segments` and `segment_publish_targets` tables from the design doc. Create `server/db.ts` with helpers to:

- resolve the DB path under `data/local_slice_manager/slice_manager.db`
- initialize schema on first open
- expose simple query helpers for tests

**Step 4: Run the test to verify it passes**

Run: `npm --prefix local-slice-manager test -- server/db.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add local-slice-manager/package.json local-slice-manager/tsconfig.json local-slice-manager/vite.config.ts local-slice-manager/index.html local-slice-manager/server/config.ts local-slice-manager/server/db.ts local-slice-manager/server/schema.sql local-slice-manager/server/db.test.ts
git commit -m "feat(slice-manager): scaffold local app and sqlite schema"
```

### Task 2: Implement manifest scanning and SQLite upsert ingestion

**Files:**
- Create: `local-slice-manager/server/scan.ts`
- Create: `local-slice-manager/server/scan.test.ts`
- Modify: `local-slice-manager/server/db.ts`

**Step 1: Write the failing scan test**

Create `local-slice-manager/server/scan.test.ts` covering:

- retained manifest segments are read from `data/live/onlytrade/content_factory/*.json`
- only rows whose local video file exists are indexed
- re-running scan updates an existing row instead of duplicating it

Use a helper like:

```ts
import {scanAndUpsertSegments} from './scan'
```

Build the test with a temp directory holding:

- one manifest JSON
- one `content_videos/t_022/*.mp4`
- one `content_posters/t_022/*.jpg`

**Step 2: Run the test to verify it fails**

Run: `npm --prefix local-slice-manager test -- server/scan.test.ts`

Expected: FAIL.

**Step 3: Implement the scanner**

Create `server/scan.ts` with logic to:

- find retained manifests under `data/live/onlytrade/content_factory`
- parse `segments[]`
- resolve `video_path` / `poster_path`
- upsert rows into SQLite keyed by `segment id`

Add a helper in `db.ts`:

```ts
upsertSegment(record)
```

**Step 4: Run the scan test**

Run: `npm --prefix local-slice-manager test -- server/scan.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add local-slice-manager/server/scan.ts local-slice-manager/server/scan.test.ts local-slice-manager/server/db.ts
git commit -m "feat(slice-manager): ingest retained manifests into sqlite"
```

### Task 3: Add the local API for list/detail/status/media routes

**Files:**
- Create: `local-slice-manager/server/app.ts`
- Create: `local-slice-manager/server/routes.test.ts`
- Create: `local-slice-manager/server/dev.mjs`
- Modify: `local-slice-manager/server/db.ts`

**Step 1: Write the failing route test**

Create `local-slice-manager/server/routes.test.ts` covering:

- `GET /api/segments` returns paged rows
- `GET /api/segments/:id` returns full detail
- `PATCH /api/segments/:id/status` updates status
- `GET /media/video/:id` streams the mapped mp4 safely
- `GET /media/poster/:id` streams the mapped poster safely
- path traversal is rejected because IDs are resolved through DB lookup, not direct file paths

**Step 2: Run the test to verify it fails**

Run: `npm --prefix local-slice-manager test -- server/routes.test.ts`

Expected: FAIL.

**Step 3: Implement the API**

Create `server/app.ts` with an Express app that exposes:

- `GET /api/segments`
- `GET /api/segments/:id`
- `PATCH /api/segments/:id/status`
- `PATCH /api/segments/:id/notes`
- `POST /api/segments/rescan`
- `GET /media/video/:id`
- `GET /media/poster/:id`

Create `server/dev.mjs` to start the API in dev mode and optionally trigger an initial scan.

**Step 4: Run the route test**

Run: `npm --prefix local-slice-manager test -- server/routes.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add local-slice-manager/server/app.ts local-slice-manager/server/routes.test.ts local-slice-manager/server/dev.mjs local-slice-manager/server/db.ts
git commit -m "feat(slice-manager): add local API and safe media routes"
```

### Task 4: Build the segment list UI

**Files:**
- Create: `local-slice-manager/src/main.tsx`
- Create: `local-slice-manager/src/App.tsx`
- Create: `local-slice-manager/src/api.ts`
- Create: `local-slice-manager/src/types.ts`
- Create: `local-slice-manager/src/pages/SegmentListPage.tsx`
- Create: `local-slice-manager/src/pages/SegmentListPage.test.tsx`

**Step 1: Write the failing UI test**

Create `local-slice-manager/src/pages/SegmentListPage.test.tsx` to assert:

- rows render poster, title, room, status, and duration
- keyword filter updates the API query or filtered view
- clicking a row opens the detail route or selection state

**Step 2: Run the test to verify it fails**

Run: `npm --prefix local-slice-manager test -- src/pages/SegmentListPage.test.tsx`

Expected: FAIL.

**Step 3: Implement the list page**

Create a basic React page that:

- fetches `GET /api/segments`
- supports local controls for room, program, status, keyword, and date range
- renders a table/card list of segments

Add the shared API client in `src/api.ts`.

**Step 4: Run the list-page test**

Run: `npm --prefix local-slice-manager test -- src/pages/SegmentListPage.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add local-slice-manager/src/main.tsx local-slice-manager/src/App.tsx local-slice-manager/src/api.ts local-slice-manager/src/types.ts local-slice-manager/src/pages/SegmentListPage.tsx local-slice-manager/src/pages/SegmentListPage.test.tsx
git commit -m "feat(slice-manager): add segment list UI"
```

### Task 5: Build the segment detail page with local playback and status editing

**Files:**
- Create: `local-slice-manager/src/pages/SegmentDetailPage.tsx`
- Create: `local-slice-manager/src/pages/SegmentDetailPage.test.tsx`
- Modify: `local-slice-manager/src/App.tsx`
- Modify: `local-slice-manager/src/api.ts`

**Step 1: Write the failing detail-page test**

Create `local-slice-manager/src/pages/SegmentDetailPage.test.tsx` covering:

- the page fetches segment detail
- renders poster + HTML5 video player
- status change calls `PATCH /api/segments/:id/status`
- notes save calls `PATCH /api/segments/:id/notes`

**Step 2: Run the test to verify it fails**

Run: `npm --prefix local-slice-manager test -- src/pages/SegmentDetailPage.test.tsx`

Expected: FAIL.

**Step 3: Implement the detail page**

Build a detail screen that shows:

- poster
- embedded `<video controls>` player
- title, summary, topic ID, room, program, source URL
- status selector
- notes textarea

Hook it into `App.tsx` with a simple route/state system.

**Step 4: Run the detail-page test**

Run: `npm --prefix local-slice-manager test -- src/pages/SegmentDetailPage.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add local-slice-manager/src/pages/SegmentDetailPage.tsx local-slice-manager/src/pages/SegmentDetailPage.test.tsx local-slice-manager/src/App.tsx local-slice-manager/src/api.ts
git commit -m "feat(slice-manager): add segment detail playback and status editing"
```

### Task 6: Add scan controls, startup behavior, and local runbook

**Files:**
- Create: `local-slice-manager/README.md`
- Create: `local-slice-manager/server/config.test.ts`
- Modify: `local-slice-manager/server/config.ts`
- Modify: `local-slice-manager/server/dev.mjs`
- Modify: `local-slice-manager/src/pages/SegmentListPage.tsx`

**Step 1: Write the failing config/startup test**

Create `local-slice-manager/server/config.test.ts` to assert:

- default source directories point at `data/live/onlytrade/content_videos`, `content_posters`, `content_factory`, and `topic_packages`
- the dev server can boot with defaults on local PC

**Step 2: Run the test to verify it fails**

Run: `npm --prefix local-slice-manager test -- server/config.test.ts`

Expected: FAIL.

**Step 3: Implement config and scan controls**

Add config defaults in `server/config.ts` for:

- DB path
- manifest dir
- video dir
- poster dir
- host / port

Update the list page to include a `Rescan` button that calls `POST /api/segments/rescan`.

Add `README.md` with:

- install
- dev run
- build
- local-only access note

**Step 4: Run the config/startup test**

Run: `npm --prefix local-slice-manager test -- server/config.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add local-slice-manager/README.md local-slice-manager/server/config.ts local-slice-manager/server/config.test.ts local-slice-manager/server/dev.mjs local-slice-manager/src/pages/SegmentListPage.tsx
git commit -m "feat(slice-manager): add scan controls and local runbook"
```

### Task 7: End-to-end verification on the local PC

**Files:**
- Verify only; no new files required

**Step 1: Run all automated tests**

Run:

```bash
npm --prefix local-slice-manager test
```

Expected: all PASS.

**Step 2: Start the local app**

Run:

```bash
npm --prefix local-slice-manager run dev
```

Expected: local API + frontend are reachable, for example at `http://127.0.0.1:19020`.

**Step 3: Verify ingestion on real local data**

Use the real local directories already present on this machine:

- `data/live/onlytrade/content_videos/t_022`
- `data/live/onlytrade/content_posters/t_022`
- `data/live/onlytrade/content_factory`

Check that:

- list view shows real `t_022` segments
- detail view opens a real `mp4`
- status update persists across refresh

**Step 4: Browser verification**

Open the app in a browser and confirm:

- search by title works
- room filter works
- video playback starts
- rescan does not duplicate rows

**Step 5: Final optional commit only if requested**

No extra verification-only commit unless explicitly requested.

---

Plan complete and saved to `docs/plans/2026-03-21-local-mp4-slice-manager-implementation.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
