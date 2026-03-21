# t_022 Content Factory Design

## Goal

新增一个并行直播间 `t_022`，路由为 `/stream/content-factory?trader=t_022&program=china-bigtech`，在复用 `t_019` 中国大厂热点上游内容生产链路的前提下，把每个 topic 生产为一个完整的独立 `mp4` 内容单元，并在网页端顺序播放这些 `mp4` 文件。

设计目标有两个：

1. 房间播放单元从“图片 + 音频 + 前端拼装”变成“完整独立视频”，降低资源同步和播放链路复杂度。
2. 每个 `mp4` 天然就是一个内容切片，后续可以直接用于视频号/抖音/快手/小红书等平台分发，不需要额外开发切片功能。

## Key Decision Summary

- 新房间使用 `t_022`，不占用现有 `t_019` / `t_020` / `t_021`
- URL 采用：`http://zhibo.quickdealservice.com:18000/onlytrade/stream/content-factory?trader=t_022&program=china-bigtech`
- `t_022` 与 `t_019` **共享上游内容工厂**，即：选题、摘要、解说文案、TTS、素材抓取尽可能复用
- `t_019` 和 `t_022` 只在下游发布层分叉：
  - `t_019` 发布 retained topic feed
  - `t_022` 渲染并发布 retained video manifest
- `t_022` 的“三张图”定义为 **3 个视觉素材位**，不是强制 3 张真实新闻原图
- MVP 不把开放式 `image search` 作为主链路；优先使用文章内多图、品牌素材库和程序生成卡片

## Why A New Room Instead Of Replacing t_019

`t_019` 已经证明了：

- 中国大厂热点选题是有效的
- retained latest-20 feed 机制是对的
- 本地 PC 生成并推送到 VM 的流程是可行的

但是 `t_022` 的目标不是“更好看的 `t_019`”，而是另一种内容形态：

- `t_019` = 直播感更强的图文口播房
- `t_022` = 可直接分发的短视频工厂房

如果直接替换 `t_019`，会把现有稳定链路、前端播放逻辑、运维节奏全部拖入重构风险。并行新增 `t_022` 的好处是：

- 上游内容质量升级能同时收益两个房间
- `t_022` 的 Remotion / ffmpeg / 视频渲染失败不会拖死 `t_019`
- 允许先验证视频化的产品价值，再决定未来是否收敛房型

## Product Requirements

### Required

- 新 agent / room id：`t_022`
- 新路由：`/stream/content-factory`
- 新节目 slug：`china-bigtech`
- 每个 topic 产出一个完整 `mp4`
- 每个 `mp4` 内至少包含：
  - 顶部 Topic Title
  - 底部摘要区
  - 3 个视觉素材位
  - TTS 音频压制后的完整视频
- 网页端只需要拉取 manifest 并顺播 mp4
- VM 侧保留最新 20 个可播放 segment
- segment 可直接作为外部平台分发素材

### Non-Goals For MVP

- 不做复杂字幕逐词高亮
- 不做多模板自动选择
- 不做横竖屏双版本
- 不做平台 API 直发
- 不做在线 image search 主链路
- 不在 MVP 中替换或破坏 `t_019`

## Route, Identity, And Naming

### Public URL

`/onlytrade/stream/content-factory?trader=t_022&program=china-bigtech`

### Internal Identity

- `room_id`: `t_022`
- `program_slug`: `china-bigtech`
- `program_title`: 建议为 `内容工厂·国内大厂`

### File / Agent Additions

- `agents/t_022/agent.json`
- `data/agents/registry.json` 增加 `t_022`
- `onlytrade-web/src/App.tsx` 增加 `contentFactory` 页面分支
- `onlytrade-web/src/pages/design/T022ContentFactoryPage.tsx`

## Architecture Overview

整体架构分为 3 层：

1. **Shared Content Layer**
2. **t_019 Publisher**
3. **t_022 Publisher**

### 1) Shared Content Layer

该层负责把“新闻素材”变成“可发布内容包”，由 `t_019` 和 `t_022` 共同使用。它输出 `TopicPackage[]`，不直接面向网页播放。

输入：

- Google News RSS 查询结果
- 直连 RSS 源（`ITHome` / `36Kr` / `Leiphone`）
- 文章页解析结果
- TTS 音频
- 品牌素材库 / 程序生成卡片

