#!/usr/bin/env python3
import argparse
import json
import math
import os
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus, urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


DEFAULT_TIMEOUT_SEC = 12
DEFAULT_PROVIDER = "auto"

DEFAULT_NITTER_BASES = [
    "https://nitter.net",
    "https://nitter.poast.org",
    "https://nitter.privacydev.net",
]

DEFAULT_CATEGORY_QUERIES = [
    {
        "category": "ai",
        "label": "X-AI",
        "query": "AI OpenAI Anthropic NVIDIA LLM",
        "keywords": ["ai", "openai", "anthropic", "nvidia", "llm", "模型", "算力"],
    },
    {
        "category": "geopolitics",
        "label": "X-地缘",
        "query": "geopolitics US China Ukraine Russia Middle East",
        "keywords": [
            "geopolitics",
            "ukraine",
            "russia",
            "china",
            "us",
            "middle east",
            "地缘",
            "中东",
            "俄乌",
        ],
    },
    {
        "category": "global_macro",
        "label": "X-宏观",
        "query": "fed inflation rates jobs treasury recession",
        "keywords": [
            "fed",
            "inflation",
            "rates",
            "jobs",
            "treasury",
            "macro",
            "通胀",
            "利率",
            "美联储",
        ],
    },
    {
        "category": "markets_cn",
        "label": "X-市场",
        "query": "A股 港股 美股 指数 盘前 盘后 热点",
        "keywords": ["a股", "港股", "美股", "指数", "盘前", "盘后", "市场", "热点"],
    },
]


def _safe_text(value: Any, max_len: int = 220) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text[:max_len]


def _shanghai_day_key(ts_ms: int) -> str:
    tz = timezone(timedelta(hours=8))
    return datetime.fromtimestamp(ts_ms / 1000, tz=tz).strftime("%Y-%m-%d")


def _parse_iso_ts_ms(value: str) -> Optional[int]:
    text = _safe_text(value, 80)
    if not text:
        return None
    try:
        normalized = text.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except Exception:
        return None


def _parse_rss_pub_ts_ms(value: str) -> Optional[int]:
    text = _safe_text(value, 120)
    if not text:
        return None
    try:
        dt = parsedate_to_datetime(text)
        if dt.tzinfo is None:
            return None
        return int(dt.timestamp() * 1000)
    except Exception:
        return None


def _http_get(
    url: str, timeout_sec: int, headers: Optional[Dict[str, str]] = None
) -> str:
    req = Request(url, headers=headers or {"User-Agent": "onlytrade-x-hot-news/1.0"})
    with urlopen(req, timeout=max(3, int(timeout_sec))) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _keyword_score(text: str, keywords: List[str]) -> int:
    lower = str(text or "").lower()
    score = 0
    for kw in keywords:
        token = str(kw or "").strip().lower()
        if token and token in lower:
            score += 1
    return score


def _score_row(
    title: str,
    keywords: List[str],
    published_ts_ms: Optional[int],
    now_ts_ms: int,
    engagement: float = 0.0,
) -> float:
    score = float(_keyword_score(title, keywords))
    if published_ts_ms and published_ts_ms > 0:
        age_hours = max(0.0, (now_ts_ms - published_ts_ms) / 3_600_000.0)
        if age_hours <= 2:
            score += 3.0
        elif age_hours <= 6:
            score += 2.0
        elif age_hours <= 12:
            score += 1.0
    if engagement > 0:
        score += min(3.5, math.log1p(engagement) / 3.0)
    return round(score, 4)


