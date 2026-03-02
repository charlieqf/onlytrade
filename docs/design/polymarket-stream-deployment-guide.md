# Polymarket Stream Deployment Guide (`t_015`)

This guide covers production-style deployment of the Polymarket demo room to:

- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/polymarket?trader=t_015`

Server baseline:

- SSH target: `root@113.125.202.169:21522`
- SSH template: `ssh -p 21522 -i <YOUR_KEY_PATH> root@113.125.202.169`
- Default key on this workstation: `C:\Users\rdpuser\.ssh\cn169_ed25519`

## 1) What this room is

The Polymarket room is a visual stream page rendered by:

- `onlytrade-web/src/pages/design/CyberPredictionPage.tsx`

Route entry:

- `/onlytrade/stream/polymarket?trader=t_015`

It is driven by a static JSON feed (`cyber_market_live.json`) plus static media (`avatar.mp4`).

Production flow:

- `virtual_market_fetcher_prod.py` (real hot-topic ingestion + market generation)
- `polymarket_engine_agents.py` (LLM-driven agent/user betting loop)
- `polymarket_stream_bridge.py` (exports DB state to `cyber_market_live.json`)

## 2) Required assets and code

Frontend code:

- `onlytrade-web/src/pages/design/CyberPredictionPage.tsx`
- `onlytrade-web/src/App.tsx` (route wiring)

Static files:

- `onlytrade-web/public/cyber_market_live.json`
- `onlytrade-web/public/avatar.mp4`

Mock feed generator:

- `mock_cyber_market.py`

Real-data pipeline scripts:

- `virtual_market_fetcher_prod.py`
- `polymarket_engine_agents.py`
- `polymarket_stream_bridge.py`
- `virtual_exchange_db.py`
- `virtual_market.db`

Agent manifest (for proper `trader=t_015` resolution in lobby/router):

- `agents/t_015/agent.json`

## 3) Important implementation notes
 
 1. Do not use global API short-circuit mocks in shared HTTP client code.
    - They can break all `/api/*` calls across the app.
 2. The mock generator writes live JSON to:
    - `onlytrade-web/public/cyber_market_live.json`
    - `onlytrade-web/dist/cyber_market_live.json` (when `dist/` exists)
 3. In production, Nginx serves `onlytrade-web/dist`, so `dist/cyber_market_live.json` must stay fresh.

## 4) Data Ingestion & LLM Engine Logic

### 4.1 Real-time Ingestion (`virtual_market_fetcher_prod.py`)
- **Sources**: Weibo Hot Search (`realtime`) and Zhihu Hot List (`total`).
- **Auth**: No login/password required. Uses public REST endpoints with spoofed browser headers and placeholder cookies.
- **Cycle**: Recommended 15 minutes (via crontab).
- **LLM Transformation**: Qwen3-Max triggers once per cycle to parse the top trending topic into a standard JSON market object (title, binary outcome, initial probability).

### 4.2 Generative Chat & Trading (`polymarket_engine_agents.py`)
- **Optimization Strategy**: Batched LLM calls. The system does not call the LLM for every single message (too slow/costly).
- **Workflow**:
  1. Calls Qwen-Max to generate a "batch" of 30 context-aware chat messages (slang, reaction, sentiment) for the current market topic.
  2. Pops messages from this local memory queue every 1-3 seconds.
  3. Formats "AI Agent Zero" decisions with technical reasoning provided by the LLM.
- **Robustness**: Uses `extract_json_from_llm_response` to forcefully extract JSON arrays from conversational LLM output.

## 5) TTS Recommendations (Aliyun CosyVoice)

For the **Cyber Polymarket** room (`t_015`), we recommend using the following "Sweet & Intellectual" female voices:

| Voice Name | Character ID | Character Traits | Best Use Case |
| :--- | :--- | :--- | :--- |
| **龙成** | `longcheng_v3` | 年轻、甜美、充满活力 (20-25岁) | 制造狂热的交易氛围，吸引流量 |
| **龙安俐** | `longanli_v3` | 知性、典雅、专业形象 (25-35岁) | 像财经新闻主播一样进行盘口深度解读 |
| **loongstella** | `loongstella` | 现代、带货、高穿透力 | 强引导性语态，适合在重大行情突破时呼吁交易 |

## 6) Environment requirements

Do not hardcode keys in source code. Provide env vars at runtime:

- `DASHSCOPE_API_KEY` (or `OPENAI_API_KEY`)
- optional: `DASHSCOPE_BASE_URL` (default: DashScope compatible endpoint)
- optional: `POLYMARKET_LLM_MODEL` (default: `qwen3-max`)

Compatibility note:

- On older VM Python environments (for example Python 3.6 with old `openai` package), scripts use OpenAI-compatible HTTP requests fallback and do not require `openai>=1`.
- If pip mirror cannot install modern OpenAI SDK, keep using the built-in fallback path.

## 5) Local verification checklist

From repo root:

```bash
npm run build --prefix onlytrade-web
python mock_cyber_market.py
```

Then verify:

```bash
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://localhost:3000/onlytrade/stream/polymarket?trader=t_015"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://localhost:3000/cyber_market_live.json"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://localhost:3000/avatar.mp4"
```

## 6) Deploy to Aliyun/zhibo (`113.125.202.169:21522`)

### 6.1 Sync code/assets

Sync at least these paths to `/opt/onlytrade`:

- `onlytrade-web/src/pages/design/CyberPredictionPage.tsx`
- `onlytrade-web/src/App.tsx`
- `onlytrade-web/public/cyber_market_live.json`
- `onlytrade-web/public/avatar.mp4`
- `mock_cyber_market.py`
- `polymarket_stream_bridge.py`
- `polymarket_engine_agents.py`
- `virtual_market_fetcher_prod.py`
- `virtual_exchange_db.py`
- `virtual_market.db`
- `agents/t_015/agent.json`

### 6.2 Build frontend

Preferred (on VM):

```bash
cd /opt/onlytrade
npm run build --prefix onlytrade-web
```

If VM cannot build due Node/glibc limits, build on compatible host and upload built artifacts to:

- `/opt/onlytrade/onlytrade-web/dist/index.html`
- `/opt/onlytrade/onlytrade-web/dist/assets/*`
- `/opt/onlytrade/onlytrade-web/dist/cyber_market_live.json`
- `/opt/onlytrade/onlytrade-web/dist/avatar.mp4`

### 6.3 Register agent `t_015`

```bash
cd /opt/onlytrade
ONLYTRADE_API_BASE=http://127.0.0.1:18080 bash scripts/onlytrade-ops.sh agent-register t_015
```

Optional runtime start:

```bash
ONLYTRADE_API_BASE=http://127.0.0.1:18080 bash scripts/onlytrade-ops.sh agent-start t_015
```

### 6.4 Start real-data pipeline services

Bridge + engine should run continuously:

```bash
cd /opt/onlytrade
python3 polymarket_stream_bridge.py
python3 polymarket_engine_agents.py
```

Recommended systemd units:

- `onlytrade-polymarket-bridge.service`
- `onlytrade-polymarket-engine.service`

Optional periodic ingest:

- `onlytrade-polymarket-fetcher.service` + timer/cron every 15 minutes

If old mock service exists, stop and disable it:

```bash
systemctl disable --now onlytrade-polymarket-mock || true
```

### 6.5 Validate on public domain

```bash
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/cyber_market_live.json"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/avatar.mp4"
curl -fsS "http://zhibo.quickdealservice.com:18000/onlytrade/api/traders"
curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" "http://zhibo.quickdealservice.com:18000/onlytrade/stream/polymarket?trader=t_015"
```

Direct Qwen auth sanity check (from VM):

```bash
python3 - <<'PY'
import json, os, urllib.request
key = os.environ.get('DASHSCOPE_API_KEY') or os.environ.get('OPENAI_API_KEY')
url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
payload = {'model':'qwen3-max','messages':[{'role':'user','content':'Reply only with OK'}],'max_tokens':12,'temperature':0}
req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'Authorization':'Bearer '+str(key or ''),'Content-Type':'application/json'})
with urllib.request.urlopen(req, timeout=30) as r:
    print(r.status)
PY
```

Target room URL:

- `http://zhibo.quickdealservice.com:18000/onlytrade/stream/polymarket?trader=t_015`

## 7) Troubleshooting

### Symptom: page opens but shows init/error state

Check:

- `http://zhibo.quickdealservice.com:18000/cyber_market_live.json`

If response is HTML instead of JSON, `dist/cyber_market_live.json` is missing or stale.

### Symptom: `trader=t_015` not respected

Check:

- `agents/t_015/agent.json` exists on VM
- `agent-register t_015` completed
- `/onlytrade/api/traders` contains `t_015`

### Symptom: feed stops updating

Check:

- `polymarket_stream_bridge.py` process is running
- `polymarket_engine_agents.py` process is running
- file mtime of `onlytrade-web/dist/cyber_market_live.json` updates continuously

### Symptom: LLM not generating messages/decisions

Check:

- `DASHSCOPE_API_KEY` (or `OPENAI_API_KEY`) is present in service environment
- `POLYMARKET_LLM_MODEL=qwen3-max`
- bridge/engine service logs do not show auth or network errors

If logs show `401 Unauthorized`:

- key is not accepted by DashScope (wrong key/project/permission), even if env variable is present.

### Symptom: TTS (Audio) not working

Check:

- `CHAT_TTS_ENABLED=true` in `runtime-api/.env.local`
- `CHAT_TTS_PROFILE_PATH` points to correct JSON mapping for `t_015`.

Cross-room ops reference:

- `docs/runbooks/six-room-stream-ops-skills.md`
