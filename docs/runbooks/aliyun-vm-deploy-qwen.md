# OnlyTrade 在阿里云 Linux VM 部署指南（含 Qwen LLM 切换）

本文用于把当前 Kamatera 上运行的 OnlyTrade，同步部署到阿里云 Linux VM，并将交易/聊天 LLM 切换为阿里 Qwen（OpenAI 兼容模式）。

适用对象：国内同事，按步骤执行即可。

> [!IMPORTANT]
> **目标环境**：CentOS 7 (Core)，已有多个 Docker 服务在运行。
> 本指南已根据实际环境调整，使用 `yum` 包管理、`nvm` 安装 Node 20、
> 自定义 Nginx 路径 `/usr/local/nginx/conf/`。

---

## 0. 目标与架构

- 前端：`onlytrade-web` 构建后静态文件，由 Nginx 提供。
- 后端：`runtime-api/server.mjs`，监听 `127.0.0.1:18080`。
- 对外入口：`http://<阿里云公网IP>:18000/onlytrade/...`
- Nginx 反代：
  - `/onlytrade/api/*` -> `http://127.0.0.1:18080/api/*`
  - 其余 `/onlytrade/*` -> 前端 SPA（`index.html`）
- LLM：通过 OpenAI 兼容协议接入 Qwen。

> [!NOTE]
> 原计划使用端口 `8000`，但该端口已被现有 Python3 服务占用。
> 改用 `18000` 作为对外访问端口，`18080` 为后端 API 内部端口不变。
> 如需使用其他端口，请全文替换 `18000`。

---

## 1. 机器与网络准备

当前 VM 配置（已确认）：

- CentOS 7 (Core)，内核 3.10.0-1160 x86_64
- 16GB 内存
- 磁盘 275G，已用 ~235G（剩余 ~41G，足够部署）
- 已有 Docker 容器运行多个服务

安全组放行（如未开放）：

- `22`（SSH）
- `18000`（OnlyTrade 网页访问）

可选端口（仅调试）：

- `18080`（后端 API，生产建议不对公网开放）

---

## 2. 安装/升级基础依赖

### 2.1 系统包（CentOS 7 yum）

大部分已安装。确认并补充：

```bash
sudo yum install -y git curl ca-certificates make gcc gcc-c++ nginx python3 python3-pip
```

### 2.2 安装 Node.js 20（via nvm）

> [!WARNING]
> 系统自带 Node v16.20.2，不要直接升级以免影响其他服务。
> 使用 `nvm` 安装 Node 20，仅 OnlyTrade 使用。

```bash
# 安装 nvm（如已安装可跳过）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# 加载 nvm（或重新登录）
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# 安装 Node 20 并设为默认
nvm install 20
nvm alias default 20

# 验证
node -v   # 应输出 v20.x.x
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
# 确保使用 Node 20（nvm 环境）
source ~/.nvm/nvm.sh
nvm use 20

cd /opt/onlytrade

# 后端依赖
npm ci --prefix runtime-api

# 前端依赖 + 构建
npm ci --prefix onlytrade-web
npm run build --prefix onlytrade-web
```

---

## 6. 配置 systemd（后端常驻）

> [!IMPORTANT]
> 因为 Node 20 通过 nvm 安装，`ExecStart` 需要使用 nvm 管理的 Node 路径。
> 先查路径：`which node`（在 nvm use 20 后执行），通常为 `/root/.nvm/versions/node/v20.x.x/bin/node`。

创建服务文件（请将 `<NVM_NODE_PATH>` 替换为实际路径）：