输出：

- 标准化 `TopicPackage`

### 2) t_019 Publisher

从 `TopicPackage[]` 中选择最优单图，保留现有 retained feed 发布模式：

- retained latest-20
- 单 topic 播放单位仍是图片 + mp3
- 兼容既有 `TopicCommentaryPage`

### 3) t_022 Publisher

从同一批 `TopicPackage[]` 中为每个 topic 选出 3 个视觉位，交给 Remotion 渲染为单独视频，再发布 retained latest-20 video manifest。

## Shared Content Model

建议新增中间产物：`TopicPackage`

```json
{
  "topic_id": "china_bigtech_xiaomi_20260321_ab12cd",
  "room_program": "china-bigtech",
  "entity_key": "xiaomi",
  "entity_label": "小米",
  "title": "原始新闻标题",
  "screen_title": "直播封面标题",
  "summary_facts": "事实摘要",
  "commentary_script": "60-90秒口播稿",
  "published_at": "2026-03-21T09:30:00Z",
  "source": "36Kr",
  "source_url": "https://...",
  "audio_file": "....mp3",
  "visual_candidates": [],
  "selected_visuals": [],
  "topic_reason": "为什么选这条",
  "priority_score": 182.0
}
```

这意味着现有偏 `t_019` 专用的 topic 生成脚本，需要逐步重构为：

- 先生成共享 `TopicPackage[]`
- 再分别发布给 `t_019` 和 `t_022`

## Visual Asset Strategy

### Principle

`t_022` 需要的是 3 个稳定可用的视觉位，而不是“必须 3 张新闻原图”。

如果坚持 3 张真实新闻图，MVP 成功率会偏低，因为现有上游大量场景只能拿到 0-1 张图。当前 `t_019` 其实就是“一条 topic 最终只保留一张可下载图片”，拿不到图直接丢弃。

### Source Priority

按以下优先级构建视觉候选：

1. **Article Images**
   - feed `media:thumbnail`
   - article page `og:image`
   - article 正文内多图
2. **Brand Assets**
   - 公司 logo
   - 产品图
   - 官方发布会 / 官方新闻图
3. **Generated Cards**
   - 标题卡
   - 摘要卡
   - 观察点卡

### Default Slot Policy

- 优先：`2 张新闻图 + 1 张品牌/信息卡`
- 次优：`1 张新闻图 + 1 张品牌图 + 1 张信息卡`
- 最差：`1 张品牌图 + 2 张程序卡`

这保证每条 topic 都尽量能渲染成视频，而不是因为图不够被放弃。

## Visual Candidate Scoring

建议统一视觉候选结构：

```json
{
  "type": "article_image",
  "source_url": "https://...",
  "local_file": "abc.jpg",
  "width": 1200,
  "height": 675,
  "score": 0.91,
  "reason": "inline_image_large_relevant"
}
```

评分规则：

- 页面主图 > 正文大图 > feed 缩略图
- 高分辨率优先
- 画幅适合竖屏裁切优先
- 与当前 topic / entity 高相关优先
- 重复图降权
- logo / icon / avatar / 广告图直接过滤

`selected_visuals` 固定产出 3 个槽位：

```json
[
  {"slot": 1, "type": "article_image", "file": "..."},
  {"slot": 2, "type": "article_image", "file": "..."},
  {"slot": 3, "type": "generated_card", "card_kind": "outlook"}
]
```

## Article Multi-Image Extraction

MVP 不使用开放式 image search 主链路，原因是：

- 稳定性差
- 时延高
- 去重与相关性难控制
- 公开分发时版权风险更高

MVP 中第二、第三张图的默认来源是：

1. resolved article URL 的正文多图
2. 品牌素材库
3. 程序生成卡

新增文章页多图抽取逻辑时，应过滤：

- logo
- icon
- avatar
- sprite
- 明显广告素材
- 小尺寸图片

## Brand Asset Library

建议新增可控素材库：

```text
assets/content_factory/brands/
  alibaba/
  tencent/
  bytedance/
  xiaomi/
  huawei/
  baidu/
  meituan/
  ideal/
  nio/
  xpeng/
```

每个实体可以放：

- logo variants
- 产品图
- 官宣活动图
- 通用品牌背景图

