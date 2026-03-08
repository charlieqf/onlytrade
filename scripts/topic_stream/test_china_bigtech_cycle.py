from pathlib import Path

from scripts.topic_stream.run_china_bigtech_cycle import (
    load_enabled_entities,
    score_candidate,
    validate_generated_block,
)


def test_load_enabled_entities_reads_yaml_config() -> None:
    config_path = Path("config/topic-stream/china_bigtech_entities.example.yaml")
    entities = load_enabled_entities(config_path)
    assert any(item["entity_key"] == "xiaomi" for item in entities)
    assert all(item["enabled"] is True for item in entities)


def test_score_candidate_prefers_alias_hits_and_recency() -> None:
    entity = {
        "entity_key": "xiaomi",
        "label": "Xiaomi",
        "aliases": ["Xiaomi", "小米"],
        "priority_weight": 1.0,
    }
    fresh_row = {
        "title": "Xiaomi keeps SU7 buzz hot",
        "summary": "The Xiaomi launch discussion remains strong.",
        "published_ts_ms": 1_710_000_000_000,
        "has_image": True,
    }
    stale_row = {
        "title": "Auto market commentary",
        "summary": "General sector roundup without Xiaomi mention.",
        "published_ts_ms": 1_700_000_000_000,
        "has_image": False,
    }
    assert score_candidate(
        entity, fresh_row, now_ts_ms=1_710_000_100_000
    ) > score_candidate(entity, stale_row, now_ts_ms=1_710_000_100_000)


def test_validate_generated_block_requires_commentary_shape() -> None:
    valid = validate_generated_block(
        {
            "screen_title": "小米这波热度，不只是车圈热度",
            "summary_facts": "Xiaomi kept receiving launch-related attention.",
            "commentary_script": "今天这条线最值得看的，不是单个参数，而是它把产品热度做成了舆论势能。车圈在看交付，资本市场在看兑现，友商在看这股流量到底能烧多久。接下来要看的，是交付节奏、用户口碑和后续动作，能不能把这波热度继续接成业务结果。",
            "screen_tags": ["SU7", "Traffic", "Delivery"],
            "topic_reason": "high attention momentum",
        }
    )
    assert valid is not None

    invalid = validate_generated_block(
        {
            "screen_title": "标题还行",
            "summary_facts": "只有事实。",
            "commentary_script": "太短。",
            "screen_tags": ["OnlyOne"],
            "topic_reason": "",
        }
    )
    assert invalid is None
