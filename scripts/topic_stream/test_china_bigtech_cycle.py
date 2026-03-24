from pathlib import Path
from scripts.topic_stream.run_china_bigtech_cycle import (
    PROGRAM_TITLE,
    _collect_rows_from_feed_xml,
    _collect_rows_from_qbitai_html,
    _build_voice_aware_audio_spec,
    _is_blocked_topic_row,
    _select_best_direct_rows,
    build_runtime_tts_payload,
    load_enabled_entities,
    score_candidate,
    validate_generated_block,
    generate_commentary_block,
)


def test_load_enabled_entities_reads_yaml_config() -> None:
    config_path = Path("config/topic-stream/china_bigtech_entities.example.yaml")
    entities = load_enabled_entities(config_path)
    assert any(item["entity_key"] == "xiaomi" for item in entities)
    assert any(item["entity_key"] == "openai" for item in entities)
    assert any(item["entity_key"] == "apple" for item in entities)
    assert all(item["entity_key"] not in {"huawei", "aito"} for item in entities)
    assert all(item["enabled"] is True for item in entities)


def test_program_title_is_globalized() -> None:
    assert PROGRAM_TITLE == "科技大厂每日锐评"


def test_validate_generated_block_rejects_english_reason_and_fallback_title() -> None:
    block = validate_generated_block(
        {
            "screen_title": "Anthropic这条消息，把情绪直接点着了",
            "summary_facts": "Anthropic 推出 Claude Pro 的电脑操作测试功能。",
            "commentary_script": "先看这件事。Claude 开始能直接控制电脑操作，这让很多人重新思考 AI 工具的边界。它不只是会聊天，而是开始真正接管任务执行。接下来要看，这种能力会不会进入更常见的办公流程，以及用户是否愿意把电脑控制权交给 AI。",
            "screen_tags": ["Anthropic", "AI", "Agent"],
            "topic_reason": "high-intensity market commentary on an attention spike",
        }
    )

    assert block is None


