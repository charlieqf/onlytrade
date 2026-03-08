#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urlencode, urljoin, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None  # type: ignore

try:
    import imageio_ffmpeg  # type: ignore
except Exception:  # pragma: no cover
    imageio_ffmpeg = None  # type: ignore


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
)
DEFAULT_TIMEOUT_SEC = 12
ROOM_ID = "t_017"
MATERIAL_SCHEMA_VERSION = "english.classroom.material.v1"
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TTS_URL = os.getenv(
    "ENGLISH_CLASSROOM_TTS_URL",
    "http://zhibo.quickdealservice.com:18000/onlytrade/api/chat/tts",
)

GOOGLE_CATEGORIES = [
    {
        "category": "world",
        "label": "World",
        "query": "latest world news events",
        "keywords": ["world", "global", "summit", "policy", "diplomacy"],
    },
    {
        "category": "technology",
        "label": "Technology",
        "query": "latest technology AI startup chip news",
        "keywords": ["ai", "technology", "chip", "startup", "software", "hardware"],
    },
    {
        "category": "business",
        "label": "Business",
        "query": "latest business economy company earnings",
        "keywords": ["business", "economy", "company", "earnings", "market"],
    },
]

GOOGLE_TOPIC_BY_CATEGORY = {
    "world": "WORLD",
    "technology": "TECHNOLOGY",
    "business": "BUSINESS",
}

SENSITIVE_TOKENS = [
    "war",
    "armed conflict",
    "airstrike",
    "missile",
    "casualties",
    "death toll",
    "graphic",
    "dismember",
    "amputation",
    "战争",
    "冲突",
    "伤亡",
    "遇难",
    "空袭",
]

FALLBACK_IMAGE_CANDIDATES = {
    "world": ["agent3.jpg", "agent4.jpg"],
    "technology": ["agent4.jpg", "agent3.jpg"],
    "business": ["host.png", "agent4.jpg"],
    "default": ["agent4.jpg", "agent3.jpg", "host.png"],
}

GENERIC_TITLE_PATTERNS = [
    r"^world news\b",
    r"^news and current affairs\b",
    r"^headlines:\s*news and events\b",
    r"^stock markets\b",
]

GENERIC_LEAD_PATTERNS = [
    r"^(hello|hi|hey)\b",
    r"^welcome\b",
    r"^good\s+(morning|afternoon|evening)\b",
    r"^today\b",
    r"^in\s+today'?s\b",
    r"^大家好",
    r"^同学们",
    r"^欢迎回来",
    r"^今天",
]

MATERIAL_SYSTEM_PROMPT = "\n".join(
    [
        "你是24x7英语口语直播课老师。",
        "你要产出三部分：屏幕标题、TTS教学讲稿、屏幕词汇。",
        '输出严格JSON: {"screen_title":"...","teaching_material":"...","screen_vocabulary":["..."]}',
        "要求：",
        "- screen_title: 1句英文，简洁有信息量，适合屏幕标题。",
        "- teaching_material: 口播教学稿，中文为主并穿插英文例句，长度约5-8句，允许自然过渡。",
        "- teaching_material风格参考课堂直播：可解释词组、可加入一段英文摘要朗读材料。",
        "- teaching_material不能只是整段英文新闻复述；必须明确包含中文讲解、词组解释或口语提示。",
        "- teaching_material至少包含1个英语例句，并且至少包含2句中文教学说明。",
        "- 禁止固定寒暄开头：不要出现Hello everyone, welcome back... / Today we have... 或 大家好，今天...。",
        "- 话题切换要像同一直播流的自然续句，不要每条新闻都重启开场。",
        '- screen_vocabulary: 4-6条，格式必须是 "English term: 中文释义"。',
        "- 不要输出markdown，不要输出JSON以外文本。",
    ]
)
MATERIAL_CACHE_VERSION = "t017_material_v2"
MATERIAL_TARGET_SECONDS = 30.0
MATERIAL_MIN_SECONDS = 24.0
MATERIAL_MAX_SECONDS = 40.0
MATERIAL_GENERATION_MAX_ATTEMPTS = 3


def _safe_text(value: Any, max_len: int = 220) -> str:
    text = str(value or "").replace("\r", " ").replace("\n", " ").replace("\t", " ")
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""
    return text[:max_len]


def _resolve_repo_path(value: Any) -> Path:
    raw = str(value or "").strip()
    p = Path(raw)
    if p.is_absolute():
        return p.resolve()
    return (REPO_ROOT / p).resolve()


def _now_iso() -> str:
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def _fetch_text(url: str, timeout_sec: int = DEFAULT_TIMEOUT_SEC) -> str:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=timeout_sec) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def _fetch_bytes(url: str, timeout_sec: int = DEFAULT_TIMEOUT_SEC) -> Tuple[bytes, str]:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=timeout_sec) as resp:
        body = resp.read()
        content_type = str(resp.headers.get("Content-Type") or "").strip().lower()
        return body, content_type


def _post_json_bytes(
    url: str,
    payload: Dict[str, Any],
    timeout_sec: int = DEFAULT_TIMEOUT_SEC,
) -> Tuple[bytes, str]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(req, timeout=timeout_sec) as resp:
        data = resp.read()
        content_type = str(resp.headers.get("Content-Type") or "").strip().lower()
        return data, content_type


def _contains_sensitive(value: str) -> bool:
    normalized = str(value or "").lower()
    if not normalized:
        return False
    return any(token in normalized for token in SENSITIVE_TOKENS)


def _is_generic_news_title(title: str) -> bool:
    safe = _safe_text(title, 220).lower()
    if not safe:
        return True
    for pattern in GENERIC_TITLE_PATTERNS:
        if re.search(pattern, safe, flags=re.IGNORECASE):
            return True
    return False


def _rss_url(query: str) -> str:
    return "https://news.google.com/rss/search?" + urlencode(
        {
            "q": query,
            "hl": "en-US",
            "gl": "US",
            "ceid": "US:en",
        }
    )


def _topic_rss_url(category: str) -> str:
    topic = GOOGLE_TOPIC_BY_CATEGORY.get(str(category or "").strip().lower(), "")
    if not topic:
        return ""
    return (
        "https://news.google.com/rss/headlines/section/topic/"
        + topic
        + "?"
        + urlencode({"hl": "en-US", "gl": "US", "ceid": "US:en"})
    )


