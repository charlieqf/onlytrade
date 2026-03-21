from pathlib import Path
from typing import Any

import scripts.topic_stream.run_china_bigtech_cycle as cycle
from scripts.topic_stream.china_bigtech_packages import (
    build_topic_packages,
    package_to_t019_row,
)


def test_build_topic_packages_preserves_t019_facts_and_visual_fields(
    tmp_path: Path,
) -> None:
    selected = [
        {
            "entity": {
                "entity_key": "tencent",
                "label": "Tencent",
                "sector": "tech",
            },
            "title": "腾讯再推新工具",
            "summary": "腾讯发布新工具并带来更多行业讨论。",
            "summary_html": '<p><img src="https://img.example.com/tencent.jpg" /></p>',
            "source": "ITHome",
            "url": "https://example.com/tencent",
            "published_at": "2026-03-21 09:00",
            "priority_score": 188.5,
        }
    ]

    def generate_commentary_block(entity, item):
        assert entity["entity_key"] == "tencent"
        assert item["title"] == "腾讯再推新工具"
        return {
            "screen_title": "腾讯这波动作不只是发工具",
            "summary_facts": "腾讯发布新工具并带来更多行业讨论。",
            "commentary_script": "这波看点不只是新工具上线，更要看它能不能把流量和场景一起拉起来。接下来要看的，是这套动作会不会继续扩到更核心的业务线上。",
            "screen_tags": ["腾讯", "工具", "业务"],
            "topic_reason": "关注度高",
            "script_estimated_seconds": 38,
        }

    def synthesize_audio(package, audio_dir):
        assert audio_dir == tmp_path / "audio"
        return str(audio_dir / f"{package['topic_id']}.mp3")

    packages = build_topic_packages(
        selected,
        image_dir=tmp_path / "images",
        audio_dir=tmp_path / "audio",
        generate_commentary_block=generate_commentary_block,
        synthesize_audio=synthesize_audio,
        download_image_for_item=lambda image_url, image_dir, image_key: str(
            image_dir / f"{image_key}.jpg"
        ),
        extract_summary_image=lambda _summary_html,
        _url: "https://img.example.com/tencent.jpg",
    )

    assert len(packages) == 1
    package = packages[0]
    assert package["screen_title"] == "腾讯这波动作不只是发工具"
    assert package["summary_facts"] == "腾讯发布新工具并带来更多行业讨论。"
    assert "接下来要看的" in package["commentary_script"]
    assert package["topic_id"].startswith("china_bigtech_tencent_2026-03-21_09-00_")
    assert package["audio_file"].endswith(".mp3")
    assert Path(package["audio_file"]).name == package["audio_file"]
    assert package["audio_local_path"] == str(
        (tmp_path / "audio" / package["audio_file"]).resolve()
    )
    assert package["visual_candidates"][0]["type"] == "article_image"
    assert (
        package["visual_candidates"][0]["image_url"]
        == "https://img.example.com/tencent.jpg"
    )
    assert Path(package["t019_image_file"]).name == package["t019_image_file"]
    assert package["t019_image_local_path"] == str(
        (tmp_path / "images" / package["t019_image_file"]).resolve()
    )
    assert package["visual_candidates"][0]["image_file"] == package["t019_image_file"]
    assert package["visual_candidates"][0]["local_file"] == package["t019_image_file"]
    assert (
        package["visual_candidates"][0]["local_path"]
        == package["t019_image_local_path"]
    )
    assert len(package["selected_visuals"]) == 3
    assert package["selected_visuals"][0]["type"] == "article_image"
    assert package["t019_image_file"] == package["selected_visuals"][0]["local_file"]
    assert (
        package["t019_image_local_path"] == package["selected_visuals"][0]["local_path"]
    )


