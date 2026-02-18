from __future__ import annotations

from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import quote_plus
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


DEFAULT_TIMEOUT_SEC = 8


CATEGORY_QUERIES = [
    {
        "category": "ai",
        "query": "人工智能 大模型 AI OpenAI Anthropic DeepMind NVIDIA",
        "keywords": [
            "AI",
            "人工智能",
            "大模型",
            "OpenAI",
            "Anthropic",
            "DeepMind",
            "NVIDIA",
        ],
    },
    {
        "category": "geopolitics",
        "query": "地缘政治 美中 俄乌 中东 台海 制裁 外交",
        "keywords": ["地缘", "俄乌", "中东", "台海", "制裁", "外交", "美国", "中国"],
    },
    {
        "category": "global_macro",
        "query": "全球 宏观 美联储 利率 通胀 就业 财政",
        "keywords": ["美联储", "利率", "通胀", "就业", "央行", "债券", "美元"],
    },
    {
        "category": "tech",
        "query": "科技 芯片 半导体 云计算 软件",
        "keywords": ["芯片", "半导体", "GPU", "云", "软件", "算力"],
    },
    {
        "category": "markets_cn",
        "query": "A股 港股 美股 市场 盘前 盘后 热点",
        "keywords": ["A股", "港股", "美股", "市场", "指数", "成交"],
    },
]


CATEGORY_LABEL_ZH = {
    "ai": "AI",
    "geopolitics": "地缘",
    "global_macro": "宏观",
    "tech": "科技",
    "markets_cn": "市场",
}


MAX_AGE_HOURS = 96


def _safe_text(value: Any, max_len: int = 220) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text[:max_len]


def _rss_urls_for_query(query: str) -> list[str]:
    q = quote_plus(str(query or "").strip())
    if not q:
        return []
    return [
        f"https://news.google.com/rss/search?q={q}+when:3d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
        f"https://www.bing.com/news/search?q={q}&format=RSS&setlang=zh-cn",
    ]


def _normalize_title(raw: str) -> str:
    title = _safe_text(raw, 220)
    if not title:
        return ""
    # Many RSS feeds append " - Source" to title; trim it for dedup consistency.
    if " - " in title:
        parts = [p.strip() for p in title.split(" - ") if p.strip()]
        if parts:
            title = parts[0]
    return title


def _parse_pub_ts_ms(pub_date: str | None) -> int | None:
    text = _safe_text(pub_date, 80)
    if not text:
        return None
    try:
        dt = parsedate_to_datetime(text)
        if dt.tzinfo is None:
            return None
        return int(dt.timestamp() * 1000)
    except Exception:
        return None


def _keyword_score(title: str, keywords: list[str]) -> int:
    t = str(title or "").lower()
    score = 0
    for kw in keywords:
        token = str(kw or "").strip().lower()
        if token and token in t:
            score += 1
    return score


def _parse_rss_items(
    xml_text: str,
    limit: int,
    category: str,
    keywords: list[str],
    now_ts_ms: int,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not xml_text:
        return out

    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return out

    items = root.findall(".//item")
    for item in items[: max(1, int(limit) * 3)]:
        title = _normalize_title(item.findtext("title") or "")
        if not title:
            continue
        link = _safe_text(item.findtext("link"), 320) or None
        pub_date = _safe_text(item.findtext("pubDate"), 64) or None
        source = _safe_text(item.findtext("source"), 80) or None
        pub_ts_ms = _parse_pub_ts_ms(pub_date)
        if pub_ts_ms is not None:
            age_hours = (now_ts_ms - pub_ts_ms) / 3_600_000
            if age_hours > MAX_AGE_HOURS:
                continue
        score = _keyword_score(title, keywords)
        if score == 0 and category in {"ai", "geopolitics"}:
            continue

        out.append(
            {
                "title": title,
                "published_at": pub_date,
                "published_ts_ms": pub_ts_ms,
                "source": source,
                "url": link,
                "category": category,
                "score": score,
            }
        )

    out.sort(
        key=lambda row: (
            int(row.get("score") or 0),
            int(row.get("published_ts_ms") or 0),
        ),
        reverse=True,
    )

    trimmed = out[: max(1, int(limit))]
    for row in trimmed:
        row.pop("score", None)
    return trimmed


def _fetch_category_items(
    query: str,
    category: str,
    keywords: list[str],
    limit: int,
    now_ts_ms: int,
) -> list[dict[str, Any]]:
    for url in _rss_urls_for_query(query):
        try:
            req = Request(url, headers={"User-Agent": "onlytrade-news-bot/1.0"})
            with urlopen(req, timeout=DEFAULT_TIMEOUT_SEC) as resp:
                payload = resp.read().decode("utf-8", errors="replace")
            rows = _parse_rss_items(
                payload,
                limit=limit,
                category=category,
                keywords=keywords,
                now_ts_ms=now_ts_ms,
            )
            if rows:
                return rows
        except Exception:
            continue
    return []


def collect_hot_news_bundle(
    *, limit_per_category: int = 6, limit_total: int = 24
) -> dict[str, Any]:
    per_cat = max(1, min(int(limit_per_category or 6), 12))
    total = max(5, min(int(limit_total or 24), 80))

    categories: dict[str, list[dict[str, Any]]] = {}
    merged: list[dict[str, Any]] = []
    seen_titles: set[str] = set()

    now_ts_ms = int(datetime.utcnow().timestamp() * 1000)

    for cfg in CATEGORY_QUERIES:
        category = str(cfg.get("category") or "").strip()
        query = str(cfg.get("query") or "").strip()
        keywords = [
            str(x or "").strip()
            for x in (cfg.get("keywords") or [])
            if str(x or "").strip()
        ]
        if not category or not query:
            continue
        rows = _fetch_category_items(
            query=query,
            category=category,
            keywords=keywords,
            limit=per_cat,
            now_ts_ms=now_ts_ms,
        )
        normalized: list[dict[str, Any]] = []
        for item in rows:
            title = _safe_text(item.get("title"), 200)
            if not title or title in seen_titles:
                continue
            seen_titles.add(title)
            normalized.append(item)
            merged.append(item)
            if len(merged) >= total:
                break
        categories[category] = normalized
        if len(merged) >= total:
            break

    commentary: list[str] = []
    for cfg in CATEGORY_QUERIES:
        category = str(cfg.get("category") or "")
        rows = categories.get(category) or []
        if not rows:
            continue
        label = CATEGORY_LABEL_ZH.get(category, category)
        picks = [_safe_text(row.get("title"), 40) for row in rows[:2]]
        picks = [p for p in picks if p]
        if not picks:
            continue
        commentary.append(f"{label}热点：{'；'.join(picks)}")

    titles: list[str] = []
    for line in commentary:
        titles.append(_safe_text(line, 120))
    for row in merged:
        label = CATEGORY_LABEL_ZH.get(str(row.get("category") or ""), "热点")
        title = _safe_text(row.get("title"), 120)
        if not title:
            continue
        titles.append(f"[{label}] {title}")
        if len(titles) >= 20:
            break

    return {
        "as_of": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "categories": categories,
        "headlines": merged[:total],
        "commentary": commentary,
        "titles": titles,
    }