def _parse_item_summary(description_html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", str(description_html or ""))
    text = unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return _safe_text(text, 320)


def _resolve_final_article_url(url: str) -> str:
    link = _safe_text(url, 800)
    if not link:
        return ""
    try:
        req = Request(link, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=DEFAULT_TIMEOUT_SEC) as resp:
            final_url = _safe_text(resp.geturl(), 900)
            final_link = final_url or link
            host = urlparse(final_link).netloc.lower()
            if host.endswith("news.google.com"):
                decoded = _decode_google_news_article_url(final_link)
                if decoded:
                    return decoded
                outbound = _extract_google_outbound_url(final_link)
                if outbound:
                    return outbound
            return final_link
    except Exception:
        return link


def _decode_google_news_article_url(source_url: str) -> str:
    source = _safe_text(source_url, 1200)
    if not source:
        return ""
    parsed = urlparse(source)
    host = parsed.netloc.lower()
    if not host.endswith("news.google.com"):
        return ""
    parts = [p for p in parsed.path.split("/") if p]
    try:
        idx = parts.index("articles")
    except ValueError:
        return ""
    if idx + 1 >= len(parts):
        return ""
    base64_str = _safe_text(parts[idx + 1], 600)
    if not base64_str:
        return ""

    signature = ""
    timestamp = ""
    for probe in (
        f"https://news.google.com/articles/{base64_str}",
        f"https://news.google.com/rss/articles/{base64_str}",
    ):
        try:
            html = _fetch_text(probe, timeout_sec=max(DEFAULT_TIMEOUT_SEC, 12))
        except Exception:
            continue
        sig_match = re.search(r'data-n-a-sg="([^"]+)"', html)
        ts_match = re.search(r'data-n-a-ts="([^"]+)"', html)
        if sig_match and ts_match:
            signature = _safe_text(sig_match.group(1), 400)
            timestamp = _safe_text(ts_match.group(1), 60)
            break
    if not signature or not timestamp:
        return ""

    payload = [
        "Fbv4je",
        (
            '["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,'
            'null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],'
            f'"{base64_str}",{timestamp},"{signature}"]'
        ),
    ]
    body = f"f.req={quote(json.dumps([[payload]]))}".encode("utf-8")
    req = Request(
        "https://news.google.com/_/DotsSplashUi/data/batchexecute",
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=max(DEFAULT_TIMEOUT_SEC, 15)) as resp:
            text = resp.read().decode("utf-8", errors="ignore")
    except Exception:
        return ""
    try:
        chunk = text.split("\n\n", 1)[1]
        parsed_rows = json.loads(chunk)
        if not isinstance(parsed_rows, list) or not parsed_rows:
            return ""
        decoded = json.loads(parsed_rows[0][2])[1]
        final_url = _safe_text(decoded, 1200)
        parsed_final = urlparse(final_url)
        if parsed_final.scheme in {"http", "https"} and parsed_final.netloc:
            final_host = parsed_final.netloc.lower()
            if final_host.endswith("news.google.com"):
                return ""
            return final_url
    except Exception:
        return ""
    return ""


def _extract_google_outbound_url(google_url: str) -> str:
    target = _safe_text(google_url, 900)
    if not target:
        return ""
    try:
        html = _fetch_text(target, timeout_sec=max(DEFAULT_TIMEOUT_SEC, 18))
    except Exception:
        return ""

    patterns = [
        r'data-n-a-h="(https?://[^"]+)"',
        r'"url":"(https?:\\/\\/[^\"]+)"',
        r'<a[^>]+href="(https?://[^"]+)"[^>]*>',
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, html, flags=re.IGNORECASE):
            candidate = _safe_text(match.group(1), 1400)
            if not candidate:
                continue
            candidate = candidate.replace("\\/", "/").replace("\\u0026", "&")
            parsed = urlparse(candidate)
            host = parsed.netloc.lower()
            if parsed.scheme not in {"http", "https"} or not host:
                continue
            if host.endswith("news.google.com") or host.endswith("google.com"):
                continue
            if any(
                bad in host
                for bad in (
                    "google-analytics",
                    "googletagmanager",
                    "doubleclick",
                    "gstatic",
                    "googleapis",
                )
            ):
                continue
            if host.endswith("googleusercontent.com") or host.endswith("gstatic.com"):
                continue
            if parsed.path.lower().endswith((".js", ".css", ".json", ".xml")):
                continue
            return _safe_text(candidate, 1200)
    return ""


def _extract_og_image(page_url: str) -> str:
    target = _safe_text(page_url, 900)
    if not target:
        return ""
    try:
        html = _fetch_text(target, timeout_sec=DEFAULT_TIMEOUT_SEC)
    except Exception:
        return ""
    patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:image["\']',
    ]

    candidates: List[str] = []
    for pattern in patterns:
        for match in re.finditer(pattern, html, flags=re.IGNORECASE):
            candidate = _safe_text(match.group(1), 1200)
            if candidate:
                candidates.append(candidate)

    # Google News article pages often expose thumbnail URLs as plain img links.
    for match in re.finditer(
        r'https://lh3\.googleusercontent\.com/[^"\'\s<>]+', html, flags=re.IGNORECASE
    ):
        candidate = _safe_text(match.group(0), 1400)
        if candidate:
            candidates.append(candidate)

    seen = set()
    for candidate in candidates:
        resolved = _safe_text(urljoin(target, candidate), 1200)
        if not resolved or resolved in seen:
            continue
        seen.add(resolved)
        parsed = urlparse(resolved)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            continue

        page_host = urlparse(target).netloc.lower()
        image_host = parsed.netloc.lower()
        image_path = parsed.path.lower()
        if image_host.endswith("gstatic.com"):
            continue
        if image_host.endswith("googleusercontent.com"):
            # Skip tiny icon variants but keep real thumbnails like ...=s0-w300.
            if re.search(r"=w(16|24|32|48)(?:$|[&#])", resolved, flags=re.IGNORECASE):
                continue
            if "favicon" in image_path:
                continue
            if page_host.endswith("news.google.com"):
                return resolved
        if image_host.endswith("news.google.com"):
            continue
        return resolved
    return ""


def _guess_ext(image_url: str, content_type: str) -> str:
    ctype = str(content_type or "").lower()
    if "png" in ctype:
        return ".png"
    if "webp" in ctype:
        return ".webp"
    if "jpeg" in ctype or "jpg" in ctype:
        return ".jpg"
    path = urlparse(str(image_url or "")).path.lower()
    if path.endswith(".png"):
        return ".png"
    if path.endswith(".webp"):
        return ".webp"
    return ".jpg"


def _guess_audio_ext(content_type: str) -> str:
    ctype = str(content_type or "").lower()
    if "mpeg" in ctype or "mp3" in ctype:
        return ".mp3"
    if "wav" in ctype:
        return ".wav"
    if "ogg" in ctype:
        return ".ogg"
    if "aac" in ctype:
        return ".aac"
    return ".bin"


def _ffmpeg_executable() -> str:
    if imageio_ffmpeg is None:
        return ""
    try:
        return str(imageio_ffmpeg.get_ffmpeg_exe() or "").strip()
    except Exception:
        return ""


def _convert_audio_to_mp3(source_path: Path, target_path: Path) -> bool:
    ffmpeg_bin = _ffmpeg_executable()
    if not ffmpeg_bin or not source_path.exists():
        return False
    target_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(source_path),
        "-vn",
        "-ac",
        "1",
        "-b:a",
        "48k",
        str(target_path),
    ]
    try:
        completed = subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=90,
        )
    except Exception:
        return False
    return completed.returncode == 0 and target_path.exists() and target_path.stat().st_size > 512


