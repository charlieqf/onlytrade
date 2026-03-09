from scripts.english.run_google_news_cycle import _is_google_news_placeholder_image_url
from scripts.topic_stream.run_five_league_cycle import (
    DEFAULT_TTS_VOICE_ID,
    _build_voice_aware_audio_spec,
    _collect_rows_from_feed_xml,
    _select_best_direct_rows,
    build_runtime_tts_payload,
    build_selfhosted_tts_payload,
)


def test_google_news_placeholder_image_url_is_detected() -> None:
    assert _is_google_news_placeholder_image_url(
        "https://lh3.googleusercontent.com/J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc=s0-w300-rw"
    )
    assert not _is_google_news_placeholder_image_url(
        "https://images.example.com/real-match-photo.jpg"
    )


def test_build_selfhosted_tts_payload_uses_fast_speed_and_voice() -> None:
    payload = build_selfhosted_tts_payload(
        "这是一段测试文案。", voice_id=DEFAULT_TTS_VOICE_ID
    )
    assert payload["voice_id"] == DEFAULT_TTS_VOICE_ID
    assert payload["speed_factor"] > 1.0


def test_build_runtime_tts_payload_includes_room_and_speed() -> None:
    payload = build_runtime_tts_payload(
        room_id="t_018",
        text="这是一段测试文案。",
        message_id="msg_fast_voice",
        speed=1.2,
    )
    assert payload["room_id"] == "t_018"
    assert payload["message_id"] == "msg_fast_voice"
    assert payload["speed"] == 1.2


def test_voice_aware_audio_spec_includes_speed_in_cache_key() -> None:
    row = {
        "id": "topic_1",
        "screen_title": "皇马这场真不对劲",
        "teaching_material": "这场球看着就像熟悉的豪门老毛病又犯了。真正要看的是下一场怎么调整。",
    }
    fast_key, fast_message, _ = _build_voice_aware_audio_spec(
        row, DEFAULT_TTS_VOICE_ID, 1.2
    )
    slow_key, slow_message, _ = _build_voice_aware_audio_spec(
        row, DEFAULT_TTS_VOICE_ID, 1.0
    )
    assert fast_key
    assert slow_key
    assert fast_key != slow_key
    assert fast_message != slow_message


def test_collect_rows_from_feed_xml_reads_common_image_fields() -> None:
    rss = """
    <rss xmlns:media="http://search.yahoo.com/mrss/">
      <channel>
        <item>
          <title>Manchester City line up another statement win</title>
          <description>Guardiola's side keeps rolling.</description>
          <link>https://www.bbc.com/sport/football/articles/test-1</link>
          <pubDate>Sun, 08 Mar 2026 18:13:23 GMT</pubDate>
          <media:thumbnail url="https://ichef.bbci.co.uk/test.jpg" width="240" height="135" />
        </item>
        <item>
          <title>Arsenal injury worry before big European night</title>
          <description>Arteta waits on key names.</description>
          <link>https://www.theguardian.com/football/2026/mar/08/test-2</link>
          <pubDate>Sun, 08 Mar 2026 19:41:40 GMT</pubDate>
          <media:content url="https://i.guim.co.uk/test.jpg" width="140" />
        </item>
        <item>
          <title>Liverpool survive another chaotic evening</title>
          <description>Another late twist at Anfield.</description>
          <link>https://www.skysports.com/football/liverpool-vs-test/report/123</link>
          <pubDate>Sun, 08 Mar 2026 18:30:00 GMT</pubDate>
          <enclosure type="image/jpg" url="https://e1.365dm.com/test.jpg" length="123456" />
        </item>
      </channel>
    </rss>
    """
    rows = _collect_rows_from_feed_xml(rss, source_name="BBC Sport", lookback_hours=72)
    assert len(rows) == 3
    assert rows[0]["image_url"] == "https://ichef.bbci.co.uk/test.jpg"
    assert rows[1]["image_url"] == "https://i.guim.co.uk/test.jpg"
    assert rows[2]["image_url"] == "https://e1.365dm.com/test.jpg"


def test_select_best_direct_rows_matches_aliases_per_entity() -> None:
    entities = [
        {
            "entity_key": "manchester_city",
            "label": "Manchester City",
            "aliases": ["Manchester City", "Man City", "City"],
            "league": "Premier League",
            "priority_weight": 1.0,
            "fallback_keywords": ["Guardiola", "Haaland"],
        },
        {
            "entity_key": "arsenal",
            "label": "Arsenal",
            "aliases": ["Arsenal", "Gunners"],
            "league": "Premier League",
            "priority_weight": 1.0,
            "fallback_keywords": ["Arteta", "Saka"],
        },
    ]
    rows = [
        {
            "title": "Manchester City line up another statement win",
            "summary": "Guardiola has City humming again.",
            "source": "BBC Sport",
            "url": "https://www.bbc.com/sport/football/articles/test-1",
            "published_at": "Sun, 08 Mar 2026 18:13:23 GMT",
            "published_ts_ms": 1_772_979_203_000,
            "image_url": "https://ichef.bbci.co.uk/test.jpg",
            "has_image": True,
        },
        {
            "title": "Arsenal injury worry before big European night",
            "summary": "Arteta waits on key names.",
            "source": "The Guardian",
            "url": "https://www.theguardian.com/football/2026/mar/08/test-2",
            "published_at": "Sun, 08 Mar 2026 19:41:40 GMT",
            "published_ts_ms": 1_772_984_900_000,
            "image_url": "https://i.guim.co.uk/test.jpg",
            "has_image": True,
        },
    ]
    chosen = _select_best_direct_rows(
        entities, rows, per_entity_limit=2, now_ts_ms=1_772_985_000_000
    )
    assert {row["entity"]["entity_key"] for row in chosen} == {
        "arsenal",
        "manchester_city",
    }