def test_package_to_t019_row_emits_single_image_and_audio_fields() -> None:
    package = {
        "topic_id": "china_bigtech_tencent_2026-03-21_abcd12",
        "entity_key": "tencent",
        "entity_label": "Tencent",
        "category": "tech",
        "title": "腾讯再推新工具",
        "screen_title": "腾讯这波动作不只是发工具",
        "summary_facts": "腾讯发布新工具并带来更多行业讨论。",
        "commentary_script": "接下来要看的，是这套动作怎么落到业务上。",
        "screen_tags": ["腾讯", "工具", "业务"],
        "source": "ITHome",
        "source_url": "https://example.com/tencent",
        "published_at": "2026-03-21 09:00",
        "t019_image_file": "data/live/onlytrade/topic_images/t_019/tencent.jpg",
        "audio_file": "data/live/onlytrade/topic_audio/t_019/tencent.mp3",
        "script_estimated_seconds": 38,
        "priority_score": 188.5,
        "topic_reason": "关注度高",
        "visual_candidates": [
            {
                "type": "article_image",
                "image_url": "https://img.example.com/tencent.jpg",
                "image_file": "data/live/onlytrade/topic_images/t_019/tencent.jpg",
            }
        ],
        "selected_visuals": [
            {
                "type": "article_image",
                "image_url": "https://img.example.com/tencent.jpg",
                "image_file": "data/live/onlytrade/topic_images/t_019/tencent.jpg",
            }
        ],
    }

    row = package_to_t019_row(package)

    assert row["id"] == package["topic_id"]
    assert row["image_file"] == "data/live/onlytrade/topic_images/t_019/tencent.jpg"
    assert row["audio_file"] == "data/live/onlytrade/topic_audio/t_019/tencent.mp3"
    assert "visual_candidates" not in row
    assert "selected_visuals" not in row


def test_build_topic_packages_skips_item_when_image_missing(tmp_path: Path) -> None:
    selected = [
        {
            "entity": {
                "entity_key": "tencent",
                "label": "Tencent",
                "sector": "tech",
            },
            "title": "腾讯再推新工具",
            "summary_html": "<p>no image</p>",
            "source": "ITHome",
            "url": "https://example.com/tencent",
            "published_at": "2026-03-21 09:00",
        }
    ]

    def synthesize_audio(_package, _audio_dir):
        raise AssertionError("audio synthesis should not run without an image")

    packages = build_topic_packages(
        selected,
        image_dir=tmp_path / "images",
        audio_dir=tmp_path / "audio",
        generate_commentary_block=lambda _entity, _item: {
            "screen_title": "unused",
            "summary_facts": "unused",
            "commentary_script": "接下来要看的，是后续动作。",
            "screen_tags": ["腾讯", "工具", "业务"],
            "topic_reason": "unused",
        },
        synthesize_audio=synthesize_audio,
        download_image_for_item=lambda _image_url, _image_dir, _image_key: None,
        extract_summary_image=lambda _summary_html, _url: "",
        extract_og_image=lambda _url: "",
        safe_text=lambda value, max_len=220: str(value or "")[:max_len],
        now_iso=lambda: "2026-03-21T12:00:00Z",
    )

    assert packages == []


def test_build_topic_packages_skips_item_when_audio_synthesis_fails(
    tmp_path: Path,
) -> None:
    selected = [
        {
            "entity": {
                "entity_key": "tencent",
                "label": "Tencent",
                "sector": "tech",
            },
            "title": "腾讯再推新工具",
            "image_url": "https://img.example.com/direct.jpg",
            "summary_html": '<p><img src="https://img.example.com/fallback.jpg" /></p>',
            "source": "ITHome",
            "url": "https://example.com/tencent",
            "published_at": "2026-03-21 09:00",
        }
    ]

    packages = build_topic_packages(
        selected,
        image_dir=tmp_path / "images",
        audio_dir=tmp_path / "audio",
        generate_commentary_block=lambda _entity, _item: {
            "screen_title": "腾讯这波动作不只是发工具",
            "summary_facts": "腾讯发布新工具并带来更多行业讨论。",
            "commentary_script": "这波看点不只是新工具上线，接下来要看的，是这套动作会不会继续扩到更核心的业务线上。",
            "screen_tags": ["腾讯", "工具", "业务"],
            "topic_reason": "关注度高",
            "script_estimated_seconds": 38,
        },
        synthesize_audio=lambda _package, _audio_dir: None,
        download_image_for_item=lambda image_url, image_dir, image_key: str(
            image_dir / f"{image_key}.jpg"
        ),
        extract_summary_image=lambda _summary_html,
        _url: "https://img.example.com/fallback.jpg",
        extract_og_image=lambda _url: "https://img.example.com/og.jpg",
        safe_text=lambda value, max_len=220: str(value or "")[:max_len],
        now_iso=lambda: "2026-03-21T12:00:00Z",
    )

    assert packages == []


