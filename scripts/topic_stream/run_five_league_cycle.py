import argparse
import hashlib
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

ROOM_ID = "t_018"
PROGRAM_SLUG = "five-league"
PROGRAM_TITLE = "五大联赛豪门每日评书"
PROGRAM_STYLE = "story_commentary"
DEFAULT_CONFIG_PATH = REPO_ROOT / "config/topic-stream/football_clubs.example.yaml"
DEFAULT_OUTPUT_PATH = (
    REPO_ROOT / "data/live/onlytrade/topic_stream/five_league_live.json"
)
DEFAULT_IMAGE_DIR = REPO_ROOT / "data/live/onlytrade/topic_images/t_018"
DEFAULT_AUDIO_DIR = REPO_ROOT / "data/live/onlytrade/topic_audio/t_018"
DEFAULT_ENV_FILE = REPO_ROOT / "runtime-api/.env.local"
DEFAULT_SELFHOSTED_TTS_URL = os.getenv(
    "TOPIC_STREAM_SELFHOSTED_TTS_URL", "http://101.227.82.130:13002/tts"
)
DEFAULT_TTS_VOICE_ID = os.getenv("TOPIC_STREAM_TTS_VOICE", "longlaotie_v3")

COMMENTARY_SYSTEM_PROMPT = "\n".join(
    [
        "你是《五大联赛豪门每日评书》的固定主播。",
        "你要把豪门俱乐部新闻改写成可直接口播的中文说书/锐评节目。",
        '输出严格JSON: {"screen_title":"...","summary_facts":"...","commentary_script":"...","screen_tags":["..."],"topic_reason":"..."}',
        "要求：",
        "- screen_title: 12-28字，要像赛后海报或豪门热搜标题。",
        "- summary_facts: 只写事实，不要把调侃混进去。",
        "- commentary_script: 60-90秒口播，要有豪门叙事感、势头感、调侃感，但不能编造比赛事实或转会结论。",
        "- commentary_script 必须包含一个后续观察钩子，例如 接下来要看 / 下一场要看 / 真正要看。",
        "- screen_tags: 3-5个短标签。",
        "- 如果素材包含传闻或转会猜测，必须明确写成 传闻 / 外界猜测 / 尚未官宣。",
        "- 不要写成比赛战报，不要输出 JSON 以外文本。",
    ]
)


def _safe_text(value: Any, max_len: int = 220) -> str:
    return english._safe_text(value, max_len)


def _now_ts_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _rss_url(query: str) -> str:
    return "https://news.google.com/rss/search?" + urlencode(
        {
            "q": query,
            "hl": "en-US",
            "gl": "US",
            "ceid": "US:en",
        }
    )


def load_enabled_entities(config_path: Path) -> List[Dict[str, Any]]:
    raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    entities = raw.get("entities") or []
    out: List[Dict[str, Any]] = []
    for item in entities:
        if not isinstance(item, dict):
            continue
        if not bool(item.get("enabled", True)):
            continue
        aliases = []
        for alias in item.get("aliases") or []:
            safe_alias = _safe_text(alias, 80)
            if safe_alias:
                aliases.append(safe_alias)
        fallback_keywords = []
        for word in item.get("fallback_keywords") or []:
            safe_word = _safe_text(word, 48)
            if safe_word:
                fallback_keywords.append(safe_word)
        out.append(
            {
                "entity_key": _safe_text(item.get("entity_key"), 64).lower(),
                "label": _safe_text(item.get("label"), 80),
                "aliases": aliases,
                "league": _safe_text(item.get("league"), 40),
                "priority_weight": float(item.get("priority_weight") or 1.0),
                "image_query": _safe_text(item.get("image_query"), 120),
                "tone_notes": _safe_text(item.get("tone_notes"), 180),
                "fallback_keywords": fallback_keywords,
            }
        )
    return [item for item in out if item["entity_key"] and item["label"]]


def build_entity_query(entity: Dict[str, Any]) -> str:
    aliases = entity.get("aliases") or []
    query_terms = aliases[:3] if aliases else [entity.get("label")]
    joined = " OR ".join(term for term in query_terms if term)
    context_words = [entity.get("league")] + list(
        entity.get("fallback_keywords") or []
    )[:3]
    context = " OR ".join(
        _safe_text(word, 40) for word in context_words if _safe_text(word, 40)
    )
    suffix = (
        "match OR transfer OR injury OR coach OR lineup OR goal OR win OR loss when:3d"
    )
    if context:
        return f"({joined}) ({context}) ({suffix})"
    return f"({joined}) ({suffix})"


