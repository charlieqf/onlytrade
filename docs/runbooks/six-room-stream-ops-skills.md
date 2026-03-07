# Stream Ops Skills (Polymarket + Night-Comfort + Oral-English)

This runbook is the operator skill card for production stream rooms on zhibo, with focus on:

- `t_015` polymarket
- `t_016` night-comfort
- `t_017` oral-english

Companion local skill file:

- `skills/six-room-stream-ops/SKILL.md`

## 1) Canonical public room links

- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/command-deck-new?trader=t_003`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/multi-broadcast?trader=t_012&show=qiangqiang_citrini_20260227`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/story-broadcast?trader=t_012&story=ai_tribunal_20260226`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/story-broadcast?trader=t_013&story=mandela_effect`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/story-broadcast?trader=t_014&story=libai`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/polymarket?trader=t_015`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/night-comfort?trader=t_016&theme=hobit`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/oral-english?trader=t_017`

## 2) Server access baseline

- Target VM host: `113.125.202.169`
- SSH port: `21522`
- SSH user: `root`
- Default key on this workstation: `C:\Users\rdpuser\.ssh\cn169_ed25519`
- Repo deployment root on VM: `/opt/onlytrade`
- Runtime API listen: `http://127.0.0.1:18080`
- Public web entry: `http://zhibo.quickdealservice.com:18000`
- Frontend deployment directory: `/opt/onlytrade/onlytrade-web/dist`
- Runtime API code path: `/opt/onlytrade/runtime-api/server.mjs`
- Active Nginx root config: `/usr/local/nginx/conf/nginx.conf`
- Included app config: `/usr/local/nginx/conf/onlytrade.conf`

Nginx route baseline (`onlytrade.conf`):

- `root /opt/onlytrade/onlytrade-web/dist;`
- `/onlytrade/api/*` -> proxy to `http://127.0.0.1:18080/api/*`
- `/api/*` -> proxy to `http://127.0.0.1:18080/api/*`
- `/onlytrade/*` SPA route via `try_files`

SSH template:

```bash
ssh -p 21522 -i <YOUR_KEY_PATH> root@113.125.202.169
```

Hot-switch helper for `t_003` voice:

```bash
bash scripts/t003-voice-hot-switch.sh status --vm-key <YOUR_KEY_PATH> --vm-port 21522
bash scripts/t003-voice-hot-switch.sh zsy --vm-key <YOUR_KEY_PATH> --vm-port 21522
bash scripts/t003-voice-hot-switch.sh cosy --vm-key <YOUR_KEY_PATH> --vm-port 21522
bash scripts/t003-voice-hot-switch.sh cosy --vm-key <YOUR_KEY_PATH> --vm-port 21522 --cosy-voice longfeifei_v3
```

Cosy voices now route through the selfhosted TTS gateway (`scripts/tts-gateway/gateway.py`).
Runtime should point `CHAT_TTS_SELFHOSTED_URL` to the gateway endpoint (recommended: `http://127.0.0.1:13003/tts`).

Allowed cosy female voices for `cosy` action:

- `longanhuan`
- `longanwen_v3`
- `longyan_v3`
- `longwan_v3`
- `longfeifei_v3`

If you use this repo's wrapper scripts:

```bash
bash scripts/onlytrade-ssh-ops.sh status
```

## 3) Room matrix and critical dependencies

| Room | Type | Core dependency | Common failure |
| --- | --- | --- | --- |
| `t_003` | command deck realtime | room packet + SSE + TTS | wrong voice, stale runtime, empty memory |
| `t_012` (`show=qiangqiang_citrini_20260227`) | multi-broadcast | story assets + frontend bundle | missing story asset file / stale bundle |
| `t_012` (`story=ai_tribunal_20260226`) | story-broadcast | story assets + frontend bundle | narration/script/scene missing |
| `t_013` (`story=mandela_effect`) | story-broadcast | story assets + `agents/t_013` registered | room API 404 when not registered |
| `t_014` (`story=libai`) | story-broadcast | story assets + `agents/t_014` registered | `narration_load_failed` or wrong fallback story |
| `t_015` (`polymarket`) | polymarket stream | `cyber_market_live.json` + `avatar.mp4` + `agents/t_015` + polymarket bridge/engine services | HTML fallback instead of JSON/video, or feed not updating |
| `t_016` (`night-comfort`) | calm loop + narration | `dist/theme-loop/t_016/*` + `agents/t_016/assets/late_night_comfort.json` + room TTS profile | black background, missing BGM, autoplay blocked |
| `t_017` (`oral-english`) | image-first classroom | local Windows collector push -> `data/live/onlytrade/english_classroom_live.json` + `data/live/onlytrade/english_images/t_017/` | repeated fallback image, empty feed, silent autoplay |

