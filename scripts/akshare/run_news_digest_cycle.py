from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
import sys

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    from backports.zoneinfo import ZoneInfo  # type: ignore

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[2]))

try:
    import akshare as ak  # type: ignore
except Exception:
    ak = None

from scripts.akshare.common import atomic_write_json
from scripts.akshare.hot_news_module import collect_hot_news_bundle


SH_TZ = ZoneInfo("Asia/Shanghai")

CASUAL_PROMPT_POOL = [
    "盘中先稳住节奏，别被情绪牵着走。",
    "先看风险，再看收益，今天先守回撤。",
    "喝口水，深呼吸，再决定是否加仓。",
    "不确定就少做，这是职业化的一部分。",
    "今天优先做高确定性机会，其他可以放过。",
    "连续亏损时先降频，保护状态最重要。",
    "仓位要留余地，别在噪音里重仓硬扛。",
    "有信号才出手，没信号就耐心等待。",
    "交易像马拉松，不是每分钟都要冲刺。",
    "先把计划写清楚，再执行会更稳。",
]


def _safe_text(value: object, max_len: int = 240) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text[:max_len]


def _collect_titles(symbol: str, limit: int) -> list[dict]:
    if ak is None:
        return []

    # ak.stock_news_em returns columns with Chinese names.
    col_title = "\u65b0\u95fb\u6807\u9898"  # 新闻标题
    col_time = "\u53d1\u5e03\u65f6\u95f4"  # 发布时间
    col_source = "\u6587\u7ae0\u6765\u6e90"  # 文章来源
    col_url = "\u65b0\u95fb\u94fe\u63a5"  # 新闻链接

    try:
        df = ak.stock_news_em(symbol=symbol)
    except Exception:
        return []
    if df is None or df.empty:
        return []

    items: list[dict] = []
    for _, row in df.head(max(1, int(limit))).iterrows():
        title = _safe_text(row.get(col_title), 200)
        if not title:
            continue
        items.append(
            {
                "title": title,
                "published_at": _safe_text(row.get(col_time), 40) or None,
                "source": _safe_text(row.get(col_source), 60) or None,
                "url": _safe_text(row.get(col_url), 240) or None,
                "symbol": symbol,
            }
        )
    return items


