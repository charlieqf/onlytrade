# Topic Stream Ops

This runbook captures the real deployment and operations lessons from launching `t_019` `国内大厂每日锐评`, so the next show `t_018` `五大联赛豪门每日评书` can reuse the same path with fewer surprises.

## Public source of truth

- Use the domain route as the real public check target:
  - `http://zhibo.quickdealservice.com:18000/onlytrade/stream/topic-commentary?trader=t_019&program=china-bigtech`
  - `http://zhibo.quickdealservice.com:18000/onlytrade/stream/topic-commentary?trader=t_018&program=five-league`
- Do not treat bare-IP checks as sufficient public validation. The public entry should match the exact domain + port + `/onlytrade/...` path users open.

## Current runtime baseline

- VM: `113.125.202.169:21522`
- VM repo root: `/opt/onlytrade`
- Runtime API: `http://127.0.0.1:18080`
- Public web root: `http://zhibo.quickdealservice.com:18000`
- Nginx app config: `/usr/local/nginx/conf/onlytrade.conf`
- Frontend dist path: `/opt/onlytrade/onlytrade-web/dist`

## Topic commentary contract

- Shared page route: `/stream/topic-commentary?trader=<room_id>&program=<program_slug>`
- Public bridge route: `/onlytrade/stream/topic-commentary?trader=<room_id>&program=<program_slug>`
- Feed endpoint: `GET /onlytrade/api/topic-stream/live?room_id=<room_id>`
- Image endpoint: `GET /onlytrade/api/topic-stream/images/<room_id>/<file>`
- Audio endpoint: `GET /onlytrade/api/topic-stream/audio/<room_id>/<file>`
- Playback rule: page advances only after current audio `ended`
- Release rule: final feed rows must have both real image and pre-generated MP3

## Local PC collector baseline for t019

- Runner: `scripts/windows/run-t019-local-push.ps1`
- Scheduler setup: `scripts/windows/setup-t019-local-push-task.ps1`
- Task name: `OnlyTrade-T019-LocalPush-10m`
- Log file: `logs/t019_local_push.log`
- Daytime window: `08:00-23:00` local PC time
- Default TTS voice: `longlaotie_v3`
- Default direct TTS URL: `http://101.227.82.130:13002/tts`

Current scheduler command:

```powershell
powershell -File scripts/windows/setup-t019-local-push-task.ps1 -IntervalMinutes 10 -StartHour 8 -EndHour 23 -RunNow
```

## Development and deployment lessons from t019

### 1) Missing trader registration sends the page back to the lobby

If `?trader=t_019` is not present in the public trader list, the frontend cannot resolve the room and will fall back to the lobby/default state.

Before validating a new show, confirm:

```bash
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/traders"
```

The new room must appear there.

For a new room like `t_018`, prepare both:

- `agents/t_018/agent.json`
- `data/agents/registry.json`

And make sure the same registration exists on the VM copy under `/opt/onlytrade`.

### 2) A correct backend is not enough if the public bundle is stale

During `t_019` launch, the runtime API was already serving `/api/topic-stream/live`, but the public domain was still loading an older frontend bundle that did not contain `topic-commentary` or `t_019` route logic.

Public checks must include both:

- route HTML uses the expected latest JS/CSS bundle
- deployed JS actually contains the new route tokens

Example checks:

```bash
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/stream/topic-commentary?trader=t_019&program=china-bigtech"
curl -fsS "http://zhibo.quickdealservice.com:18000/assets/<index-bundle>.js"
```

If the bundle is stale, the browser can still land on the lobby even though the API is healthy.

### 3) The domain route is the release gate, not bare-IP browsing

For this stack, use `zhibo.quickdealservice.com:18000/onlytrade/...` as the final release check. A working IP-based route is helpful, but it does not replace domain validation.

### 4) The VM copy is not guaranteed to be a normal git checkout

During `t_019` launch, `/opt/onlytrade` did not behave like a standard git working tree for deployment. Do not assume `git pull` is available there.

Be ready to:

- copy updated source files directly when needed
- copy built frontend bundle files directly into `/opt/onlytrade/onlytrade-web/dist`
- verify the public `index.html` points to the expected asset filenames

### 5) Node 16 + Vite 6 can break frontend build on the VM

The VM build path hit a Node 16 compatibility issue (`crypto.getRandomValues is not a function`). The practical workaround during `t_019` launch was:

- build locally on the PC
- copy the exact `index.html`, JS, and CSS bundle files to the VM dist directory

For `t_018`, prefer local build + targeted dist copy unless the VM Node/Vite baseline is upgraded.

### 6) Voice changes must invalidate cached MP3 names

For `t_019`, the local generator now uses a voice-aware audio cache key. This is important because changing the TTS voice should produce new MP3 filenames instead of silently reusing old audio.

Reuse this rule for `t_018`: include voice identity in the generated audio cache key.

## Recommended t018 bring-up checklist

1. Add `agents/t_018/agent.json`
2. Register `t_018` in local and VM `data/agents/registry.json`
3. Add the football collector and Windows runner/scheduler
4. Keep the same day-window scheduler model used by `t_019`
5. Keep static-audio-only release feed policy
6. Verify public trader list includes `t_018`
7. Verify the public domain page loads the latest bundle
8. Verify `topic-stream/live`, image, and audio endpoints on the public bridge URL

## High-value verification commands

```bash
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/traders"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/topic-stream/live?room_id=t_019"
curl -fsS -I "http://zhibo.quickdealservice.com:18000/onlytrade/stream/topic-commentary?trader=t_019&program=china-bigtech"
curl -fsS -I "http://zhibo.quickdealservice.com:18000/onlytrade/api/topic-stream/images/t_019/<image>.jpg"
curl -fsS -I "http://zhibo.quickdealservice.com:18000/onlytrade/api/topic-stream/audio/t_019/<audio>.mp3"
```

Windows local scheduler checks:

```powershell
Get-ScheduledTask -TaskName "OnlyTrade-T019-LocalPush-10m"
Get-ScheduledTask -TaskName "OnlyTrade-T019-LocalPush-10m" | Get-ScheduledTaskInfo
Get-Content logs\t019_local_push.log -Tail 80
```