def _center_crop_to_portrait_9_16(raw_path: Path, out_path: Path) -> bool:
    if Image is None:
        return False
    try:
        with Image.open(raw_path) as im:
            src_w, src_h = im.size
            if src_w <= 0 or src_h <= 0:
                return False
            target_ratio = 9.0 / 16.0
            src_ratio = float(src_w) / float(src_h)
            if src_ratio > target_ratio:
                crop_h = src_h
                crop_w = int(round(crop_h * target_ratio))
                left = max(0, int((src_w - crop_w) / 2))
                top = 0
            else:
                crop_w = src_w
                crop_h = int(round(crop_w / target_ratio))
                left = 0
                top = max(0, int((src_h - crop_h) / 2))
            right = min(src_w, left + crop_w)
            bottom = min(src_h, top + crop_h)
            cropped = im.crop((left, top, right, bottom)).convert("RGB")
            resized = cropped.resize((720, 1280), Image.Resampling.LANCZOS)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            resized.save(out_path, format="JPEG", quality=88, optimize=True)
            return True
    except Exception:
        return False


def _download_image_for_item(
    image_url: str, image_dir: Path, image_key: str
) -> Optional[str]:
    target_url = _safe_text(image_url, 1200)
    if not target_url:
        return None
    parsed_input = urlparse(target_url)
    if (
        parsed_input.netloc.lower().endswith("googleusercontent.com")
        and "=" in target_url
    ):
        target_url = re.sub(r"=s0-w\d+", "=s0", target_url)
        target_url = re.sub(r"=w\d+", "=s0", target_url)
    try:
        body, ctype = _fetch_bytes(target_url)
    except Exception:
        return None
    if not body or len(body) < 1024:
        return None
    ext = _guess_ext(target_url, ctype)
    raw_path = image_dir / f"{image_key}{ext}"
    image_dir.mkdir(parents=True, exist_ok=True)
    try:
        raw_path.write_bytes(body)
    except Exception:
        return None

    if Image is not None:
        try:
            with Image.open(raw_path) as im:
                w, h = im.size
                if w < 220 or h < 120:
                    try:
                        raw_path.unlink(missing_ok=True)
                    except Exception:
                        pass
                    return None
                # Google placeholder thumbnails often arrive as small near-square images.
                if (
                    urlparse(target_url)
                    .netloc.lower()
                    .endswith("googleusercontent.com")
                    and w <= 460
                    and h <= 460
                    and abs(float(w) - float(h)) <= 40
                ):
                    try:
                        raw_path.unlink(missing_ok=True)
                    except Exception:
                        pass
                    return None
        except Exception:
            return None
    return raw_path.name


def _extract_summary_image(description_html: str, page_url: str = "") -> str:
    html = str(description_html or "")
    if not html:
        return ""
    patterns = [
        r'<img[^>]+src=["\']([^"\']+)["\']',
        r'<media:content[^>]+url=["\']([^"\']+)["\']',
        r'<media:thumbnail[^>]+url=["\']([^"\']+)["\']',
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, html, flags=re.IGNORECASE):
            candidate = _safe_text(match.group(1), 1200)
            if not candidate:
                continue
            resolved = _safe_text(urljoin(page_url or "", candidate), 1200)
            if resolved:
                return resolved
    return ""


def _build_audio_spec(row: Dict[str, Any]) -> Tuple[str, str, str]:
    script = _normalize_tts_text(_safe_text(
        row.get("teaching_material") or row.get("summary") or row.get("title"),
        2600,
    ))
    if not script:
        return "", "", ""
    row_id = _safe_text(row.get("id"), 80) or "headline"
    message_id = _safe_text(f"t017_{row_id}_{script[:48]}", 120)
    digest = hashlib.sha1(
        f"{message_id}|{script}".encode("utf-8", errors="ignore")
    ).hexdigest()[:24]
    return digest, message_id, script


def _synthesize_audio_for_item(
    row: Dict[str, Any],
    audio_dir: Path,
    tts_url: str,
    tts_timeout_sec: int,
) -> Optional[str]:
    safe_tts_url = _safe_text(tts_url, 500)
    if not safe_tts_url:
        return None
    audio_key, message_id, script = _build_audio_spec(row)
    if not audio_key or not message_id or not script:
        return None

    audio_dir.mkdir(parents=True, exist_ok=True)
    for probe_ext in (".mp3", ".wav", ".ogg", ".aac", ".bin"):
        existing = audio_dir / f"{audio_key}{probe_ext}"
        if existing.exists() and existing.is_file() and existing.stat().st_size > 1024:
            return existing.name

    try:
        body, content_type = _post_json_bytes(
            safe_tts_url,
            {
                "room_id": ROOM_ID,
                "text": script,
                "message_id": message_id,
                "tone": "energetic",
                "speaker_id": "coach_a",
            },
            timeout_sec=max(8, int(tts_timeout_sec)),
        )
    except Exception:
        return None
    if not body or len(body) < 1024:
        return None
    ext = _guess_audio_ext(content_type)
    target = audio_dir / f"{audio_key}{ext}"
    try:
        target.write_bytes(body)
    except Exception:
        return None
    mp3_target = audio_dir / f"{audio_key}.mp3"
    if ext != ".mp3" and _convert_audio_to_mp3(target, mp3_target):
        try:
            target.unlink(missing_ok=True)
        except Exception:
            pass
        return mp3_target.name
    return target.name