def score_candidate(
    entity: Dict[str, Any], row: Dict[str, Any], now_ts_ms: Optional[int] = None
) -> float:
    now_ms = int(now_ts_ms or _now_ts_ms())
    title = _safe_text(row.get("title"), 240).lower()
    summary = _safe_text(row.get("summary"), 360).lower()
    aliases = [str(alias).lower() for alias in entity.get("aliases") or []]
    keywords = [str(word).lower() for word in entity.get("fallback_keywords") or []]
    alias_hits = sum(
        1 for alias in aliases if alias and (alias in title or alias in summary)
    )
    keyword_hits = sum(
        1 for word in keywords if word and (word in title or word in summary)
    )
    pub_ts_ms = int(row.get("published_ts_ms") or 0)
    age_hours = max(0.0, (now_ms - pub_ts_ms) / 3_600_000) if pub_ts_ms else 72.0
    freshness_score = max(0.0, 40.0 - min(age_hours, 40.0))
    hot_words = [
        "win",
        "loss",
        "draw",
        "goal",
        "transfer",
        "injury",
        "coach",
        "final",
        "derby",
        "pressure",
    ]
    heat_score = (
        12.0 if any(word in title or word in summary for word in hot_words) else 0.0
    )
    image_score = 10.0 if bool(row.get("has_image")) else 0.0
    return round(
        float(entity.get("priority_weight") or 1.0) * 100.0
        + alias_hits * 26.0
        + keyword_hits * 10.0
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
        rows.append(
            {
                "entity_key": entity["entity_key"],
                "entity_label": entity["label"],
                "category": _safe_text(entity.get("league"), 40).lower() or "football",
                "title": title,
                "summary": summary,
                "summary_html": summary_html,
                "source": source,
                "url": final_url or link,
                "published_at": pub_date,
                "published_ts_ms": pub_ts_ms,
                "query": query,
            }
        )
        seen.add(title_fp)
    return rows


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
    if len(screen_tags) < 3 or not topic_reason:
        return None
    estimated_seconds = english._estimate_material_seconds(commentary_script)
    if estimated_seconds < 20 or estimated_seconds > 95:
        return None
    if not any(
        marker in commentary_script
        for marker in ["接下来", "下一场", "后面要看", "真正要看", "关键要看"]
    ):
        return None
    dry_markers = ["比赛最终", "控球率", "射门次数"]
    dry_hits = sum(1 for marker in dry_markers if marker in commentary_script)
    if dry_hits >= 3:
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
            f"league: {_safe_text(entity.get('league'), 40)}",
            f"headline: {_safe_text(row.get('title'), 220)}",
            f"summary: {_safe_text(row.get('summary'), 360)}",
            f"source: {_safe_text(row.get('source'), 80) or 'n/a'}",
            f"tone_notes: {_safe_text(entity.get('tone_notes'), 180) or '豪门叙事、调侃、带势头'}",
            "hard_rules:",
            "- 不要把它写成比赛战报",
            "- 要有一个尖锐角度或调侃点",
            "- 如果是传闻必须写清楚未官宣",
            "- 要有一个下一场/下一步观察钩子",
            "- 要像主播在说，不要像体育记者发稿",
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


def _generate_commentary_with_gemini(
    entity: Dict[str, Any], row: Dict[str, Any], timeout_sec: int
) -> Optional[Dict[str, Any]]:
    api_key = _safe_text(os.getenv("GEMINI_API_KEY"), 240)
    if not api_key:
        return None
    model = (
        _safe_text(
            os.getenv("TOPIC_STREAM_GEMINI_MODEL") or os.getenv("GEMINI_MODEL"), 80
        )
        or "gemini-2.0-flash"
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
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
    league = _safe_text(entity.get("league"), 32)
    script = (
        f"今天{label}这条消息，表面看是在讲{title}。"
        f"先把事实摆清楚：{summary}。"
        f"但豪门新闻从来不只看表面，真正要看的是这支队伍的气势、教练压力和下一场叙事会不会继续抬头。"
        f"如果这波动静能接成连续表现，{league}这条线就会越炒越热；如果只是一天热搜，反噬和吐槽很快也会跟上。"
        f"所以接下来要看，教练调整、更衣室反应和下一场比赛走势，能不能把这股声量继续顶上去。"
    )
    block = {
        "screen_title": f"{label}这条线，热闹之外更要看后手",
        "summary_facts": summary or title,
        "commentary_script": script,
        "screen_tags": [label, league or "Football", "Momentum", "Next match"],
        "topic_reason": "fallback commentary on headline club update",
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
        providers = ["gemini", "openai", "fallback"]
    for name in providers:
        try:
            if name == "gemini":
                generated = _generate_commentary_with_gemini(entity, row, timeout_sec)
            elif name == "openai":
                generated = _generate_commentary_with_openai(entity, row, timeout_sec)
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
        safe_text = f"{safe_text}。接着看下一场走势。".strip()
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


def _build_voice_aware_audio_spec(
    row: Dict[str, Any], voice_id: str
) -> tuple[str, str, str]:
    base_audio_key, base_message_id, script = english._build_audio_spec(row)
    safe_voice = _safe_text(voice_id, 80).lower() or DEFAULT_TTS_VOICE_ID
    if not base_audio_key or not script:
        return "", "", ""
    audio_key = hashlib.sha1(
        f"{base_audio_key}|voice|{safe_voice}".encode("utf-8", errors="ignore")
    ).hexdigest()[:24]
    message_id = _safe_text(f"{base_message_id}_{safe_voice}", 120) or base_message_id
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


def choose_best_rows(
    entities: List[Dict[str, Any]], lookback_hours: int, per_entity_limit: int
) -> List[Dict[str, Any]]:
    now_ts_ms = _now_ts_ms()
    chosen: List[Dict[str, Any]] = []
    for entity in entities:
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
    english.ROOM_ID = ROOM_ID
    entities = load_enabled_entities(config_path)
    selected = choose_best_rows(entities, lookback_hours, per_entity_limit)[
        : max(1, int(limit_total))
    ]
    image_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)

    topics: List[Dict[str, Any]] = []
    for item in selected:
        entity = item["entity"]
        image_key = hashlib.sha1(
            f"{entity['entity_key']}|{item.get('title', '')}|{item.get('url', '')}|{item.get('published_at', '')}".encode(
                "utf-8", errors="ignore"
            )
        ).hexdigest()[:20]
        image_url = english._extract_summary_image(
            _safe_text(item.get("summary_html"), 4000),
            _safe_text(item.get("url"), 1000),
        ) or english._extract_og_image(_safe_text(item.get("url"), 1000))
        image_file = (
            english._download_image_for_item(image_url, image_dir, image_key)
            if image_url
            else None
        )
        item["has_image"] = bool(image_file)
        if not image_file:
            continue

        generated = generate_commentary_block(entity, item, timeout_sec, provider)
        topic_day = (
            _safe_text(item.get("published_at"), 32)
            .replace(" ", "_")
            .replace(":", "-")[:16]
            or english._now_iso()[:10]
        )
        topic_id = f"five_league_{entity['entity_key']}_{topic_day}_{image_key[:6]}"
        row = {
            "id": topic_id,
            "entity_key": entity["entity_key"],
            "entity_label": entity["label"],
            "category": _safe_text(entity.get("league"), 40).lower() or "football",
            "title": _safe_text(item.get("title"), 220),
            "screen_title": generated["screen_title"],
            "summary_facts": generated["summary_facts"],
            "commentary_script": generated["commentary_script"],
            "screen_tags": generated["screen_tags"],
            "source": _safe_text(item.get("source"), 80),
            "source_url": _safe_text(item.get("url"), 1000),
            "published_at": _safe_text(item.get("published_at"), 80),
            "image_file": image_file,
            "script_estimated_seconds": generated.get("script_estimated_seconds"),
            "priority_score": item.get("priority_score"),
            "topic_reason": generated["topic_reason"],
            "teaching_material": generated["commentary_script"],
        }
        audio_file = synthesize_audio_direct_selfhosted(
            row,
            audio_dir=audio_dir,
            tts_url=_safe_text(audio_tts_url, 500),
            timeout_sec=max(8, int(audio_timeout_sec)),
            voice_id=_safe_text(audio_tts_voice, 80) or DEFAULT_TTS_VOICE_ID,
        )
        if not audio_file:
            audio_file = english._synthesize_audio_for_item(
                row,
                audio_dir=audio_dir,
                tts_url=english.DEFAULT_TTS_URL,
                tts_timeout_sec=max(8, int(audio_timeout_sec)),
            )
        if not audio_file:
            continue
        row["audio_file"] = audio_file
        row.pop("teaching_material", None)
        topics.append(row)

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
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build five-league topic-stream feed")
    parser.add_argument(
        "--config", default=str(DEFAULT_CONFIG_PATH), help="Entity config YAML path"
    )
    parser.add_argument(
        "--output", default=str(DEFAULT_OUTPUT_PATH), help="Output feed JSON path"
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
        default=os.getenv("TOPIC_STREAM_TTS_URL", english.DEFAULT_TTS_URL),
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
    image_dir = Path(args.image_dir).resolve()
    audio_dir = Path(args.audio_dir).resolve()
    env_file = Path(args.env_file).resolve()
    if env_file.exists():
        english._load_env_file(env_file)

    payload = build_payload(
        config_path=config_path,
        output_path=output_path,
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
                "topic_count": int(payload.get("topic_count") or 0),
                "image_dir": str(image_dir),
                "audio_dir": str(audio_dir),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
