import json
from pathlib import Path

from scripts.tldr.run_audio_card_factory import process_dropbox_once


def test_process_dropbox_once_skips_completed_jobs_on_second_scan(
    tmp_path: Path,
) -> None:
    input_dir = tmp_path / "incoming"
    workspace_root = tmp_path / "workspace"
    input_dir.mkdir()
    audio_path = input_dir / "alpha.mp3"
    audio_path.write_bytes(b"audio-one")

    calls: list[Path] = []

    def fake_process(job_dir: Path) -> dict:
        calls.append(job_dir)
        (job_dir / "job.json").write_text(
            json.dumps({"status": "completed"}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return {"status": "completed"}

    first = process_dropbox_once(
        input_dir=input_dir,
        workspace_root=workspace_root,
        process_job_fn=fake_process,
        date_token="2026-04-09",
    )
    second = process_dropbox_once(
        input_dir=input_dir,
        workspace_root=workspace_root,
        process_job_fn=fake_process,
        date_token="2026-04-09",
    )

    assert first["processed_count"] == 1
    assert second["processed_count"] == 0
    assert len(calls) == 1


def test_process_dropbox_once_creates_new_job_when_same_name_has_new_hash(
    tmp_path: Path,
) -> None:
    input_dir = tmp_path / "incoming"
    workspace_root = tmp_path / "workspace"
    input_dir.mkdir()
    audio_path = input_dir / "alpha.mp3"
    audio_path.write_bytes(b"audio-one")

    processed_job_dirs: list[Path] = []

    def fake_process(job_dir: Path) -> dict:
        processed_job_dirs.append(job_dir)
        (job_dir / "job.json").write_text(
            json.dumps({"status": "completed"}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return {"status": "completed"}

    process_dropbox_once(
        input_dir=input_dir,
        workspace_root=workspace_root,
        process_job_fn=fake_process,
        date_token="2026-04-09",
    )
    audio_path.write_bytes(b"audio-two")
    result = process_dropbox_once(
        input_dir=input_dir,
        workspace_root=workspace_root,
        process_job_fn=fake_process,
        date_token="2026-04-09",
    )

    assert result["processed_count"] == 1
    assert len({path.name for path in processed_job_dirs}) == 2
