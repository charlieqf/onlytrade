from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import quote_plus
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


DEFAULT_TIMEOUT_SEC = 8


CATEGORY_QUERIES = [
    ("domestic", "中国 国内 热点"),
    ("international", "国际 全球 热点"),
    ("politics", "中国 政治 时事"),
    ("military", "军事 国防 热点"),
    ("technology", "科技 AI 芯片"),
]


CATEGORY_LABEL_ZH = {
    "domestic": "国内",
    "international": "国际",
    "politics": "政经",
    "military": "军事",
    "technology": "科技",
}


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
        f"https://news.google.com/rss/search?q={q}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
        f"https://www.bing.com/news/search?q={q}&format=RSS&setlang=zh-cn",
    ]


def _parse_rss_items(xml_text: str, limit: int, category: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not xml_text:
        return out

    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return out

    items = root.findall(".//item")
    for item in items[: max(1, int(limit) * 3)]:
        title = _safe_text(item.findtext("title"), 200)
        if not title:
            continue
        link = _safe_text(item.findtext("link"), 320) or None
        pub_date = _safe_text(item.findtext("pubDate"), 64) or None
        source = _safe_text(item.findtext("source"), 80) or None

        out.append(
            {
                "title": title,
                "published_at": pub_date,
                "source": source,
                "url": link,
                "category": category,
            }
        )
        if len(out) >= max(1, int(limit)):
            break

    return out


def _fetch_category_items(
    query: str, category: str, limit: int
) -> list[dict[str, Any]]:
    for url in _rss_urls_for_query(query):
        try:
            req = Request(url, headers={"User-Agent": "onlytrade-news-bot/1.0"})
            with urlopen(req, timeout=DEFAULT_TIMEOUT_SEC) as resp:
                payload = resp.read().decode("utf-8", errors="replace")
            rows = _parse_rss_items(payload, limit=limit, category=category)
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

    for category, query in CATEGORY_QUERIES:
        rows = _fetch_category_items(query, category, per_cat)
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
    for category, _query in CATEGORY_QUERIES:
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
