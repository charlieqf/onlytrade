# OnlyTrade 在阿里云 Linux VM 部署指南（含 Qwen LLM 切换）

本文用于把当前 Kamatera 上运行的 OnlyTrade，同步部署到阿里云 Linux VM，并将交易/聊天 LLM 切换为阿里 Qwen（OpenAI 兼容模式）。

适用对象：国内同事，按步骤执行即可。

---

## 0. 目标与架构

- 前端：`onlytrade-web` 构建后静态文件，由 Nginx 提供。
- 后端：`runtime-api/server.mjs`，监听 `127.0.0.1:18080`。
- 对外入口：`http://<aliyun-ip>:8000/onlytrade/...`
- Nginx 反代：
  - `/onlytrade/api/*` -> `http://127.0.0.1:18080/api/*`
  - 其余 `/onlytrade/*` -> 前端 SPA（`index.html`）
- LLM：通过 OpenAI 兼容协议接入 Qwen。

---

## 1. 机器与网络准备

建议配置：

- 2C4G 起步（推荐 4C8G，前端构建更稳）
- 系统：Ubuntu 22.04/24.04（其他发行版可参考同逻辑）
- 安全组放行：
  - `22`（SSH）
  - `8000`（网页访问）

可选端口（仅调试）：

- `18080`（后端 API，生产建议不对公网开放）

---

## 2. 安装基础依赖

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates build-essential nginx python3 python3-pip
```

安装 Node.js 20：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

国内网络建议（加速 npm）：

```bash
npm config set registry https://registry.npmmirror.com
```

---

## 3. 拉取代码

```bash
sudo mkdir -p /opt/onlytrade
sudo chown -R $USER:$USER /opt/onlytrade
cd /opt/onlytrade

git clone https://github.com/charlieqf/onlytrade.git .
git checkout main
git pull --ff-only origin main
```

---

## 4. 配置 runtime-api 环境（切到 Qwen）

后端会自动加载：

1. `runtime-api/.env.local`
2. `runtime-api/.env`

请创建 `runtime-api/.env.local`：

```bash
cat > /opt/onlytrade/runtime-api/.env.local <<'EOF'
# ===== LLM: Qwen (OpenAI-compatible) =====
OPENAI_API_KEY=<你的DashScope_API_KEY>
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# 决策模型（交易）
AGENT_OPENAI_MODEL=qwen-plus

# 聊天模型（房间互动）
CHAT_OPENAI_MODEL=qwen-turbo

# 通用默认模型（兜底）
OPENAI_MODEL=qwen-plus

# LLM开关与超时
AGENT_LLM_ENABLED=true
CHAT_LLM_ENABLED=true
AGENT_LLM_TIMEOUT_MS=30000
CHAT_LLM_TIMEOUT_MS=30000

# 控制输出成本（可按需调整）
AGENT_LLM_DEV_TOKEN_SAVER=true
AGENT_LLM_MAX_OUTPUT_TOKENS=600
CHAT_LLM_MAX_OUTPUT_TOKENS=220

# Runtime 建议
RUNTIME_DATA_MODE=live_file
STRICT_LIVE_MODE=false

# 安全：控制接口令牌（请改成强随机）
CONTROL_API_TOKEN=<强随机token>

# ===== TTS（建议） =====
# 如果你目前没有 OpenAI TTS，建议默认走 selfhosted，避免音频接口打到 Qwen 兼容端点失败。
CHAT_TTS_ENABLED=true
CHAT_TTS_PROVIDER_DEFAULT=selfhosted
CHAT_TTS_SELFHOSTED_URL=http://101.227.82.130:13002/tts
CHAT_TTS_SELFHOSTED_MEDIA_TYPE=wav
CHAT_TTS_SELFHOSTED_VOICE_DEFAULT=xuanyijiangjie
EOF
```

说明：

- 本项目把 LLM 调用统一走 `OPENAI_BASE_URL` + `OPENAI_API_KEY`，因此切 Qwen 只需替换这两项和模型名。
- 若你不需要 TTS，可临时 `CHAT_TTS_ENABLED=false`。

---

## 5. 安装依赖并构建

```bash
cd /opt/onlytrade

# 后端依赖
npm ci --prefix runtime-api

# 前端依赖 + 构建
npm ci --prefix onlytrade-web
npm run build --prefix onlytrade-web
```

---

## 6. 配置 systemd（后端常驻）

创建服务文件：

```bash
sudo tee /etc/systemd/system/onlytrade-runtime-api.service >/dev/null <<'EOF'
[Unit]
Description=OnlyTrade Runtime API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/onlytrade/runtime-api
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=18080

[Install]
WantedBy=multi-user.target
EOF
```

启动并设为开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now onlytrade-runtime-api
sudo systemctl status onlytrade-runtime-api --no-pager
```

---

## 7. 配置 Nginx（8000 对外）

创建站点配置：

```bash
sudo tee /etc/nginx/sites-available/onlytrade.conf >/dev/null <<'EOF'
server {
    listen 8000;
    server_name _;

    root /opt/onlytrade/onlytrade-web/dist;
    index index.html;

    # API桥接（含SSE）
    location ^~ /onlytrade/api/ {
        proxy_pass http://127.0.0.1:18080/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE/流式建议
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600;
    }

    # /onlytrade 前缀路由到 SPA
    location ^~ /onlytrade/ {
        rewrite ^/onlytrade/(.*)$ /$1 break;
        try_files $uri $uri/ /index.html;
    }

    # 兼容绝对资源路径 /assets /icons /story
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
```