## 4) Policy baseline

- Story and multi-broadcast pages keep BGM disabled by policy.
- Room BGM is restricted to `t_003` only.
- `t_003` TTS baseline is `selfhosted + zsy`.
- `t_003` Cosy switch also uses `provider=selfhosted` (gateway routes by `voice_id`).
- Story/multi URLs should pass explicit `story=<slug>` or `show=<slug>`.

## 5) Fast health checks (copy/paste)

### 5.1 Public page and room API checks

```bash
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/traders"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_003/stream-packet?decision_limit=3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_012/stream-packet?decision_limit=3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_013/stream-packet?decision_limit=3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_014/stream-packet?decision_limit=3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_015/stream-packet?decision_limit=3"
```

### 5.2 Story asset checks (`t_013`/`t_014`/`t_012-story`)

```bash
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/story/libai/manifest.json"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/story/libai/script.txt"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/onlytrade/story/libai/narration.mp3"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/onlytrade/story/libai/scene_0.png"
```

### 5.3 `t_015` polymarket asset/feed checks

```bash
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/cyber_market_live.json"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/avatar.mp4"
```

### 5.4 `t_016` night-comfort checks

```bash
curl -fsS -I "http://zhibo.quickdealservice.com:18000/onlytrade/stream/night-comfort?trader=t_016&theme=hobit"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/theme-loop/t_016/hobit.mp4"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/theme-loop/t_016/hobit.mp3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/chat/tts/profile?room_id=t_016"
```

Expected TTS baseline for `t_016`: `selfhosted + longyuan_v3`.

### 5.5 `t_017` oral-english checks

```bash
curl -fsS -I "http://zhibo.quickdealservice.com:18000/onlytrade/stream/oral-english?trader=t_017"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/english-classroom/live?room_id=t_017"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/onlytrade/api/english-classroom/images/<image>.jpg"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/onlytrade/api/english-classroom/audio/<audio>.mp3"
```

`t_017` collection model:

- Local Windows PC collects Google News + images + materials.
- Local PC pre-generates MP3 for the first 5 topics, then pushes JSON + images + MP3 to VM.
- Current collector keeps only topics with real downloaded images; it does not keep fallback-image rows in the final feed.
- VM does not run independent `t_017` collector cron.

`t_017` stable data locations:

- Local JSON: `data/live/onlytrade/english_classroom_live.json`
- Local images: `data/live/onlytrade/english_images/t_017/`
- Local audio: `data/live/onlytrade/english_audio/t_017/`
- VM JSON: `/opt/onlytrade/data/live/onlytrade/english_classroom_live.json`
- VM images: `/opt/onlytrade/data/live/onlytrade/english_images/t_017/`
- VM audio: `/opt/onlytrade/data/live/onlytrade/english_audio/t_017/`

Windows automation baseline for `t_017`:

- One-shot runner:
  - `powershell -File scripts/windows/run-t017-local-push.ps1`
- Task installer:
  - `powershell -File scripts/windows/setup-t017-local-push-task.ps1 -IntervalMinutes 5 -RunNow`
- Current task name:
  - `OnlyTrade-T017-LocalPush-5m`
- Local log:
  - `logs/t017_local_push.log`
- The task uses Git Bash from:
  - `C:\Program Files\Git\bin\bash.exe`
- Current task is `Interactive only`; if the Windows user logs out, the loop stops.

### 5.6 `t_003` voice checks

```bash
bash scripts/onlytrade-ssh-ops.sh tts-status t_003
bash scripts/onlytrade-ssh-ops.sh tts-set t_003 --provider selfhosted --voice zsy --fallback none
bash scripts/onlytrade-ssh-ops.sh tts-test t_003 --text "语音连通测试 zsy"
```

## 6) Aliyun service operations for room `t_015`

Expected services:

- `onlytrade-polymarket-bridge.service`
- `onlytrade-polymarket-engine.service`
- optional timer: `onlytrade-polymarket-fetcher.timer`

Quick checks:

```bash
ssh -p 21522 -i <YOUR_KEY_PATH> root@113.125.202.169 "systemctl is-active onlytrade-polymarket-bridge onlytrade-polymarket-engine"
ssh -p 21522 -i <YOUR_KEY_PATH> root@113.125.202.169 "stat -c '%n %Y %s' /opt/onlytrade/onlytrade-web/dist/cyber_market_live.json"
```

### 6.1 Qwen auth probe (recommended)

Use this to confirm key + base URL before debugging app behavior:

