---
name: six-room-stream-ops
description: Use when operating, troubleshooting, or verifying zhibo stream rooms on Aliyun, especially polymarket (t_015), night-comfort (t_016), oral-english (t_017), topic-commentary rooms such as t_019 china-bigtech / t_018 five-league, and the t_022 content-factory room.
---

# Stream Room Ops

Operator skill for these public rooms:

- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/command-deck-new?trader=t_003`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/multi-broadcast?trader=t_012&show=qiangqiang_citrini_20260227`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/story-broadcast?trader=t_012&story=ai_tribunal_20260226`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/story-broadcast?trader=t_013&story=mandela_effect`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/story-broadcast?trader=t_014&story=libai`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/polymarket?trader=t_015`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/night-comfort?trader=t_016&theme=hobit`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/oral-english?trader=t_017`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/topic-commentary?trader=t_019&program=china-bigtech`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/topic-commentary?trader=t_018&program=five-league`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/content-factory?trader=t_022&program=china-bigtech`

## Aliyun baseline

- SSH: `ssh -p 21522 -i <YOUR_KEY_PATH> root@113.125.202.169`
- Default key (this workstation): `C:\Users\rdpuser\.ssh\cn169_ed25519`
- Runtime API: `http://127.0.0.1:18080`
- Web root: `http://zhibo.quickdealservice.com:18000`

## Deployment baseline (must-match)

- Target VM: `113.125.202.169:21522` (user `root`)
- SSH key: `C:\Users\rdpuser\.ssh\cn169_ed25519`
- VM repo root: `/opt/onlytrade`
- Frontend dist path: `/opt/onlytrade/onlytrade-web/dist`
- Runtime API file: `/opt/onlytrade/runtime-api/server.mjs`
- Active Nginx root config: `/usr/local/nginx/conf/nginx.conf`
- Included app config: `/usr/local/nginx/conf/onlytrade.conf`

Nginx baseline in `onlytrade.conf`:

- `root /opt/onlytrade/onlytrade-web/dist;`
- `/onlytrade/api/*` -> `http://127.0.0.1:18080/api/*`
- `/api/*` -> `http://127.0.0.1:18080/api/*`
- `/onlytrade/*` SPA via `try_files`

`t_003` hot-switch helper (recommended):

```bash
bash scripts/t003-voice-hot-switch.sh status --vm-key <YOUR_KEY_PATH> --vm-port 21522
bash scripts/t003-voice-hot-switch.sh zsy --vm-key <YOUR_KEY_PATH> --vm-port 21522
bash scripts/t003-voice-hot-switch.sh cosy --vm-key <YOUR_KEY_PATH> --vm-port 21522
bash scripts/t003-voice-hot-switch.sh cosy --vm-key <YOUR_KEY_PATH> --vm-port 21522 --cosy-voice longfeifei_v3
```

Cosy voices are routed through the selfhosted TTS gateway (`scripts/tts-gateway/gateway.py`).
Set `CHAT_TTS_SELFHOSTED_URL=http://127.0.0.1:13003/tts` on VM after deploying the gateway.

Allowed cosy female voices:

- `longanhuan`
- `longanwen_v3`
- `longyan_v3`
- `longwan_v3`
- `longfeifei_v3`

## Quick health checks

```bash
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/traders"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_003/stream-packet?decision_limit=3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_012/stream-packet?decision_limit=3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_013/stream-packet?decision_limit=3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_014/stream-packet?decision_limit=3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_015/stream-packet?decision_limit=3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/chat/tts/profile?room_id=t_016"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/english-classroom/live?room_id=t_017"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/topic-stream/live?room_id=t_019"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/content-factory/live?room_id=t_022"
```

## Critical room-specific checks

- `t_003` voice baseline:

```bash
bash scripts/onlytrade-ssh-ops.sh tts-set t_003 --provider selfhosted --voice zsy --fallback none
```

- `t_013`/`t_014` missing room fix:

```bash
bash scripts/onlytrade-ssh-ops.sh agent-register t_013
bash scripts/onlytrade-ssh-ops.sh agent-register t_014
```

- `t_015` polymarket assets:

```bash
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/cyber_market_live.json"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/avatar.mp4"
```

- `t_015` service status (Aliyun):

```bash
ssh -p 21522 -i <YOUR_KEY_PATH> root@113.125.202.169 "systemctl status onlytrade-polymarket-bridge --no-pager"
ssh -p 21522 -i <YOUR_KEY_PATH> root@113.125.202.169 "systemctl status onlytrade-polymarket-engine --no-pager"
```

- `t_016` night-comfort checks:

```bash
curl -fsS -I "http://zhibo.quickdealservice.com:18000/onlytrade/stream/night-comfort?trader=t_016&theme=hobit"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/theme-loop/t_016/hobit.mp4"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/theme-loop/t_016/hobit.mp3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/chat/tts/profile?room_id=t_016"
```

Expected baseline: `provider=selfhosted`, `voice=longyuan_v3`.

- `t_017` oral-english local collector + VM playback checks:

```bash
# run on local Windows PC (collector + generator + push)
bash scripts/english/local_collect_and_push_t017.sh

# verify public room + feed on VM
curl -fsS -I "http://zhibo.quickdealservice.com:18000/onlytrade/stream/oral-english?trader=t_017"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/english-classroom/live?room_id=t_017"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/onlytrade/api/english-classroom/audio/<audio>.mp3"
```

Current `t_017` baseline:

- Local PC pre-generates MP3 for the first 5 topics and pushes them to VM.
- Final feed only keeps rows with real downloaded images; fallback-image rows are dropped.
- Frontend prefers `audio_api_url` MP3 and only falls back to live TTS if static audio fails.

- `t_019` topic-commentary local collector + VM playback checks:

