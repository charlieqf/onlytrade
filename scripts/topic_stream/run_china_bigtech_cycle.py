import argparse
import hashlib
import html
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.english import run_google_news_cycle as english  # noqa: E402
from scripts.topic_stream.china_bigtech_packages import (  # noqa: E402
    build_topic_packages,
    package_to_t019_row,
)

ROOM_ID = "t_019"
PROGRAM_SLUG = "china-bigtech"
PROGRAM_TITLE = "科技大厂每日锐评"
PROGRAM_STYLE = "sharp_commentary"
DEFAULT_CONFIG_PATH = (
    REPO_ROOT / "config/topic-stream/china_bigtech_entities.example.yaml"
)
DEFAULT_OUTPUT_PATH = (
    REPO_ROOT / "data/live/onlytrade/topic_stream/china_bigtech_live.json"
)
DEFAULT_PACKAGE_OUTPUT_PATH = (
    REPO_ROOT / "data/live/onlytrade/topic_packages/china_bigtech_packages.json"
)
DEFAULT_IMAGE_DIR = REPO_ROOT / "data/live/onlytrade/topic_images/t_019"
DEFAULT_AUDIO_DIR = REPO_ROOT / "data/live/onlytrade/topic_audio/t_019"
DEFAULT_CACHE_PATH = (
    REPO_ROOT / "data/live/onlytrade/topic_stream/china_bigtech_commentary_cache.json"
)
DEFAULT_ENV_FILE = REPO_ROOT / "runtime-api/.env.local"
DEFAULT_SELFHOSTED_TTS_URL = os.getenv(
    "TOPIC_STREAM_SELFHOSTED_TTS_URL", "http://101.227.82.130:13002/tts"
)
DEFAULT_TTS_VOICE_ID = os.getenv("TOPIC_STREAM_TTS_VOICE", "longlaotie_v3")
DEFAULT_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_QWEN_MODEL = "qwen3-max"
COMMENTARY_PROVIDER_RETRIES = 2
MEDIA_NS = {"media": "http://search.yahoo.com/mrss/"}
BLOCKED_ENTITY_KEYS = {"huawei", "aito"}
BLOCKED_TOPIC_PATTERNS = [
    r"华为",
    r"huawei",
    r"余承东",
    r"麒麟",
    r"鸿蒙",
    r"harmonyos",
    r"鸿蒙智行",
    r"问界",
    r"\baito\b",
]
DIRECT_FEED_SOURCES = [
    {"name": "ITHome", "kind": "rss", "url": "https://www.ithome.com/rss/"},
    {"name": "36Kr", "kind": "rss", "url": "https://36kr.com/feed"},
    {"name": "Leiphone", "kind": "rss", "url": "https://www.leiphone.com/feed"},
    {
        "name": "QbitAI",
        "kind": "qbitai_category",
        "url": "https://www.qbitai.com/category/%e8%b5%84%e8%ae%af",
    },
]

COMMENTARY_SYSTEM_PROMPT = "\n".join(
    [
        "你是《国内大厂每日锐评》的固定主播。",
        "节目覆盖国内科技大厂、全球科技巨头和 AI 明星公司。",
        "你要把公司新闻改写成可直接口播的中文锐评节目。",
        '输出严格JSON: {"screen_title":"...","summary_facts":"...","commentary_script":"...","screen_tags":["..."],"topic_reason":"..."}',
        "要求：",
        "- screen_title: 12-28字，像直播封面标题，短、狠、能带节奏。",
        "- summary_facts: 只写事实摘要，不夹带攻击性判断，不写未经证实的断言。",
        "- commentary_script: 60-90秒口播，风格锐利、调侃、带判断，但必须和事实分开。",
        "- commentary_script 必须包含一个后续观察钩子，例如 接下来要看 / 真正要看 / 后面要看。",
        "- screen_tags: 3-5个短标签。",
        "- 如果素材里包含传闻，必须明确写成 未证实 / 市场传闻 / 外界猜测。",
        "- 不要写成公关稿，不要平铺直叙，不要输出 JSON 以外文本。",
    ]
)


def _strip_html(text: str) -> str:
    safe = re.sub(r"<[^>]+>", " ", str(text or ""))
    return _safe_text(html.unescape(safe), 1200)


def _parse_qbitai_time(text: str, now_ts_ms: Optional[int] = None) -> Optional[int]:
    safe = _safe_text(text, 120).replace("\xa0", " ")
    if not safe:
        return None
    now = datetime.fromtimestamp((now_ts_ms or _now_ts_ms()) / 1000, tz=timezone.utc)
    if match := re.search(r"(\d+)分钟前", safe):
        minutes = max(0, int(match.group(1)))
        return int((now.timestamp() - minutes * 60) * 1000)
    if match := re.search(r"(\d+)小时前", safe):
        hours = max(0, int(match.group(1)))
        return int((now.timestamp() - hours * 3600) * 1000)
    if match := re.search(r"昨天\s*(\d{1,2}):(\d{2})", safe):
        candidate = now.replace(
            hour=int(match.group(1)),
            minute=int(match.group(2)),
            second=0,
            microsecond=0,
        )
        candidate = (
            candidate.replace(day=now.day) - english.timedelta(days=1)
            if hasattr(english, "timedelta")
            else candidate
        )
    if match := re.search(r"前天\s*(\d{1,2}):(\d{2})", safe):
        candidate = now.replace(
            hour=int(match.group(1)),
            minute=int(match.group(2)),
            second=0,
            microsecond=0,
        )
        candidate = candidate.replace(day=now.day)
        return int((candidate.timestamp() - 2 * 86400) * 1000)
    if match := re.search(r"(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?", safe):
        year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
        hour = int(match.group(4) or 0)
        minute = int(match.group(5) or 0)
        candidate = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
        return int(candidate.timestamp() * 1000)
    return None


