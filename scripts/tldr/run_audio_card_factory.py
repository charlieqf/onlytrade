from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from scripts.tldr.build_audio_card_assets import build_audio_card_assets
from scripts.tldr.build_post_recording_package import build_post_recording_package
from scripts.tldr.clean_transcript import derive_headline_from_lines
from scripts.tldr.render_sample_cut import create_render_context, render_sample_cut
from scripts.tldr.transcribe_aroll import transcribe_topic_aroll


def _date_token(raw: str | None = None) -> str:
    return str(raw) if raw else datetime.now().strftime("%Y-%m-%d")


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "audio-card-job"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _job_json_path(job_dir: Path) -> Path:
    return job_dir / "job.json"


def _load_job(job_dir: Path) -> dict[str, Any]:
    path = _job_json_path(job_dir)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_job(job_dir: Path, payload: dict[str, Any]) -> None:
    _job_json_path(job_dir).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _recording_dir(job_dir: Path) -> Path:
    return job_dir / "recording"


def _verbose_transcript_path(job_dir: Path) -> Path:
    return _recording_dir(job_dir) / "video.stt.verbose.json"


def _cleaned_transcript_path(job_dir: Path) -> Path:
    return _recording_dir(job_dir) / "video.stt.cleaned.md"


def _card_plan_path(job_dir: Path) -> Path:
    return _recording_dir(job_dir) / "video.card-plan.json"


def _openclaw_bin() -> str:
    return os.environ.get("OPENCLAW_BIN", "openclaw")


def _gog_bin() -> str:
    return os.environ.get("GOG_BIN", shutil.which("gog") or "/opt/homebrew/bin/gog")


def _openclaw_agent_id() -> str:
    return os.environ.get("OPENCLAW_AGENT_ID", "tldr-pipeline")


def _openclaw_workspace_root() -> Path | None:
    raw = os.environ.get("OPENCLAW_AGENT_WORKSPACE")
    return Path(raw) if raw else None


def _openclaw_env() -> dict[str, str]:
    env = os.environ.copy()
    current = env.get("PATH", "")
    prefix = "/opt/homebrew/bin:/opt/homebrew/opt/python@3.12/libexec/bin"
    env["PATH"] = f"{prefix}:{current}" if current else prefix
    return env


