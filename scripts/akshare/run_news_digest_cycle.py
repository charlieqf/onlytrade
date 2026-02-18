from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[2]))

try:
    import akshare as ak  # type: ignore
except Exception:
    ak = None

from scripts.akshare.common import atomic_write_json
from scripts.akshare.hot_news_module import collect_hot_news_bundle


SH_TZ = ZoneInfo("Asia/Shanghai")


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--canonical-path", default="data/live/onlytrade/news_digest.cn-a.json"
    )
    parser.add_argument("--symbols", default="600519,000001,300750,601318")
    parser.add_argument("--limit-per-symbol", type=int, default=6)
    parser.add_argument("--limit-total", type=int, default=20)
    parser.add_argument("--hot-limit-per-category", type=int, default=4)
    parser.add_argument("--hot-limit-total", type=int, default=20)
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

    now = datetime.now(SH_TZ)
    payload = {
        "schema_version": "news.digest.v1",
        "market": "CN-A",
        "mode": "real",
        "provider": "akshare" if ak is not None else "rss-hot-news",
        "source_kind": "hot_news_plus_symbol_news"
        if ak is not None
        else "hot_news_only",
        "day_key": now.strftime("%Y-%m-%d"),
        "as_of_ts_ms": int(now.timestamp() * 1000),
        "symbols": symbols,
        "headline_count": len(headlines),
        "headlines": headlines,
        "categories": hot_categories,
        "commentary": hot_commentary,
        "titles": hot_titles,
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
