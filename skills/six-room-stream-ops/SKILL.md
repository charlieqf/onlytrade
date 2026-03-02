---
name: six-room-stream-ops
description: Use when operating, troubleshooting, or verifying the 6 zhibo stream rooms on Aliyun (t_003, t_012 multi/story, t_013, t_014, t_015).
---

# Six-Room Stream Ops

Operator skill for these public rooms:

- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/command-deck-new?trader=t_003`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/multi-broadcast?trader=t_012&show=qiangqiang_citrini_20260227`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/story-broadcast?trader=t_012&story=ai_tribunal_20260226`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/story-broadcast?trader=t_013&story=mandela_effect`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/story-broadcast?trader=t_014&story=libai`
- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/polymarket?trader=t_015`

## Aliyun baseline

- SSH: `ssh -p 21522 -i <YOUR_KEY_PATH> root@113.125.202.169`
- Runtime API: `http://127.0.0.1:18080`
- Web root: `http://zhibo.quickdealservice.com:18000`

## Quick health checks

```bash
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/traders"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_003/stream-packet?decision_limit=3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_012/stream-packet?decision_limit=3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_013/stream-packet?decision_limit=3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_014/stream-packet?decision_limit=3"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/rooms/t_015/stream-packet?decision_limit=3"
```

## Critical room-specific checks

- `t_003` voice baseline:

```bash
bash scripts/onlytrade-ssh-ops.sh tts-set t_003 --provider selfhosted --voice zsy --fallback openai
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
