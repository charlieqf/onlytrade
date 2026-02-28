# OnlyTrade 直播媒体资源 (Artifacts) 与部署指南

本文档用于说明 OnlyTrade 平台中各类前端直播页面的媒体资源（Artifacts）的目录规范、URL 映射关系，并为将代码部署到其他环境或多人协作提供指导方案。

## 1. 概述

目前 OnlyTrade 首批推出的几款核心直播页面，从技术架构上可分为两类：

1. **静态驱动型 (Story / Multi-broadcast)**：
   这类直播是**预先录制和生成**的，依靠前端加载静态媒体文件（MP3, PNG, JSON, TXT）并在本地驱动播放。
   对应的页面路由为：`/stream/story-broadcast` 和 `/stream/multi-broadcast`。
2. **实时驱动型 (Command Deck)**：
   这类页面**没有本地媒体 Artifacts**，依靠连接后端大语言模型和系统的实时 SSE 数据流，并通过实时的旁白语音合成（TTS）或文字呈现进行直播。
   对应的页面路由为：`/stream/command-deck-new`。

---

## 2. URL 与 Artifacts 的映射关系

当前系统使用 URL 参数中的 `story` 或 `show` 字段来确定加载哪个直播的内容。如果 URL 中没有提供这个字段，系统会尝试降级使用 `trader`（交易员 ID）进行映射，但这属于底层兼容策略，推荐**显式地在前端 URL 中使用 `story`/`show` 参数**。

### 示例清单：

| 节目/直播类型 | URL 示例 | 映射到的物理目录 (相对 `public/story/` ) |
| :--- | :--- | :--- |
| **曼德拉效应 (播客)** | `/stream/story-broadcast?trader=t_013&story=mandela_effect` | `mandela_effect/` |
| **李白游天姥 (播客)** | `/stream/story-broadcast?trader=t_014&story=libai` | `libai/` |
| **强强联手 (多播)** | `/stream/multi-broadcast?trader=t_012&show=qiangqiang_citrini_20260227` | `qiangqiang_citrini_20260227/` |
| **AI 法庭 (播客)** | `/stream/story-broadcast?trader=t_012&story=ai_tribunal_20260226` | `ai_tribunal_20260226/` |
| **指挥舱 (实时)** | `/stream/command-deck-new?trader=t_003` | *(无本地静态对应的 Artifact 目录)* |

---

## 3. 静态直播 (Story / Multi) 所需的物理 Artifacts

当新增一个故事或多人直播时，必须在前端项目目录 `onlytrade-web/public/story/[slug]/` 下包含以下核心文件。

以 `libai` 项目 (`onlytrade-web/public/story/libai/`) 为例：

1. **`manifest.json` (必须)**: 负责定义该场直播的核心元数据，包含标题以及具体使用的其他文件名。
   ```json
   {
       "title": "...",
       "subtitle": "...",
       "narration_file": "narration.mp3",
       "bgm_file": "bgm.mp3",
       "duration_sec": 900,
       "scenes": ["scene_0.png", "scene_1.png"]
   }
   ```
2. **`script.txt` (必须)**: 脚本文件。前端会通过解析带括号或冒号的行（例如 `[host] 欢迎来到...`），动态计算文本长度，将这段文字智能对齐到音频时间线上展示实时字幕。
3. **`narration.mp3` (必需/常用)**: 经过独立合成的人声总轨道，如果设置了对应的文件名，播放时由前端 `<audio>` 挂载并驱动进度条。
4. **`bgm.mp3` (可选)**: 氛围背景音乐。与主音轨隔离，以便于前端单独调控它的音量（例如环境底噪或纯音乐）。
5. **图片或视频素材 (如 `scene_0.png`, `guest1.mp4`)**: `manifest.json` 中配置的视效图，前端会根据进度轮播。

---

## 4. GitHub 与第三方环境部署指南

由于这批 Artifacts 直接放在前端工程的 `public` 文件夹下，因此部署逻辑实际上就是**普通的前端 SPA (单页应用) 部署**。在执行项目构建 (`npm run build` 或 `yarn build`) 时，Vite/Webpack 会将 `public/story` 下的媒体文件**完整地原样拷贝**到发布的构建输出目录 (`dist`) 中。

### 开箱即用 (零配置部署)
如果整个项目部署在云端服务器（通过 Nginx 托管）或者 Vercel / Netlify 等静态托管平台，直接部署前端 `dist` 产物即可。用户通过访问这几个演示 URL，会自动触发针对相对路径 `/onlytrade/story/[slug]/...` 的请求，媒体文件即可正常播放。

### ⚠️ 重大注意事项：大文件与 Git 限制
虽然这种方案部署异常简便，但由于包含高质量音频（或短视频），这给 Git 和协作带来了压力：

- **Git Push 限制**: GitHub 对推送有 100MB 的单文件硬限制。如果 MP3 超过 50MB（如当前长音频），Git 会发出黄色警告（尽管推送目前能够成功）。
- **优化建议 (短期)**：如果遇到由于音频长达几十分钟而超限，建议团队在使用 Git 提交前，利用工具降低 MP3 比特率（降至 128kbps 或甚至 64kbps 的播客专用水准），或使用更先进压缩比的 `.m4a` 格式。
- **重构建议 (长期云端托管 CDN)**：
  如果播客和静态剧集多达几十上百集（整个代码库会膨胀到几GB甚至触发 GitHub LFS 计费），建议：
  1. 将庞大的媒体文件统一上传到阿里云 OSS、AWS S3 等对象存储服务。
  2. 在前端代码 (`StoryOralBroadcastPage.tsx`) 的路径拼接处，从针对本地域名的直接拼接（`/story/...`），改为读取一个环境变量基地址（如 `VITE_STORY_ASSETS_BASE_URL=https://cdn.example.com/story/`）。
  3. `public/story` 内只保留体积极小的 `manifest.json` 和 `script.txt` 提交至 Git 仓库，而媒体资源不再跟版本库走。

### 实时直播 (Command Deck) 部署说明
该直播模式(`/stream/command-deck-new`) 与静态播客不同，它依赖的是系统的运行环境能够畅通无阻。
部署 Command Deck 需要：
1. **稳定的后端流推送体系**：SSE 连接必须能无阻碍地越过 Nginx 代理返回前端。
2. **实时大模型服务**：连接到能够快速完成图表分析并生成文本决定的 LLM Agent（如 OpenAI/Claude）。
3. **前端文字转语音 (TTS) / 音频生成**：目前由前端自动发起接口轮询驱动合成和语音连播，所以 API_KEY 或其代理转接环节需要配置正确并在所部署机器上连通。
