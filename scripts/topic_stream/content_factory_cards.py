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


def _text_units(text: str) -> float:
    units = 0.0
    for char in text:
        if char.isspace():
            units += 0.3
        elif char.isascii() and char.isalnum():
            units += 0.68
        elif char in ",.:;!?，。：；！？、“”‘’()（）【】-":
            units += 0.45
        else:
            units += 1.0
    return units


def _wrap_lines(text: str, max_units: float, max_lines: int) -> List[str]:
    normalized = str(text or "").strip()
    if not normalized:
        return []

    lines: List[str] = []
    current = ""
    for char in normalized:
        probe = f"{current}{char}"
        if current and _text_units(probe) > max_units:
            lines.append(current)
            current = char
            if len(lines) == max_lines - 1:
                break
        else:
            current = probe

    remainder = normalized[len("".join(lines)) :].strip()
    if len(lines) == max_lines - 1:
        current = (current + remainder).strip()
    if current:
        lines.append(current)

    if len(lines) > max_lines:
        lines = lines[:max_lines]
    if len(lines) == max_lines and _text_units(lines[-1]) > max_units:
        trimmed = ""
        for char in lines[-1]:
            if _text_units(trimmed + char + "…") > max_units:
                break
            trimmed += char
        lines[-1] = (trimmed or lines[-1][: max(1, len(lines[-1]) - 1)]).rstrip() + "…"
    return lines


def _svg_text_block(
    *,
    x: int,
    y: int,
    lines: List[str],
    font_size: int,
    line_height: int,
    fill: str,
    weight: int = 700,
) -> str:
    if not lines:
        return ""
    tspans = []
    for index, line in enumerate(lines):
        dy = 0 if index == 0 else line_height
        tspans.append(f'<tspan x="{x}" dy="{dy}">{html.escape(line)}</tspan>')
    return (
        f'<text x="{x}" y="{y}" fill="{fill}" font-size="{font_size}" '
        f'font-family="Arial, sans-serif" font-weight="{weight}">'
        + "".join(tspans)
        + "</text>"
    )


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
    reason = html.escape(
        str(package.get("topic_reason") or package.get("commentary_text") or summary)
    )
    tags = [
        html.escape(str(tag).strip())
        for tag in package.get("screen_tags") or []
        if str(tag).strip()
    ]
    tag_line = " / ".join(tags[:3])
    card_specs = [
        ("title", "今日看点", title, reason),
        (
            "commentary",
            "一句话点评",
            reason or summary or title,
            tag_line or "热点追踪 / 观点提炼",
        ),
        ("facts", "关键信息", summary or reason or title, tag_line or "内容工厂"),
    ]
    cards: List[Dict[str, Any]] = []
    for index, (card_kind, eyebrow, body, footer) in enumerate(card_specs, start=1):
        file_path = output_dir / f"{topic_id}--{index:02d}-{card_kind}.svg"
        title_lines = _wrap_lines(title, max_units=16.5, max_lines=2)
        body_lines = _wrap_lines(body, max_units=23.5, max_lines=3)
        footer_lines = _wrap_lines(footer, max_units=28, max_lines=1)
        svg = "".join(
            [
                '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="768" viewBox="0 0 1080 768">',
                '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#101826" /><stop offset="100%" stop-color="#1e293b" /></linearGradient><linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#fb7185" /><stop offset="100%" stop-color="#f97316" /></linearGradient></defs>',
                '<rect width="1080" height="768" fill="url(#bg)" />',
                '<circle cx="964" cy="114" r="164" fill="#ffffff" fill-opacity="0.05" />',
                '<rect x="30" y="30" width="1020" height="708" rx="40" fill="#0b1220" fill-opacity="0.88" stroke="#ffffff" stroke-opacity="0.08" stroke-width="3" />',
                '<rect x="76" y="86" width="116" height="10" rx="5" fill="url(#accent)" />',
                f'<text x="76" y="138" fill="#fbbf24" font-size="28" font-family="Arial, sans-serif" font-weight="700">{html.escape(eyebrow)}</text>',
                _svg_text_block(
                    x=76,
                    y=232,
                    lines=title_lines,
                    font_size=66,
                    line_height=76,
                    fill="#f8fafc",
                    weight=800,
                ),
                _svg_text_block(
                    x=76,
                    y=408,
                    lines=body_lines,
                    font_size=42,
                    line_height=54,
                    fill="#f8fafc",
                    weight=700,
                ),
                _svg_text_block(
                    x=76,
                    y=646,
                    lines=footer_lines,
                    font_size=26,
                    line_height=32,
                    fill="#cbd5e1",
                    weight=600,
                ),
                '<text x="76" y="694" fill="#64748b" font-size="20" font-family="Arial, sans-serif">@onlytrade content factory</text>',
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