启用并重启 Nginx：

```bash
sudo ln -sf /etc/nginx/sites-available/onlytrade.conf /etc/nginx/sites-enabled/onlytrade.conf
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl status nginx --no-pager
```

---

## 8. 首次联调验证

### 8.1 后端本地健康检查

```bash
curl -fsS http://127.0.0.1:18080/health
curl -fsS http://127.0.0.1:18080/api/agent/runtime/status | head
```

### 8.2 对外桥接检查

```bash
curl -i "http://127.0.0.1:8000/onlytrade/api/agent/runtime/status"
curl -i "http://127.0.0.1:8000/onlytrade/stream/command-deck-new?trader=t_003"
```

### 8.3 浏览器访问

- `http://<阿里云公网IP>:8000/onlytrade/stream/command-deck-new?trader=t_003`
- `http://<阿里云公网IP>:8000/onlytrade/stream/multi-broadcast?trader=t_012&show=qiangqiang_citrini_20260227`

---

## 9. Qwen 切换是否成功（核验）

查看后端日志：

```bash
sudo journalctl -u onlytrade-runtime-api -n 200 --no-pager
```

关注类似输出（模型名应为你配置的 qwen）：

- `llm=openai decision_model=qwen-plus chat_model=qwen-turbo ...`

说明：日志里 `llm=openai` 表示“OpenAI 兼容协议调用器”，不代表实际供应商一定是 OpenAI。

---

## 10. 日常发布流程（给同事）

每次更新代码后执行：

```bash
cd /opt/onlytrade
git fetch origin main
git checkout main
git pull --ff-only origin main

npm ci --prefix runtime-api
npm ci --prefix onlytrade-web
npm run build --prefix onlytrade-web

sudo systemctl restart onlytrade-runtime-api
sudo systemctl reload nginx

curl -fsS http://127.0.0.1:18080/health
curl -fsS http://127.0.0.1:8000/onlytrade/api/agent/runtime/status >/dev/null
```

也可以用仓库脚本（注意设置 health URL 为 18080）：

```bash
cd /opt/onlytrade
ONLYTRADE_API_HEALTH_URL=http://127.0.0.1:18080/health \
ONLYTRADE_API_RUNTIME_URL=http://127.0.0.1:18080/api/agent/runtime/status \
bash scripts/deploy-vm.sh --skip-tests
```

---

## 11. 盘前数据准备（CN）

建议每天开盘前执行：

```bash
cd /opt/onlytrade
bash scripts/onlytrade-ops.sh preopen-cn-refresh
bash scripts/onlytrade-ops.sh akshare-run-once
bash scripts/onlytrade-ops.sh red-blue-cn-run-once
bash scripts/onlytrade-ops.sh akshare-status
bash scripts/onlytrade-ops.sh overview-status
```

---

## 12. 常用运维命令

```bash
# 服务状态
sudo systemctl status onlytrade-runtime-api --no-pager
sudo systemctl status nginx --no-pager

# 查看实时日志
sudo journalctl -u onlytrade-runtime-api -f

# 运行态 API
curl -fsS http://127.0.0.1:18080/api/agent/runtime/status | jq .

# 暂停/恢复 agent（需 CONTROL_API_TOKEN）
curl -X POST http://127.0.0.1:18080/api/agent/runtime/control \
  -H 'Content-Type: application/json' \
  -H 'x-control-token: <你的CONTROL_API_TOKEN>' \
  -d '{"action":"pause"}'

curl -X POST http://127.0.0.1:18080/api/agent/runtime/control \
  -H 'Content-Type: application/json' \
  -H 'x-control-token: <你的CONTROL_API_TOKEN>' \
  -d '{"action":"resume"}'
```

---

## 13. 常见故障排查

### A. 页面打开是 500

通常是后端没起来：

```bash
ss -ltnp | grep 18080
sudo systemctl restart onlytrade-runtime-api
curl -fsS http://127.0.0.1:18080/health
```

### B. 页面 200 但空白

多半是前端 `dist` 损坏或构建失败：

```bash
cd /opt/onlytrade
npm run build --prefix onlytrade-web
sudo systemctl reload nginx
```

### C. 切 Qwen 后 LLM 无输出/超时

- 检查 `OPENAI_BASE_URL` 是否为：
  - `https://dashscope.aliyuncs.com/compatible-mode/v1`
- 检查 key 是否可用。
- 可先把模型降级到 `qwen-turbo` 验证连通，再切回 `qwen-plus`。

### D. 出现第二路串音（故事页）

已在新版本做跨页面音轨清理；若仍偶发：

- 浏览器强刷（`Ctrl+F5`）
- 关闭旧标签页后重开。

---

## 14. 给同事的最短执行清单（TL;DR）

1. 安装 Node20 + Nginx + Python3
2. 拉代码到 `/opt/onlytrade`
3. 配 `runtime-api/.env.local`（Qwen key/base/model）
4. `npm ci`（backend+frontend） + `npm run build --prefix onlytrade-web`
5. 启动 `onlytrade-runtime-api` systemd
6. 配 Nginx 监听 `8000` 并桥接 `/onlytrade/api`
7. `curl` 验证健康与页面
8. 每天开盘前执行盘前刷新命令

---

如需我补一份“阿里云 Linux 3（CentOS 系）”版本（`yum`/`dnf` 命令、服务路径差异），我可以在同目录再加一个兼容版。