def test_build_topic_packages_keeps_three_slot_visual_precedence_explicit(
    tmp_path: Path,
) -> None:
    brand_asset = tmp_path / "brands" / "tencent--cover.png"
    brand_asset.parent.mkdir(parents=True, exist_ok=True)
    brand_asset.write_bytes(b"brand")

    packages = build_topic_packages(
        selected=[
            {
                "entity": {
                    "entity_key": "tencent",
                    "label": "Tencent",
                    "sector": "tech",
                },
                "title": "腾讯再推新工具",
                "image_url": "https://img.example.com/direct.jpg",
                "summary_html": '<p><img src="https://img.example.com/fallback.jpg" /></p>',
                "source": "ITHome",
                "url": "https://example.com/tencent",
                "published_at": "2026-03-21 09:00",
            }
        ],
        image_dir=tmp_path / "images",
        audio_dir=tmp_path / "audio",
        generate_commentary_block=lambda _entity, _item: {
            "screen_title": "腾讯这波动作不只是发工具",
            "summary_facts": "腾讯发布新工具并带来更多行业讨论。",
            "commentary_script": "这波看点不只是新工具上线，接下来要看的，是这套动作会不会继续扩到更核心的业务线上。",
            "screen_tags": ["腾讯", "工具", "业务"],
            "topic_reason": "关注度高",
            "script_estimated_seconds": 38,
        },
        synthesize_audio=lambda package, audio_dir: str(
            audio_dir / f"{package['topic_id']}.mp3"
        ),
        download_image_for_item=lambda image_url, image_dir, image_key: str(
            image_dir / f"{image_key}.jpg"
        ),
        extract_summary_image=lambda _summary_html,
        _url: "https://img.example.com/fallback.jpg",
        extract_og_image=lambda _url: "https://img.example.com/og.jpg",
        safe_text=lambda value, max_len=220: str(value or "")[:max_len],
        now_iso=lambda: "2026-03-21T12:00:00Z",
        brand_asset_dir=brand_asset.parent,
    )

    assert len(packages) == 1
    package = packages[0]
    assert [visual["type"] for visual in package["selected_visuals"]] == [
        "article_image",
        "brand_asset",
        "generated_card",
    ]
    assert package["t019_image_file"] == package["selected_visuals"][0]["local_file"]
    assert len(package["selected_visuals"]) == 3


