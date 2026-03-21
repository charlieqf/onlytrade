import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from scripts.topic_stream.content_factory_cards import (
    build_generated_cards,
    choose_visual_slots,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BRAND_ASSET_DIR = REPO_ROOT / "assets/content_factory/brands"


def _default_safe_text(value: Any, max_len: int = 220) -> str:
    if value is None:
        return ""
    return str(value).strip()[:max_len]


def _default_extract_summary_image(_summary_html: str, _url: str) -> str:
    return ""


def _default_extract_og_image(_url: str) -> str:
    return ""


def _default_download_image_for_item(
    _image_url: str, _image_dir: Path, _image_key: str
) -> Optional[str]:
    return None


def _default_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _absolute_local_path(value: Any, base_dir: Path) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = base_dir / candidate
    return str(candidate.resolve())


def _basename(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return Path(raw).name


def _with_visual_local_path(visual: Dict[str, Any], image_dir: Path) -> Dict[str, Any]:
    normalized = dict(visual)
    local_value = (
        normalized.get("local_path")
        or normalized.get("local_file")
        or normalized.get("image_file")
    )
    local_path = _absolute_local_path(local_value, image_dir)
    if local_path:
        normalized["local_path"] = local_path
    return normalized


def _load_brand_assets(entity_key: str, brand_asset_dir: Path) -> List[Dict[str, Any]]:
    assets: List[Dict[str, Any]] = []
    supported_exts = (".png", ".jpg", ".jpeg", ".webp")
    if not brand_asset_dir.exists():
        return assets
    for asset_path in sorted(brand_asset_dir.glob(f"{entity_key}--*")):
        if asset_path.suffix.lower() not in supported_exts or not asset_path.is_file():
            continue
        assets.append(
            {
                "type": "brand_asset",
                "local_file": str(asset_path),
                "image_file": str(asset_path),
                "score": 0.6,
            }
        )
    return assets


def _resolve_image_url(
    item: Dict[str, Any],
    safe_text: Callable[[Any, int], str],
    extract_summary_image: Callable[[str, str], str],
    extract_og_image: Callable[[str], str],
) -> str:
    return (
        safe_text(item.get("image_url"), 1200)
        or extract_summary_image(
            safe_text(item.get("summary_html"), 4000),
            safe_text(item.get("url"), 1000),
        )
        or extract_og_image(safe_text(item.get("url"), 1000))
    )


def build_topic_packages(
    selected: List[Dict[str, Any]],
    image_dir: Path,
    audio_dir: Path,
    generate_commentary_block: Callable[
        [Dict[str, Any], Dict[str, Any]], Dict[str, Any]
    ],
    synthesize_audio: Callable[[Dict[str, Any], Path], Optional[str]],
    download_image_for_item: Optional[Callable[[str, Path, str], Optional[str]]] = None,
    extract_summary_image: Optional[Callable[[str, str], str]] = None,
    extract_og_image: Optional[Callable[[str], str]] = None,
    safe_text: Optional[Callable[[Any, int], str]] = None,
    now_iso: Optional[Callable[[], str]] = None,
    brand_asset_dir: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    download_image = download_image_for_item or _default_download_image_for_item
    summary_image = extract_summary_image or _default_extract_summary_image
    og_image = extract_og_image or _default_extract_og_image
    safe_text_fn = safe_text or _default_safe_text
    now_iso_fn = now_iso or _default_now_iso
    brand_dir = brand_asset_dir or DEFAULT_BRAND_ASSET_DIR

    image_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)

    packages: List[Dict[str, Any]] = []
    for raw_item in selected:
        item = dict(raw_item)
        entity = item["entity"]
        image_key = hashlib.sha1(
            f"{entity['entity_key']}|{item.get('title', '')}|{item.get('url', '')}|{item.get('published_at', '')}".encode(
                "utf-8", errors="ignore"
            )
        ).hexdigest()[:20]
        image_url = _resolve_image_url(item, safe_text_fn, summary_image, og_image)
        image_file = (
            download_image(image_url, image_dir, image_key) if image_url else None
        )
        item["has_image"] = bool(image_file)
        if not image_file:
            continue

        generated = generate_commentary_block(entity, item)
        topic_day = (
            safe_text_fn(item.get("published_at"), 32)
            .replace(" ", "_")
            .replace(":", "-")[:16]
            or now_iso_fn()[:10]
        )
        topic_id = f"china_bigtech_{entity['entity_key']}_{topic_day}_{image_key[:6]}"
        article_image_name = _basename(image_file)
        article_image_local_path = _absolute_local_path(image_file, image_dir)
        primary_visual = {
            "type": "article_image",
            "image_url": image_url,
            "local_file": article_image_name,
            "image_file": article_image_name,
            "local_path": article_image_local_path,
            "score": 1.0,
        }
        generated_cards = build_generated_cards(
            package={
                "topic_id": topic_id,
                "title": safe_text_fn(item.get("title"), 220),
                "screen_title": generated["screen_title"],
                "summary_facts": generated["summary_facts"],
            },
            output_dir=image_dir / "generated",
        )
        selection = choose_visual_slots(
            article_images=[primary_visual],
            brand_assets=_load_brand_assets(entity["entity_key"], brand_dir),
            generated_cards=generated_cards,
        )
        visual_candidates = [
            _with_visual_local_path(visual, image_dir)
            for visual in selection["visual_candidates"]
        ]
        selected_visuals = [
            _with_visual_local_path(visual, image_dir)
            for visual in selection["selected_visuals"]
        ]
        if len(selected_visuals) != 3:
            continue
        best_visual = next(
            (
                visual
                for visual in selected_visuals
                if visual.get("type")
                in {"article_image", "brand_asset", "generated_card"}
                and (visual.get("local_file") or visual.get("image_file"))
            ),
            None,
        )
        if not best_visual:
            continue
        t019_image_file = _basename(
            best_visual.get("local_file")
            or best_visual.get("image_file")
            or best_visual.get("local_path")
        )
        t019_image_local_path = _absolute_local_path(
            best_visual.get("local_path")
            or best_visual.get("local_file")
            or best_visual.get("image_file"),
            image_dir,
        )
        package = {
            "topic_id": topic_id,
            "id": topic_id,
            "entity_key": entity["entity_key"],
            "entity_label": entity["label"],
            "category": entity.get("sector") or "tech",
            "title": safe_text_fn(item.get("title"), 220),
            "screen_title": generated["screen_title"],
            "summary_facts": generated["summary_facts"],
            "commentary_script": generated["commentary_script"],
            "screen_tags": generated["screen_tags"],
            "source": safe_text_fn(item.get("source"), 80),
            "source_url": safe_text_fn(item.get("url"), 1000),
            "published_at": safe_text_fn(item.get("published_at"), 80),
            "t019_image_file": t019_image_file,
            "t019_image_local_path": t019_image_local_path,
            "script_estimated_seconds": generated.get("script_estimated_seconds"),
            "priority_score": item.get("priority_score"),
            "topic_reason": generated["topic_reason"],
            "teaching_material": generated["commentary_script"],
            "visual_candidates": visual_candidates,
            "selected_visuals": selected_visuals,
        }
        audio_file = synthesize_audio(package, audio_dir)
        if not audio_file:
            continue
        package["audio_file"] = _basename(audio_file)
        package["audio_local_path"] = _absolute_local_path(audio_file, audio_dir)
        packages.append(package)
    return packages


def package_to_t019_row(package: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": package["topic_id"],
        "entity_key": package["entity_key"],
        "entity_label": package["entity_label"],
        "category": package["category"],
        "title": package["title"],
        "screen_title": package["screen_title"],
        "summary_facts": package["summary_facts"],
        "commentary_script": package["commentary_script"],
        "screen_tags": package["screen_tags"],
        "source": package["source"],
        "source_url": package["source_url"],
        "published_at": package["published_at"],
        "image_file": package["t019_image_file"],
        "audio_file": package["audio_file"],
        "script_estimated_seconds": package.get("script_estimated_seconds"),
        "priority_score": package.get("priority_score"),
        "topic_reason": package["topic_reason"],
    }