def _prepare_fallback_images(image_dir: Path) -> Dict[str, str]:
    image_dir.mkdir(parents=True, exist_ok=True)
    resolved: Dict[str, str] = {}

    for category, candidates in FALLBACK_IMAGE_CANDIDATES.items():
        for src_name in candidates:
            source_path = (REPO_ROOT / src_name).resolve()
            if not source_path.exists() or not source_path.is_file():
                continue
            ext = source_path.suffix.lower() or ".jpg"
            target_name = f"fallback_{category}{ext}"
            target_path = image_dir / target_name
            try:
                if (
                    not target_path.exists()
                    or target_path.stat().st_size != source_path.stat().st_size
                ):
                    target_path.write_bytes(source_path.read_bytes())
                resolved[category] = target_name
                break
            except Exception:
                continue
    return resolved


def _parse_pub_ts(pub_date: str) -> Optional[int]:
    text = _safe_text(pub_date, 80)
    if not text:
        return None
    try:
        dt = parsedate_to_datetime(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except Exception:
        return None


def _sanitize_title_text(value: Any) -> str:
    return _safe_text(value, 180)


def _sanitize_teaching_material(value: Any) -> str:
    text = str(value or "").replace("\r", " ").replace("\t", " ")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \u3000]{2,}", " ", text).strip()
    return _normalize_tts_text(text[:2200])


def _normalize_tts_text(value: Any) -> str:
    text = str(value or "")
    if not text:
        return ""
    replacements = [
        (r"\b24/7\s+Wall\s+St\.?\b", "twenty four seven Wall Street"),
        (r"\b24/7\b", "twenty four seven"),
        (r"\b24x7\b", "twenty four seven"),
        (r"\bWall\s+St\.?\b", "Wall Street"),
    ]
    out = text
    for pattern, repl in replacements:
        out = re.sub(pattern, repl, out, flags=re.IGNORECASE)
    return out


def _normalize_screen_vocabulary(value: Any) -> List[str]:
    rows: List[str] = []
    if isinstance(value, list):
        for item in value:
            text = _safe_text(item, 120)
            if text:
                rows.append(text)
    elif isinstance(value, str):
        for item in re.split(r"[\n;；]+", value):
            text = _safe_text(item, 120)
            if text:
                rows.append(text)
    out: List[str] = []
    for row in rows:
        if ":" in row:
            out.append(row)
        else:
            parts = re.split(r"\s+-\s+|\s+—\s+", row, maxsplit=1)
            if len(parts) == 2:
                out.append(f"{_safe_text(parts[0], 60)}: {_safe_text(parts[1], 60)}")
            else:
                out.append(f"{_safe_text(row, 60)}: 词汇")
        if len(out) >= 6:
            break
    return out


def _first_sentence_like(text: str) -> str:
    source = _safe_text(text, 260)
    if not source:
        return ""
    parts = re.split(r"(?<=[.!?。！？])\s+", source, maxsplit=1)
    return _safe_text(parts[0] if parts else source, 160)


def _has_generic_lead(text: str) -> bool:
    first = _first_sentence_like(text)
    if not first:
        return False
    lowered = first.lower()
    for pattern in GENERIC_LEAD_PATTERNS:
        if re.search(pattern, lowered, flags=re.IGNORECASE):
            return True
    return False


def _contains_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", str(text or "")))


def _has_teaching_signal(text: str) -> bool:
    source = str(text or "")
    if not source:
        return False
    patterns = [
        r"这里的",
        r"这个词",
        r"这个短语",
        r"意思是",
        r"可以说",
        r"比如",
        r"例如",
        r"大家注意",
        r"表达",
        r"用法",
        r"口语",
        r"在新闻里",
        r"我们可以",
    ]
    return any(re.search(pattern, source, flags=re.IGNORECASE) for pattern in patterns)


def _estimate_material_seconds(text: str) -> float:
    source = str(text or "")
    if not source:
        return 0.0
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", source))
    english_words = len(re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", source))
    pauses = len(re.findall(r"[，。！？,.!?;；:：]", source))
    seconds = (chinese_chars / 4.6) + (english_words / 2.8) + (pauses * 0.18)
    return round(seconds, 1)


def _material_user_prompt(row: Dict[str, Any], previous_title: str) -> str:
    return "\n".join(
        [
            f"room_id: {ROOM_ID}",
            f"headline: {_safe_text(row.get('title'), 180) or 'n/a'}",
            f"summary: {_safe_text(row.get('summary'), 320) or 'n/a'}",
            f"source: {_safe_text(row.get('source'), 80) or 'n/a'}",
            f"previous_headline: {_safe_text(previous_title, 180) or 'n/a'}",
            "related_news: none",
            "related_commentary: none",
            "key_points: none",
            "hard_rule: teaching_material must contain Chinese teaching explanation and cannot be only English news reading.",
            'hard_rule: include at least one explicit teaching move such as "这里的...","可以说...","这个词..." or "比如...".',
            "style_hint: smooth transition between topics, energetic classroom tone, practical spoken English training.",
        ]
    )


def _post_json(
    url: str, payload: Dict[str, Any], headers: Dict[str, str], timeout: int
) -> Dict[str, Any]:
    req = Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="ignore")
    return json.loads(raw)


def _parse_json_object_loose(text: str) -> Optional[Dict[str, Any]]:
    source = str(text or "").strip()
    if not source:
        return None
    try:
        parsed = json.loads(source)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        pass
    match = re.search(r"\{[\s\S]*\}", source)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _material_from_openai(
    row: Dict[str, Any],
    previous_title: str,
    model: str,
    api_key: str,
    base_url: str,
    timeout_sec: int,
) -> Dict[str, Any]:
    payload = {
        "model": model,
        "temperature": 0.45,
        "max_tokens": 520,
        "messages": [
            {"role": "system", "content": MATERIAL_SYSTEM_PROMPT},
            {"role": "user", "content": _material_user_prompt(row, previous_title)},
        ],
    }
    parsed = _post_json(
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
    obj = _parse_json_object_loose(str(text))
    if not obj:
        raise RuntimeError("openai_material_json_parse_failed")
    return obj


def _material_from_gemini(
    row: Dict[str, Any],
    previous_title: str,
    model_candidates: List[str],
    api_key: str,
    base_url: str,
    timeout_sec: int,
) -> Tuple[Dict[str, Any], str]:
    last_error = "gemini_no_candidate"
    user_prompt = _material_user_prompt(row, previous_title)
    for model in model_candidates:
        model_name = _safe_text(model, 80)
        if not model_name:
            continue
        url = (
            f"{base_url.rstrip('/')}/models/{model_name}:generateContent?key={api_key}"
        )
        payload = {
            "system_instruction": {"parts": [{"text": MATERIAL_SYSTEM_PROMPT}]},
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": user_prompt}],
                }
            ],
            "generationConfig": {
                "temperature": 0.45,
                "maxOutputTokens": 1200,
                "responseMimeType": "application/json",
            },
        }
        try:
            parsed = _post_json(
                url,
                payload,
                {"Content-Type": "application/json"},
                timeout_sec,
            )
            text = ""
            for cand in parsed.get("candidates") or []:
                raw_content = cand.get("content") if isinstance(cand, dict) else {}
                content = raw_content if isinstance(raw_content, dict) else {}
                for part in content.get("parts") or []:
                    t = (
                        _safe_text(part.get("text"), 5000)
                        if isinstance(part, dict)
                        else ""
                    )
                    if t:
                        text = t
                        break
                if text:
                    break
            obj = _parse_json_object_loose(text)
            if not obj:
                raise RuntimeError("gemini_material_json_parse_failed")
            return obj, model_name
        except Exception as error:
            last_error = _safe_text(str(error), 220)
            continue
    raise RuntimeError(last_error or "gemini_generate_failed")


