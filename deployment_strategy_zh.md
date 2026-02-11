# 部署策略：MVP 基础设施方案

## 1. 方案 A：开发者首选 (Vercel + Railway + Supabase)
*强烈推荐用于 MVP 阶段和个人开发者。*

| 组件 | 平台 | 推荐理由 |
| :--- | :--- | :--- |
| **前端 (UI)** | **Vercel** | Next.js 的原生支持最强。全球 CDN，免费额度极高。 |
| **后端 (Python)** | **Railway** | 完美支持 Docker 化的 FastAPI/Python 循环任务。没有 Serverless 的超时限制，适合 24/7 运行的交易 Agent。 |
| **数据库/实时同步** | **Supabase** | 托管 PostgreSQL + 实时引擎。省去了自建 WebSocket 后端的繁琐，且自带用户认证。 |
| **缓存/队列** | **Upstash** | Serverless Redis。完美解决 Vercel 与 Railway 之间的状态共享。 |

**专家评述**：上线速度最快，成本极低（大部分有免费额度），运维压力几乎为零。

---

## 2. 方案 B：企业级选型 (Google Cloud Platform)
*适合预期会有海量用户，或者需要深度集成其他 Google 云服务的场景。*

| 组件 | 平台 | 推荐理由 |
| :--- | :--- | :--- |
| **前端与后端**| **Cloud Run** | 基于容器的弹性伸缩。可以同时运行 Next.js 和 FastAPI。 |
| **数据库** | **Cloud SQL** | 企业级 PostgreSQL (成本显著高于 Supabase)。 |
| **实时通讯** | **Firebase/Ably** | 需要额外引入来替代 Supabase 的实时推送功能。 |

**专家评述**：配置非常繁琐，有一定的学习门槛。即使在没有流量时，也会产生较高的基础闲置成本。

---

## 3. 核心考虑：Python Agent 的“生命力”问题
交易 Agent 不能部署在传统的 **Serverless Functions**（如 Vercel API 或普通的 Cloud Run）中，原因有二：
1. **长连接**：Agent 需要与行情供应商保持不间断的 WebSocket 连接。
2. **主动监听**：Agent 需要 24/7 的事件循环来捕获瞬间的“价格突破”或“量能激增”，而不是等到用户访问网页才触发。

**结论**：对于 Python 部分，**Railway** 或 **轻量级 VPS** 是更优选择，因为它们允许进程长久驻留。

## 4. OnlyTrade 最终推荐建议
1. **前端 (The Face)**：部署在 **Vercel**。
2. **后端引擎 (The Brain)**：部署在 **Railway** (使用 Docker 部署)。
3. **数据中心 (The Memory)**：使用 **Supabase**。

这种“分布式云服务”架构不仅性能强悍，而且能让你在项目初期将精力 100% 集中在代码逻辑上，而不是繁杂的服务器运维。
