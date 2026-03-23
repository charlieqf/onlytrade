# Local MP4 Slice Manager Design

## Goal

在本地资源生成服务器（local PC）上新增一个独立的 MP4 切片管理网页，用来统一管理各直播间生成的短视频切片资产。它的第一阶段目标是：浏览、搜索、播放、筛选 `mp4` 切片；后续再扩展为多平台发布工作台。

这个系统明确不部署到公网直播 VM，也不复用 `http://zhibo.quickdealservice.com:18000` 的运行环境。它应当直接部署在素材生成机器上，读取本地切片产物与元数据。

## Why This Should Be A Separate Local App

- 它服务的是内容运营与发布，不是直播观众。
- 它天然依赖本地生成目录，放在 local PC 上最短链路。
- 它未来会逐步引入账号授权、发布状态、失败重试、平台适配等后台能力，不适合塞进现有直播前台。
- 它与 `t_022` 的关系是“消费已生成资产”，不是直播房间本身的一部分。

## Primary Users

- 运营：筛选要发布的切片
- 内容负责人：查看近期产出质量、搜索某个 topic 是否已经出片
- 后期 / 审核：快速试听、试看、决定是否丢弃或重做
- 后续自动发布器：读同一套索引与状态字段

## MVP Scope

第一阶段只做“资产管理后台”，不做复杂发布：

- 按房间查看切片列表
- 按节目 / 直播间 / 时间 / 标题 / 实体 / topic_id 搜索
- 查看 poster、标题、摘要、时长、生成时间、源链接
- 在线播放 `mp4`
- 标记切片状态：`new` / `reviewed` / `ready` / `published` / `archived` / `rejected`
- 查看该切片来自哪个 `TopicPackage`

MVP 不做：

- 平台 OAuth / 自动上传
- 多用户权限系统
- 复杂审核流
- 云端存储迁移
- 视频二次编辑

## System Boundary

### Inputs

- `data/live/onlytrade/content_videos/<room_id>/*.mp4`
- `data/live/onlytrade/content_posters/<room_id>/*.jpg`
- `data/live/onlytrade/topic_packages/*.json`
- `data/live/onlytrade/content_factory/*.json`
- 将来可接入：平台发布状态文件 / 发布日志

### Outputs

- 本地管理网页
- 切片索引数据库 / JSON 索引
- 切片状态变更记录
- 未来：各平台发布任务

## Core Decision

我建议这个管理网页走：

- **独立本地应用**
- **本地 API + 本地前端**
- **SQLite 作为状态数据库**
- **本地文件系统作为媒体真源**

这样有三个好处：

1. 文件扫描和媒体读取简单直接。
2. `mp4` / poster 不需要再搬运到别的系统才能管理。
3. 未来加发布状态、失败重试、标签、备注时，不必污染直播系统主数据库。

## Proposed Stack

推荐：

- 后端：Node.js + Express
- 前端：React + Vite
- 数据库：SQLite
- 媒体读取：直接走本地磁盘路径映射
- 部署方式：local PC 上独立端口运行，例如 `http://127.0.0.1:19020`

原因：

- 当前仓库已有 React/Vite 和 Node/Express 经验，接入成本最低
- SQLite 足够支撑单机资产后台
- 未来要接平台发布 API 时，Node 生态更顺手

## Directory And Data Model

建议增加一个独立的数据目录：

```text
data/local_slice_manager/
  slice_manager.db
  exports/
  logs/
```

核心表：`segments`

```sql
segments (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  program_slug TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  entity_key TEXT,
  source_url TEXT,
  published_at TEXT,
  generated_at TEXT NOT NULL,
  duration_sec REAL,
  video_path TEXT NOT NULL,
  poster_path TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  content_hash TEXT,
  manifest_as_of TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

扩展表：`segment_publish_targets`

```sql
segment_publish_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  publish_status TEXT NOT NULL,
  remote_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

## Ingestion Model

管理后台不应自己负责生成 `mp4`。它只做“索引 + 状态管理”。

推荐两种摄取方式：

### Mode A: Scan + Upsert (MVP 推荐)

后台启动时或定时任务中：

1. 扫描 `content_factory/*.json`
2. 读取 retained manifest 中的 `segments`
3. 补充 `video_path` / `poster_path`
4. 如果文件存在，则 upsert 到 SQLite

优点：