def _fallback_material(row: Dict[str, Any]) -> Dict[str, Any]:
    title = _sanitize_title_text(
        row.get("title") or "A new global update is developing."
    )
    summary = _safe_text(row.get("summary"), 360)
    teaching = (
        f"我们继续看这条新闻：{title}。"
        + (f"它的核心信息是：{summary}。" if summary else "")
        + "这里的 main update 可以理解成这条新闻最核心的变化。"
        + '你可以先说："The main update is..."，再补一句 "It matters because..."。'
        + "如果想把表达更自然，可以再加一句原因或者影响。"
        + '比如你可以完整说："The main update is that the situation is changing fast, and it matters because people may need a different response."。'
        + "这里的 changing fast 就是在说变化很快，different response 可以理解成要换一种应对方式。"
        + "大家注意，课堂里不要只念新闻原句，而是要先讲新闻在说什么，再练一个你自己能复述出来的英语句子。"
    )
    material = _sanitize_teaching_material(teaching)
    return {
        "screen_title": _sanitize_title_text(title),
        "teaching_material": material,
        "screen_vocabulary": [
            "Main update: 主要更新",
            "It matters because: 重要原因是",
            "Changing fast: 变化很快",
            "Different response: 不同应对",
            "Cost pressure: 成本压力",
            "Supply chain: 供应链",
        ],
        "material_estimated_seconds": _estimate_material_seconds(material),
    }


