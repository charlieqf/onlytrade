from pathlib import Path

from scripts.topic_stream.run_china_bigtech_cycle import (
    _collect_rows_from_feed_xml,
    _build_voice_aware_audio_spec,
    _select_best_direct_rows,
    build_runtime_tts_payload,
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


def test_collect_rows_from_feed_xml_reads_description_image() -> None:
    rss = """
    <rss>
      <channel>
        <item>
          <title>马化腾谈腾讯免费安装 OpenClaw 引排队：没想到会这么火</title>
          <description><![CDATA[<p><img src="https://img.ithome.com/tencent.jpg" /></p><p>腾讯相关报道</p>]]></description>
          <link>https://www.ithome.com/0/927/001.htm</link>
          <pubDate>Mon, 09 Mar 2026 01:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>
    """
    rows = _collect_rows_from_feed_xml(rss, source_name="ITHome", lookback_hours=72)
    assert len(rows) == 1
    assert rows[0]["image_url"] == "https://img.ithome.com/tencent.jpg"
    assert rows[0]["has_image"] is True


def test_select_best_direct_rows_matches_chinese_aliases() -> None:
    entities = [
        {
            "entity_key": "tencent",
            "label": "Tencent",
            "aliases": ["Tencent", "腾讯"],
            "priority_weight": 1.0,
            "fallback_keywords": ["微信", "QQ"],
        },
        {
            "entity_key": "xiaomi",
            "label": "Xiaomi",
            "aliases": ["Xiaomi", "小米"],
            "priority_weight": 1.0,
            "fallback_keywords": ["SU7", "雷军"],
        },
    ]
    rows = [
        {
            "title": "马化腾谈腾讯免费安装 OpenClaw 引排队：没想到会这么火",
            "summary": "腾讯产品动态。",
            "published_ts_ms": 1_772_984_000_000,
            "has_image": True,
            "image_url": "https://img.ithome.com/tencent.jpg",
            "source": "ITHome",
            "url": "https://www.ithome.com/0/927/001.htm",
        },
        {
            "title": "小米增程 SUV 路测视频曝光",
            "summary": "小米汽车最新消息。",
            "published_ts_ms": 1_772_983_000_000,
            "has_image": True,
            "image_url": "https://img.ithome.com/xiaomi.jpg",
            "source": "ITHome",
            "url": "https://www.ithome.com/0/927/002.htm",
        },
    ]
    chosen = _select_best_direct_rows(
        entities, rows, per_entity_limit=2, now_ts_ms=1_772_985_000_000
    )
    assert {row["entity"]["entity_key"] for row in chosen} == {"tencent", "xiaomi"}


def test_build_runtime_tts_payload_sets_room_id() -> None:
    payload = build_runtime_tts_payload(
        room_id="t_019",
        text="这是一段测试文案。",
        message_id="msg_t019_voice",
    )
    assert payload["room_id"] == "t_019"
    assert payload["message_id"] == "msg_t019_voice"


def test_voice_aware_audio_spec_changes_with_cache_variant() -> None:
    row = {
        "id": "topic_1",
        "screen_title": "腾讯这波流量有点猛",
        "teaching_material": "这条线最值得看的，是流量能不能接成业务动作。",
    }
    direct_key, _, _ = _build_voice_aware_audio_spec(row, "longlaotie_v3")
    runtime_key, _, _ = _build_voice_aware_audio_spec(
        row, "longlaotie_v3", cache_variant="runtime_api"
    )
    assert direct_key
    assert runtime_key
    assert direct_key != runtime_key
