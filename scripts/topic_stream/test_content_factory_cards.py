from pathlib import Path

from scripts.topic_stream.content_factory_cards import (
    build_generated_cards,
    choose_visual_slots,
)


def test_slot_three_falls_back_when_only_two_article_images(tmp_path: Path) -> None:
    generated_cards = build_generated_cards(
        {"topic_id": "china_bigtech_tencent_2026", "title": "Tencent update"},
        tmp_path,
    )

    result = choose_visual_slots(
        article_images=[
            {"type": "article_image", "local_file": "hero-1.jpg", "score": 0.9},
            {"type": "article_image", "local_file": "hero-2.jpg", "score": 0.8},
        ],
        brand_assets=[
            {"type": "brand_asset", "local_file": "brand-cover.png", "score": 0.6}
        ],
        generated_cards=generated_cards,
    )

    assert [visual["type"] for visual in result["selected_visuals"]] == [
        "article_image",
        "article_image",
        "brand_asset",
    ]


def test_one_real_image_still_produces_exactly_three_selected_visuals(
    tmp_path: Path,
) -> None:
    generated_cards = build_generated_cards(
        {"topic_id": "china_bigtech_tencent_2026", "title": "Tencent update"},
        tmp_path,
    )

    result = choose_visual_slots(
        article_images=[
            {"type": "article_image", "local_file": "hero-1.jpg", "score": 0.9}
        ],
        brand_assets=[],
        generated_cards=generated_cards,
    )

    assert len(result["selected_visuals"]) == 3
    assert result["selected_visuals"][0]["type"] == "article_image"
    assert [visual["type"] for visual in result["selected_visuals"][1:]] == [
        "generated_card",
        "generated_card",
    ]


def test_generated_cards_are_only_used_after_valid_article_images(
    tmp_path: Path,
) -> None:
    generated_cards = build_generated_cards(
        {"topic_id": "china_bigtech_tencent_2026", "title": "Tencent update"},
        tmp_path,
    )

    result = choose_visual_slots(
        article_images=[
            {"type": "article_image", "local_file": "hero-1.jpg", "score": 0.95},
            {"type": "article_image", "local_file": "hero-2.jpg", "score": 0.9},
        ],
        brand_assets=[],
        generated_cards=generated_cards,
    )

    assert [visual["local_file"] for visual in result["selected_visuals"][:2]] == [
        "hero-1.jpg",
        "hero-2.jpg",
    ]
    assert result["selected_visuals"][2]["type"] == "generated_card"


def test_article_images_outrank_brand_and_generated_visuals_regardless_of_score(
    tmp_path: Path,
) -> None:
    generated_cards = build_generated_cards(
        {"topic_id": "china_bigtech_tencent_2026", "title": "Tencent update"},
        tmp_path,
    )

    result = choose_visual_slots(
        article_images=[
            {"type": "article_image", "local_file": "hero-low-score.jpg", "score": 0.1}
        ],
        brand_assets=[
            {"type": "brand_asset", "local_file": "brand-high-score.png", "score": 0.99}
        ],
        generated_cards=[
            {
                **generated_cards[0],
                "local_file": "generated-high-score.svg",
                "image_file": "generated-high-score.svg",
                "score": 1.5,
            }
        ],
    )

    assert [visual["type"] for visual in result["selected_visuals"]] == [
        "article_image",
        "brand_asset",
        "generated_card",
    ]
    assert result["selected_visuals"][0]["local_file"] == "hero-low-score.jpg"
