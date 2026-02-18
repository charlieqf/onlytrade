# CN-A Popular 10 Selection (2026-02-17)

## Data sources used

- Eastmoney A-share hot rank snapshot via AKShare `stock_hot_rank_em()`.
- Per-stock 30-day hot-rank history via AKShare `stock_hot_rank_detail_em(symbol)`.
- Theme/news-like concept heat via AKShare `stock_hot_keyword_em(symbol)`.

## Selection method

1. Start from current top-100 in Eastmoney hot rank.
2. For each stock, compute 30-day popularity persistence metrics:
   - average rank over last 30 days
   - count of days ranked in top 10
3. Prefer symbols that combine:
   - sustained rank persistence (not only one-day spikes)
   - current attention (still in hot top-100)
   - broad viewer-attraction themes (AI, brokers, resources, liquor, robotics, etc.).

## Final 10-stock pool

| Symbol | Name | Current Rank | Avg Rank (30d) | Top10 Days (30d) | Top Concepts |
|---|---:|---:|---:|---:|---|
| `002131.SZ` | 利欧股份 | 17 | 9.50 | 22 | 字节概念 / 液冷概念 / 百度概念 |
| `300058.SZ` | 蓝色光标 | 25 | 19.73 | 9 | 字节概念 / 人工智能 / 百度概念 |
| `002342.SZ` | 巨力索具 | 73 | 32.37 | 14 | 商业航天 / 白酒 / 雄安新区 |
| `600519.SH` | 贵州茅台 | 23 | 33.67 | 6 | 白酒 / 茅指数 / 电商概念 |
| `300059.SZ` | 东方财富 | 24 | 33.30 | 4 | 券商概念 / 国产软件 / 互联金融 |
| `600089.SH` | 特变电工 | 55 | 36.77 | 6 | 特高压 / 黄金概念 / 数据中心 |
| `600986.SH` | 浙文互联 | 54 | 40.50 | 4 | 算力概念 / 阿里概念 / 字节概念 |
| `601899.SH` | 紫金矿业 | 51 | 49.37 | 4 | 小金属概念 / 稀缺资源 / 黄金概念 |
| `002050.SZ` | 三花智控 | 4 | 63.33 | 2 | 特斯拉 / 机器人概念 / 汽车热管理 |
| `002195.SZ` | 岩山科技 | 52 | 50.97 | 2 | 人脑工程 / 人工智能 / 国产软件 |

## Applied changes

- Updated CN agent manifests to use this 10-stock pool:
  - `agents/t_001/agent.json`
  - `agents/t_002/agent.json`
  - `agents/t_003/agent.json`
  - `agents/t_004/agent.json`
- Updated AKShare default live symbol set (collect/convert pipeline):
  - `scripts/akshare/collector.py`
  - `scripts/akshare/run_cycle.py`
  - `scripts/onlytrade-ops.sh`
  - `scripts/live_autofix_watchdog.py`
- Updated CN symbol-name map and affected runtime test:
  - `runtime-api/server.mjs`
  - `runtime-api/test/agentManagementRoutes.test.mjs`