- 最容易做
- 对现有 `t_022` 零侵入
- 出错时可反复重扫恢复

### Mode B: Render Hook

在 `t_022` render/publish 结束时，顺手调用本地 manager API 写入索引。

这个可以第二阶段再做。

## Slice Status Model

MVP 建议的状态机：

- `new`: 新生成，未人工处理
- `reviewed`: 已人工看过
- `ready`: 准备发布
- `published`: 已发布到至少一个平台
- `rejected`: 明确不要
- `archived`: 历史归档

这个状态设计能覆盖：

- 内容筛选
- 简单运营流
- 将来自动发布器的前置筛选条件

## Web UI Structure

### Page 1: Segment List

列表主界面，字段：

- poster 缩略图
- title
- room_id / program_slug
- entity_key
- published_at
- duration
- status
- 是否已发布

支持筛选：

- 房间：`t_019`, `t_022`, 后续更多
- 节目：`china-bigtech` 等
- 时间范围
- 状态
- 关键词

### Page 2: Segment Detail

详情页：

- 大图 poster
- 内嵌视频播放器
- 标题 / 摘要
- topic_id
- source_url
- 本地文件路径
- 状态修改
- 备注输入框
- 将来平台发布状态列表

### Page 3: Queue / Review View

按状态聚合：

- 待审核
- 待发布
- 发布失败

这个页面第二阶段很有价值。

## API Design

本地 manager API 建议：

- `GET /api/segments`
- `GET /api/segments/:id`
- `PATCH /api/segments/:id/status`
- `PATCH /api/segments/:id/notes`
- `POST /api/segments/rescan`
- `GET /api/platforms/status`（后续）
- `POST /api/segments/:id/publish/:platform`（后续）

MVP 中最关键的是：

- 列表接口
- 详情接口
- 状态更新接口
- 重扫接口

## Search Strategy

MVP 搜索不需要引入全文搜索引擎。

用 SQLite 即可：

- `LIKE` 搜索 `title`
- `topic_id`
- `entity_key`
- `room_id`
- `program_slug`

如果以后切片量上万，再考虑 FTS5。

## Media Serving Strategy

本地 manager 后端可直接暴露：

- `/media/video/:segmentId`
- `/media/poster/:segmentId`

实现时不要把文件路径直接暴露给前端，而是：

- 先根据 `segment_id` 查数据库
- 再由后端安全映射到磁盘文件
- 防止路径遍历

## Relationship With t_022

它与 `t_022` 的关系应该是：

- `t_022` 负责生成视频内容
- Local Slice Manager 负责管理这些内容资产

也就是说：

- `t_022` 是生产线
- Slice Manager 是运营后台

二者共享的数据锚点是：

- `segment id`
- `topic_id`
- `room_id`
- `program_slug`

## Future Publishing Extension

第二阶段可以扩展为“发布工作台”：

- 抖音 / 视频号 / 快手 / 小红书平台配置
- 手工发布按钮
- 批量发布
- 发布状态回写
- 发布失败重试
- 平台返回 ID 记录

但建议前提是先把第一阶段“浏览 / 搜索 / 播放 / 状态管理”做稳。

## Security And Ops

这个系统是本地后台，不应默认公网开放。

建议：

- 仅监听 `127.0.0.1`
- 如需远程访问，用 SSH 隧道或内网代理
- 不在第一阶段做复杂认证
- 日志只记录元数据，不记录平台密钥

## MVP Delivery Plan

### Phase 1

- 建独立应用骨架
- 扫描 retained manifest -> upsert SQLite
- 列表页
- 详情页
- 本地视频播放
- 状态修改

### Phase 2

- 队列页
- 失败切片筛选
- 重扫与重建索引

### Phase 3

- 平台发布能力
- 发布记录 / 失败重试
- 批量操作

## Success Criteria

- 能看到本地所有 `t_022` 切片
- 能按标题 / topic_id / 房间搜索
- 能直接播放 `mp4`
- 能修改切片状态和备注
- 新生成的切片能被扫描并入库
- 为未来多平台发布预留稳定数据结构

## Recommendation

建议下一步直接做一个新项目，例如：

- `local-slice-manager/`

先实现最小闭环：

- SQLite 建库
- 扫描 `content_factory` retained manifest
- 列表页 + 详情页 + 本地播放
- 切片状态管理

等这个后台能稳定用于内容筛选后，再做平台发布功能。