def _validate_material(obj: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    title = _sanitize_title_text(obj.get("screen_title") or obj.get("title"))
    teaching = _sanitize_teaching_material(
        obj.get("teaching_material") or obj.get("script") or obj.get("text")
    )
    vocab = _normalize_screen_vocabulary(
        obj.get("screen_vocabulary") or obj.get("key_phrases") or obj.get("vocabulary")
    )
    if not title or not teaching or len(vocab) < 4:
        return None
    if _has_generic_lead(teaching):
        return None
    if not _contains_chinese(teaching):
        return None
    if not _has_teaching_signal(teaching):
        return None
    estimated_seconds = _estimate_material_seconds(teaching)
    if (
        estimated_seconds < MATERIAL_MIN_SECONDS
        or estimated_seconds > MATERIAL_MAX_SECONDS
    ):
        return None
    return {
        "screen_title": title,
        "teaching_material": teaching,
        "screen_vocabulary": vocab[:6],
        "material_estimated_seconds": estimated_seconds,
    }


def _cache_key_for_row(row: Dict[str, Any]) -> str:
    base = "|".join(
        [
            MATERIAL_CACHE_VERSION,
            _safe_text(row.get("title"), 220),
            _safe_text(row.get("summary"), 360),
            _safe_text(row.get("source"), 80),
            _safe_text(row.get("url"), 600),
        ]
    )
    return hashlib.sha1(base.encode("utf-8", errors="ignore")).hexdigest()


def _load_material_cache(cache_path: Path) -> Dict[str, Any]:
    try:
        if not cache_path.exists():
            return {}
        raw = json.loads(cache_path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def _save_material_cache(
    cache_path: Path, cache: Dict[str, Any], max_entries: int = 600
) -> None:
    if not isinstance(cache, dict):
        return
    items = list(cache.items())
    if len(items) > max_entries:
        items = items[-max_entries:]
    trimmed = {k: v for k, v in items if isinstance(k, str)}
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache_path.with_suffix(cache_path.suffix + ".tmp")
    tmp.write_text(json.dumps(trimmed, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(cache_path)


def _load_env_file(path: Path) -> int:
    if not path.exists() or not path.is_file():
        return 0
    loaded = 0
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = str(raw or "").strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env_key = _safe_text(key, 80)
        if not env_key:
            continue
        env_val = str(value or "").strip().strip('"').strip("'")
        if not os.getenv(env_key):
            os.environ[env_key] = env_val
            loaded += 1
    return loaded


def _collect_google_rows(
    limit_per_category: int, lookback_hours: int
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    lookback_ms = max(1, int(lookback_hours)) * 3600 * 1000
    for cfg in GOOGLE_CATEGORIES:
        query = _safe_text(cfg.get("query"), 180)
        if not query:
            continue
        feed_urls: List[str] = []
        topic_feed = _topic_rss_url(_safe_text(cfg.get("category"), 24))
        if topic_feed:
            feed_urls.append(topic_feed)
        feed_urls.append(_rss_url(query))

        picked = 0
        seen_titles = set()
        for feed_url in feed_urls:
            if picked >= limit_per_category:
                break
            try:
                rss = _fetch_text(feed_url, timeout_sec=DEFAULT_TIMEOUT_SEC)
                root = ET.fromstring(rss)
            except Exception:
                continue

            for item in root.findall(".//item"):
                if picked >= limit_per_category:
                    break
                title = _safe_text(item.findtext("title"), 180)
                if not title:
                    continue
                if _is_generic_news_title(title):
                    continue
                fp = re.sub(r"\s+", "", title.lower())
                if not fp or fp in seen_titles:
                    continue
                if _contains_sensitive(title):
                    continue
                link = _safe_text(item.findtext("link"), 900)
                summary = _parse_item_summary(item.findtext("description") or "")
                if _contains_sensitive(summary):
                    continue
                source = _safe_text(item.findtext("source"), 80)
                pub_date = _safe_text(item.findtext("pubDate"), 80)
                pub_ts_ms = _parse_pub_ts(pub_date)
                if pub_ts_ms is not None and (now_ms - pub_ts_ms) > lookback_ms:
                    continue
                final_url = _resolve_final_article_url(link)
                rows.append(
                    {
                        "category": _safe_text(cfg.get("category"), 24),
                        "category_label": _safe_text(cfg.get("label"), 24),
                        "query": query,
                        "title": title,
                        "summary": summary,
                        "summary_html": item.findtext("description") or "",
                        "source": source,
                        "url": final_url or link,
                        "google_link": link,
                        "published_at": pub_date,
                        "published_ts_ms": pub_ts_ms,
                    }
                )
                seen_titles.add(fp)
                picked += 1
    return rows


def _dedupe_rows(rows: List[Dict[str, Any]], limit_total: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for row in rows:
        title = _safe_text(row.get("title"), 180)
        if not title:
            continue
        fp = re.sub(r"\s+", "", title.lower())
        if not fp or fp in seen:
            continue
        seen.add(fp)
        out.append(row)
        if len(out) >= max(1, int(limit_total)):
            break
    return out


def _resolve_gemini_model_candidates(default_model: str) -> List[str]:
    raw = _safe_text(
        os.getenv(
            "ENGLISH_CLASSROOM_GEMINI_MODELS",
            f"{default_model},gemini-2.5-flash,gemini-2.0-flash",
        ),
        400,
    )
    candidates: List[str] = []
    for item in raw.split(","):
        name = _safe_text(item, 80)
        if name and name not in candidates:
            candidates.append(name)
    if default_model and default_model not in candidates:
        candidates.insert(0, default_model)
    return candidates


def _attach_materials_to_rows(
    rows: List[Dict[str, Any]],
    provider: str,
    material_max_items: int,
    material_timeout_sec: int,
    material_cache: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    safe_provider = _safe_text(provider, 24).lower() or "auto"
    openai_key = _safe_text(
        os.getenv("ENGLISH_CLASSROOM_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY"),
        240,
    )
    openai_base = (
        _safe_text(
            os.getenv("ENGLISH_CLASSROOM_OPENAI_BASE_URL")
            or os.getenv("OPENAI_BASE_URL"),
            180,
        )
        or "https://api.openai.com/v1"
    )
    openai_model = (
        _safe_text(os.getenv("ENGLISH_CLASSROOM_OPENAI_MODEL"), 80)
        or _safe_text(os.getenv("OPENAI_MODEL"), 80)
        or "gpt-4o-mini"
    )

    gemini_key = _safe_text(os.getenv("GEMINI_API_KEY"), 240)
    gemini_base = (
        _safe_text(os.getenv("GEMINI_BASE_URL"), 180)
        or "https://generativelanguage.googleapis.com/v1beta"
    )
    gemini_default_model = (
        _safe_text(os.getenv("ENGLISH_CLASSROOM_GEMINI_MODEL"), 80)
        or "gemini-3-flash-preview"
    )
    gemini_candidates = _resolve_gemini_model_candidates(gemini_default_model)

    if safe_provider == "auto":
        if gemini_key:
            provider_order = ["gemini", "openai"]
        elif openai_key:
            provider_order = ["openai"]
        else:
            provider_order = ["none"]
    elif safe_provider in {"gemini", "openai", "none"}:
        provider_order = [safe_provider]
    else:
        provider_order = ["gemini", "openai"]

    generated = 0
    cache_hits = 0
    failures = 0
    generation_attempts = 0
    invalid_generations = 0
    previous_title = ""
    out_rows: List[Dict[str, Any]] = []

    for idx, row in enumerate(rows):
        row_out = dict(row)
        cache_key = _cache_key_for_row(row_out)
        cached = material_cache.get(cache_key)
        if isinstance(cached, dict):
            valid_cached = _validate_material(cached)
            if valid_cached:
                row_out.update(valid_cached)
                row_out["material_provider"] = _safe_text(
                    cached.get("material_provider") or "cache", 24
                )
                row_out["material_model"] = _safe_text(cached.get("material_model"), 80)
                row_out["material_generated_at"] = _safe_text(
                    cached.get("material_generated_at") or _now_iso(), 40
                )
                cache_hits += 1
                previous_title = _safe_text(row_out.get("title"), 180) or previous_title
                out_rows.append(row_out)
                continue

        material_obj: Optional[Dict[str, Any]] = None
        material_provider = "fallback"
        material_model = "fallback"

        should_generate = idx < max(0, int(material_max_items))
        if should_generate:
            for candidate_provider in provider_order:
                for _attempt in range(max(1, int(MATERIAL_GENERATION_MAX_ATTEMPTS))):
                    generation_attempts += 1
                    try:
                        if candidate_provider == "gemini" and gemini_key:
                            raw_obj, used_model = _material_from_gemini(
                                row_out,
                                previous_title,
                                gemini_candidates,
                                gemini_key,
                                gemini_base,
                                material_timeout_sec,
                            )
                            valid = _validate_material(raw_obj)
                            if valid:
                                material_obj = valid
                                material_provider = "gemini"
                                material_model = used_model
                                break
                            invalid_generations += 1
                        elif candidate_provider == "openai" and openai_key:
                            raw_obj = _material_from_openai(
                                row_out,
                                previous_title,
                                openai_model,
                                openai_key,
                                openai_base,
                                material_timeout_sec,
                            )
                            valid = _validate_material(raw_obj)
                            if valid:
                                material_obj = valid
                                material_provider = "openai"
                                material_model = openai_model
                                break
                            invalid_generations += 1
                    except Exception:
                        invalid_generations += 1
                        continue
                if material_obj:
                    break

        if material_obj:
            generated += 1
        else:
            failures += 1
            material_obj = _fallback_material(row_out)

        generated_at = _now_iso()
        row_out.update(material_obj)
        row_out["material_provider"] = material_provider
        row_out["material_model"] = material_model
        row_out["material_generated_at"] = generated_at

        material_cache[cache_key] = {
            **material_obj,
            "material_provider": material_provider,
            "material_model": material_model,
            "material_generated_at": generated_at,
            "material_schema_version": MATERIAL_SCHEMA_VERSION,
        }
        previous_title = _safe_text(row_out.get("title"), 180) or previous_title
        out_rows.append(row_out)

    stats = {
        "material_provider_mode": safe_provider,
        "material_provider_order": provider_order,
        "material_generated": generated,
        "material_cache_hits": cache_hits,
        "material_failures": failures,
        "material_generation_attempts": generation_attempts,
        "material_invalid_generations": invalid_generations,
        "material_max_items": max(0, int(material_max_items)),
    }
    return out_rows, material_cache, stats


def build_payload(
    limit_total: int,
    limit_per_category: int,
    image_dir: Path,
    lookback_hours: int,
    material_provider: str,
    material_max_items: int,
    material_timeout_sec: int,
    material_cache: Dict[str, Any],
    audio_dir: Path,
    audio_tts_url: str,
    audio_timeout_sec: int,
    audio_max_items: int,
) -> Dict[str, Any]:
    fallback_images = _prepare_fallback_images(image_dir)
    rows = _collect_google_rows(
        max(1, int(limit_per_category)),
        max(1, int(lookback_hours)),
    )
    if len(rows) < 8:
        rows = _collect_google_rows(
            max(1, int(limit_per_category)),
            max(168, int(lookback_hours) * 2),
        )
    limit_total = max(1, int(limit_total))
    dedupe_pool_size = min(max(limit_total * 3, limit_total), 60)
    deduped = _dedupe_rows(rows, dedupe_pool_size)
    filtered = []

    for row in deduped:
        key_raw = (
            f"{row.get('title', '')}|{row.get('url', '')}|{row.get('published_at', '')}"
        )
        image_key = hashlib.sha1(key_raw.encode("utf-8", errors="ignore")).hexdigest()[
            :20
        ]
        image_url = (
            _extract_summary_image(
                _safe_text(row.get("summary_html"), 4000),
                _safe_text(row.get("url"), 1000),
            )
            or _extract_og_image(_safe_text(row.get("url"), 1000))
        )
        image_file = (
            _download_image_for_item(image_url, image_dir, image_key)
            if image_url
            else None
        )
        category_key = _safe_text(row.get("category"), 24).lower() or "default"
        fallback_image = fallback_images.get(category_key) or fallback_images.get(
            "default"
        )
        row_out = {
            **row,
            "id": f"gnews_{image_key}",
            "image_url": image_url,
            "image_file": image_file or fallback_image,
            "image_fit": "original",
        }
        filtered.append(row_out)

    preferred_rows = [
        row
        for row in filtered
        if not _safe_text(row.get("image_file"), 120).startswith("fallback_")
    ]
    fallback_rows = [
        row
        for row in filtered
        if _safe_text(row.get("image_file"), 120).startswith("fallback_")
    ]
    selected_rows = preferred_rows[:limit_total]

    enriched_rows, updated_cache, material_stats = _attach_materials_to_rows(
        selected_rows,
        provider=material_provider,
        material_max_items=material_max_items,
        material_timeout_sec=material_timeout_sec,
        material_cache=material_cache,
    )

    for idx, row in enumerate(enriched_rows):
        if not isinstance(row, dict):
            continue
        if idx >= max(0, int(audio_max_items)):
            break
        audio_file = _synthesize_audio_for_item(
            row,
            audio_dir=audio_dir,
            tts_url=audio_tts_url,
            tts_timeout_sec=audio_timeout_sec,
        )
        if audio_file:
            row["audio_file"] = audio_file

    categories: Dict[str, List[Dict[str, Any]]] = {}
    for row in enriched_rows:
        key = _safe_text(row.get("category"), 32).lower() or "general"
        categories.setdefault(key, []).append(row)

    titles = [
        _safe_text(row.get("title"), 120)
        for row in enriched_rows
        if _safe_text(row.get("title"), 120)
    ]
    commentary = [
        _safe_text(
            f"{_safe_text(row.get('title'), 80)} | {_safe_text(row.get('source'), 40)}",
            130,
        )
        for row in enriched_rows[:10]
    ]

    return {
        "schema_version": "english.classroom.feed.v1",
        "material_schema_version": MATERIAL_SCHEMA_VERSION,
        "room_id": ROOM_ID,
        "provider": "google_news_rss",
        "mode": "live",
        "as_of": _now_iso(),
        "lookback_hours": max(1, int(lookback_hours)),
        "headline_count": len(enriched_rows),
        "headlines": enriched_rows,
        "titles": [x for x in titles if x],
        "commentary": [x for x in commentary if x],
        "background_notes": [
            "课堂保持连续口语训练，围绕实时国际动态做素材切换。",
            "先用短句开口，再尝试一个更自然的进阶表达。",
        ],
        "categories": categories,
        "source_kind": "google_news",
        "material_stats": material_stats,
        "material_cache_size": len(updated_cache),
        "material_provider": _safe_text(material_provider, 24) or "auto",
    }


def atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _load_previous_headlines(path: Path, limit_total: int) -> List[Dict[str, Any]]:
    try:
        if not path.exists():
            return []
        prev = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(prev, dict):
        return []
    rows = prev.get("headlines")
    if not isinstance(rows, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        title = _safe_text(item.get("title"), 180)
        rid = _safe_text(item.get("id"), 80)
        if not title or not rid:
            continue
        out.append(item)
        if len(out) >= max(1, int(limit_total)):
            break
    return out


def _headline_fingerprint(row: Dict[str, Any]) -> str:
    rid = _safe_text(row.get("id"), 120)
    if rid:
        return rid
    title = _safe_text(row.get("title"), 220).lower()
    source = _safe_text(row.get("source"), 80).lower()
    if not title:
        return ""
    return f"{title}|{source}"


def _merge_latest_window(
    current_rows: List[Dict[str, Any]],
    previous_rows: List[Dict[str, Any]],
    limit_total: int,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()

    for row in current_rows:
        if not isinstance(row, dict):
            continue
        fp = _headline_fingerprint(row)
        if not fp or fp in seen:
            continue
        seen.add(fp)
        out.append(dict(row))
        if len(out) >= max(1, int(limit_total)):
            return out

    for row in previous_rows:
        if not isinstance(row, dict):
            continue
        fp = _headline_fingerprint(row)
        if not fp or fp in seen:
            continue
        seen.add(fp)
        out.append(dict(row))
        if len(out) >= max(1, int(limit_total)):
            break
    return out


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build t_017 Google News oral-English feed"
    )
    parser.add_argument(
        "--output",
        default="data/live/onlytrade/english_classroom_live.json",
        help="Output feed JSON path",
    )
    parser.add_argument(
        "--image-dir",
        default="data/live/onlytrade/english_images/t_017",
        help="Local image cache dir",
    )
    parser.add_argument("--limit-total", type=int, default=24)
    parser.add_argument("--limit-per-category", type=int, default=10)
    parser.add_argument("--lookback-hours", type=int, default=72)
    parser.add_argument(
        "--material-provider",
        default=os.getenv("ENGLISH_CLASSROOM_MATERIAL_PROVIDER", "auto"),
        help="Material provider: auto|gemini|openai|none",
    )
    parser.add_argument(
        "--material-max-items",
        type=int,
        default=int(os.getenv("ENGLISH_CLASSROOM_MATERIAL_MAX_ITEMS", "8")),
        help="Max headlines per cycle to generate materials for",
    )
    parser.add_argument(
        "--material-timeout-sec",
        type=int,
        default=int(os.getenv("ENGLISH_CLASSROOM_MATERIAL_TIMEOUT_SEC", "40")),
        help="LLM timeout seconds per generation",
    )
    parser.add_argument(
        "--material-cache",
        default=os.getenv(
            "ENGLISH_CLASSROOM_MATERIAL_CACHE",
            "data/live/onlytrade/english_classroom_material_cache.json",
        ),
        help="Material cache JSON path",
    )
    parser.add_argument(
        "--env-file",
        default=os.getenv("ENGLISH_CLASSROOM_ENV_FILE", "runtime-api/.env.local"),
        help="Optional env file path to load API keys",
    )
    parser.add_argument(
        "--audio-dir",
        default="data/live/onlytrade/english_audio/t_017",
        help="Local generated audio cache dir",
    )
    parser.add_argument(
        "--audio-tts-url",
        default=DEFAULT_TTS_URL,
        help="TTS endpoint used to pre-generate classroom audio",
    )
    parser.add_argument(
        "--audio-timeout-sec",
        type=int,
        default=int(os.getenv("ENGLISH_CLASSROOM_AUDIO_TIMEOUT_SEC", "60")),
        help="Timeout seconds for each pre-generated audio request",
    )
    parser.add_argument(
        "--audio-max-items",
        type=int,
        default=int(os.getenv("ENGLISH_CLASSROOM_AUDIO_MAX_ITEMS", "5")),
        help="Max number of leading headlines to pre-generate audio for",
    )
    args = parser.parse_args()

    output_path = _resolve_repo_path(args.output)
    image_dir = _resolve_repo_path(args.image_dir)
    audio_dir = _resolve_repo_path(args.audio_dir)
    env_file_path = _resolve_repo_path(args.env_file)
    loaded_env_count = _load_env_file(env_file_path)
    material_cache_path = _resolve_repo_path(args.material_cache)
    material_cache = _load_material_cache(material_cache_path)
    limit_total = max(4, int(args.limit_total or 24))
    payload = build_payload(
        limit_total=limit_total,
        limit_per_category=max(2, int(args.limit_per_category or 10)),
        image_dir=image_dir,
        lookback_hours=max(1, int(args.lookback_hours or 72)),
        material_provider=_safe_text(args.material_provider, 24) or "auto",
        material_max_items=max(0, int(args.material_max_items or 0)),
        material_timeout_sec=max(8, int(args.material_timeout_sec or 40)),
        material_cache=material_cache,
        audio_dir=audio_dir,
        audio_tts_url=_safe_text(args.audio_tts_url, 500),
        audio_timeout_sec=max(8, int(args.audio_timeout_sec or 60)),
        audio_max_items=max(0, int(args.audio_max_items or 0)),
    )
    previous_rows = _load_previous_headlines(output_path, limit_total)
    raw_current_rows = payload.get("headlines")
    current_rows: List[Dict[str, Any]] = []
    if isinstance(raw_current_rows, list):
        for row in raw_current_rows:
            if isinstance(row, dict):
                current_rows.append(row)
    merged_rows = _merge_latest_window(
        current_rows=current_rows,
        previous_rows=previous_rows,
        limit_total=limit_total,
    )

    if merged_rows:
        merged_rows, material_cache, merged_material_stats = _attach_materials_to_rows(
            merged_rows,
            provider=_safe_text(args.material_provider, 24) or "auto",
            material_max_items=len(merged_rows),
            material_timeout_sec=max(8, int(args.material_timeout_sec or 40)),
            material_cache=material_cache,
        )
        payload["material_stats"] = merged_material_stats
        payload["material_cache_size"] = len(material_cache)
        fixed_rows: List[Dict[str, Any]] = []
        for idx, row in enumerate(merged_rows):
            item = dict(row)
            image_file = _safe_text(item.get("image_file"), 120)
            if not image_file or image_file.startswith("fallback_"):
                continue
            if len(fixed_rows) < max(0, int(args.audio_max_items or 0)) and not _safe_text(item.get("audio_file"), 120):
                audio_file = _synthesize_audio_for_item(
                    item,
                    audio_dir=audio_dir,
                    tts_url=_safe_text(args.audio_tts_url, 500),
                    tts_timeout_sec=max(8, int(args.audio_timeout_sec or 60)),
                )
                if audio_file:
                    item["audio_file"] = audio_file
            fixed_rows.append(item)

        payload["headlines"] = fixed_rows
        payload["headline_count"] = len(fixed_rows)
        payload["titles"] = [
            _safe_text(row.get("title"), 120)
            for row in fixed_rows
            if _safe_text(row.get("title"), 120)
        ]
        payload["commentary"] = [
            _safe_text(
                f"{_safe_text(row.get('title'), 80)} | {_safe_text(row.get('source'), 40)}",
                130,
            )
            for row in fixed_rows[:10]
        ]
        restored_categories: Dict[str, List[Dict[str, Any]]] = {}
        for row in fixed_rows:
            ckey = _safe_text(row.get("category"), 32).lower() or "general"
            restored_categories.setdefault(ckey, []).append(row)
        payload["categories"] = restored_categories
        if int(payload.get("headline_count") or 0) < limit_total:
            payload["mode"] = "rolling_window_partial"
    else:
        payload["background_notes"] = [
            "当前未抓到新稿，课堂继续使用最近安全新闻练口语。",
            "课堂节奏保持连续，用短句做英文表达示范。",
        ]
        payload["mode"] = "cached"
    atomic_write_json(output_path, payload)
    _save_material_cache(material_cache_path, material_cache)
    print(
        json.dumps(
            {
                "ok": True,
                "output": str(output_path),
                "headline_count": int(payload.get("headline_count") or 0),
                "image_dir": str(image_dir),
                "audio_dir": str(audio_dir),
                "material_provider": payload.get("material_provider"),
                "material_stats": payload.get("material_stats") or {},
                "material_cache": str(material_cache_path),
                "loaded_env_count": loaded_env_count,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
