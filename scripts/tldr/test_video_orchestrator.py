import json
from pathlib import Path

from scripts.tldr.run_audio_card_factory import (
    process_content_pipeline_once,
    process_job_once,
)


def _write_landing_message(base_dir: Path, *, message_id: str = "msg-001") -> Path:
    landing_dir = (
        base_dir / "voice_to_video" / "1" / "20260409" / "incoming" / message_id
    )
    landing_dir.mkdir(parents=True, exist_ok=True)
    audio_path = landing_dir / "first.mp3"
    audio_path.write_bytes(b"audio-one")
    metadata = {
        "messageId": message_id,
        "threadId": "thread-001",
        "subject": "Voice batch",
        "from": "sender@example.com",
        "savedFiles": [
            {
                "filename": "first.mp3",
                "path": str(audio_path),
                "attachmentId": "att-001",
                "mimeType": "audio/mpeg",
                "size": audio_path.stat().st_size,
            }
        ],
    }
    (landing_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return landing_dir


def test_process_content_pipeline_once_creates_job_from_landing_metadata(
    tmp_path: Path,
) -> None:
    landing_root = tmp_path / "landing"
    workspace_root = tmp_path / "workspace"
    _write_landing_message(landing_root)

    processed: list[Path] = []

    def fake_process(job_dir: Path) -> dict:
        processed.append(job_dir)
        payload = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
        payload["status"] = "completed"
        (job_dir / "job.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return payload

    result = process_content_pipeline_once(
        landing_root=landing_root,
        workspace_root=workspace_root,
        process_job_fn=fake_process,
    )

    assert result["processed_count"] == 1
    assert len(processed) == 1
    job = json.loads((processed[0] / "job.json").read_text(encoding="utf-8"))
    assert job["source_message_id"] == "msg-001"
    assert job["source_attachment_id"] == "att-001"
    assert job["source_sender"] == "sender@example.com"


def test_process_content_pipeline_once_skips_completed_attachment_jobs(
    tmp_path: Path,
) -> None:
    landing_root = tmp_path / "landing"
    workspace_root = tmp_path / "workspace"
    _write_landing_message(landing_root)

    def fake_process(job_dir: Path) -> dict:
        payload = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
        payload["status"] = "completed"
        (job_dir / "job.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return payload

    first = process_content_pipeline_once(
        landing_root=landing_root,
        workspace_root=workspace_root,
        process_job_fn=fake_process,
    )
    second = process_content_pipeline_once(
        landing_root=landing_root,
        workspace_root=workspace_root,
        process_job_fn=fake_process,
    )

    assert first["processed_count"] == 1
    assert second["processed_count"] == 0
    assert second["skipped_count"] == 1


def test_process_job_once_triggers_agent_after_transcription(tmp_path: Path) -> None:
    job_dir = tmp_path / "job"
    recording_dir = job_dir / "recording"
    recording_dir.mkdir(parents=True)
    (recording_dir / "audio.mp3").write_bytes(b"audio")
    (job_dir / "topic.json").write_text(
        json.dumps(
            {
                "topic_id": "job",
                "topic_key": "job",
                "screen_title_cn": "job",
                "source_links": [],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (job_dir / "job.json").write_text(
        json.dumps({"status": "discovered"}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    calls: list[str] = []

    def fake_transcribe(topic_dir: Path, **_kwargs) -> dict:
        calls.append("transcribe")
        (topic_dir / "recording" / "video.stt.verbose.json").write_text(
            json.dumps(
                {
                    "segments": [
                        {"id": 0, "start": 0.0, "end": 1.0, "text": "第一句"},
                        {"id": 1, "start": 1.0, "end": 2.0, "text": "第二句"},
                    ]
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return {}

    def fake_run_agent(topic_dir: Path) -> dict:
        calls.append("agent")
        (topic_dir / "recording" / "video.stt.cleaned.md").write_text(
            "第一句\n\n第二句\n",
            encoding="utf-8",
        )
        (topic_dir / "recording" / "video.card-plan.json").write_text(
            json.dumps(
                {
                    "headline": "清洗标题",
                    "cards": [
                        {
                            "label": "开场卡",
                            "headline": "关键观点",
                            "lines": ["第一点", "第二点"],
                        }
                    ],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return {"status": "ok"}

    def fake_build_assets(topic_dir: Path, **_kwargs) -> dict:
        calls.append("assets")
        manifest_path = topic_dir / "sample_cut_v1_asset_manifest.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "recommended_primary_assets": [
                        {
                            "path": "sample_cut_v1_assets/card-001.jpg",
                            "role": "卡片",
                            "spoken_section": "开场卡",
                        }
                    ]
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return {"manifest_path": str(manifest_path)}

    def fake_build_package(topic_dir: Path, **_kwargs) -> dict:
        calls.append("package")
        sample_dir = topic_dir / "sample_cut_v1"
        sample_dir.mkdir(exist_ok=True)
        render_props_path = sample_dir / "sample_cut_v1_render_props.json"
        render_props_path.write_text("{}\n", encoding="utf-8")
        return {"render_props_path": str(render_props_path), "duration_in_seconds": 8.0}

    def fake_create_context(*_args, **_kwargs) -> dict:
        calls.append("context")
        return {"ok": True}

    def fake_render(_context: dict) -> dict:
        calls.append("render")
        return {"output_video": "video.mp4", "preview_paths": ["preview_1s.jpg"]}

    job = process_job_once(
        job_dir,
        transcribe_fn=fake_transcribe,
        run_agent_fn=fake_run_agent,
        build_assets_fn=fake_build_assets,
        build_package_fn=fake_build_package,
        create_context_fn=fake_create_context,
        render_fn=fake_render,
    )

    assert calls == ["transcribe", "agent", "assets", "package", "context", "render"]
    assert job["status"] == "completed"
    assert (job_dir / "recording" / "video.card-plan.json").exists()


def test_process_job_once_skips_agent_when_cleaned_and_plan_exist(
    tmp_path: Path,
) -> None:
    job_dir = tmp_path / "job"
    recording_dir = job_dir / "recording"
    recording_dir.mkdir(parents=True)
    (recording_dir / "audio.mp3").write_bytes(b"audio")
    (recording_dir / "video.stt.verbose.json").write_text(
        json.dumps(
            {"segments": [{"id": 0, "start": 0.0, "end": 1.0, "text": "第一句"}]},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (recording_dir / "video.stt.cleaned.md").write_text("第一句\n", encoding="utf-8")
    (recording_dir / "video.card-plan.json").write_text(
        json.dumps(
            {
                "headline": "标题",
                "cards": [{"label": "卡片", "headline": "H", "lines": ["L"]}],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (job_dir / "topic.json").write_text(
        json.dumps(
            {
                "topic_id": "job",
                "topic_key": "job",
                "screen_title_cn": "job",
                "source_links": [],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (job_dir / "job.json").write_text(
        json.dumps({"status": "transcribed"}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    calls: list[str] = []

    def fake_agent(_topic_dir: Path) -> dict:
        calls.append("agent")
        return {"status": "unexpected"}

    def fake_build_assets(topic_dir: Path, **_kwargs) -> dict:
        calls.append("assets")
        manifest_path = topic_dir / "sample_cut_v1_asset_manifest.json"
        manifest_path.write_text(
            json.dumps(
                {"recommended_primary_assets": []}, ensure_ascii=False, indent=2
            ),
            encoding="utf-8",
        )
        return {"manifest_path": str(manifest_path)}

    def fake_build_package(topic_dir: Path, **_kwargs) -> dict:
        calls.append("package")
        sample_dir = topic_dir / "sample_cut_v1"
        sample_dir.mkdir(exist_ok=True)
        render_props_path = sample_dir / "sample_cut_v1_render_props.json"
        render_props_path.write_text("{}\n", encoding="utf-8")
        return {"render_props_path": str(render_props_path), "duration_in_seconds": 8.0}

    def fake_create_context(*_args, **_kwargs) -> dict:
        calls.append("context")
        return {"ok": True}

    def fake_render(_context: dict) -> dict:
        calls.append("render")
        return {"output_video": "video.mp4", "preview_paths": []}

    process_job_once(
        job_dir,
        run_agent_fn=fake_agent,
        build_assets_fn=fake_build_assets,
        build_package_fn=fake_build_package,
        create_context_fn=fake_create_context,
        render_fn=fake_render,
    )

    assert "agent" not in calls