def _collect_global_flash_titles(limit: int) -> list[dict]:
    if ak is None:
        return []

    # ak.stock_info_global_cls columns: 标题, 内容, 发布日期, 发布时间
    col_title = "\u6807\u9898"  # 标题
    col_content = "\u5185\u5bb9"  # 内容
    col_date = "\u53d1\u5e03\u65e5\u671f"  # 发布日期
    col_time = "\u53d1\u5e03\u65f6\u95f4"  # 发布时间

    try:
        df = ak.stock_info_global_cls()
    except Exception:
        return []
    if df is None or df.empty:
        return []

    items: list[dict] = []
    max_rows = max(1, min(int(limit or 12) * 3, 120))
    for _, row in df.head(max_rows).iterrows():
        title = _safe_text(row.get(col_title), 120)
        content = _safe_text(row.get(col_content), 220)
        merged_title = title or content
        if not merged_title:
            continue

        pub_date = _safe_text(row.get(col_date), 20)
        pub_time = _safe_text(row.get(col_time), 20)
        published_at = " ".join(x for x in [pub_date, pub_time] if x).strip() or None

        items.append(
            {
                "title": merged_title,
                "published_at": published_at,
                "source": "\u8d22\u8054\u793e\u5feb\u8baf",
                "url": None,
                "symbol": None,
                "category": "markets_cn",
            }
        )
        if len(items) >= max(1, int(limit)):
            break
    return items


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--canonical-path", default="data/live/onlytrade/news_digest.cn-a.json"
    )
    parser.add_argument("--symbols", default="600519,000001,300750,601318")
    parser.add_argument("--limit-per-symbol", type=int, default=10)
    parser.add_argument("--limit-total", type=int, default=36)
    parser.add_argument("--hot-limit-per-category", type=int, default=8)
    parser.add_argument("--hot-limit-total", type=int, default=36)
    args = parser.parse_args()

    symbols = [s.strip() for s in str(args.symbols or "").split(",") if s.strip()]
    per_symbol = max(1, min(int(args.limit_per_symbol or 6), 20))
    limit_total = max(1, min(int(args.limit_total or 20), 50))

    headlines: list[dict] = []
    seen = set()

    hot_bundle = collect_hot_news_bundle(
        limit_per_category=max(1, int(args.hot_limit_per_category or 4)),
        limit_total=max(5, int(args.hot_limit_total or 20)),
    )
    hot_categories = hot_bundle.get("categories") or {}
    hot_commentary = [
        str(x or "").strip()
        for x in (hot_bundle.get("commentary") or [])
        if str(x or "").strip()
    ]
    hot_titles = [
        str(x or "").strip()
        for x in (hot_bundle.get("titles") or [])
        if str(x or "").strip()
    ]

    now = datetime.now(SH_TZ)
    day_seed = int(now.strftime("%j"))
    rotate = day_seed % len(CASUAL_PROMPT_POOL)
    casual_prompts = (CASUAL_PROMPT_POOL[rotate:] + CASUAL_PROMPT_POOL[:rotate])[:8]

    for item in hot_bundle.get("headlines") or []:
        title = str(item.get("title") or "").strip()
        if not title or title in seen:
            continue
        seen.add(title)
        headlines.append(item)
        if len(headlines) >= limit_total:
            break

    for sym in symbols:
        if len(headlines) >= limit_total:
            break
        for item in _collect_titles(sym, per_symbol):
            key = item.get("title") or ""
            if not key or key in seen:
                continue
            seen.add(key)
            headlines.append(item)
            if len(headlines) >= limit_total:
                break

    used_global_fallback = False
    if len(headlines) < limit_total:
        remain = max(1, limit_total - len(headlines))
        for item in _collect_global_flash_titles(min(remain, 20)):
            key = item.get("title") or ""
            if not key or key in seen:
                continue
            seen.add(key)
            headlines.append(item)
            used_global_fallback = True
            if len(headlines) >= limit_total:
                break

    if not hot_commentary:
        picks = [
            _safe_text(item.get("title"), 40)
            for item in headlines[:3]
            if _safe_text(item.get("title"), 40)
        ]
        if picks:
            hot_commentary = [f"\u5e02\u573a\u5feb\u8baf\uff1a{'\uff1b'.join(picks)}"]

    if not hot_titles:
        fallback_titles = []
        for item in headlines:
            label = str(item.get("category") or "").strip()
            title = _safe_text(item.get("title"), 120)
            if not title:
                continue
            prefix = "[\u5feb\u8baf]"
            if label == "ai":
                prefix = "[AI]"
            elif label == "geopolitics":
                prefix = "[\u5730\u7f18]"
            elif label == "global_macro":
                prefix = "[\u5b8f\u89c2]"
            elif label == "tech":
                prefix = "[\u79d1\u6280]"
            elif label == "markets_cn":
                prefix = "[\u5e02\u573a]"
            fallback_titles.append(f"{prefix} {title}")
            if len(fallback_titles) >= 20:
                break
        hot_titles = fallback_titles

    payload = {
        "schema_version": "news.digest.v1",
        "market": "CN-A",
        "mode": "real",
        "provider": "akshare" if ak is not None else "rss-hot-news",
        "source_kind": (
            "hot_news_plus_symbol_news_plus_global_cls"
            if (ak is not None and used_global_fallback)
            else ("hot_news_plus_symbol_news" if ak is not None else "hot_news_only")
        ),
        "day_key": now.strftime("%Y-%m-%d"),
        "as_of_ts_ms": int(now.timestamp() * 1000),
        "symbols": symbols,
        "headline_count": len(headlines),
        "headlines": headlines,
        "categories": hot_categories,
        "commentary": hot_commentary,
        "titles": hot_titles,
        "casual_prompts": casual_prompts,
    }
    atomic_write_json(args.canonical_path, payload)
    print(
        json.dumps(
            {
                "ok": True,
                "output_path": args.canonical_path,
                "headline_count": len(headlines),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