def test_blocked_topic_row_filters_huawei_cluster_content() -> None:
    assert _is_blocked_topic_row(
        {
            "entity_key": "xpeng",
            "title": "余承东：华为手机终于实现了全面回归",
            "summary": "一篇带有华为和小鹏关键词的盘点稿。",
        }
    )
    assert _is_blocked_topic_row(
        {
            "entity_key": "aito",
            "title": "问界新车发布",
            "summary": "华为系相关内容。",
        }
    )
    assert not _is_blocked_topic_row(
        {
            "entity_key": "nvidia",
            "title": "英伟达开放架构",
            "summary": "AI 芯片生态扩张。",
        }
    )


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
            "topic_reason": "小米这波热度已经从产品讨论外溢到舆论和资本预期。",
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
          <pubDate>Mon, 23 Mar 2026 01:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>
    """
    rows = _collect_rows_from_feed_xml(rss, source_name="ITHome", lookback_hours=72)
    assert len(rows) == 1
    assert rows[0]["image_url"] == "https://img.ithome.com/tencent.jpg"
    assert rows[0]["has_image"] is True


def test_collect_rows_from_qbitai_html_parses_recent_cards() -> None:
    html = """
    <html><body>
      <a href="https://www.qbitai.com/2026/03/391361.html"><img src="https://i.qbitai.com/wp-content/uploads/2026/03/main.png" /></a>
      <h4><a href="https://www.qbitai.com/2026/03/391361.html">字节版龙虾架构火爆GitHub！开源获35k+ Star</a></h4>
      <p>各类Skill按需扩展</p>
      <span>17小时前</span>
      <a href="https://www.qbitai.com/tag/%e5%ad%97%e8%8a%82">字节</a>
    </body></html>
    """

    rows = _collect_rows_from_qbitai_html(
        html,
        source_name="QbitAI",
        source_url="https://www.qbitai.com/category/%e8%b5%84%e8%ae%af",
        lookback_hours=72,
        now_ts_ms=1_774_300_000_000,
    )

    assert len(rows) == 1
    assert rows[0]["source"] == "QbitAI"
    assert rows[0]["title"].startswith("字节版龙虾架构火爆GitHub")
    assert (
        rows[0]["image_url"]
        == "https://i.qbitai.com/wp-content/uploads/2026/03/main.png"
    )
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


def test_select_best_direct_rows_does_not_duplicate_same_source_url_across_entities() -> (
    None
):
    entities = [
        {
            "entity_key": "huawei",
            "label": "Huawei",
            "aliases": ["Huawei", "华为", "余承东"],
            "priority_weight": 1.0,
        },
        {
            "entity_key": "xpeng",
            "label": "XPeng",
            "aliases": ["XPeng", "小鹏"],
            "priority_weight": 1.0,
        },
    ]
    shared_url = "https://www.leiphone.com/category/zaobao/tcZpKTzqlz97BVVU.html"
    rows = [
        {
            "title": "余承东：华为手机终于实现了全面回归；员工内涵小鹏智驾靠吹？",
            "summary": "一篇同时提到华为和小鹏的盘点稿。",
            "published_ts_ms": 1_774_300_000_000,
            "has_image": True,
            "image_url": "https://img.example.com/shared.jpg",
            "source": "Leiphone",
            "url": shared_url,
        },
        {
            "title": "小鹏汽车组织升级，智驾团队继续调整",
            "summary": "一篇只属于小鹏的独立稿件。",
            "published_ts_ms": 1_774_299_000_000,
            "has_image": True,
            "image_url": "https://img.example.com/xpeng.jpg",
            "source": "ITHome",
            "url": "https://www.ithome.com/0/932/999.htm",
        },
    ]

    chosen = _select_best_direct_rows(
        entities, rows, per_entity_limit=2, now_ts_ms=1_774_301_000_000
    )

    assert len(chosen) == 1
    assert chosen[0]["entity"]["entity_key"] == "xpeng"
    assert chosen[0]["url"] == "https://www.ithome.com/0/932/999.htm"


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


def test_generate_commentary_block_tries_qwen_then_openai_then_gemini_twice(
    monkeypatch,
) -> None:
    entity = {"label": "OpenAI", "entity_key": "openai", "aliases": ["OpenAI"]}
    row = {"title": "OpenAI launches a new feature", "summary": "Feature summary"}
    attempts: list[str] = []

    def fake_qwen(_entity, _row, _timeout_sec):
        attempts.append("qwen")
        return None

    def fake_openai(_entity, _row, _timeout_sec):
        attempts.append("openai")
        return None

    def fake_gemini(_entity, _row, _timeout_sec):
        attempts.append("gemini")
        return {
            "screen_title": "OpenAI 新功能上线！",
            "summary_facts": "OpenAI 发布了新的产品功能。",
            "commentary_script": "今天这条最值得看的，不只是 OpenAI 又发了新功能。真正要看的是，它会不会继续把产品能力变成用户心智和平台粘性。",
            "screen_tags": ["OpenAI", "产品", "AI"],
            "topic_reason": "AI 产品动作持续升温",
            "script_estimated_seconds": 30,
        }

    monkeypatch.setattr(
        "scripts.topic_stream.run_china_bigtech_cycle._generate_commentary_with_qwen",
        fake_qwen,
    )
    monkeypatch.setattr(
        "scripts.topic_stream.run_china_bigtech_cycle._generate_commentary_with_openai",
        fake_openai,
    )
    monkeypatch.setattr(
        "scripts.topic_stream.run_china_bigtech_cycle._generate_commentary_with_gemini",
        fake_gemini,
    )

    result = generate_commentary_block(entity, row, timeout_sec=20, provider="auto")

    assert result["screen_title"] == "OpenAI 新功能上线！"
    assert attempts == ["qwen", "qwen", "openai", "openai", "gemini"]


def test_generate_commentary_block_falls_back_after_all_model_retries(
    monkeypatch,
) -> None:
    entity = {"label": "OpenAI", "entity_key": "openai", "aliases": ["OpenAI"]}
    row = {"title": "OpenAI launches a new feature", "summary": "Feature summary"}
    attempts: list[str] = []

    monkeypatch.setattr(
        "scripts.topic_stream.run_china_bigtech_cycle._generate_commentary_with_qwen",
        lambda *_args, **_kwargs: attempts.append("qwen") or None,
    )
    monkeypatch.setattr(
        "scripts.topic_stream.run_china_bigtech_cycle._generate_commentary_with_openai",
        lambda *_args, **_kwargs: attempts.append("openai") or None,
    )
    monkeypatch.setattr(
        "scripts.topic_stream.run_china_bigtech_cycle._generate_commentary_with_gemini",
        lambda *_args, **_kwargs: attempts.append("gemini") or None,
    )

    result = generate_commentary_block(entity, row, timeout_sec=20, provider="auto")

    assert result["screen_title"].startswith("OpenAI")
    assert attempts == ["qwen", "qwen", "openai", "openai", "gemini", "gemini"]