该库的用途不是替代新闻图，而是保证 `t_022` 的视频链路在素材不足时仍能稳定出片。

## Generated Card Policy

MVP 只做 2 种程序生成卡：

1. **Summary Card**
   - 显示 2-3 条摘要事实
2. **Outlook Card**
   - 显示“接下来要看 / 真正要看”的观察点

不做复杂图表卡，不做多风格模板切换。

## Remotion Video Design

### Output Format

- 竖屏：`1080 x 1920`
- `30fps`
- 编码：`H.264 + AAC`
- 每个 topic 一个独立 composition

### Duration Strategy

视频长度默认 **等于音频长度**，而不是“差不多”。

实现方式：

- 先拿到 mp3 时长
- 用 Remotion metadata 计算 composition frames
- 在这个总时长内分配 3 个视觉场景

### Scene Layout

每个 segment 由 3 个 scene 组成：

1. **Scene 1**
   - 主视觉 1
   - Topic Title 强曝光
2. **Scene 2**
   - 主视觉 2
   - Summary facts
3. **Scene 3**
   - 主视觉 3
   - Outlook / hook

时长比例默认：

- `34% / 33% / 33%`

### Motion Style

采用轻量且稳定的动态效果：

- push-in
- pan
- fade
- 轻微转场

不做复杂 3D，不做重粒子特效。

## MP4 Packaging

最终交付物是单条 topic 的完整视频：

- 3 个视觉位
- 顶部标题
- 底部摘要
- TTS 音频已压入视频轨道
- 输出完整 `mp4`

网页端无需再单独处理图片和音频同步。

## Storage Layout

建议新增目录：

```text
data/live/onlytrade/topic_packages/
  china_bigtech_packages.json

data/live/onlytrade/content_factory/
  china_bigtech_factory_live.json

data/live/onlytrade/content_videos/
  t_022/
    <segment>.mp4

data/live/onlytrade/content_posters/
  t_022/
    <segment>.jpg
```

说明：

- `topic_packages`：共享中间产物
- `content_factory_live.json`：视频 manifest
- `content_videos/t_022`：最终 mp4
- `content_posters/t_022`：封面图，可选但建议保留

## Manifest Contract

新增 `t_022` 的 retained video manifest：

```json
{
  "schema_version": "content.factory.feed.v1",
  "room_id": "t_022",
  "program_slug": "china-bigtech",
  "program_title": "内容工厂·国内大厂",
  "as_of": "2026-03-21T10:00:00Z",
  "segment_count": 20,
  "segments": [
    {
      "id": "cf_xiaomi_20260321_ab12cd",
      "topic_id": "china_bigtech_xiaomi_20260321_ab12cd",
      "title": "小米又把牌桌掀了？",
      "summary": "发布节奏、价格策略、后续观察点...",
      "published_at": "2026-03-21T09:40:00Z",
      "duration_sec": 58.4,
      "video_file": "cf_xiaomi_20260321_ab12cd.mp4",
      "poster_file": "cf_xiaomi_20260321_ab12cd.jpg",
      "video_api_url": "/api/content-factory/videos/t_022/cf_xiaomi_20260321_ab12cd.mp4",
      "poster_api_url": "/api/content-factory/posters/t_022/cf_xiaomi_20260321_ab12cd.jpg"
    }
  ]
}
```

### Retention Rules

- dedupe key：`topic_id`
- 同一 topic 新 render 成功后替换旧版本
- manifest 只保留最新 20 条且 **mp4 实际存在** 的 segment

## API Design

建议新增 API：

- `GET /api/content-factory/live?room_id=t_022`
- `GET /api/content-factory/videos/:room_id/:file`
- `GET /api/content-factory/posters/:room_id/:file`

Public bridge：

- `/onlytrade/api/content-factory/live?room_id=t_022`
- `/onlytrade/api/content-factory/videos/t_022/<file>.mp4`
- `/onlytrade/api/content-factory/posters/t_022/<file>.jpg`

## Frontend Design

新增页面：

- `onlytrade-web/src/pages/design/T022ContentFactoryPage.tsx`

页面职责很简单：

- 每 15 秒拉一次 manifest
- 播放当前 mp4
- `ended` 后自动切下一个
- 预加载下一个视频
- 当前视频 404 / 解码失败则跳过