def _collect_rows_from_qbitai_html(
    html_text: str,
    source_name: str,
    source_url: str,
    lookback_hours: int,
    now_ts_ms: Optional[int] = None,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    safe_html = str(html_text or "")
    if not safe_html:
        return rows
    now_ms = int(now_ts_ms or _now_ts_ms())
    lookback_ms = max(1, int(lookback_hours)) * 3600 * 1000
    pattern = re.compile(
        r'<a[^>]+href="(?P<url>https://www\.qbitai\.com/\d{4}/\d{2}/\d+\.html)"[^>]*>\s*'
        r'(?:<img[^>]+src="(?P<image>https?://[^"]+)"[^>]*>\s*)?</a>.*?'
        r'<h4[^>]*>\s*<a[^>]+href="(?P=url)"[^>]*>(?P<title>.*?)</a>\s*</h4>.*?'
        r"<p[^>]*>(?P<summary>.*?)</p>.*?"
        r"(?:<a[^>]*>.*?</a>\s*)?(?P<time>(?:\d+分钟前|\d+小时前|昨天\s*\d{1,2}:\d{2}|前天\s*\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?))",
        flags=re.IGNORECASE | re.DOTALL,
    )
    seen: set[str] = set()
    for match in pattern.finditer(safe_html):
        title = _strip_html(match.group("title"))
        if not title or english._contains_sensitive(title):
            continue
        title_fp = re.sub(r"\s+", "", title.lower())
        if not title_fp or title_fp in seen:
            continue
        summary = _strip_html(match.group("summary") or "")
        if english._contains_sensitive(summary):
            continue
        pub_label = _safe_text(match.group("time"), 80)
        pub_ts_ms = _parse_qbitai_time(pub_label, now_ts_ms=now_ms)
        if pub_ts_ms is not None and (now_ms - pub_ts_ms) > lookback_ms:
            continue
        rows.append(
            {
                "title": title,
                "summary": summary,
                "summary_html": summary,
                "source": _safe_text(source_name, 80),
                "url": _safe_text(match.group("url"), 1000),
                "published_at": pub_label,
                "published_ts_ms": pub_ts_ms,
                "image_url": _safe_text(match.group("image"), 1200),
                "has_image": bool(_safe_text(match.group("image"), 1200)),
                "source_url": _safe_text(source_url, 1000),
            }
        )
        seen.add(title_fp)
    return rows


def _safe_text(value: Any, max_len: int = 220) -> str:
    return english._safe_text(value, max_len)


def _now_ts_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _rss_url(query: str) -> str:
    return "https://news.google.com/rss/search?" + urlencode(
        {
            "q": query,
            "hl": "zh-CN",
            "gl": "CN",
            "ceid": "CN:zh-Hans",
        }
    )


def load_enabled_entities(config_path: Path) -> List[Dict[str, Any]]:
    raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    entities = raw.get("entities") or []
    out: List[Dict[str, Any]] = []
    for item in entities:
        if not isinstance(item, dict):
            continue
        enabled = bool(item.get("enabled", True))
        if not enabled:
            continue
        aliases_raw = item.get("aliases")
        aliases_clean: List[str] = []
        if isinstance(aliases_raw, list):
            for alias in aliases_raw:
                safe_alias = _safe_text(alias, 80)
                if safe_alias:
                    aliases_clean.append(safe_alias)
            entity_key = _safe_text(item.get("entity_key"), 64).lower()
            if entity_key in BLOCKED_ENTITY_KEYS:
                continue
            out.append(
                {
                    "entity_key": entity_key,
                    "label": _safe_text(item.get("label"), 80),
                    "aliases": aliases_clean,
                    "sector": _safe_text(item.get("sector"), 24).lower() or "tech",
                    "priority_weight": float(item.get("priority_weight") or 1.0),
                    "enabled": True,
                    "image_query": _safe_text(item.get("image_query"), 120),
                    "tone_notes": _safe_text(item.get("tone_notes"), 160),
                }
            )
    return [item for item in out if item["entity_key"] and item["label"]]


def _contains_blocked_topic_text(text: str) -> bool:
    safe = _safe_text(text, 2000).lower()
    if not safe:
        return False
    return any(
        re.search(pattern, safe, flags=re.IGNORECASE)
        for pattern in BLOCKED_TOPIC_PATTERNS
    )


def _is_blocked_topic_row(row: Dict[str, Any]) -> bool:
    if _safe_text(row.get("entity_key"), 64).lower() in BLOCKED_ENTITY_KEYS:
        return True
    haystack = " ".join(
        [
            _safe_text(row.get("title"), 400),
            _safe_text(row.get("summary"), 600),
            _safe_text(row.get("source_url"), 1000),
            _safe_text(row.get("url"), 1000),
        ]
    )
    return _contains_blocked_topic_text(haystack)


def build_entity_query(entity: Dict[str, Any]) -> str:
    aliases = entity.get("aliases") or []
    query_terms = aliases[:3] if aliases else [entity.get("label")]
    joined = " OR ".join(term for term in query_terms if term)
    if entity.get("sector") == "vehicle":
        suffix = "汽车 OR 智驾 OR 发布 OR 降价 OR 销量 when:3d"
    else:
        suffix = "AI OR 发布 OR 财报 OR 业务 OR 组织 when:3d"
    return f"({joined}) ({suffix})"


def _matches_token(text: str, token: str) -> bool:
    safe_text = _safe_text(text, 1200).lower()
    safe_token = _safe_text(token, 80).lower()
    if not safe_text or not safe_token:
        return False
    if re.search(r"[\u4e00-\u9fff]", safe_token):
        return safe_token in safe_text
    pattern = r"(?<![a-z0-9])" + re.escape(safe_token) + r"(?![a-z0-9])"
    return re.search(pattern, safe_text, flags=re.IGNORECASE) is not None


def score_candidate(
    entity: Dict[str, Any], row: Dict[str, Any], now_ts_ms: Optional[int] = None
) -> float:
    now_ms = int(now_ts_ms or _now_ts_ms())
    title = _safe_text(row.get("title"), 240).lower()
    summary = _safe_text(row.get("summary"), 360).lower()
    aliases = [str(alias).lower() for alias in entity.get("aliases") or []]
    alias_title_hits = sum(1 for alias in aliases if _matches_token(title, alias))
    alias_summary_hits = sum(1 for alias in aliases if _matches_token(summary, alias))
    pub_ts_ms = int(row.get("published_ts_ms") or 0)
    age_hours = max(0.0, (now_ms - pub_ts_ms) / 3_600_000) if pub_ts_ms else 72.0
    freshness_score = max(0.0, 42.0 - min(age_hours, 42.0))
    hot_words = [
        "发布",
        "财报",
        "ai",
        "价格战",
        "降价",
        "智驾",
        "芯片",
        "开售",
        "争议",
        "组织",
    ]
    heat_score = (
        12.0 if any(word in title or word in summary for word in hot_words) else 0.0
    )
    image_score = 10.0 if bool(row.get("has_image")) else 0.0
    return round(
        float(entity.get("priority_weight") or 1.0) * 100.0
        + alias_title_hits * 28.0
        + alias_summary_hits * 14.0
        + freshness_score
        + heat_score
        + image_score,
        2,
    )


def collect_entity_rows(
    entity: Dict[str, Any], lookback_hours: int, per_entity_limit: int
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    now_ms = _now_ts_ms()
    lookback_ms = max(1, int(lookback_hours)) * 3600 * 1000
    query = build_entity_query(entity)
    try:
        rss = english._fetch_text(
            _rss_url(query), timeout_sec=english.DEFAULT_TIMEOUT_SEC
        )
        root = ET.fromstring(rss)
    except Exception:
        return rows

    seen = set()
    for item in root.findall(".//item"):
        if len(rows) >= max(1, int(per_entity_limit)):
            break
        title = _safe_text(item.findtext("title"), 220)
        if not title:
            continue
        title_fp = re.sub(r"\s+", "", title.lower())
        if not title_fp or title_fp in seen or english._contains_sensitive(title):
            continue
        summary_html = item.findtext("description") or ""
        summary = english._parse_item_summary(summary_html)
        if english._contains_sensitive(summary):
            continue
        source = _safe_text(item.findtext("source"), 80)
        pub_date = _safe_text(item.findtext("pubDate"), 80)
        pub_ts_ms = english._parse_pub_ts(pub_date)
        if pub_ts_ms is not None and (now_ms - pub_ts_ms) > lookback_ms:
            continue
        link = _safe_text(item.findtext("link"), 1000)
        final_url = english._resolve_final_article_url(link)
        candidate = {
            "entity_key": entity["entity_key"],
            "entity_label": entity["label"],
            "category": entity.get("sector") or "tech",
            "title": title,
            "summary": summary,
            "summary_html": summary_html,
            "source": source,
            "url": final_url or link,
            "published_at": pub_date,
            "published_ts_ms": pub_ts_ms,
            "query": query,
        }
        if _is_blocked_topic_row(candidate):
            continue
        rows.append(candidate)
        seen.add(title_fp)
    return rows


def _extract_feed_item_image_url(
    item: ET.Element, description_html: str, link: str
) -> str:
    media_thumbnail = item.find("media:thumbnail", MEDIA_NS)
    if media_thumbnail is not None:
        candidate = _safe_text(media_thumbnail.attrib.get("url"), 1200)
        if candidate:
            return candidate
    media_content = item.find("media:content", MEDIA_NS)
    if media_content is not None:
        candidate = _safe_text(media_content.attrib.get("url"), 1200)
        if candidate:
            return candidate
    enclosure = item.find("enclosure")
    if enclosure is not None:
        enc_type = _safe_text(enclosure.attrib.get("type"), 80).lower()
        candidate = _safe_text(enclosure.attrib.get("url"), 1200)
        if candidate and (enc_type.startswith("image/") or not enc_type):
            return candidate
    return english._extract_summary_image(description_html, link)


def _collect_rows_from_feed_xml(
    rss_text: str, source_name: str, lookback_hours: int
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    now_ms = _now_ts_ms()
    lookback_ms = max(1, int(lookback_hours)) * 3600 * 1000
    try:
        root = ET.fromstring(rss_text)
    except Exception:
        return rows

    seen = set()
    for item in root.findall(".//item"):
        title = _safe_text(item.findtext("title"), 220)
        if not title or english._contains_sensitive(title):
            continue
        title_fp = re.sub(r"\s+", "", title.lower())
        if not title_fp or title_fp in seen:
            continue
        description_html = item.findtext("description") or ""
        summary = english._parse_item_summary(description_html)
        if english._contains_sensitive(summary):
            continue
        pub_date = _safe_text(item.findtext("pubDate"), 80)
        pub_ts_ms = english._parse_pub_ts(pub_date)
        if pub_ts_ms is not None and (now_ms - pub_ts_ms) > lookback_ms:
            continue
        link = _safe_text(item.findtext("link"), 1000)
        if not link:
            continue
        image_url = _extract_feed_item_image_url(item, description_html, link)
        rows.append(
            {
                "title": title,
                "summary": summary,
                "summary_html": description_html,
                "source": _safe_text(source_name, 80),
                "url": link,
                "published_at": pub_date,
                "published_ts_ms": pub_ts_ms,
                "image_url": image_url,
                "has_image": bool(image_url),
            }
        )
        seen.add(title_fp)
    return rows


def collect_direct_source_rows(lookback_hours: int) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    seen = set()
    for source in DIRECT_FEED_SOURCES:
        source_name = _safe_text(source.get("name"), 80)
        source_url = _safe_text(source.get("url"), 1000)
        source_kind = _safe_text(source.get("kind") or "rss", 40).lower()
        try:
            body = english._fetch_text(
                source_url, timeout_sec=english.DEFAULT_TIMEOUT_SEC
            )
        except Exception:
            continue
        if source_kind == "qbitai_category":
            source_rows = _collect_rows_from_qbitai_html(
                body,
                source_name=source_name,
                source_url=source_url,
                lookback_hours=lookback_hours,
            )
        else:
            source_rows = _collect_rows_from_feed_xml(body, source_name, lookback_hours)
        for row in source_rows:
            if _is_blocked_topic_row(row):
                continue
            key = (
                _safe_text(row.get("url"), 1000) or _safe_text(row.get("title"), 220)
            ).lower()
            if not key or key in seen:
                continue
            seen.add(key)
            rows.append(row)
    return rows


def _select_best_direct_rows(
    entities: List[Dict[str, Any]],
    source_rows: List[Dict[str, Any]],
    per_entity_limit: int,
    now_ts_ms: Optional[int] = None,
) -> List[Dict[str, Any]]:
    now_ms = int(now_ts_ms or _now_ts_ms())
    chosen: List[Dict[str, Any]] = []
    used_urls: set[str] = set()
    for entity in entities:
        aliases = [str(alias).lower() for alias in entity.get("aliases") or []]
        scored: List[Dict[str, Any]] = []
        for row in source_rows:
            if _is_blocked_topic_row(row):
                continue
            haystack = f"{_safe_text(row.get('title'), 240)} {_safe_text(row.get('summary'), 360)}"
            if not any(_matches_token(haystack, alias) for alias in aliases):
                continue
            item = dict(row)
            item["priority_score"] = score_candidate(entity, item, now_ts_ms=now_ms)
            scored.append(item)
        if not scored:
            continue
        best = None
        for candidate in sorted(
            scored,
            key=lambda item: float(item.get("priority_score") or 0.0),
            reverse=True,
        )[: max(1, int(per_entity_limit))]:
            candidate_url = _safe_text(candidate.get("url"), 1000).lower()
            if candidate_url and candidate_url in used_urls:
                continue
            best = candidate
            break
        if best is None:
            continue
        best_url = _safe_text(best.get("url"), 1000).lower()
        if best_url:
            used_urls.add(best_url)
        chosen.append({**best, "entity": entity})
    return sorted(
        chosen, key=lambda item: float(item.get("priority_score") or 0.0), reverse=True
    )


def validate_generated_block(obj: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    screen_title = _safe_text(obj.get("screen_title") or obj.get("title"), 80)
    summary_facts = _safe_text(obj.get("summary_facts") or obj.get("summary"), 500)
    commentary_script = _safe_text(
        obj.get("commentary_script") or obj.get("script"), 2200
    )
    screen_tags = [
        _safe_text(item, 48)
        for item in (obj.get("screen_tags") or [])
        if _safe_text(item, 48)
    ][:5]
    topic_reason = _safe_text(obj.get("topic_reason"), 180)
    if not screen_title or not summary_facts or not commentary_script:
        return None
    if len(screen_tags) < 3:
        return None
    if not topic_reason:
        return None
    if re.search(
        r"这条消息，把情绪直接点着了|这波动静，重点不在表面热闹", screen_title
    ):
        return None
    english_chars = sum(1 for ch in topic_reason if ch.isascii() and ch.isalpha())
    chinese_chars = sum(1 for ch in topic_reason if "\u4e00" <= ch <= "\u9fff")
    if english_chars > 12 and english_chars > chinese_chars:
        return None
    estimated_seconds = english._estimate_material_seconds(commentary_script)
    if estimated_seconds < 20 or estimated_seconds > 95:
        return None
    if not any(
        marker in commentary_script
        for marker in ["接下来", "下一步", "后面要看", "真正要看", "关键要看"]
    ):
        return None
    return {
        "screen_title": screen_title,
        "summary_facts": summary_facts,
        "commentary_script": commentary_script,
        "screen_tags": screen_tags,
        "topic_reason": topic_reason,
        "script_estimated_seconds": estimated_seconds,
    }


def _commentary_user_prompt(entity: Dict[str, Any], row: Dict[str, Any]) -> str:
    return "\n".join(
        [
            f"program: {PROGRAM_SLUG}",
            f"entity: {_safe_text(entity.get('label'), 80)}",
            f"sector: {_safe_text(entity.get('sector'), 24)}",
            f"headline: {_safe_text(row.get('title'), 220)}",
            f"summary: {_safe_text(row.get('summary'), 360)}",
            f"source: {_safe_text(row.get('source'), 80) or 'n/a'}",
            f"tone_notes: {_safe_text(entity.get('tone_notes'), 160) or '锐评、带判断、别端着'}",
            "hard_rules:",
            "- 事实和锐评要分开",
            "- 不要使用未经证实的攻击性断言",
            "- 要有一个后续观察钩子",
            "- 要像主播在说，不要像 PR 稿",
        ]
    )


def _generate_commentary_with_openai(
    entity: Dict[str, Any], row: Dict[str, Any], timeout_sec: int
) -> Optional[Dict[str, Any]]:
    api_key = _safe_text(
        os.getenv("TOPIC_STREAM_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY"), 240
    )
    if not api_key:
        return None
    base_url = (
        _safe_text(
            os.getenv("TOPIC_STREAM_OPENAI_BASE_URL") or os.getenv("OPENAI_BASE_URL"),
            200,
        )
        or "https://api.openai.com/v1"
    )
    model = (
        _safe_text(
            os.getenv("TOPIC_STREAM_OPENAI_MODEL") or os.getenv("OPENAI_MODEL"), 80
        )
        or "gpt-4o-mini"
    )
    payload = {
        "model": model,
        "temperature": 0.65,
        "max_tokens": 700,
        "messages": [
            {"role": "system", "content": COMMENTARY_SYSTEM_PROMPT},
            {"role": "user", "content": _commentary_user_prompt(entity, row)},
        ],
    }
    parsed = english._post_json(
        f"{base_url.rstrip('/')}/chat/completions",
        payload,
        {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        timeout_sec,
    )
    text = ((parsed.get("choices") or [{}])[0].get("message") or {}).get(
        "content"
    ) or ""
    obj = english._parse_json_object_loose(str(text))
    return validate_generated_block(obj or {})


def _generate_commentary_with_qwen(
    entity: Dict[str, Any], row: Dict[str, Any], timeout_sec: int
) -> Optional[Dict[str, Any]]:
    api_key = _safe_text(
        os.getenv("TOPIC_STREAM_QWEN_API_KEY")
        or os.getenv("DASHSCOPE_API_KEY")
        or os.getenv("QWEN_API_KEY"),
        240,
    )
    if not api_key:
        return None
    base_url = (
        _safe_text(
            os.getenv("TOPIC_STREAM_QWEN_BASE_URL") or os.getenv("DASHSCOPE_BASE_URL"),
            200,
        )
        or DEFAULT_QWEN_BASE_URL
    )
    model = _safe_text(os.getenv("TOPIC_STREAM_QWEN_MODEL"), 80) or DEFAULT_QWEN_MODEL
    payload = {
        "model": model,
        "temperature": 0.65,
        "max_tokens": 700,
        "messages": [
            {"role": "system", "content": COMMENTARY_SYSTEM_PROMPT},
            {"role": "user", "content": _commentary_user_prompt(entity, row)},
        ],
    }
    parsed = english._post_json(
        f"{base_url.rstrip('/')}/chat/completions",
        payload,
        {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        timeout_sec,
    )
    text = ((parsed.get("choices") or [{}])[0].get("message") or {}).get(
        "content"
    ) or ""
    obj = english._parse_json_object_loose(str(text))
    return validate_generated_block(obj or {})


def _generate_commentary_with_gemini(
    entity: Dict[str, Any], row: Dict[str, Any], timeout_sec: int
) -> Optional[Dict[str, Any]]:
    api_key = _safe_text(os.getenv("GEMINI_API_KEY"), 240)
    if not api_key:
        return None
    base_url = (
        _safe_text(os.getenv("GEMINI_BASE_URL"), 200)
        or "https://generativelanguage.googleapis.com/v1beta"
    )
    model = _safe_text(os.getenv("TOPIC_STREAM_GEMINI_MODEL"), 80) or "gemini-2.5-flash"
    url = f"{base_url.rstrip('/')}/models/{model}:generateContent?key={api_key}"
    payload = {
        "system_instruction": {"parts": [{"text": COMMENTARY_SYSTEM_PROMPT}]},
        "contents": [
            {"role": "user", "parts": [{"text": _commentary_user_prompt(entity, row)}]}
        ],
        "generationConfig": {
            "temperature": 0.65,
            "maxOutputTokens": 1200,
            "responseMimeType": "application/json",
        },
    }
    parsed = english._post_json(
        url, payload, {"Content-Type": "application/json"}, timeout_sec
    )
    text = ""
    for cand in parsed.get("candidates") or []:
        content = cand.get("content") if isinstance(cand, dict) else {}
        if not isinstance(content, dict):
            continue
        for part in content.get("parts") or []:
            if isinstance(part, dict) and _safe_text(part.get("text"), 6000):
                text = _safe_text(part.get("text"), 6000)
                break
        if text:
            break
    obj = english._parse_json_object_loose(text)
    return validate_generated_block(obj or {})


def _fallback_commentary(entity: Dict[str, Any], row: Dict[str, Any]) -> Dict[str, Any]:
    label = _safe_text(entity.get("label"), 40)
    summary = _safe_text(row.get("summary"), 260)
    title = _safe_text(row.get("title"), 80)
    script = (
        f"今天{label}这条消息，表面上看是在讲{title}。"
        f"先把事实摆清楚：{summary}。"
        f"但真正值得看的，不是单条新闻本身，而是它背后那股资源、节奏和舆论牵引力。"
        f"如果这家公司能把这波热度继续接成业务动作，故事就会越讲越大；如果只剩流量，没有兑现，反噬也会来得很快。"
        f"所以接下来要看，管理层后续动作、市场反馈和竞争对手回应，能不能把这条线继续推高。"
    )
    block = {
        "screen_title": f"{label}这波动静，重点不在表面热闹",
        "summary_facts": summary or title,
        "commentary_script": script,
        "screen_tags": [label, "Hot topic", "Strategy", "Next move"],
        "topic_reason": "fallback commentary on high-attention company update",
    }
    return validate_generated_block(block) or {
        **block,
        "script_estimated_seconds": english._estimate_material_seconds(script),
    }


def generate_commentary_block(
    entity: Dict[str, Any], row: Dict[str, Any], timeout_sec: int, provider: str
) -> Dict[str, Any]:
    provider_mode = _safe_text(provider, 24).lower() or "auto"
    providers = [provider_mode]
    if provider_mode == "auto":
        providers = ["qwen", "openai", "gemini", "fallback"]
    for name in providers:
        attempts = COMMENTARY_PROVIDER_RETRIES if name != "fallback" else 1
        for _attempt in range(attempts):
            try:
                if name == "qwen":
                    generated = _generate_commentary_with_qwen(entity, row, timeout_sec)
                elif name == "gemini":
                    generated = _generate_commentary_with_gemini(
                        entity, row, timeout_sec
                    )
                elif name == "openai":
                    generated = _generate_commentary_with_openai(
                        entity, row, timeout_sec
                    )
                else:
                    generated = _fallback_commentary(entity, row)
                if generated:
                    return generated
            except Exception:
                continue
    return _fallback_commentary(entity, row)


def build_selfhosted_tts_payload(
    text: str, voice_id: str = DEFAULT_TTS_VOICE_ID, speed: float = 1.0
) -> Dict[str, Any]:
    safe_text = _safe_text(text, 2600)
    if len(safe_text) < 10:
        safe_text = f"{safe_text}。继续关注后续变化。".strip()
    return {
        "text": safe_text,
        "text_lang": "zh",
        "prompt_lang": "zh",
        "top_k": 30,
        "top_p": 1,
        "temperature": 1,
        "text_split_method": "cut5",
        "batch_size": 32,
        "batch_threshold": 0.75,
        "split_bucket": True,
        "speed_factor": max(0.7, min(float(speed), 1.3)),
        "media_type": "wav",
        "streaming_mode": True,
        "seed": 100,
        "parallel_infer": True,
        "repetition_penalty": 1.35,
        "sample_steps": 32,
        "super_sampling": False,
        "sample_rate": 32000,
        "fragment_interval": 0.01,
        "voice_id": _safe_text(voice_id, 80) or DEFAULT_TTS_VOICE_ID,
    }


def build_runtime_tts_payload(
    room_id: str, text: str, message_id: str
) -> Dict[str, Any]:
    safe_text = _safe_text(text, 2600)
    if len(safe_text) < 10:
        safe_text = f"{safe_text}。继续关注后续变化。".strip()
    return {
        "room_id": _safe_text(room_id, 80) or ROOM_ID,
        "text": safe_text,
        "message_id": _safe_text(message_id, 120),
    }


def _build_voice_aware_audio_spec(
    row: Dict[str, Any], voice_id: str, cache_variant: str = ""
) -> tuple[str, str, str]:
    base_audio_key, base_message_id, script = english._build_audio_spec(row)
    safe_voice = _safe_text(voice_id, 80).lower() or DEFAULT_TTS_VOICE_ID
    safe_variant = _safe_text(cache_variant, 60).lower()
    if not base_audio_key or not script:
        return "", "", ""
    cache_suffix = f"|variant|{safe_variant}" if safe_variant else ""
    audio_key = hashlib.sha1(
        f"{base_audio_key}|voice|{safe_voice}{cache_suffix}".encode(
            "utf-8", errors="ignore"
        )
    ).hexdigest()[:24]
    suffix = f"_{safe_variant}" if safe_variant else ""
    message_id = (
        _safe_text(f"{base_message_id}_{safe_voice}{suffix}", 120) or base_message_id
    )
    return audio_key, message_id, script


def synthesize_audio_direct_selfhosted(
    row: Dict[str, Any], audio_dir: Path, tts_url: str, timeout_sec: int, voice_id: str
) -> Optional[str]:
    audio_key, _message_id, script = _build_voice_aware_audio_spec(row, voice_id)
    if not audio_key or not script:
        return None
    audio_dir.mkdir(parents=True, exist_ok=True)
    for probe_ext in (".mp3", ".wav", ".ogg", ".aac", ".bin"):
        existing = audio_dir / f"{audio_key}{probe_ext}"
        if existing.exists() and existing.is_file() and existing.stat().st_size > 1024:
            return existing.name
    try:
        body, content_type = english._post_json_bytes(
            _safe_text(tts_url, 500) or DEFAULT_SELFHOSTED_TTS_URL,
            build_selfhosted_tts_payload(script, voice_id=voice_id),
            timeout_sec=max(8, int(timeout_sec)),
        )
    except Exception:
        return None
    if not body or len(body) < 1024:
        return None
    ext = english._guess_audio_ext(content_type)
    target = audio_dir / f"{audio_key}{ext}"
    try:
        target.write_bytes(body)
    except Exception:
        return None
    mp3_target = audio_dir / f"{audio_key}.mp3"
    if ext != ".mp3" and english._convert_audio_to_mp3(target, mp3_target):
        try:
            target.unlink(missing_ok=True)
        except Exception:
            pass
        return mp3_target.name
    return target.name


def synthesize_audio_via_runtime_api(
    row: Dict[str, Any],
    audio_dir: Path,
    tts_url: str,
    timeout_sec: int,
    voice_id: str,
    room_id: str = ROOM_ID,
) -> Optional[str]:
    audio_key, message_id, script = _build_voice_aware_audio_spec(
        row, voice_id, cache_variant="runtime_api"
    )
    if not audio_key or not script:
        return None
    audio_dir.mkdir(parents=True, exist_ok=True)
    for probe_ext in (".mp3", ".wav", ".ogg", ".aac", ".bin"):
        existing = audio_dir / f"{audio_key}{probe_ext}"
        if existing.exists() and existing.is_file() and existing.stat().st_size > 1024:
            return existing.name
    try:
        body, content_type = english._post_json_bytes(
            _safe_text(tts_url, 500),
            build_runtime_tts_payload(room_id, script, message_id),
            timeout_sec=max(8, int(timeout_sec)),
        )
    except Exception:
        return None
    if not body or len(body) < 1024:
        return None
    ext = english._guess_audio_ext(content_type)
    target = audio_dir / f"{audio_key}{ext}"
    try:
        target.write_bytes(body)
    except Exception:
        return None
    mp3_target = audio_dir / f"{audio_key}.mp3"
    if ext != ".mp3" and english._convert_audio_to_mp3(target, mp3_target):
        try:
            target.unlink(missing_ok=True)
        except Exception:
            pass
        return mp3_target.name
    return target.name


def synthesize_audio_via_legacy_tts_api(
    row: Dict[str, Any],
    audio_dir: Path,
    tts_url: str,
    timeout_sec: int,
    room_id: str,
) -> Optional[str]:
    safe_tts_url = _safe_text(tts_url, 500)
    if not safe_tts_url:
        return None
    audio_key, message_id, script = english._build_audio_spec(row)
    if not audio_key or not message_id or not script:
        return None
    audio_dir.mkdir(parents=True, exist_ok=True)
    for probe_ext in (".mp3", ".wav", ".ogg", ".aac", ".bin"):
        existing = audio_dir / f"{audio_key}{probe_ext}"
        if existing.exists() and existing.is_file() and existing.stat().st_size > 1024:
            return existing.name
    try:
        body, content_type = english._post_json_bytes(
            safe_tts_url,
            {
                "room_id": _safe_text(room_id, 80) or ROOM_ID,
                "text": script,
                "message_id": message_id,
                "tone": "energetic",
                "speaker_id": "coach_a",
            },
            timeout_sec=max(8, int(timeout_sec)),
        )
    except Exception:
        return None
    if not body or len(body) < 1024:
        return None
    ext = english._guess_audio_ext(content_type)
    target = audio_dir / f"{audio_key}{ext}"
    try:
        target.write_bytes(body)
    except Exception:
        return None
    mp3_target = audio_dir / f"{audio_key}.mp3"
    if ext != ".mp3" and english._convert_audio_to_mp3(target, mp3_target):
        try:
            target.unlink(missing_ok=True)
        except Exception:
            pass
        return mp3_target.name
    return target.name


def choose_best_rows(
    entities: List[Dict[str, Any]], lookback_hours: int, per_entity_limit: int
) -> List[Dict[str, Any]]:
    now_ts_ms = _now_ts_ms()
    chosen: List[Dict[str, Any]] = []
    direct_rows = collect_direct_source_rows(lookback_hours)
    chosen.extend(
        _select_best_direct_rows(
            entities,
            direct_rows,
            per_entity_limit=per_entity_limit,
            now_ts_ms=now_ts_ms,
        )
    )
    already_picked = {row["entity"]["entity_key"] for row in chosen}
    for entity in entities:
        if entity["entity_key"] in already_picked:
            continue
        candidates = collect_entity_rows(entity, lookback_hours, per_entity_limit)
        if not candidates:
            continue
        scored = []
        for row in candidates:
            item = dict(row)
            item["priority_score"] = score_candidate(entity, item, now_ts_ms=now_ts_ms)
            scored.append(item)
        best = sorted(
            scored,
            key=lambda item: float(item.get("priority_score") or 0.0),
            reverse=True,
        )[0]
        chosen.append({**best, "entity": entity})
    return sorted(
        chosen, key=lambda item: float(item.get("priority_score") or 0.0), reverse=True
    )


def build_payload(
    config_path: Path,
    output_path: Path,
    package_output_path: Optional[Path],
    image_dir: Path,
    audio_dir: Path,
    limit_total: int,
    per_entity_limit: int,
    lookback_hours: int,
    provider: str,
    timeout_sec: int,
    audio_tts_url: str,
    audio_timeout_sec: int,
    audio_tts_voice: str,
) -> Dict[str, Any]:
    entities = load_enabled_entities(config_path)
    selected = choose_best_rows(entities, lookback_hours, per_entity_limit)[
        : max(1, int(limit_total))
    ]

    def _generate_package_commentary(
        entity: Dict[str, Any], item: Dict[str, Any]
    ) -> Dict[str, Any]:
        return generate_commentary_block(entity, item, timeout_sec, provider)

    def _synthesize_package_audio(
        package: Dict[str, Any], package_audio_dir: Path
    ) -> Optional[str]:
        safe_tts_url = _safe_text(audio_tts_url, 500)
        target_voice = _safe_text(audio_tts_voice, 80) or DEFAULT_TTS_VOICE_ID
        if safe_tts_url.endswith("/api/chat/tts"):
            audio_file = synthesize_audio_via_runtime_api(
                package,
                audio_dir=package_audio_dir,
                tts_url=safe_tts_url,
                timeout_sec=max(8, int(audio_timeout_sec)),
                voice_id=target_voice,
                room_id=ROOM_ID,
            )
        else:
            audio_file = synthesize_audio_direct_selfhosted(
                package,
                audio_dir=package_audio_dir,
                tts_url=safe_tts_url,
                timeout_sec=max(8, int(audio_timeout_sec)),
                voice_id=target_voice,
            )
        if not audio_file:
            audio_file = synthesize_audio_via_legacy_tts_api(
                package,
                audio_dir=package_audio_dir,
                tts_url=english.DEFAULT_TTS_URL,
                timeout_sec=max(8, int(audio_timeout_sec)),
                room_id=ROOM_ID,
            )
        return audio_file

    packages = build_topic_packages(
        selected,
        image_dir=image_dir,
        audio_dir=audio_dir,
        generate_commentary_block=_generate_package_commentary,
        synthesize_audio=_synthesize_package_audio,
        download_image_for_item=english._download_image_for_item,
        extract_summary_image=english._extract_summary_image,
        extract_og_image=english._extract_og_image,
        safe_text=english._safe_text,
        now_iso=english._now_iso,
    )
    topics: List[Dict[str, Any]] = [
        package_to_t019_row(package) for package in packages
    ]

    payload = {
        "schema_version": "topic.stream.feed.v1",
        "room_id": ROOM_ID,
        "program_slug": PROGRAM_SLUG,
        "program_title": PROGRAM_TITLE,
        "program_style": PROGRAM_STYLE,
        "as_of": english._now_iso(),
        "topic_count": len(topics),
        "topics": topics,
        "generation_stats": {
            "candidate_entities": len(entities),
            "selected_entities": len(selected),
            "released_topics": len(topics),
            "provider": _safe_text(provider, 24) or "auto",
        },
    }
    english.atomic_write_json(output_path, payload)
    if package_output_path is not None:
        english.atomic_write_json(
            package_output_path,
            {
                "schema_version": "topic.package.feed.v1",
                "room_id": ROOM_ID,
                "program_slug": PROGRAM_SLUG,
                "program_title": PROGRAM_TITLE,
                "as_of": payload["as_of"],
                "package_count": len(packages),
                "packages": packages,
            },
        )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build china-bigtech topic-stream feed"
    )
    parser.add_argument(
        "--config", default=str(DEFAULT_CONFIG_PATH), help="Entity config YAML path"
    )
    parser.add_argument(
        "--output", default=str(DEFAULT_OUTPUT_PATH), help="Output feed JSON path"
    )
    parser.add_argument(
        "--package-output",
        default=str(DEFAULT_PACKAGE_OUTPUT_PATH),
        help="Output shared package JSON path",
    )
    parser.add_argument(
        "--image-dir", default=str(DEFAULT_IMAGE_DIR), help="Image cache directory"
    )
    parser.add_argument(
        "--audio-dir", default=str(DEFAULT_AUDIO_DIR), help="Generated audio directory"
    )
    parser.add_argument("--limit-total", type=int, default=10)
    parser.add_argument("--per-entity-limit", type=int, default=4)
    parser.add_argument("--lookback-hours", type=int, default=72)
    parser.add_argument(
        "--provider", default=os.getenv("TOPIC_STREAM_COMMENTARY_PROVIDER", "auto")
    )
    parser.add_argument(
        "--timeout-sec",
        type=int,
        default=int(os.getenv("TOPIC_STREAM_TIMEOUT_SEC", "40")),
    )
    parser.add_argument(
        "--audio-tts-url",
        default=os.getenv("TOPIC_STREAM_TTS_URL", DEFAULT_SELFHOSTED_TTS_URL),
    )
    parser.add_argument(
        "--audio-tts-voice",
        default=os.getenv("TOPIC_STREAM_TTS_VOICE", DEFAULT_TTS_VOICE_ID),
    )
    parser.add_argument(
        "--audio-timeout-sec",
        type=int,
        default=int(os.getenv("TOPIC_STREAM_AUDIO_TIMEOUT_SEC", "60")),
    )
    parser.add_argument(
        "--env-file", default=str(DEFAULT_ENV_FILE), help="Optional env file path"
    )
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    output_path = Path(args.output).resolve()
    package_output_path = Path(args.package_output).resolve()
    image_dir = Path(args.image_dir).resolve()
    audio_dir = Path(args.audio_dir).resolve()
    env_file = Path(args.env_file).resolve()
    if env_file.exists():
        english._load_env_file(env_file)

    payload = build_payload(
        config_path=config_path,
        output_path=output_path,
        package_output_path=package_output_path,
        image_dir=image_dir,
        audio_dir=audio_dir,
        limit_total=max(1, int(args.limit_total)),
        per_entity_limit=max(1, int(args.per_entity_limit)),
        lookback_hours=max(1, int(args.lookback_hours)),
        provider=_safe_text(args.provider, 24) or "auto",
        timeout_sec=max(8, int(args.timeout_sec)),
        audio_tts_url=_safe_text(args.audio_tts_url, 500),
        audio_timeout_sec=max(8, int(args.audio_timeout_sec)),
        audio_tts_voice=_safe_text(args.audio_tts_voice, 80) or DEFAULT_TTS_VOICE_ID,
    )
    print(
        json.dumps(
            {
                "ok": True,
                "output": str(output_path),
                "package_output": str(package_output_path),
                "topic_count": int(payload.get("topic_count") or 0),
                "image_dir": str(image_dir),
                "audio_dir": str(audio_dir),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
