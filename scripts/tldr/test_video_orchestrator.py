import json
from pathlib import Path

import pytest

from scripts.tldr.run_audio_card_factory import (
    process_content_pipeline_once,
    process_job_once,
    run_openclaw_agent_for_job,
    sync_content_pipeline_message_groups,
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


def test_run_openclaw_agent_for_job_uses_explicit_agent_and_homebrew_path(
    tmp_path: Path, monkeypatch
) -> None:
    job_dir = tmp_path / "2026-04-09" / "job-001"
    recording_dir = job_dir / "recording"
    recording_dir.mkdir(parents=True)
    (recording_dir / "video.stt.verbose.json").write_text(
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

    calls: dict[str, object] = {}

    class FakeResult:
        returncode = 0
        stdout = '{"ok":true}'
        stderr = ""

    def fake_run(cmd, cwd, capture_output, text, check, env):
        calls["cmd"] = cmd
        calls["cwd"] = cwd
        calls["env"] = env
        (recording_dir / "video.stt.cleaned.md").write_text(
            "第一句\n\n第二句\n", encoding="utf-8"
        )
        (recording_dir / "video.card-plan.json").write_text(
            json.dumps(
                {
                    "headline": "标题",
                    "cards": [
                        {
                            "label": "开场卡",
                            "headline": "关键点",
                            "lines": ["第一点", "第二点"],
                        }
                    ],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return FakeResult()

    monkeypatch.setenv("OPENCLAW_AGENT_ID", "tldr-pipeline")
    monkeypatch.setenv("OPENCLAW_BIN", "/opt/homebrew/bin/openclaw")
    monkeypatch.setenv("OPENCLAW_AGENT_WORKSPACE", str(tmp_path))
    monkeypatch.setattr("scripts.tldr.run_audio_card_factory.subprocess.run", fake_run)

    run_openclaw_agent_for_job(job_dir)

    cmd = calls["cmd"]
    assert cmd[:5] == [
        "/opt/homebrew/bin/openclaw",
        "agent",
        "--agent",
        "tldr-pipeline",
        "-m",
    ]
    assert "job-001/recording/video.stt.verbose.json" in cmd[5]
    assert calls["cwd"] == str(job_dir)
    assert "/opt/homebrew/bin" in calls["env"]["PATH"]


def test_run_openclaw_agent_for_job_accepts_text_only_card_schema(
    tmp_path: Path, monkeypatch
) -> None:
    job_dir = tmp_path / "job-002"
    recording_dir = job_dir / "recording"
    recording_dir.mkdir(parents=True)
    (recording_dir / "video.stt.verbose.json").write_text(
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

    class FakeResult:
        returncode = 0
        stdout = '{"ok":true}'
        stderr = ""

    def fake_run(cmd, cwd, capture_output, text, check, env):
        (recording_dir / "video.stt.cleaned.md").write_text(
            "第一句\n\n第二句\n", encoding="utf-8"
        )
        (recording_dir / "video.card-plan.json").write_text(
            json.dumps(
                {
                    "cards": [
                        {"text": "开场结论\n第一点\n第二点"},
                        {"text": "执行动作\n动作一"},
                    ]
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return FakeResult()

    monkeypatch.setattr("scripts.tldr.run_audio_card_factory.subprocess.run", fake_run)

    result = run_openclaw_agent_for_job(job_dir)

    assert result["status"] == "ok"


def _write_completed_content_pipeline_job(
    workspace_root: Path,
    *,
    date_token: str,
    job_id: str,
    message_id: str,
    thread_id: str = "thread-001",
    subject: str = "voice_to_video_[1]",
    sender: str = '"Sender" <sender@example.com>',
    output_name: str | None = None,
    input_name: str = "first.mp3",
    source_attachment_name: str | None = None,
    status: str = "completed",
) -> Path:
    job_dir = workspace_root / date_token / job_id
    sample_dir = job_dir / "sample_cut_v1"
    sample_dir.mkdir(parents=True, exist_ok=True)
    output_path = sample_dir / (output_name or f"{job_id}_sample_v1.mp4")
    output_path.write_bytes(b"fake-mp4")
    payload = {
        "status": status,
        "source_message_id": message_id,
        "source_thread_id": thread_id,
        "source_subject": subject,
        "source_sender": sender,
        "input_name": input_name,
        "source_attachment_name": source_attachment_name or input_name,
        "output_video": str(output_path),
    }
    (job_dir / "job.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return job_dir


def test_sync_content_pipeline_message_groups_uploads_and_replies(
    tmp_path: Path, monkeypatch
) -> None:
    workspace_root = tmp_path / "workspace"
    _write_completed_content_pipeline_job(
        workspace_root,
        date_token="2026-04-09",
        job_id="audio-card-job-1",
        message_id="msg-001",
        output_name="first.mp4",
    )
    _write_completed_content_pipeline_job(
        workspace_root,
        date_token="2026-04-09",
        job_id="audio-card-job-2",
        message_id="msg-001",
        output_name="second.mp4",
    )

    commands: list[list[str]] = []

    class FakeResult:
        def __init__(self, stdout: str) -> None:
            self.returncode = 0
            self.stdout = stdout
            self.stderr = ""

    def fake_run(cmd, cwd, capture_output, text, check, env):
        commands.append(cmd)
        if cmd[1:3] == ["drive", "mkdir"]:
            return FakeResult(json.dumps({"id": "drive-folder-001"}))
        if cmd[1:3] == ["drive", "upload"]:
            file_name = Path(cmd[3]).name
            return FakeResult(json.dumps({"id": f"upload-{file_name}"}))
        if cmd[1:3] == ["gmail", "send"]:
            return FakeResult(json.dumps({"id": "reply-001"}))
        raise AssertionError(f"Unexpected command: {cmd}")

    monkeypatch.setattr("scripts.tldr.run_audio_card_factory.subprocess.run", fake_run)

    result = sync_content_pipeline_message_groups(
        workspace_root=workspace_root,
        message_ids={"msg-001"},
        date_tokens={"2026-04-09"},
        drive_root_id="drive-root-001",
        drive_account="content.pipeline.1@gmail.com",
        reply_after_upload=True,
    )

    assert result["uploaded_group_count"] == 1
    assert result["uploaded_file_count"] == 2
    assert result["replied_group_count"] == 1
    state_path = (
        workspace_root / "2026-04-09" / "content-pipeline-message-msg-001.sync.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["drive_folder_id"] == "drive-folder-001"
    assert state["drive_folder_url"].endswith("drive-folder-001")
    assert len(state["uploaded_files"]) == 2
    assert state["reply_status"] == "sent"
    assert any(cmd[1:3] == ["drive", "mkdir"] for cmd in commands)
    assert sum(1 for cmd in commands if cmd[1:3] == ["drive", "upload"]) == 2
    gmail_send = next(cmd for cmd in commands if cmd[1:3] == ["gmail", "send"])
    assert "--reply-to-message-id" in gmail_send
    assert "--thread-id" not in gmail_send


def test_sync_content_pipeline_message_groups_waits_for_terminal_jobs(
    tmp_path: Path, monkeypatch
) -> None:
    workspace_root = tmp_path / "workspace"
    _write_completed_content_pipeline_job(
        workspace_root,
        date_token="2026-04-09",
        job_id="audio-card-job-1",
        message_id="msg-001",
    )
    _write_completed_content_pipeline_job(
        workspace_root,
        date_token="2026-04-09",
        job_id="audio-card-job-2",
        message_id="msg-001",
        status="agent_completed",
    )

    def fake_run(*_args, **_kwargs):
        raise AssertionError(
            "No external command should run before all jobs are terminal"
        )

    monkeypatch.setattr("scripts.tldr.run_audio_card_factory.subprocess.run", fake_run)

    result = sync_content_pipeline_message_groups(
        workspace_root=workspace_root,
        message_ids={"msg-001"},
        date_tokens={"2026-04-09"},
        drive_root_id="drive-root-001",
        drive_account="content.pipeline.1@gmail.com",
        reply_after_upload=True,
    )

    assert result["pending_group_count"] == 1
    assert result["uploaded_group_count"] == 0
    assert result["replied_group_count"] == 0


def test_sync_content_pipeline_message_groups_is_idempotent(
    tmp_path: Path, monkeypatch
) -> None:
    workspace_root = tmp_path / "workspace"
    _write_completed_content_pipeline_job(
        workspace_root,
        date_token="2026-04-09",
        job_id="audio-card-job-1",
        message_id="msg-001",
        output_name="first.mp4",
    )

    state_path = (
        workspace_root / "2026-04-09" / "content-pipeline-message-msg-001.sync.json"
    )
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(
            {
                "source_message_id": "msg-001",
                "drive_folder_id": "drive-folder-001",
                "drive_folder_url": "https://drive.google.com/drive/folders/drive-folder-001",
                "uploaded_files": [
                    {
                        "job_id": "audio-card-job-1",
                        "filename": "first.mp4",
                        "output_video": str(
                            workspace_root
                            / "2026-04-09"
                            / "audio-card-job-1"
                            / "sample_cut_v1"
                            / "first.mp4"
                        ),
                        "size_bytes": len(b"fake-mp4"),
                        "drive_file_id": "upload-first.mp4",
                    }
                ],
                "reply_status": "sent",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    def fake_run(*_args, **_kwargs):
        raise AssertionError("Idempotent sync should not re-upload or re-send")

    monkeypatch.setattr("scripts.tldr.run_audio_card_factory.subprocess.run", fake_run)

    result = sync_content_pipeline_message_groups(
        workspace_root=workspace_root,
        message_ids={"msg-001"},
        date_tokens={"2026-04-09"},
        drive_root_id="drive-root-001",
        drive_account="content.pipeline.1@gmail.com",
        reply_after_upload=True,
    )

    assert result["uploaded_group_count"] == 0
    assert result["replied_group_count"] == 0


def test_sync_content_pipeline_message_groups_persists_upload_state_before_reply(
    tmp_path: Path, monkeypatch
) -> None:
    workspace_root = tmp_path / "workspace"
    _write_completed_content_pipeline_job(
        workspace_root,
        date_token="2026-04-09",
        job_id="audio-card-job-1",
        message_id="msg-001",
        output_name="first.mp4",
    )

    class FakeResult:
        def __init__(self, stdout: str, returncode: int = 0, stderr: str = "") -> None:
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = stderr

    def fake_run(cmd, cwd, capture_output, text, check, env):
        if cmd[1:3] == ["drive", "mkdir"]:
            return FakeResult(json.dumps({"id": "drive-folder-001"}))
        if cmd[1:3] == ["drive", "upload"]:
            return FakeResult(json.dumps({"id": "upload-first.mp4"}))
        if cmd[1:3] == ["gmail", "send"]:
            return FakeResult("", returncode=1, stderr="reply failed")
        raise AssertionError(f"Unexpected command: {cmd}")

    monkeypatch.setattr("scripts.tldr.run_audio_card_factory.subprocess.run", fake_run)

    with pytest.raises(RuntimeError, match="reply failed"):
        sync_content_pipeline_message_groups(
            workspace_root=workspace_root,
            message_ids={"msg-001"},
            date_tokens={"2026-04-09"},
            drive_root_id="drive-root-001",
            drive_account="content.pipeline.1@gmail.com",
            reply_after_upload=True,
        )

    state_path = (
        workspace_root / "2026-04-09" / "content-pipeline-message-msg-001.sync.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["drive_folder_id"] == "drive-folder-001"
    assert len(state["uploaded_files"]) == 1
    assert state["reply_status"] == "pending"


def test_sync_content_pipeline_message_groups_repairs_old_output_name_and_reuploads(
    tmp_path: Path, monkeypatch
) -> None:
    workspace_root = tmp_path / "workspace"
    job_dir = _write_completed_content_pipeline_job(
        workspace_root,
        date_token="2026-04-09",
        job_id="audio-card-job-1",
        message_id="msg-001",
        input_name="历史的温度.mp3",
        output_name="audio-card-job-1_sample_v1.mp4",
    )

    state_path = (
        workspace_root / "2026-04-09" / "content-pipeline-message-msg-001.sync.json"
    )
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(
            {
                "source_message_id": "msg-001",
                "drive_folder_id": "drive-folder-001",
                "drive_folder_url": "https://drive.google.com/drive/folders/drive-folder-001",
                "uploaded_files": [
                    {
                        "job_id": "audio-card-job-1",
                        "filename": "audio-card-job-1_sample_v1.mp4",
                        "output_video": str(
                            job_dir / "sample_cut_v1" / "audio-card-job-1_sample_v1.mp4"
                        ),
                        "size_bytes": len(b"fake-mp4"),
                        "drive_file_id": "upload-old-name",
                    }
                ],
                "reply_status": "sent",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    commands: list[list[str]] = []

    class FakeResult:
        def __init__(self, stdout: str) -> None:
            self.returncode = 0
            self.stdout = stdout
            self.stderr = ""

    def fake_run(cmd, cwd, capture_output, text, check, env):
        commands.append(cmd)
        if cmd[1:3] == ["drive", "delete"]:
            return FakeResult(json.dumps({"id": cmd[3]}))
        if cmd[1:3] == ["drive", "upload"]:
            return FakeResult(json.dumps({"id": "upload-fixed-name"}))
        raise AssertionError(f"Unexpected command: {cmd}")

    monkeypatch.setattr("scripts.tldr.run_audio_card_factory.subprocess.run", fake_run)

    result = sync_content_pipeline_message_groups(
        workspace_root=workspace_root,
        message_ids={"msg-001"},
        date_tokens={"2026-04-09"},
        drive_root_id="drive-root-001",
        drive_account="content.pipeline.1@gmail.com",
        reply_after_upload=True,
    )

    fixed_path = job_dir / "sample_cut_v1" / "历史的温度.mp4"
    assert fixed_path.exists()
    assert not (job_dir / "sample_cut_v1" / "audio-card-job-1_sample_v1.mp4").exists()
    job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    assert job["output_video"] == str(fixed_path)
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["uploaded_files"][0]["filename"] == "历史的温度.mp4"
    assert state["uploaded_files"][0]["drive_file_id"] == "upload-fixed-name"
    delete_cmd = next(cmd for cmd in commands if cmd[1:3] == ["drive", "delete"])
    assert delete_cmd[3] == "upload-old-name"
    assert "--force" in delete_cmd
    upload_cmd = next(cmd for cmd in commands if cmd[1:3] == ["drive", "upload"])
    assert Path(upload_cmd[3]).name == "历史的温度.mp4"
    assert result["uploaded_group_count"] == 1
    assert result["uploaded_file_count"] == 1
    assert result["replied_group_count"] == 0
