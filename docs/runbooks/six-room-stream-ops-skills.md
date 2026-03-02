# Six-Room Stream Ops Skills

This runbook is the operator skill card for the 6 production stream rooms on Aliyun/zhibo.

Companion local skill file:

- `skills/six-room-stream-ops/SKILL.md`

## 1) Canonical public room links

- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/command-deck-new?trader=t_003`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/multi-broadcast?trader=t_012&show=qiangqiang_citrini_20260227`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/story-broadcast?trader=t_012&story=ai_tribunal_20260226`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/story-broadcast?trader=t_013&story=mandela_effect`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/story-broadcast?trader=t_014&story=libai`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/polymarket?trader=t_015`

## 2) Server access baseline

- Host: `113.125.202.169`
- SSH port: `21522`
- Default key on this workstation: `C:\Users\rdpuser\.ssh\cn169_ed25519`
- Runtime API: `http://127.0.0.1:18080`
- Public web: `http://zhibo.quickdealservice.com:18000`

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

### 5.4 `t_003` voice checks

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

### E) `t_015` logs show `missing key` but key is configured

Likely cause:

- Python 3.6 on VM + old `openai` package import path mismatch.

Current solution in repo:

- polymarket scripts support direct HTTP fallback via `requests` and do not require `openai>=1`.

Action:

1. Verify process env contains `OPENAI_API_KEY`/`DASHSCOPE_API_KEY`.
2. Trust direct Qwen auth probe (`6.1`) and fetcher success logs over generic init warnings.