```bash
# run on local Windows PC (collector + generator + push)
bash scripts/topic_stream/local_collect_and_push_t019.sh

# verify public room + feed on VM/domain
curl -fsS -I "http://zhibo.quickdealservice.com:18000/onlytrade/stream/topic-commentary?trader=t_019&program=china-bigtech"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/topic-stream/live?room_id=t_019"
ssh -p 21522 -i ~/.ssh/cn169_ed25519 root@113.125.202.169 'python3 /opt/onlytrade/scripts/topic_stream/retained_feed_merge.py --help'
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/onlytrade/api/topic-stream/images/t_019/<image>.jpg"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/onlytrade/api/topic-stream/audio/t_019/<audio>.mp3"
```

Current `t_019` baseline:

- Local PC scheduler task: `OnlyTrade-T019-LocalPush-10m`
- Daytime window: `08:00-23:00`
- Log file: `logs/t019_local_push.log`
- Default topic-stream direct voice: `longlaotie_v3`
- Local PC still generates one batch JSON per run, but the VM does not mirror that batch directly anymore.
- VM canonical file `data/live/onlytrade/topic_stream/china_bigtech_live.json` is now a retained rolling snapshot.
- VM merge helper path: `/opt/onlytrade/scripts/topic_stream/retained_feed_merge.py`
- Retained merge contract: dedupe by `topic.id`, keep the newest `20` valid rows.
- Release feed keeps only rows with both image and pre-generated MP3, and retained rows are filtered against real VM asset existence.
- VM helper must stay Python `3.6` compatible.
- Public page resolution depends on `t_019` being present in `/onlytrade/api/traders`.
- If the public page falls back to lobby, check trader registration first, then check whether the public JS bundle actually contains `topic-commentary` / `t_019` route code.
- If the feed returns `200` but audio/image assets return `404`, suspect stale retained rows or a failed asset sync before blaming the player.

- `t_022` content-factory local render + VM playback checks:

```bash
# run on local Windows PC (render + push + retained merge)
bash scripts/content_factory/local_render_and_push_t022.sh

# verify public room + retained manifest + retained video on VM/domain
curl -fsS -I "http://zhibo.quickdealservice.com:18000/onlytrade/stream/content-factory?trader=t_022&program=china-bigtech"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/content-factory/live?room_id=t_022"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/onlytrade/api/content-factory/videos/t_022/<segment>.mp4"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/onlytrade/api/content-factory/posters/t_022/<poster>.jpg"
ssh -p 21522 -i ~/.ssh/cn169_ed25519 root@113.125.202.169 'python3 /opt/onlytrade/scripts/content_factory/retained_video_manifest_merge.py --help'
```

Current `t_022` baseline:

- Local PC scheduler task: `OnlyTrade-T022-LocalPush-10m`
- Daytime window: `08:00-23:00`
- Log file: `logs/t022_local_push.log`
- Local shell entrypoint: `scripts/content_factory/local_render_and_push_t022.sh`
- VM canonical file `data/live/onlytrade/content_factory/china_bigtech_factory_live.json` is a retained rolling snapshot.
- VM merge helper path: `/opt/onlytrade/scripts/content_factory/retained_video_manifest_merge.py`
- Retained merge contract: dedupe by `topic_id`, keep the newest `20` valid rows.
- Public asset verification must include a `200 video/mp4` response for a retained segment, not just manifest `200`.
- `t_019` and `t_022` share the upstream `china_bigtech` package layer, so fixes to package summaries/scripts/visual selection should improve both rooms without per-room duplication.

For the next `t_018` launch, reuse the `t_019` topic-stream path:

- add `agents/t_018/agent.json`
- register `t_018` locally and on the VM in `data/agents/registry.json`
- keep the same domain-first validation path
- prefer local frontend build + targeted dist copy if VM build is still constrained by Node 16 / Vite 6

Windows local loop (current preferred method, every 5 min):

```powershell
powershell -File scripts/windows/setup-t017-local-push-task.ps1 -IntervalMinutes 5 -RunNow
```

Task details:

- Task name: `OnlyTrade-T017-LocalPush-5m`
- Runner: `scripts/windows/run-t017-local-push.ps1`
- Log file: `logs/t017_local_push.log`
- Git Bash path: `C:\Program Files\Git\bin\bash.exe`
- Current mode is `Interactive only`

Legacy shell loop (still valid if needed):

```bash
nohup bash -lc "while true; do bash scripts/english/local_collect_and_push_t017.sh >> logs/t017_local_push.log 2>&1; sleep 300; done" > logs/t017_local_push.supervisor.log 2>&1 &
```

- Qwen auth probe (before deep debugging):

```bash
python3 - <<'PY'
import json, urllib.request
key='YOUR_KEY'
url='https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
payload={'model':'qwen3-max','messages':[{'role':'user','content':'Reply only with OK'}],'max_tokens':12,'temperature':0}
req=urllib.request.Request(url,data=json.dumps(payload).encode('utf-8'),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
with urllib.request.urlopen(req,timeout=30) as r:
    print('status', r.status)
PY
```

If this returns 401, key auth is the blocker (not frontend/router).

## Policy reminders

- Story/multi BGM stays disabled.
- Room BGM only allowed for `t_003`.
- Story/multi links should include explicit `story`/`show` query.
- Runtime env names may still be `OPENAI_*` for protocol compatibility even when model vendor is Qwen.

## Source of truth docs

- `docs/runbooks/six-room-stream-ops-skills.md`
- `docs/runbooks/phone-stream-pages.md`
- `docs/design/polymarket-stream-deployment-guide.md`
- `docs/design/topic-stream-program-blueprints.md`
- `docs/runbooks/topic-stream-ops.md`
