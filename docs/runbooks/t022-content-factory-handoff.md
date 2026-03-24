# t_022 Content Factory Handoff

This document captures the current operational baseline for `t_022` on both the local production PC and the Aliyun VM so future operators can continue the room without rediscovering the same pitfalls.

## Scope

- Room: `t_022`
- Program slug: `china-bigtech`
- Current program title: `内容工厂·科技大厂`
- Public room URL: `http://zhibo.quickdealservice.com:18000/onlytrade/stream/content-factory?trader=t_022&program=china-bigtech`
- Public slice manager URL: `http://zhibo.quickdealservice.com:18000/onlytrade/slice-manager/`

## Current content policy

### Topic scope

- `t_022` is now a mixed pool for domestic tech companies, global tech giants, and AI-native companies.
- Direct-source ingestion currently includes `ITHome`, `36Kr`, `Leiphone`, and `QbitAI`.
- The current package pool already expands beyond domestic companies when recent coverage exists.

### Hard content exclusions

- Huawei-cluster content is blocked end-to-end.
- Blocked entities: `huawei`, `aito`.
- Blocked topic text patterns include: `华为`, `余承东`, `麒麟`, `鸿蒙`, `问界`, `AITO`, `Huawei`.
- The block exists in both:
  - `scripts/topic_stream/run_china_bigtech_cycle.py` (production selection)
  - `scripts/content_factory/render_publish_t022_from_packages.py` (publish-time safety guard)

### LLM generation policy

- Commentary provider order is: `qwen3-max -> openai -> gemini -> fallback`.
- Each model is attempted twice before falling through to the next provider.
- Environment is loaded from `runtime-api/.env.local`, not repo-root `.env.local`.
- If `DASHSCOPE_API_KEY` / `TOPIC_STREAM_QWEN_API_KEY` is absent, Qwen is skipped automatically.

### Dirty-content guards

- `validate_generated_block()` rejects:
  - fallback-style titles such as `这条消息，把情绪直接点着了` or `这波动静，重点不在表面热闹`
  - obviously English `topic_reason` values dominating the field
- This prevents low-quality or cross-program fallback copy from entering the package layer.

## Current video template contract

All newly generated `t_022` videos are expected to follow the current three-zone video template.

### Layout

- `9:16` canvas (`1080x1920`)
- Top / middle / bottom height split: `30 / 40 / 30`
- Top title stays visually stable; the title is not animated line-by-line.
- Middle zone rotates three visuals.
- Bottom zone uses dynamic commentary subtitles rather than a static summary block.

### Commentary rules

- No `评论字幕` label.
- No heavy boxed subtitle panel; the subtitle area should blend into the video with a soft gradient.
- Subtitle copy should be Chinese commentary-style prose, not direct TTS transcript text.
- The current approved feel is based on the slower dynamic subtitle sample that was manually reviewed on the local PC.
- Implementation lives in:
  - `content-factory-renderer/src/ContentFactorySegment.tsx`
  - `content-factory-renderer/src/dynamicCommentary.ts`

### Visual-selection rules

- Prefer three real visuals when available.
- If not enough real visuals exist, use generated cards as fallback.
- Near-duplicate image filtering is enabled so one long image and its crop do not both appear in the same video.
- Implementation lives in `scripts/topic_stream/china_bigtech_packages.py`.

## Local production path

### Files and scripts

- Windows runner: `scripts/windows/run-t022-local-push.ps1`
- Scheduled-task setup: `scripts/windows/setup-t022-local-push-task.ps1`
- Shell entrypoint: `scripts/content_factory/local_render_and_push_t022.sh`
- Topic builder: `scripts/topic_stream/run_china_bigtech_cycle.py`
- MP4 publisher: `scripts/content_factory/render_publish_t022_from_packages.py`
- Renderer: `content-factory-renderer/`

### Key local outputs

- Package feed: `data/live/onlytrade/topic_packages/china_bigtech_packages.json`
- Batch manifest: `data/live/onlytrade/content_factory/china_bigtech_factory_live.batch.json`
- MP4 output dir: `data/live/onlytrade/content_videos/t_022`
- Poster output dir: `data/live/onlytrade/content_posters/t_022`
- Scheduler log: `logs/t022_local_push.log`

### Normal local manual run

```bash
bash scripts/content_factory/local_render_and_push_t022.sh
```

This command currently:

1. rebuilds the latest mixed `china-bigtech` package feed
2. renders the newest `t_022` MP4 batch
3. uploads that batch to the VM
4. merges it into the canonical VM retained manifest