```bash
# 获取当前 nvm node 路径
NVM_NODE=$(which node)
echo "Node path: $NVM_NODE"

sudo tee /etc/systemd/system/onlytrade-runtime-api.service >/dev/null <<EOF
[Unit]
Description=OnlyTrade Runtime API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/onlytrade/runtime-api
ExecStart=$NVM_NODE server.mjs
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

## 7. 配置 Nginx（18000 对外）

> [!IMPORTANT]
> 此 VM 的 Nginx 是编译安装的，配置在 `/usr/local/nginx/conf/`。
> **没有** `sites-available`/`sites-enabled` 目录，需使用 `include` 方式添加配置。

### 7.1 创建 OnlyTrade 站点配置

```bash
sudo tee /usr/local/nginx/conf/onlytrade.conf >/dev/null <<'EOF'
server {
    listen 18000;
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

    # API桥接（修复前端硬编码 /api/ 的问题）
    location ^~ /api/ {
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

### 7.2 在主配置中 include

检查 `/usr/local/nginx/conf/nginx.conf` 的 `http {}` 块末尾是否已有类似 `include` 行：

```bash
grep -n 'include.*onlytrade' /usr/local/nginx/conf/nginx.conf
```

如果没有，在 `http {}` 块末尾（`}` 之前）添加：

```bash
# 编辑主配置（注意备份）
sudo cp /usr/local/nginx/conf/nginx.conf /usr/local/nginx/conf/nginx.conf.$(date +%Y%m%d)

# 在 http {} 块的最后一个 } 之前插入 include 行
sudo sed -i '/^}/i \    include /usr/local/nginx/conf/onlytrade.conf;' /usr/local/nginx/conf/nginx.conf
```

> 如果 `sed` 位置不对，请手动编辑 `nginx.conf`，在 `http { ... }` 块末尾、最后一个 `}` 之前加上：
> ```
> include /usr/local/nginx/conf/onlytrade.conf;
> ```

### 7.3 测试并重载

```bash
sudo nginx -t
sudo nginx -s reload
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
curl -i "http://127.0.0.1:18000/onlytrade/api/agent/runtime/status"
curl -i "http://127.0.0.1:18000/onlytrade/stream/command-deck-new?trader=t_003"
```

### 8.3 浏览器访问

- `http://<阿里云公网IP>:18000/onlytrade/stream/command-deck-new?trader=t_003`
- `http://<阿里云公网IP>:18000/onlytrade/stream/multi-broadcast?trader=t_012&show=qiangqiang_citrini_20260227`

---

## 9. Qwen 切换是否成功（核验）

查看后端日志：

```bash
sudo journalctl -u onlytrade-runtime-api -n 200 --no-pager
```

关注类似输出（模型名应为你配置的 qwen）：

- `llm=openai decision_model=qwen-plus chat_model=qwen-turbo ...`

说明：日志里 `llm=openai` 表示"OpenAI 兼容协议调用器"，不代表实际供应商一定是 OpenAI。

---

## 10. 日常发布流程（给同事）

每次更新代码后执行：

```bash
# 确保 nvm 环境
source ~/.nvm/nvm.sh
nvm use 20

cd /opt/onlytrade
git fetch origin main
git checkout main
git pull --ff-only origin main

npm ci --prefix runtime-api
npm ci --prefix onlytrade-web
npm run build --prefix onlytrade-web

sudo systemctl restart onlytrade-runtime-api
sudo nginx -s reload

curl -fsS http://127.0.0.1:18080/health
curl -fsS http://127.0.0.1:18000/onlytrade/api/agent/runtime/status >/dev/null
```

> [!TIP]
> 如果你需要启动特定的直播数字人 Agent（如 `t_003`, `t_012`, `t_013`, `t_014`），可以使用 Ops CLI 启动它们：
> ```bash
> cd /opt/onlytrade
> source scripts/onlytrade-ops.sh
> export ONLYTRADE_OPS_RUNTIME_API_URL=http://127.0.0.1:18080
> export ONLYTRADE_OPS_IDENTITY_TOKEN=$(grep CONTROL_API_TOKEN /opt/onlytrade/runtime-api/.env.local | cut -d '=' -f2)
> agent-start t_003
> agent-start t_012
> agent-start t_013
> agent-start t_014
> ```

也可以用仓库脚本（注意设置 health URL 为 18080）：

```bash
cd /opt/onlytrade
source ~/.nvm/nvm.sh && nvm use 20
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

# Nginx 状态（编译安装版无 systemd，直接检测进程）
ps aux | grep nginx

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
source ~/.nvm/nvm.sh && nvm use 20
npm run build --prefix onlytrade-web
sudo nginx -s reload
```

### C. 切 Qwen 后 LLM 无输出/超时

- 检查 `OPENAI_BASE_URL` 是否为：
  - `https://dashscope.aliyuncs.com/compatible-mode/v1`
- 检查 key 是否可用。
- 可先把模型降级到 `qwen-turbo` 验证连通，再切回 `qwen-plus`。

### D. systemd 找不到 node

如果 `systemctl start onlytrade-runtime-api` 报错找不到 node：

```bash
# 确认 nvm node 路径
source ~/.nvm/nvm.sh && nvm use 20 && which node
# 更新 service 文件中的 ExecStart 路径
sudo systemctl daemon-reload
sudo systemctl restart onlytrade-runtime-api
```

### E. 出现第二路串音（故事/多播页）

**原因**：之前由于 React 组件切换路由时 TTS 的异步音频请求晚于组件卸载返回，导致产生了无法被 React 控制的后台 `<audio>` 播放残留。或者由于部分 `manifest.json` 中配置了混有人声的 `bgm_file`。
**解决**：最新代码已在使用 `useAgentTtsAutoplay` 的 Hook 处通过引入 `ttsPlaySessionRef` 令牌彻底修复了异步播放泄漏的问题。如果依然出现问题：
- 确保已拉取最新前端代码并在 VM 上重新 `npm run build`。
- 确认对应的故事 `manifest.json` 里没有配置不需要的 `bgm_file`。
- 浏览器强制刷新（`Ctrl+F5`）。

---

## 14. 给同事的最短执行清单（TL;DR）

1. 安装 nvm → Node 20；确认 Nginx/Python3/Git 已有
2. 拉代码到 `/opt/onlytrade`
3. 配 `runtime-api/.env.local`（Qwen key/base/model）
4. `npm ci`（backend+frontend） + `npm run build --prefix onlytrade-web`
5. 启动 `onlytrade-runtime-api` systemd（注意 ExecStart 用 nvm 的 node 路径）
6. 配 Nginx 监听 `18000` 并桥接 `/onlytrade/api`（include 方式加入 `/usr/local/nginx/conf/onlytrade.conf`）
7. `curl` 验证健康与页面
8. 安全组放行端口 `18000`
9. 每天开盘前执行盘前刷新命令