def _collect_category_from_nitter(
    query: str,
    category: str,
    label: str,
    keywords: List[str],
    now_ts_ms: int,
    lookback_hours: int,
    timeout_sec: int,
    nitter_bases: List[str],
    limit: int,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    max_age_ms = max(1, int(lookback_hours)) * 3_600_000
    for base in nitter_bases:
        url = f"{base.rstrip('/')}/search/rss?f=tweets&q={quote_plus(query)}"
        try:
            xml_text = _http_get(url, timeout_sec)
            root = ET.fromstring(xml_text)
            rows: List[Dict[str, Any]] = []
            for item in root.findall(".//item"):
                title_raw = _safe_text(item.findtext("title"), 320)
                desc_raw = _safe_text(item.findtext("description"), 320)
                title = title_raw or desc_raw
                if not title:
                    continue
                pub_raw = _safe_text(item.findtext("pubDate"), 120)
                pub_ts_ms = _parse_rss_pub_ts_ms(pub_raw)
                if pub_ts_ms and now_ts_ms - pub_ts_ms > max_age_ms:
                    continue
                link = _safe_text(item.findtext("link"), 400) or None
                author = ""
                if ":" in title:
                    author = _safe_text(title.split(":", 1)[0], 80)
                score = _score_row(
                    title, keywords, pub_ts_ms, now_ts_ms, engagement=0.0
                )
                rows.append(
                    {
                        "title": title,
                        "published_at": pub_raw or None,
                        "published_ts_ms": pub_ts_ms,
                        "source": "x.com/nitter-rss",
                        "url": link,
                        "author": author or None,
                        "category": category,
                        "category_label": label,
                        "score": score,
                    }
                )
            rows.sort(
                key=lambda r: (
                    float(r.get("score") or 0),
                    int(r.get("published_ts_ms") or 0),
                ),
                reverse=True,
            )
            return rows[: max(1, int(limit))], url
        except Exception:
            continue
    return [], None


def _collect_category_from_x_api(
    query: str,
    category: str,
    label: str,
    keywords: List[str],
    now_ts_ms: int,
    lookback_hours: int,
    timeout_sec: int,
    bearer_token: str,
    limit: int,
) -> List[Dict[str, Any]]:
    max_age_ms = max(1, int(lookback_hours)) * 3_600_000
    query_text = f"({query}) -is:retweet -is:reply"
    params = {
        "query": query_text,
        "max_results": str(max(10, min(100, int(limit) * 2))),
        "tweet.fields": "created_at,public_metrics,lang",
        "expansions": "author_id",
        "user.fields": "name,username,verified",
    }
    url = f"https://api.x.com/2/tweets/search/recent?{urlencode(params)}"
    req = Request(
        url,
        headers={
            "Authorization": f"Bearer {bearer_token}",
            "User-Agent": "onlytrade-x-hot-news/1.0",
        },
    )
    with urlopen(req, timeout=max(3, int(timeout_sec))) as resp:
        payload = json.loads(resp.read().decode("utf-8", errors="replace"))

    users: Dict[str, Dict[str, Any]] = {}
    includes = payload.get("includes") or {}
    for row in includes.get("users") or []:
        uid = str(row.get("id") or "").strip()
        if uid:
            users[uid] = row

    rows: List[Dict[str, Any]] = []
    for tweet in payload.get("data") or []:
        text = _safe_text(tweet.get("text"), 320)
        if not text:
            continue
        pub_raw = _safe_text(tweet.get("created_at"), 80)
        pub_ts_ms = _parse_iso_ts_ms(pub_raw)
        if pub_ts_ms and now_ts_ms - pub_ts_ms > max_age_ms:
            continue
        metrics = tweet.get("public_metrics") or {}
        engagement = (
            float(metrics.get("like_count") or 0)
            + float(metrics.get("retweet_count") or 0) * 1.5
            + float(metrics.get("quote_count") or 0) * 1.2
            + float(metrics.get("reply_count") or 0)
        )
        uid = str(tweet.get("author_id") or "").strip()
        user = users.get(uid) or {}
        username = _safe_text(user.get("username"), 64)
        author_name = _safe_text(user.get("name"), 80)
        tweet_id = _safe_text(tweet.get("id"), 64)
        tweet_url = (
            f"https://x.com/{username}/status/{tweet_id}"
            if username and tweet_id
            else None
        )
        score = _score_row(text, keywords, pub_ts_ms, now_ts_ms, engagement=engagement)
        rows.append(
            {
                "title": text,
                "published_at": pub_raw or None,
                "published_ts_ms": pub_ts_ms,
                "source": "x.com/api-v2",
                "url": tweet_url,
                "author": author_name or username or None,
                "category": category,
                "category_label": label,
                "score": score,
                "engagement": round(engagement, 2),
            }
        )

    rows.sort(
        key=lambda r: (float(r.get("score") or 0), int(r.get("published_ts_ms") or 0)),
        reverse=True,
    )
    return rows[: max(1, int(limit))]


def _atomic_write_json(path: str, payload: Dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(target)


def _normalize_query_list(value: str) -> List[Dict[str, Any]]:
    text = _safe_text(value, 4000)
    if not text:
        return DEFAULT_CATEGORY_QUERIES
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list) and parsed:
            out: List[Dict[str, Any]] = []
            for row in parsed:
                if not isinstance(row, dict):
                    continue
                category = _safe_text(row.get("category"), 32).lower()
                query = _safe_text(row.get("query"), 180)
                if not category or not query:
                    continue
                label = _safe_text(row.get("label"), 32) or f"X-{category}"
                keywords = [
                    _safe_text(k, 40).lower()
                    for k in (row.get("keywords") or [])
                    if _safe_text(k, 40)
                ]
                out.append(
                    {
                        "category": category,
                        "label": label,
                        "query": query,
                        "keywords": keywords,
                    }
                )
            if out:
                return out
    except Exception:
        pass
    return DEFAULT_CATEGORY_QUERIES


def collect_x_hot_events(
    output_path: str,
    provider: str,
    limit_total: int,
    limit_per_category: int,
    lookback_hours: int,
    timeout_sec: int,
    nitter_bases: List[str],
    bearer_token: str,
    query_list: List[Dict[str, Any]],
) -> Dict[str, Any]:
    now_ts_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    per_cat_limit = max(1, min(int(limit_per_category), 20))
    total_limit = max(5, min(int(limit_total), 120))
    mode = provider.strip().lower() if provider else DEFAULT_PROVIDER

    categories: Dict[str, List[Dict[str, Any]]] = {}
    provider_hits: List[str] = []
    merged: List[Dict[str, Any]] = []
    seen_titles = set()

    for cfg in query_list:
        category = _safe_text(cfg.get("category"), 32).lower()
        label = _safe_text(cfg.get("label"), 32) or f"X-{category}"
        query = _safe_text(cfg.get("query"), 220)
        keywords = [
            str(k).lower() for k in (cfg.get("keywords") or []) if _safe_text(k, 40)
        ]
        if not category or not query:
            continue

        rows: List[Dict[str, Any]] = []
        source_note = ""
        if mode in ("auto", "x_api") and bearer_token:
            try:
                rows = _collect_category_from_x_api(
                    query=query,
                    category=category,
                    label=label,
                    keywords=keywords,
                    now_ts_ms=now_ts_ms,
                    lookback_hours=lookback_hours,
                    timeout_sec=timeout_sec,
                    bearer_token=bearer_token,
                    limit=per_cat_limit,
                )
                if rows:
                    source_note = "x_api"
            except Exception:
                rows = []

        if not rows and mode in ("auto", "nitter_rss"):
            rows, used_url = _collect_category_from_nitter(
                query=query,
                category=category,
                label=label,
                keywords=keywords,
                now_ts_ms=now_ts_ms,
                lookback_hours=lookback_hours,
                timeout_sec=timeout_sec,
                nitter_bases=nitter_bases,
                limit=per_cat_limit,
            )
            if rows:
                source_note = used_url or "nitter_rss"

        if source_note:
            provider_hits.append(source_note)

        categories[category] = rows
        for row in rows:
            title = _safe_text(row.get("title"), 220)
            if not title:
                continue
            key = title.lower()
            if key in seen_titles:
                continue
            seen_titles.add(key)
            merged.append(row)
            if len(merged) >= total_limit:
                break
        if len(merged) >= total_limit:
            break

    merged.sort(
        key=lambda r: (float(r.get("score") or 0), int(r.get("published_ts_ms") or 0)),
        reverse=True,
    )
    merged = merged[:total_limit]

    commentary: List[str] = []
    for cfg in query_list:
        category = _safe_text(cfg.get("category"), 32).lower()
        label = _safe_text(cfg.get("label"), 32) or f"X-{category}"
        rows = categories.get(category) or []
        picks = [
            _safe_text(row.get("title"), 46)
            for row in rows[:2]
            if _safe_text(row.get("title"), 46)
        ]
        if picks:
            commentary.append(f"{label}热点：{'；'.join(picks)}")

    titles: List[str] = []
    for line in commentary:
        titles.append(_safe_text(line, 120))
    for row in merged:
        label = (
            _safe_text(row.get("category_label"), 24)
            or f"X-{_safe_text(row.get('category'), 16)}"
        )
        title = _safe_text(row.get("title"), 120)
        if not title:
            continue
        titles.append(f"[{label}] {title}")
        if len(titles) >= 24:
            break

    source_kind = "empty"
    if any("x_api" in hit for hit in provider_hits):
        source_kind = (
            "x_api_plus_rss"
            if any("nitter" in hit for hit in provider_hits)
            else "x_api"
        )
    elif provider_hits:
        source_kind = "nitter_rss"

    payload = {
        "schema_version": "x.hot.events.v1",
        "provider": "x.com",
        "source_kind": source_kind,
        "as_of": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "as_of_ts_ms": now_ts_ms,
        "day_key": _shanghai_day_key(now_ts_ms),
        "headline_count": len(merged),
        "headlines": merged,
        "categories": categories,
        "commentary": commentary,
        "titles": titles,
    }
    _atomic_write_json(output_path, payload)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/live/onlytrade/x_hot_events.json")
    parser.add_argument(
        "--provider", default=DEFAULT_PROVIDER, choices=["auto", "x_api", "nitter_rss"]
    )
    parser.add_argument("--limit-total", type=int, default=36)
    parser.add_argument("--limit-per-category", type=int, default=10)
    parser.add_argument("--lookback-hours", type=int, default=24)
    parser.add_argument("--timeout-sec", type=int, default=DEFAULT_TIMEOUT_SEC)
    parser.add_argument("--nitter-bases", default="")
    parser.add_argument(
        "--query-json", default=os.environ.get("X_COLLECTOR_QUERY_JSON", "")
    )
    parser.add_argument("--bearer-token", default=os.environ.get("X_BEARER_TOKEN", ""))
    args = parser.parse_args()

    query_list = _normalize_query_list(args.query_json)
    if args.nitter_bases.strip():
        nitter_bases = [
            item.strip() for item in args.nitter_bases.split(",") if item.strip()
        ]
    else:
        nitter_bases = DEFAULT_NITTER_BASES

    payload = collect_x_hot_events(
        output_path=args.output,
        provider=args.provider,
        limit_total=args.limit_total,
        limit_per_category=args.limit_per_category,
        lookback_hours=args.lookback_hours,
        timeout_sec=args.timeout_sec,
        nitter_bases=nitter_bases,
        bearer_token=args.bearer_token,
        query_list=query_list,
    )
    print(
        json.dumps(
            {
                "ok": True,
                "output_path": args.output,
                "headline_count": int(payload.get("headline_count") or 0),
                "source_kind": payload.get("source_kind") or "empty",
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