这比当前 `t_019` 的前端逻辑明显更简单，因为它不再需要组合：

- `image_api_url`
- `audio_api_url`
- 手动切 topic
- 音频 ended 同步控制

## Local PC Workflow

建议不要直接复制 `local_collect_and_push_t019.sh`，而是拆成 3 个阶段脚本：

1. `build_china_bigtech_packages.py`
2. `publish_t019_from_packages.py`
3. `render_publish_t022_from_packages.py`

推荐顺序：

1. 先生成共享 `TopicPackage[]`
2. 先更新 `t_019`
3. 再渲染并发布 `t_022`

原因：

- `t_019` 更新轻，应该优先稳定
- `t_022` 视频渲染重，允许慢一些
- `t_022` 失败不能影响 `t_019`

## Rendering Pipeline

`render_publish_t022_from_packages.py` 负责：

1. 从 `TopicPackage[]` 选可发布 topic
2. 为每条 topic 选出 3 个视觉位
3. 生成 Remotion composition props
4. 渲染 `mp4`
5. 生成 poster
6. 上传到 VM
7. 更新 retained latest-20 manifest

## Failure Handling

### Rules

- `t_019` 发布失败与 `t_022` 发布失败必须隔离
- 单条 topic 视频渲染失败，不应阻断其他 topic
- 没有可用 `mp4` 的 segment 不得进入 `t_022` manifest
- manifest 中的 retained rows 必须过滤掉真实文件不存在的 `mp4`

### Typical Failures

- 文章只有 0-1 张可用图
  - 使用品牌图 / 生成卡补齐
- TTS 成功但视频渲染失败
  - 不进入 manifest
- 图片下载成功但视频编码失败
  - 不进入 manifest
- VM 上文件缺失
  - retained merge 时剔除

## Operational Principle

对 `t_022` 而言，**最新 20 个可播放视频段** 才是真实 SLO，不是“最新生成了多少条 topic”。

需要关注：

- manifest `segment_count`
- mp4 实际存在性
- 前 3-5 个 segment 的 `200 video/mp4`
- poster `200 image/*`
- 网页是否连续顺播

## Rollout Plan

### Phase 1: Shared Package Layer

- 把 `t_019` 上游改造成共享 `TopicPackage[]`
- `t_019` 继续正常发布

### Phase 2: t_022 MVP Video Room

- 新增 `t_022`
- 新增 1 个 Remotion 模板
- 新增 retained latest-20 video manifest
- 前端只顺播 mp4

### Phase 3: Distribution Readiness

- 产出封面图
- 规范 segment 命名
- 补充平台发布元数据

## Success Criteria

- `t_022` 可以并行存在，不影响 `t_019`
- `t_019` 与 `t_022` 共用同一套上游内容改进
- 每个 `t_022` segment 都是完整独立 mp4
- 房间前端只播 mp4，不依赖图片/音频双资源拼装
- retained manifest 永远只保留可播放的最新 20 条
- 生成出的 `mp4` 能直接用于外部平台分发

## Recommendation

这是一个值得做的新房型，但本质上不是“新页面”，而是：

- 一个共享内容工厂
- 一个视频化发布器
- 一个面向直播和分发双用途的内容系统

建议下一步先写实现计划，按 MVP 只做：

- `t_022`
- `china-bigtech`
- 一个 Remotion 模板
- latest-20 retained video manifest
- 共享上游内容包

## Deferred Follow-Up: Local MP4 Slice Manager

该项目还应预留一个后续阶段：在本地资源生成服务器（local PC）上部署一个独立的 `mp4` 切片管理网页，而不是部署在直播 VM `http://zhibo.quickdealservice.com:18000` 上。

这个本地管理网页的目标：

- 浏览各直播间生成出的 `mp4` 切片
- 按房间、节目、实体、时间、关键词搜索
- 直接播放和预览
- 后续扩展到“发布到各平台”的工作台

这个需求不进入 `t_022` MVP 的主关键路径，但应影响当前设计决策：

- `mp4` 文件命名要稳定、可检索
- manifest / segment metadata 要足够丰富
- poster、topic_id、room_id、program_slug、发布时间等字段应在生成期写好
- 未来本地管理网页应直接读取 local PC 上的 segment 索引，而不是依赖直播 VM
