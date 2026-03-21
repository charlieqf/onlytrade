from __future__ import annotations

import html
from pathlib import Path
from typing import Any, Dict, List


VISUAL_BUCKET_PRECEDENCE = {
    "article_image": 0,
    "brand_asset": 1,
    "generated_card": 2,
}


def _visual_score(visual: Dict[str, Any]) -> float:
    try:
        return float(visual.get("score") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _visual_precedence(visual: Dict[str, Any]) -> int:
    return VISUAL_BUCKET_PRECEDENCE.get(str(visual.get("type") or ""), 99)


def _normalize_visual(visual: Dict[str, Any], visual_type: str) -> Dict[str, Any]:
    normalized = dict(visual)
    normalized["type"] = normalized.get("type") or visual_type
    local_file = str(normalized.get("local_file") or normalized.get("image_file") or "")
    if local_file:
        normalized["local_file"] = local_file
        normalized["image_file"] = normalized.get("image_file") or local_file
    return normalized


def _dedupe_visuals(visuals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduped: List[Dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for visual in visuals:
        key = (
            str(visual.get("type") or ""),
            str(visual.get("local_file") or visual.get("image_file") or ""),
            str(visual.get("card_kind") or ""),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(visual)
    return deduped


def build_generated_cards(
    package: Dict[str, Any], output_dir: Path
) -> List[Dict[str, Any]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    topic_id = str(package.get("topic_id") or package.get("id") or "topic")
    title = html.escape(
        str(package.get("screen_title") or package.get("title") or "Topic")
    )
    summary = html.escape(
        str(package.get("summary_facts") or package.get("summary") or "")
    )
    card_specs = [
        ("title", "Content Factory", title),
        ("summary", "Key Takeaway", summary or title),
        ("close", "Watch Next", "Track the next signal."),
    ]
    cards: List[Dict[str, Any]] = []
    for index, (card_kind, eyebrow, body) in enumerate(card_specs, start=1):
        file_path = output_dir / f"{topic_id}--{index:02d}-{card_kind}.svg"
        svg = "".join(
            [
                '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">',
                '<rect width="1080" height="1920" fill="#0f172a" />',
                '<rect x="72" y="72" width="936" height="1776" rx="48" fill="#111827" stroke="#38bdf8" stroke-width="6" />',
                f'<text x="120" y="220" fill="#38bdf8" font-size="44" font-family="Arial, sans-serif">{html.escape(eyebrow)}</text>',
                f'<text x="120" y="380" fill="#f8fafc" font-size="78" font-family="Arial, sans-serif">{title[:80]}</text>',
                f'<text x="120" y="560" fill="#cbd5e1" font-size="46" font-family="Arial, sans-serif">{body[:180]}</text>',
                "</svg>",
            ]
        )
        file_path.write_text(svg, encoding="utf-8")
        cards.append(
            {
                "type": "generated_card",
                "card_kind": card_kind,
                "local_file": str(file_path),
                "image_file": str(file_path),
                "score": round(0.3 - (index * 0.01), 2),
            }
        )
    return cards


def choose_visual_slots(
    article_images: List[Dict[str, Any]],
    brand_assets: List[Dict[str, Any]],
    generated_cards: List[Dict[str, Any]],
) -> Dict[str, List[Dict[str, Any]]]:
    candidates = (
        [_normalize_visual(visual, "article_image") for visual in article_images]
        + [_normalize_visual(visual, "brand_asset") for visual in brand_assets]
        + [_normalize_visual(visual, "generated_card") for visual in generated_cards]
    )
    ordered_candidates = _dedupe_visuals(
        sorted(
            candidates,
            key=lambda visual: (_visual_precedence(visual), -_visual_score(visual)),
        )
    )
    return {
        "visual_candidates": ordered_candidates,
        "selected_visuals": ordered_candidates[:3],
    }