```bash
ssh -p 21522 -i <YOUR_KEY_PATH> root@113.125.202.169 "python3 - <<'PY'
import json, urllib.request
key='YOUR_KEY'
base='https://dashscope.aliyuncs.com/compatible-mode/v1'
url=base+'/chat/completions'
payload={'model':'qwen3-max','messages':[{'role':'user','content':'Reply only with OK'}],'max_tokens':12,'temperature':0}
req=urllib.request.Request(url,data=json.dumps(payload).encode('utf-8'),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
with urllib.request.urlopen(req,timeout=30) as r:
    print('status', r.status)
    print(r.read(120).decode('utf-8','ignore'))
PY"
```

If this returns `401 Unauthorized`, the key is wrong for DashScope even if it looks valid.

### 6.2 Runtime env naming note

`runtime-api` uses `OPENAI_*` variable names for OpenAI-compatible protocol settings, but Qwen works through the same fields when `OPENAI_BASE_URL` points to DashScope.

## 7) Failure signatures and exact fix

### A) Story page shows fallback title or `narration_load_failed`

Fix:

1. Sync missing files to both paths:
   - `/opt/onlytrade/onlytrade-web/public/story/<slug>/`
   - `/opt/onlytrade/onlytrade-web/dist/story/<slug>/`
2. Verify non-HTML media content-types.

### B) `t_013`/`t_014` room API returns 404

Fix:

```bash
bash scripts/onlytrade-ssh-ops.sh agent-register t_013
bash scripts/onlytrade-ssh-ops.sh agent-register t_014
```

### C) `t_003` voice is wrong

Fix:

```bash
bash scripts/onlytrade-ssh-ops.sh tts-set t_003 --provider selfhosted --voice zsy --fallback none
```

### D) `t_015` shows static/old feed or errors

Fix checklist:

1. Ensure `cyber_market_live.json` and `avatar.mp4` exist in both:
   - `/opt/onlytrade/onlytrade-web/public/`
   - `/opt/onlytrade/onlytrade-web/dist/`
2. Ensure `t_015` is registered:

```bash
bash scripts/onlytrade-ssh-ops.sh agent-register t_015
```

3. Ensure polymarket services are running and logs are healthy:

```bash
ssh -p 21522 -i <YOUR_KEY_PATH> root@113.125.202.169 "systemctl status onlytrade-polymarket-bridge --no-pager"
ssh -p 21522 -i <YOUR_KEY_PATH> root@113.125.202.169 "systemctl status onlytrade-polymarket-engine --no-pager"
```

4. Hard refresh browser (cache bust).

### F) `t_016` has avatar+TTS but black background or no BGM

Fix checklist:

1. Ensure media files exist in VM dist:
   - `/opt/onlytrade/onlytrade-web/dist/theme-loop/t_016/hobit.mp4`
   - `/opt/onlytrade/onlytrade-web/dist/theme-loop/t_016/hobit.mp3`
2. Verify page loads the expected bundle from `index.html` under `dist`.
3. Browser autoplay policy may require first interaction; tap once to unlock audio.

### G) `t_017` shows repeated fallback image or stale topics

Fix checklist:

1. Run local collector and push once:

```bash
bash scripts/english/local_collect_and_push_t017.sh
```

2. Confirm local loop is running every 5 minutes (recommended).
3. Confirm VM feed file updated:
   - `/opt/onlytrade/data/live/onlytrade/english_classroom_live.json`
4. Confirm image files present under:
   - `/opt/onlytrade/data/live/onlytrade/english_images/t_017/`
5. Confirm MP3 files present under:
   - `/opt/onlytrade/data/live/onlytrade/english_audio/t_017/`
6. Confirm live API no longer exposes fallback rows:
   - `headline_count` can be less than 20
   - `image_file` should not start with `fallback_`
7. Confirm frontend bundle and MIME are correct after deploy:
   - `curl -I http://zhibo.quickdealservice.com:18000/assets/<bundle>.js`
   - expect `Content-Type: application/javascript`
8. If module script loads as `text/html`, check static dir permissions:
   - `/opt/onlytrade/onlytrade-web/dist/assets`
   - `/opt/onlytrade/onlytrade-web/dist/icons`
   - then `chmod -R a+rX` and reload nginx.

### E) `t_015` logs show `missing key` but key is configured

Likely cause:

- Python 3.6 on VM + old `openai` package import path mismatch.

Current solution in repo:

- polymarket scripts support direct HTTP fallback via `requests` and do not require `openai>=1`.

Action:

1. Verify process env contains `OPENAI_API_KEY`/`DASHSCOPE_API_KEY`.
2. Trust direct Qwen auth probe (`6.1`) and fetcher success logs over generic init warnings.
