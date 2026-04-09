from __future__ import annotations

import argparse
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from scripts.tldr.clean_transcript import derive_headline_from_lines
from scripts.tldr.transcribe_aroll import canonical_recording_media_path


FONT_REG_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
FONT_BOLD_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
W = 1080
H = 1920


def _cleaned_path(topic_dir: Path) -> Path:
    return topic_dir / "recording" / "video.stt.cleaned.md"


def _asset_manifest_path(topic_dir: Path, version: str) -> Path:
    return topic_dir / f"sample_cut_{version}_asset_manifest.json"


def _archive_dir(topic_dir: Path, version: str) -> Path:
    return topic_dir / f"sample_cut_{version}_assets"


def _card_plan_path(topic_dir: Path) -> Path:
    return topic_dir / "recording" / "video.card-plan.json"


@lru_cache(maxsize=2)
def _font_path(kind: str) -> str:
    candidates = FONT_BOLD_CANDIDATES if kind == "bold" else FONT_REG_CANDIDATES
    for raw in candidates:
        if Path(raw).exists():
            return raw
    raise FileNotFoundError(f"No usable font file found for kind={kind}")


def _font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(_font_path(kind), size)


def _load_cleaned_lines(topic_dir: Path) -> list[str]:
    cleaned_path = _cleaned_path(topic_dir)
    if not cleaned_path.exists():
        raise FileNotFoundError(f"Missing cleaned transcript file: {cleaned_path}")
    return [
        line.strip()
        for line in cleaned_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _chunk_lines(lines: list[str], max_cards: int) -> list[list[str]]:
    if not lines:
        return []
    card_count = min(max_cards, len(lines))
    chunk_size = max(1, -(-len(lines) // card_count))
    return [
        lines[index : index + chunk_size] for index in range(0, len(lines), chunk_size)
    ]


def _load_llm_card_plan(topic_dir: Path) -> dict[str, Any] | None:
    plan_path = _card_plan_path(topic_dir)
    if not plan_path.exists():
        return None
    payload = json.loads(plan_path.read_text(encoding="utf-8"))
    cards = payload.get("cards")
    if not isinstance(cards, list) or not cards:
        return None
    return payload


def _card_text_lines(card: dict[str, Any]) -> list[str]:
    text = str(card.get("text") or "").strip()
    if not text:
        return []
    return [line.strip() for line in text.splitlines() if line.strip()]


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font_obj, max_width: int) -> str:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        current = ""
        for char in paragraph:
            candidate = current + char
            bbox = draw.textbbox((0, 0), candidate, font=font_obj)
            if current and (bbox[2] - bbox[0]) > max_width:
                lines.append(current)
                current = char
            else:
                current = candidate
        if current:
            lines.append(current)
        if not paragraph:
            lines.append("")
    return "\n".join(lines)


def _fit_text(
    draw: ImageDraw.ImageDraw,
    box,
    text: str,
    font_path: str,
    start: int,
    minimum: int,
    fill,
    spacing: int = 10,
) -> None:
    x1, y1, x2, y2 = box
    for size in range(start, minimum - 1, -2):
        font_obj = _font(font_path, size)
        wrapped = _wrap_text(draw, text, font_obj, x2 - x1)
        bbox = draw.multiline_textbbox(
            (x1, y1), wrapped, font=font_obj, spacing=spacing
        )
        if bbox[3] - bbox[1] <= (y2 - y1):
            draw.multiline_text(
                (x1, y1), wrapped, font=font_obj, fill=fill, spacing=spacing
            )
            return
    font_obj = _font(font_path, minimum)
    wrapped = _wrap_text(draw, text, font_obj, x2 - x1)
    draw.multiline_text((x1, y1), wrapped, font=font_obj, fill=fill, spacing=spacing)


def _rounded_panel(draw: ImageDraw.ImageDraw, box, fill, radius: int = 36) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def _render_card(
    output_path: Path,
    *,
    headline: str,
    label: str,
    lines: list[str],
    index: int,
    total: int,
) -> None:
    canvas = Image.new("RGBA", (W, H), (6, 10, 18, 255))
    draw = ImageDraw.Draw(canvas)
    accents = [(255, 101, 84), (94, 132, 255), (255, 182, 78), (64, 190, 149)]
    accent = accents[index % len(accents)]

    _rounded_panel(draw, (52, 72, 1028, 1848), (12, 18, 31, 248), radius=44)
    _rounded_panel(draw, (88, 116, 320, 184), accent + (255,), radius=24)
    draw.text((118, 132), label, font=_font("bold", 30), fill=(255, 255, 255))

    _fit_text(
        draw,
        (92, 240, 956, 468),
        headline,
        "bold",
        84,
        52,
        (255, 247, 239),
        12,
    )

    body_top = 560
    for offset, line in enumerate(lines[:4]):
        box_top = body_top + offset * 258
        _rounded_panel(
            draw, (92, box_top, 988, box_top + 202), (255, 248, 242, 246), radius=30
        )
        _rounded_panel(
            draw, (122, box_top + 26, 212, box_top + 84), accent + (255,), radius=20
        )
        draw.text(
            (148, box_top + 38),
            f"{offset + 1}",
            font=_font("bold", 28),
            fill=(255, 255, 255),
        )
        _fit_text(
            draw,
            (248, box_top + 34, 956, box_top + 170),
            line,
            "bold" if offset == 0 else "regular",
            42 if offset == 0 else 32,
            28 if offset == 0 else 24,
            (26, 30, 38),
            8,
        )

    footer = f"Card {index + 1} / {total}"
    _rounded_panel(draw, (92, 1738, 988, 1810), (255, 255, 255, 18), radius=20)
    draw.text((122, 1756), footer, font=_font("regular", 24), fill=(215, 220, 232))

    canvas = canvas.filter(ImageFilter.GaussianBlur(0.2))
    canvas.convert("RGB").save(output_path, quality=95)


def build_audio_card_assets(
    topic_dir: Path, *, version: str = "v1", max_cards: int = 4
) -> dict[str, Any]:
    topic_dir = Path(topic_dir)
    version = version if version.startswith("v") else f"v{version}"
    archive_dir = _archive_dir(topic_dir, version)
    archive_dir.mkdir(parents=True, exist_ok=True)
    for existing in archive_dir.glob("card-*.jpg"):
        existing.unlink()

    lines = _load_cleaned_lines(topic_dir)
    llm_plan = _load_llm_card_plan(topic_dir)
    headline = derive_headline_from_lines(lines)
    card_specs: list[dict[str, Any]] = []
    if llm_plan:
        headline = str(llm_plan.get("headline") or headline).strip() or headline
        for index, card in enumerate(llm_plan.get("cards", []), start=1):
            if not isinstance(card, dict):
                continue
            card_headline = str(card.get("headline") or "").strip()
            card_label = str(card.get("label") or "核心卡片").strip() or "核心卡片"
            raw_lines = card.get("lines")
            if not isinstance(raw_lines, list):
                raw_lines = []
            card_lines = [str(line).strip() for line in raw_lines if str(line).strip()]
            text_only_lines = _card_text_lines(card)
            if text_only_lines:
                if not card_headline:
                    card_headline = text_only_lines[0]
                if not card_lines:
                    card_lines = text_only_lines[1:] or [card_headline]
                if card_label == "核心卡片":
                    card_label = f"卡片 {index}"
                if not str(llm_plan.get("headline") or "").strip():
                    headline = card_headline if index == 1 else headline
            if not card_headline and not card_lines:
                continue
            card_specs.append(
                {
                    "label": card_label,
                    "headline": card_headline or headline,
                    "lines": card_lines or [headline],
                    "spoken_section": card_label,
                }
            )
    else:
        chunks = _chunk_lines(lines, max_cards=max_cards)
        if not chunks:
            raise ValueError(
                "No cleaned transcript lines available for card generation"
            )
        for chunk in chunks:
            title = chunk[0] if chunk else headline
            body_lines = chunk[1:] or [headline]
            card_specs.append(
                {
                    "label": "核心卡片",
                    "headline": title,
                    "lines": body_lines,
                    "spoken_section": title,
                }
            )

    if not card_specs:
        raise ValueError("No card specs available for card generation")

    card_names: list[str] = []
    for index, card_spec in enumerate(card_specs):
        card_name = f"card-{index + 1:03d}.jpg"
        _render_card(
            archive_dir / card_name,
            headline=str(card_spec["headline"]),
            label=str(card_spec["label"]),
            lines=list(card_spec["lines"]),
            index=index,
            total=len(card_specs),
        )
        card_names.append(card_name)

    manifest = {
        "topic": json.loads((topic_dir / "topic.json").read_text(encoding="utf-8")).get(
            "topic_key", "audio-card-topic"
        ),
        "recording_ready": canonical_recording_media_path(topic_dir).exists(),
        "render_mode": "audio_cards",
        "recommended_primary_assets": [
            {
                "path": f"sample_cut_{version}_assets/{card_name}",
                "role": "卡片",
                "spoken_section": str(
                    card_specs[index].get("spoken_section") or f"card {index + 1}"
                ),
            }
            for index, card_name in enumerate(card_names)
        ],
        "archived_assets": [
            f"sample_cut_{version}_assets/{card_name}" for card_name in card_names
        ],
    }
    _asset_manifest_path(topic_dir, version).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "archive_dir": str(archive_dir),
        "card_count": len(card_names),
        "manifest_path": str(_asset_manifest_path(topic_dir, version)),
        "headline": headline,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build pure text card assets for audio-only TLDR jobs"
    )
    parser.add_argument("--topic-dir", required=True)
    parser.add_argument("--version", default="v1")
    args = parser.parse_args()
    result = build_audio_card_assets(Path(args.topic_dir), version=args.version)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