## Aliyun / VM baseline

- Host: `113.125.202.169`
- SSH port: `21522`
- User: `root`
- SSH key on this workstation: `C:\Users\rdpuser\.ssh\cn169_ed25519`
- Repo root: `/opt/onlytrade`
- Runtime API: `http://127.0.0.1:18080`
- Public web root: `http://zhibo.quickdealservice.com:18000`

### Key VM files

- Canonical retained manifest: `/opt/onlytrade/data/live/onlytrade/content_factory/china_bigtech_factory_live.json`
- Online MP4 directory: `/opt/onlytrade/data/live/onlytrade/content_videos/t_022`
- Online poster directory: `/opt/onlytrade/data/live/onlytrade/content_posters/t_022`
- Archive root: `/opt/onlytrade/data/live/onlytrade/archive/t_022`
- Slice-manager DB: `/opt/onlytrade/data/local_slice_manager/slice_manager.db`

## Current operational lessons

### 1) Do not trust scheduled-task result code alone

- Windows task result codes can stay stale even while a new run is actively progressing.
- The practical truth source is:
  - `logs/t022_local_push.log`
  - current local batch manifest timestamp
  - current render/publish subprocess chain

### 2) SSH / SCP timeouts can fail upload after local render succeeded

- A recent production failure came from `scp` timing out while uploading to the VM.
- Symptom: local MP4s were freshly rendered, but the VM retained feed did not advance.
- First check VM reachability before assuming render failure.

### 3) Replacing the VM manifest may require restarting `onlytrade-runtime-api`

- The runtime API can continue serving stale in-memory retained rows after the manifest file is replaced on disk.
- If the disk manifest looks correct but `/api/content-factory/live?room_id=t_022` still returns old rows, restart only the runtime API.

### 4) If old files are archived, rebuild the slice-manager DB

- `slice-manager` does not automatically forget removed files if the old DB is kept.
- After archiving or bulk-removing online MP4/JPG files, rebuild the DB and rescan.

### 5) One source article must not create multiple entity slots

- A real bug allowed the same roundup article to generate separate `huawei`, `xpeng`, and `meta` videos, all effectively about Huawei.
- This is now guarded by source-URL dedupe in `_select_best_direct_rows()`.

## Safe cleanup / replacement workflow

Use this when you want to remove stale or policy-violating videos from both the live room and slice manager without immediately deleting files forever.

### Recommended procedure

1. Upload the newest local batch manifest to the VM as `.incoming.json`
2. Rebuild the canonical VM retained manifest from an empty baseline plus the incoming batch
3. Move all non-kept online MP4/JPG files into `/archive/t_022/<timestamp>/`
4. Rebuild the slice-manager DB
5. Restart `onlytrade-runtime-api`
6. Verify both public endpoints again

### Why archive instead of hard-delete first

- Safer rollback path
- Lets operators inspect exactly what was removed
- Keeps the online directories and retained feed clean while preserving forensics

## Verification checklist

### Public live room

```bash
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/content-factory/live?room_id=t_022"
curl -fsS -I "http://zhibo.quickdealservice.com:18000/onlytrade/stream/content-factory?trader=t_022&program=china-bigtech"
```

### Public asset checks

```bash
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/onlytrade/api/content-factory/videos/t_022/<segment>.mp4"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/onlytrade/api/content-factory/posters/t_022/<poster>.jpg"
```

### Slice manager

```bash
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/slice-manager/api/segments?page=1&pageSize=50"
```

### Local scheduler / render health

```powershell
Get-ScheduledTask -TaskName "OnlyTrade-T022-LocalPush-10m"
Get-ScheduledTask -TaskName "OnlyTrade-T022-LocalPush-10m" | Get-ScheduledTaskInfo
Get-Content logs\t022_local_push.log -Tail 80
```

## Current known gaps

- Slice manager list ordering still deserves an explicit “latest sync first” sort policy if operators want strict recency ordering in the UI.
- Global-content balancing has improved, but a dedicated cooldown / cluster-balancing rule can still make the top of the retained feed feel more varied.

## Recommended handoff order for the next operator

1. Read `docs/runbooks/topic-stream-ops.md`
2. Read this file end-to-end
3. Check the latest local package feed and batch manifest timestamps
4. Check `logs/t022_local_push.log`
5. Check the public live room API and slice-manager API
6. Only then decide whether to rerun local publish, archive stale content, or restart runtime services