def _env_flag(name: str) -> bool:
    return str(os.environ.get(name) or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _content_pipeline_drive_root_id() -> str:
    return str(os.environ.get("CONTENT_PIPELINE_DRIVE_ROOT_ID") or "").strip()


def _content_pipeline_drive_account() -> str:
    return str(
        os.environ.get("CONTENT_PIPELINE_DRIVE_ACCOUNT")
        or os.environ.get("CONTENT_PIPELINE_ACCOUNT")
        or ""
    ).strip()


def _content_pipeline_reply_account() -> str:
    return str(
        os.environ.get("CONTENT_PIPELINE_REPLY_ACCOUNT")
        or _content_pipeline_drive_account()
        or ""
    ).strip()


def _content_pipeline_reply_after_upload() -> bool:
    return _env_flag("CONTENT_PIPELINE_REPLY_AFTER_UPLOAD")


def _write_topic_json(job_dir: Path, *, topic_key: str, source_mp3: Path) -> None:
    topic_path = job_dir / "topic.json"
    if topic_path.exists():
        return
    topic_path.write_text(
        json.dumps(
            {
                "topic_id": topic_key,
                "topic_key": topic_key,
                "screen_title_cn": source_mp3.stem,
                "source_links": [
                    {
                        "label": "Local Audio",
                        "url": source_mp3.resolve().as_uri(),
                    }
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def _update_topic_json(job_dir: Path, updates: dict[str, Any]) -> None:
    topic_path = job_dir / "topic.json"
    payload = json.loads(topic_path.read_text(encoding="utf-8"))
    payload.update(
        {key: value for key, value in updates.items() if value not in {None, ""}}
    )
    topic_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def create_or_load_job_dir(
    audio_path: Path, workspace_root: Path, *, date_token: str
) -> Path:
    audio_path = Path(audio_path)
    workspace_root = Path(workspace_root)
    audio_hash = _sha256(audio_path)
    topic_key = f"{_slugify(audio_path.stem)}-{audio_hash[:8]}"
    job_dir = workspace_root / date_token / topic_key
    recording_dir = job_dir / "recording"
    recording_dir.mkdir(parents=True, exist_ok=True)
    copied_audio_path = recording_dir / "audio.mp3"
    if (
        not copied_audio_path.exists()
        or copied_audio_path.read_bytes() != audio_path.read_bytes()
    ):
        shutil.copyfile(audio_path, copied_audio_path)
    _write_topic_json(job_dir, topic_key=topic_key, source_mp3=audio_path)

    payload = _load_job(job_dir)
    payload.update(
        {
            "status": payload.get("status") or "discovered",
            "input_hash": audio_hash,
            "input_size_bytes": audio_path.stat().st_size,
            "input_name": audio_path.name,
            "source_mp3": str(audio_path.resolve()),
        }
    )
    _write_job(job_dir, payload)
    return job_dir


def create_or_load_content_pipeline_job_dir(
    *,
    audio_path: Path,
    workspace_root: Path,
    message_metadata: dict[str, Any],
    attachment_metadata: dict[str, Any],
    date_token: str,
) -> Path:
    job_dir = create_or_load_job_dir(audio_path, workspace_root, date_token=date_token)
    payload = _load_job(job_dir)
    payload.update(
        {
            "source_message_id": str(message_metadata.get("messageId") or ""),
            "source_thread_id": str(message_metadata.get("threadId") or ""),
            "source_subject": str(message_metadata.get("subject") or ""),
            "source_sender": str(message_metadata.get("from") or ""),
            "source_metadata_path": str(attachment_metadata.get("metadata_path") or ""),
            "source_attachment_id": str(attachment_metadata.get("attachmentId") or ""),
            "source_attachment_name": str(
                attachment_metadata.get("filename") or audio_path.name
            ),
            "source_channel": "content_pipeline",
        }
    )
    _write_job(job_dir, payload)
    _update_topic_json(
        job_dir,
        {
            "screen_title_cn": str(
                attachment_metadata.get("filename") or audio_path.stem
            ),
            "source_message_id": str(message_metadata.get("messageId") or ""),
            "source_thread_id": str(message_metadata.get("threadId") or ""),
            "source_subject": str(message_metadata.get("subject") or ""),
            "source_sender": str(message_metadata.get("from") or ""),
        },
    )
    return job_dir


def _update_screen_title_from_cleaned_transcript(topic_dir: Path) -> None:
    topic_path = topic_dir / "topic.json"
    payload = json.loads(topic_path.read_text(encoding="utf-8"))
    cleaned_path = topic_dir / "recording" / "video.stt.cleaned.md"
    if not cleaned_path.exists():
        return
    lines = [
        line.strip()
        for line in cleaned_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    payload["screen_title_cn"] = derive_headline_from_lines(lines)
    topic_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _count_transcript_segments(job_dir: Path) -> int:
    payload = json.loads(_verbose_transcript_path(job_dir).read_text(encoding="utf-8"))
    segments = payload.get("segments")
    if not isinstance(segments, list):
        raise ValueError("Verbose transcript payload must contain a segments list")
    return len(segments)


def _count_cleaned_lines(job_dir: Path) -> int:
    return len(
        [
            line.strip()
            for line in _cleaned_transcript_path(job_dir)
            .read_text(encoding="utf-8")
            .splitlines()
            if line.strip()
        ]
    )


def _validate_card_plan(job_dir: Path) -> None:
    payload = json.loads(_card_plan_path(job_dir).read_text(encoding="utf-8"))
    cards = payload.get("cards")
    if not isinstance(cards, list) or not cards:
        raise ValueError("video.card-plan.json must contain at least one card")
    has_global_headline = bool(str(payload.get("headline") or "").strip())
    for card in cards:
        if not isinstance(card, dict):
            raise ValueError("Each card plan entry must be an object")
        text_only = bool(str(card.get("text") or "").strip())
        if text_only:
            has_global_headline = True
            continue
        if not str(card.get("label") or "").strip():
            raise ValueError("Each card must contain a non-empty label")
        if not str(card.get("headline") or "").strip():
            raise ValueError("Each card must contain a non-empty headline")
        lines = card.get("lines")
        if not isinstance(lines, list) or not [
            str(line).strip() for line in lines if str(line).strip()
        ]:
            raise ValueError("Each card must contain at least one non-empty line")
    if not has_global_headline:
        raise ValueError(
            "video.card-plan.json must contain a non-empty headline or text cards"
        )


def _validate_agent_outputs(job_dir: Path) -> None:
    cleaned_path = _cleaned_transcript_path(job_dir)
    card_plan_path = _card_plan_path(job_dir)
    if not cleaned_path.exists():
        raise FileNotFoundError(f"Missing cleaned transcript output: {cleaned_path}")
    if not card_plan_path.exists():
        raise FileNotFoundError(f"Missing card plan output: {card_plan_path}")
    segment_count = _count_transcript_segments(job_dir)
    cleaned_count = _count_cleaned_lines(job_dir)
    if cleaned_count != segment_count:
        raise ValueError(
            f"Cleaned transcript line count ({cleaned_count}) must equal segment count ({segment_count})"
        )
    _validate_card_plan(job_dir)


def _build_openclaw_prompt(job_dir: Path) -> str:
    workspace_root = _openclaw_workspace_root()
    job_ref = str(job_dir)
    if workspace_root:
        try:
            job_ref = str(job_dir.relative_to(workspace_root))
        except ValueError:
            job_ref = str(job_dir)
    return (
        f"Operate only inside the job directory '{job_ref}'. "
        f"Read '{job_ref}/recording/video.stt.verbose.json'. "
        f"Write '{job_ref}/recording/video.stt.cleaned.md' with exactly one non-empty cleaned subtitle line per transcript segment. "
        f"Write '{job_ref}/recording/video.card-plan.json' with 3-6 concise full-screen text cards. "
        "Preferred JSON schema: {headline, cards:[{label, headline, lines:[...]}]}. "
        "Fallback schema is allowed only if needed: {cards:[{text:'line1\\nline2'}]}. "
        "Preserve meaning, remove ASR noise and repetition, and do not add facts not grounded in the audio."
    )


def run_openclaw_agent_for_job(job_dir: Path) -> dict[str, Any]:
    prompt = _build_openclaw_prompt(job_dir)
    result = subprocess.run(
        [
            _openclaw_bin(),
            "agent",
            "--agent",
            _openclaw_agent_id(),
            "-m",
            prompt,
            "--thinking",
            "high",
            "--timeout",
            "600",
            "--json",
        ],
        cwd=str(job_dir),
        capture_output=True,
        text=True,
        check=False,
        env=_openclaw_env(),
    )
    if result.returncode != 0:
        raise RuntimeError(
            "OpenClaw agent command failed: "
            + (
                result.stderr.strip()
                or result.stdout.strip()
                or f"exit {result.returncode}"
            )
        )
    _validate_agent_outputs(job_dir)
    return {
        "status": "ok",
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def _default_preview_seconds(duration_in_seconds: float) -> list[float]:
    duration = max(1.0, float(duration_in_seconds))
    candidates = [1.0, duration * 0.25, duration * 0.5, duration * 0.75]
    trimmed = [
        round(min(max(0.5, value), max(0.5, duration - 0.5)), 2) for value in candidates
    ]
    unique: list[float] = []
    for value in trimmed:
        if value not in unique:
            unique.append(value)
    return unique


def process_job_once(
    topic_dir: Path,
    *,
    version: str = "v1",
    transcribe_fn: Callable[..., dict[str, Any]] = transcribe_topic_aroll,
    run_agent_fn: Callable[[Path], dict[str, Any]] = run_openclaw_agent_for_job,
    build_assets_fn: Callable[..., dict[str, Any]] = build_audio_card_assets,
    build_package_fn: Callable[..., dict[str, Any]] = build_post_recording_package,
    create_context_fn: Callable[..., Any] = create_render_context,
    render_fn: Callable[..., dict[str, Any]] = render_sample_cut,
) -> dict[str, Any]:
    topic_dir = Path(topic_dir)
    job = _load_job(topic_dir)

    if job.get("status") == "completed":
        return job

    if not _verbose_transcript_path(topic_dir).exists():
        transcribe_fn(topic_dir, write_cleaned_scaffold=True)
        job["status"] = "transcribed"
        _write_job(topic_dir, job)

    if (not _cleaned_transcript_path(topic_dir).exists()) or (
        not _card_plan_path(topic_dir).exists()
    ):
        agent_result = run_agent_fn(topic_dir)
        _validate_agent_outputs(topic_dir)
        _update_screen_title_from_cleaned_transcript(topic_dir)
        job["status"] = "agent_completed"
        job["agent_status"] = str(agent_result.get("status") or "ok")
        _write_job(topic_dir, job)
    else:
        _validate_agent_outputs(topic_dir)
        _update_screen_title_from_cleaned_transcript(topic_dir)
        job["status"] = "agent_completed"
        _write_job(topic_dir, job)

    assets_result = build_assets_fn(topic_dir, version=version)
    job["status"] = "cards_built"
    job["asset_manifest_path"] = assets_result["manifest_path"]
    _write_job(topic_dir, job)

    package_result = build_package_fn(topic_dir, version=version)
    job["status"] = "package_built"
    job["render_props_path"] = package_result["render_props_path"]
    _write_job(topic_dir, job)

    context = create_context_fn(
        topic_dir,
        version=version,
        preview_seconds=_default_preview_seconds(package_result["duration_in_seconds"]),
    )
    render_result = render_fn(context)
    job["status"] = "completed"
    job["output_video"] = render_result["output_video"]
    job["preview_paths"] = render_result["preview_paths"]
    _write_job(topic_dir, job)
    return job


process_audio_job = process_job_once


_TERMINAL_JOB_STATUSES = {"completed", "failed"}


def _run_json_command(args: list[str], *, cwd: Path | None = None) -> Any:
    result = subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        check=False,
        env=_openclaw_env(),
    )
    if result.returncode != 0:
        raise RuntimeError(
            "Command failed: "
            + " ".join(args)
            + "\n"
            + (
                result.stderr.strip()
                or result.stdout.strip()
                or f"exit {result.returncode}"
            )
        )
    stdout = result.stdout.strip()
    return json.loads(stdout) if stdout else {}


def _content_pipeline_state_path(
    workspace_root: Path, *, date_token: str, message_id: str
) -> Path:
    return (
        workspace_root / date_token / f"content-pipeline-message-{message_id}.sync.json"
    )


def _safe_drive_name(value: str, *, fallback: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|\r\n\t]+", "_", str(value or "")).strip(" ._")
    return cleaned or fallback


def _message_drive_folder_name(group: dict[str, Any]) -> str:
    subject = _safe_drive_name(
        str(group.get("source_subject") or "content_pipeline"),
        fallback="content_pipeline",
    )
    return f"{subject}_{group['source_message_id']}"


def _message_reply_subject(group: dict[str, Any]) -> str:
    subject = str(
        group.get("source_subject") or "Your content pipeline videos are ready"
    ).strip()
    if subject.lower().startswith("re:"):
        return subject
    return f"Re: {subject}"


def _message_reply_body(group: dict[str, Any], state: dict[str, Any]) -> str:
    lines = [
        "Your video batch is ready.",
        f"Google Drive folder: {state['drive_folder_url']}",
        "",
        "Uploaded files:",
    ]
    lines.extend(
        f"- {item['filename']}"
        for item in state.get("uploaded_files", [])
        if item.get("filename")
    )
    return "\n".join(lines).strip() + "\n"


def _desired_mp4_filename(job: dict[str, Any]) -> str | None:
    for key in ("source_attachment_name", "input_name"):
        raw_name = str(job.get(key) or "").strip()
        if not raw_name:
            continue
        source_name = Path(raw_name).name
        stem = Path(source_name).stem.strip()
        if stem:
            return f"{stem}.mp4"
    return None


def _normalize_completed_output_video(
    job_dir: Path, job: dict[str, Any]
) -> dict[str, Any]:
    output_raw = str(job.get("output_video") or "").strip()
    if not output_raw:
        return job
    output_path = Path(output_raw)
    if not output_path.exists():
        return job
    desired_name = _desired_mp4_filename(job)
    if not desired_name or output_path.name == desired_name:
        return job

    desired_path = output_path.with_name(desired_name)
    if desired_path.exists() and desired_path != output_path:
        output_path.unlink()
    elif desired_path != output_path:
        output_path.rename(desired_path)

    job["output_video"] = str(desired_path)
    _write_job(job_dir, job)

    for metadata_path in desired_path.parent.glob("*.metadata.json"):
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if metadata.get("video") != desired_path.name:
            metadata["video"] = desired_path.name
            metadata_path.write_text(
                json.dumps(metadata, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    return job


def _collect_content_pipeline_message_groups(
    workspace_root: Path,
    *,
    message_ids: set[str] | None = None,
    date_tokens: set[str] | None = None,
) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    for date_dir in sorted(Path(workspace_root).iterdir()):
        if not date_dir.is_dir():
            continue
        if date_tokens and date_dir.name not in date_tokens:
            continue
        for job_json_path in sorted(date_dir.glob("*/job.json")):
            job_dir = job_json_path.parent
            job = _load_job(job_dir)
            message_id = str(job.get("source_message_id") or "").strip()
            if not message_id:
                continue
            if message_ids and message_id not in message_ids:
                continue
            key = (date_dir.name, message_id)
            group = groups.setdefault(
                key,
                {
                    "date_token": date_dir.name,
                    "source_message_id": message_id,
                    "source_thread_id": str(job.get("source_thread_id") or ""),
                    "source_subject": str(job.get("source_subject") or ""),
                    "source_sender": str(job.get("source_sender") or ""),
                    "jobs": [],
                },
            )
            group["jobs"].append({"job_dir": job_dir, "job": job})
    return list(groups.values())


def sync_content_pipeline_message_groups(
    *,
    workspace_root: Path,
    message_ids: set[str] | None,
    date_tokens: set[str] | None,
    drive_root_id: str,
    drive_account: str,
    reply_after_upload: bool = False,
    reply_account: str | None = None,
) -> dict[str, Any]:
    workspace_root = Path(workspace_root)
    drive_root_id = str(drive_root_id or "").strip()
    drive_account = str(drive_account or "").strip()
    reply_account = str(reply_account or drive_account or "").strip()
    if not drive_root_id or not drive_account:
        return {
            "pending_group_count": 0,
            "uploaded_group_count": 0,
            "uploaded_file_count": 0,
            "replied_group_count": 0,
        }

    pending_group_count = 0
    uploaded_group_count = 0
    uploaded_file_count = 0
    replied_group_count = 0

    for group in _collect_content_pipeline_message_groups(
        workspace_root,
        message_ids=message_ids,
        date_tokens=date_tokens,
    ):
        jobs = group["jobs"]
        if any(
            str(item["job"].get("status") or "") not in _TERMINAL_JOB_STATUSES
            for item in jobs
        ):
            pending_group_count += 1
            continue

        completed_jobs = []
        for item in jobs:
            job = _normalize_completed_output_video(Path(item["job_dir"]), item["job"])
            output_video = Path(str(job.get("output_video") or ""))
            if job.get("status") == "completed" and output_video.exists():
                completed_jobs.append(
                    {
                        "job_dir": Path(item["job_dir"]),
                        "job": job,
                        "output_video": output_video,
                    }
                )
        if not completed_jobs:
            continue

        state_path = _content_pipeline_state_path(
            workspace_root,
            date_token=group["date_token"],
            message_id=group["source_message_id"],
        )
        state = (
            json.loads(state_path.read_text(encoding="utf-8"))
            if state_path.exists()
            else {
                "source_message_id": group["source_message_id"],
                "source_thread_id": group["source_thread_id"],
                "source_subject": group["source_subject"],
                "source_sender": group["source_sender"],
                "uploaded_files": [],
                "reply_status": "pending",
            }
        )
        uploaded_by_job = {
            str(item.get("job_id") or ""): item
            for item in state.get("uploaded_files", [])
            if isinstance(item, dict)
        }

        if not state.get("drive_folder_id"):
            folder_payload = _run_json_command(
                [
                    _gog_bin(),
                    "drive",
                    "mkdir",
                    _message_drive_folder_name(group),
                    "-a",
                    drive_account,
                    "--parent",
                    drive_root_id,
                    "--json",
                    "--results-only",
                    "--no-input",
                ]
            )
            state["drive_folder_id"] = str(folder_payload.get("id") or "")
            state["drive_folder_url"] = (
                f"https://drive.google.com/drive/folders/{state['drive_folder_id']}"
                if state["drive_folder_id"]
                else ""
            )

        uploaded_this_group = False
        for item in completed_jobs:
            job_dir = Path(item["job_dir"])
            output_video = Path(item["output_video"])
            job_id = job_dir.name
            size_bytes = output_video.stat().st_size
            existing = uploaded_by_job.get(job_id)
            if (
                existing
                and existing.get("size_bytes") == size_bytes
                and existing.get("filename") == output_video.name
            ):
                continue
            existing_drive_file_id = str(
                (existing or {}).get("drive_file_id") or ""
            ).strip()
            if existing_drive_file_id:
                _run_json_command(
                    [
                        _gog_bin(),
                        "drive",
                        "delete",
                        existing_drive_file_id,
                        "-a",
                        drive_account,
                        "--force",
                        "--json",
                        "--results-only",
                        "--no-input",
                    ]
                )
            upload_payload = _run_json_command(
                [
                    _gog_bin(),
                    "drive",
                    "upload",
                    str(output_video),
                    "-a",
                    drive_account,
                    "--parent",
                    str(state["drive_folder_id"]),
                    "--name",
                    output_video.name,
                    "--json",
                    "--results-only",
                    "--no-input",
                ]
            )
            uploaded_by_job[job_id] = {
                "job_id": job_id,
                "filename": output_video.name,
                "output_video": str(output_video),
                "size_bytes": size_bytes,
                "drive_file_id": str(upload_payload.get("id") or ""),
            }
            uploaded_this_group = True
            uploaded_file_count += 1

        state["uploaded_files"] = sorted(
            uploaded_by_job.values(), key=lambda item: str(item.get("job_id") or "")
        )
        if uploaded_this_group:
            uploaded_group_count += 1

        state["last_synced_at"] = datetime.now().isoformat()
        state_path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        if (
            reply_after_upload
            and reply_account
            and state.get("uploaded_files")
            and state.get("reply_status") != "sent"
            and group.get("source_message_id")
        ):
            reply_payload = _run_json_command(
                [
                    _gog_bin(),
                    "gmail",
                    "send",
                    "-a",
                    reply_account,
                    "--subject",
                    _message_reply_subject(group),
                    "--body",
                    _message_reply_body(group, state),
                    "--reply-to-message-id",
                    str(group["source_message_id"]),
                    "--reply-all",
                    "--json",
                    "--results-only",
                    "--no-input",
                ]
            )
            state["reply_status"] = "sent"
            state["reply_message_id"] = str(reply_payload.get("id") or "")
            replied_group_count += 1

        state["last_synced_at"] = datetime.now().isoformat()
        state_path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    return {
        "pending_group_count": pending_group_count,
        "uploaded_group_count": uploaded_group_count,
        "uploaded_file_count": uploaded_file_count,
        "replied_group_count": replied_group_count,
    }


def _normalize_landing_date(token: str) -> str:
    digits = "".join(char for char in str(token or "") if char.isdigit())
    if len(digits) >= 8:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    return _date_token()


def process_content_pipeline_once(
    *,
    landing_root: Path,
    workspace_root: Path,
    process_job_fn: Callable[[Path], dict[str, Any]] = process_job_once,
    drive_root_id: str | None = None,
    drive_account: str | None = None,
    reply_after_upload: bool | None = None,
    reply_account: str | None = None,
) -> dict[str, Any]:
    landing_root = Path(landing_root)
    workspace_root = Path(workspace_root)
    processed_count = 0
    skipped_count = 0
    failed_count = 0
    message_ids: set[str] = set()
    date_tokens: set[str] = set()

    for metadata_path in sorted(landing_root.glob("**/incoming/*/metadata.json")):
        message_metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        date_token = _normalize_landing_date(metadata_path.parts[-4])
        date_tokens.add(date_token)
        message_id = str(message_metadata.get("messageId") or "").strip()
        if message_id:
            message_ids.add(message_id)
        saved_files = message_metadata.get("savedFiles")
        if not isinstance(saved_files, list):
            continue
        for saved_file in saved_files:
            if not isinstance(saved_file, dict):
                continue
            raw_path = Path(str(saved_file.get("path") or ""))
            if raw_path.suffix.lower() != ".mp3" or not raw_path.exists():
                continue
            attachment_metadata = dict(saved_file)
            attachment_metadata["metadata_path"] = str(metadata_path)
            job_dir = create_or_load_content_pipeline_job_dir(
                audio_path=raw_path,
                workspace_root=workspace_root,
                message_metadata=message_metadata,
                attachment_metadata=attachment_metadata,
                date_token=date_token,
            )
            job = _load_job(job_dir)
            if job.get("status") == "completed":
                skipped_count += 1
                continue
            try:
                process_job_fn(job_dir)
                processed_count += 1
            except Exception as exc:
                job = _load_job(job_dir)
                job["status"] = "failed"
                job["error"] = str(exc)
                _write_job(job_dir, job)
                failed_count += 1

    result = {
        "processed_count": processed_count,
        "skipped_count": skipped_count,
        "failed_count": failed_count,
    }

    resolved_drive_root_id = str(
        drive_root_id or _content_pipeline_drive_root_id()
    ).strip()
    resolved_drive_account = str(
        drive_account or _content_pipeline_drive_account()
    ).strip()
    resolved_reply_after_upload = (
        _content_pipeline_reply_after_upload()
        if reply_after_upload is None
        else bool(reply_after_upload)
    )
    resolved_reply_account = str(
        reply_account or _content_pipeline_reply_account()
    ).strip()
    if resolved_drive_root_id and resolved_drive_account:
        result.update(
            sync_content_pipeline_message_groups(
                workspace_root=workspace_root,
                message_ids=message_ids,
                date_tokens=date_tokens,
                drive_root_id=resolved_drive_root_id,
                drive_account=resolved_drive_account,
                reply_after_upload=resolved_reply_after_upload,
                reply_account=resolved_reply_account,
            )
        )

    return result


def process_dropbox_once(
    *,
    input_dir: Path,
    workspace_root: Path,
    process_job_fn: Callable[[Path], dict[str, Any]] = process_audio_job,
    date_token: str | None = None,
) -> dict[str, Any]:
    input_dir = Path(input_dir)
    workspace_root = Path(workspace_root)
    date_value = _date_token(date_token)
    processed_count = 0
    skipped_count = 0
    failed_count = 0

    for audio_path in sorted(input_dir.glob("*.mp3")):
        job_dir = create_or_load_job_dir(
            audio_path, workspace_root, date_token=date_value
        )
        job = _load_job(job_dir)
        if job.get("status") == "completed":
            skipped_count += 1
            continue
        try:
            process_job_fn(job_dir)
            processed_count += 1
        except Exception as exc:
            job = _load_job(job_dir)
            job["status"] = "failed"
            job["error"] = str(exc)
            _write_job(job_dir, job)
            failed_count += 1

    return {
        "date": date_value,
        "processed_count": processed_count,
        "skipped_count": skipped_count,
        "failed_count": failed_count,
    }


def watch_audio_card_factory(
    *,
    input_dir: Path,
    workspace_root: Path,
    poll_seconds: int = 15,
    once: bool = False,
) -> dict[str, Any]:
    result = process_dropbox_once(input_dir=input_dir, workspace_root=workspace_root)
    if once:
        return result
    while True:
        time.sleep(max(5, int(poll_seconds)))
        result = process_dropbox_once(
            input_dir=input_dir, workspace_root=workspace_root
        )


def watch_content_pipeline_factory(
    *,
    landing_root: Path,
    workspace_root: Path,
    poll_seconds: int = 15,
    once: bool = False,
    drive_root_id: str | None = None,
    drive_account: str | None = None,
    reply_after_upload: bool | None = None,
    reply_account: str | None = None,
) -> dict[str, Any]:
    result = process_content_pipeline_once(
        landing_root=landing_root,
        workspace_root=workspace_root,
        drive_root_id=drive_root_id,
        drive_account=drive_account,
        reply_after_upload=reply_after_upload,
        reply_account=reply_account,
    )
    if once:
        return result
    while True:
        time.sleep(max(5, int(poll_seconds)))
        result = process_content_pipeline_once(
            landing_root=landing_root,
            workspace_root=workspace_root,
            drive_root_id=drive_root_id,
            drive_account=drive_account,
            reply_after_upload=reply_after_upload,
            reply_account=reply_account,
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Process audio-card jobs from a flat mp3 folder or a content_pipeline landing tree"
    )
    parser.add_argument("--input-dir")
    parser.add_argument("--landing-root")
    parser.add_argument("--workspace-root", required=True)
    parser.add_argument("--poll-seconds", type=int, default=15)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--drive-root-id")
    parser.add_argument("--drive-account")
    parser.add_argument("--reply-account")
    parser.add_argument("--reply-after-upload", action="store_true", default=None)
    args = parser.parse_args()

    if not args.input_dir and not args.landing_root:
        raise SystemExit("One of --input-dir or --landing-root is required")
    if args.input_dir and args.landing_root:
        raise SystemExit("Use either --input-dir or --landing-root, not both")

    if args.landing_root:
        result = watch_content_pipeline_factory(
            landing_root=Path(args.landing_root),
            workspace_root=Path(args.workspace_root),
            poll_seconds=args.poll_seconds,
            once=args.once,
            drive_root_id=args.drive_root_id,
            drive_account=args.drive_account,
            reply_after_upload=args.reply_after_upload,
            reply_account=args.reply_account,
        )
    else:
        result = watch_audio_card_factory(
            input_dir=Path(args.input_dir),
            workspace_root=Path(args.workspace_root),
            poll_seconds=args.poll_seconds,
            once=args.once,
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