def test_build_payload_does_not_mutate_english_room_id(
    tmp_path: Path, monkeypatch
) -> None:
    original_room_id = cycle.english.ROOM_ID

    monkeypatch.setattr(cycle, "load_enabled_entities", lambda _path: [])
    monkeypatch.setattr(cycle, "choose_best_rows", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(cycle, "build_topic_packages", lambda *args, **kwargs: [])
    monkeypatch.setattr(
        cycle.english, "atomic_write_json", lambda _path, _payload: None
    )
    monkeypatch.setattr(cycle.english, "_now_iso", lambda: "2026-03-21T12:00:00Z")
    cycle.english.ROOM_ID = "original-room"

    payload = cycle.build_payload(
        config_path=tmp_path / "entities.yaml",
        output_path=tmp_path / "feed.json",
        package_output_path=None,
        image_dir=tmp_path / "images",
        audio_dir=tmp_path / "audio",
        limit_total=5,
        per_entity_limit=2,
        lookback_hours=72,
        provider="auto",
        timeout_sec=30,
        audio_tts_url="http://example.com/tts",
        audio_timeout_sec=30,
        audio_tts_voice="longlaotie_v3",
    )

    assert payload["room_id"] == cycle.ROOM_ID
    assert cycle.english.ROOM_ID == "original-room"
    cycle.english.ROOM_ID = original_room_id


def test_build_payload_fallback_audio_uses_t019_room_id(
    tmp_path: Path, monkeypatch
) -> None:
    captured: dict[str, str] = {}

    monkeypatch.setattr(cycle, "load_enabled_entities", lambda _path: [])
    monkeypatch.setattr(cycle, "choose_best_rows", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        cycle, "synthesize_audio_via_runtime_api", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        cycle, "synthesize_audio_direct_selfhosted", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(cycle.english, "_guess_audio_ext", lambda _content_type: ".mp3")
    monkeypatch.setattr(
        cycle.english, "atomic_write_json", lambda _path, _payload: None
    )
    monkeypatch.setattr(cycle.english, "_now_iso", lambda: "2026-03-21T12:00:00Z")

    def fake_post_json_bytes(url, payload, timeout_sec):
        captured["url"] = url
        captured["room_id"] = payload["room_id"]
        captured["message_id"] = payload["message_id"]
        captured["timeout_sec"] = str(timeout_sec)
        return (b"x" * 2048, "audio/mpeg")

    monkeypatch.setattr(cycle.english, "_post_json_bytes", fake_post_json_bytes)

    def fake_build_topic_packages(*args, **kwargs):
        audio_file = kwargs["synthesize_audio"](
            {
                "topic_id": "china_bigtech_tencent_2026-03-21_abcd12",
                "id": "china_bigtech_tencent_2026-03-21_abcd12",
                "title": "腾讯再推新工具",
                "summary": "腾讯发布新工具并带来更多行业讨论。",
                "teaching_material": "接下来要看的，是这套动作会不会继续扩到更核心的业务线上。",
            },
            kwargs["audio_dir"],
        )
        return [
            {
                "topic_id": "china_bigtech_tencent_2026-03-21_abcd12",
                "entity_key": "tencent",
                "entity_label": "Tencent",
                "category": "tech",
                "title": "腾讯再推新工具",
                "screen_title": "腾讯这波动作不只是发工具",
                "summary_facts": "腾讯发布新工具并带来更多行业讨论。",
                "commentary_script": "接下来要看的，是这套动作会不会继续扩到更核心的业务线上。",
                "screen_tags": ["腾讯", "工具", "业务"],
                "source": "ITHome",
                "source_url": "https://example.com/tencent",
                "published_at": "2026-03-21 09:00",
                "t019_image_file": "tencent.jpg",
                "audio_file": audio_file,
                "script_estimated_seconds": 38,
                "priority_score": 188.5,
                "topic_reason": "关注度高",
            }
        ]

    monkeypatch.setattr(cycle, "build_topic_packages", fake_build_topic_packages)

    payload = cycle.build_payload(
        config_path=tmp_path / "entities.yaml",
        output_path=tmp_path / "feed.json",
        package_output_path=None,
        image_dir=tmp_path / "images",
        audio_dir=tmp_path / "audio",
        limit_total=5,
        per_entity_limit=2,
        lookback_hours=72,
        provider="auto",
        timeout_sec=30,
        audio_tts_url="http://example.com/tts",
        audio_timeout_sec=30,
        audio_tts_voice="longlaotie_v3",
    )

    assert payload["topic_count"] == 1
    assert captured["url"] == cycle.english.DEFAULT_TTS_URL
    assert captured["room_id"] == cycle.ROOM_ID
    assert captured["message_id"].startswith("t017_")
    assert captured["timeout_sec"] == "30"


def test_build_payload_writes_shared_package_feed_when_requested(
    tmp_path: Path, monkeypatch
) -> None:
    writes: list[tuple[Path, dict[str, Any]]] = []
    package_output_path = tmp_path / "topic_packages" / "china_bigtech_packages.json"

    monkeypatch.setattr(cycle, "load_enabled_entities", lambda _path: [])
    monkeypatch.setattr(cycle, "choose_best_rows", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(cycle.english, "_now_iso", lambda: "2026-03-21T12:00:00Z")

    def fake_atomic_write_json(path, payload):
        writes.append((Path(path), payload))

    monkeypatch.setattr(cycle.english, "atomic_write_json", fake_atomic_write_json)
    monkeypatch.setattr(
        cycle,
        "build_topic_packages",
        lambda *args, **kwargs: [
            {
                "topic_id": "china_bigtech_tencent_2026-03-21_abcd12",
                "entity_key": "tencent",
                "entity_label": "Tencent",
                "category": "tech",
                "screen_title": "腾讯这波动作不只是发工具",
                "summary_facts": "腾讯发布新工具并带来更多行业讨论。",
                "commentary_script": "接下来要看的，是这套动作会不会继续扩到更核心的业务线上。",
                "screen_tags": ["腾讯", "工具", "业务"],
                "title": "腾讯再推新工具",
                "source": "ITHome",
                "source_url": "https://example.com/tencent",
                "t019_image_file": "tencent.jpg",
                "audio_file": "tencent.mp3",
                "published_at": "2026-03-21 09:00",
                "topic_reason": "关注度高",
            }
        ],
    )

    cycle.build_payload(
        config_path=tmp_path / "entities.yaml",
        output_path=tmp_path / "feed.json",
        package_output_path=package_output_path,
        image_dir=tmp_path / "images",
        audio_dir=tmp_path / "audio",
        limit_total=5,
        per_entity_limit=2,
        lookback_hours=72,
        provider="auto",
        timeout_sec=30,
        audio_tts_url="http://example.com/tts",
        audio_timeout_sec=30,
        audio_tts_voice="longlaotie_v3",
    )

    assert len(writes) == 2
    assert writes[1][0] == package_output_path
    assert writes[1][1]["schema_version"] == "topic.package.feed.v1"
    assert writes[1][1]["package_count"] == 1
    assert (
        writes[1][1]["packages"][0]["topic_id"]
        == "china_bigtech_tencent_2026-03-21_abcd12"
    )
