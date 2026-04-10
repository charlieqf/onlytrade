from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _normalize_version(version: str) -> str:
    version = version.strip()
    return version if version.startswith("v") else f"v{version}"


def _preview_name(second: float) -> str:
    second_text = str(second).replace(".", "_")
    if second_text.endswith("_0"):
        second_text = second_text[:-2]
    return f"preview_{second_text}s.jpg"


def _load_topic_json(topic_dir: Path) -> dict:
    topic_path = topic_dir / "topic.json"
    if not topic_path.exists():
        raise FileNotFoundError(f"Missing topic.json: {topic_path}")
    return json.loads(topic_path.read_text(encoding="utf-8"))


def _preferred_output_video_name(
    topic_dir: Path, *, topic_key: str, version: str
) -> str:
    job_path = topic_dir / "job.json"
    if job_path.exists():
        try:
            job = json.loads(job_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            job = {}
        for key in ("source_attachment_name", "input_name"):
            raw_name = str(job.get(key) or "").strip()
            if raw_name:
                source_name = Path(raw_name).name
                stem = Path(source_name).stem.strip()
                if stem:
                    return f"{stem}.mp4"
    return f"{topic_key}_sample_{version}.mp4"


@dataclass
class RenderContext:
    root_dir: Path
    topic_dir: Path
    topic_key: str
    version: str
    composition_id: str
    render_props_path: Path
    output_dir: Path
    output_video_path: Path
    metadata_path: Path
    process_note_path: Path
    preview_seconds: list[float]
    preview_paths: list[Path]
    renderer_workdir: Path


def create_render_context(
    topic_dir: Path,
    *,
    version: str,
    root_dir: Path | None = None,
    preview_seconds: Sequence[float],
    composition_id: str = "tldr-sample-cut",
) -> RenderContext:
    topic_dir = Path(topic_dir)
    root_dir = Path(root_dir) if root_dir is not None else _repo_root()
    topic_data = _load_topic_json(topic_dir)
    topic_key = str(topic_data["topic_key"])
    version = _normalize_version(version)
    output_dir = topic_dir / f"sample_cut_{version}"
    output_video_path = output_dir / _preferred_output_video_name(
        topic_dir, topic_key=topic_key, version=version
    )
    preview_values = [float(v) for v in preview_seconds]
    preview_paths = [output_dir / _preview_name(value) for value in preview_values]
    return RenderContext(
        root_dir=root_dir,
        topic_dir=topic_dir,
        topic_key=topic_key,
        version=version,
        composition_id=composition_id,
        render_props_path=output_dir / f"sample_cut_{version}_render_props.json",
        output_dir=output_dir,
        output_video_path=output_video_path,
        metadata_path=output_dir / f"{topic_key}_sample_{version}.metadata.json",
        process_note_path=output_dir / f"sample_cut_{version}_process.md",
        preview_seconds=preview_values,
        preview_paths=preview_paths,
        renderer_workdir=root_dir / "content-factory-renderer",
    )


def _default_runner(command: str, *, workdir: Path) -> None:
    subprocess.run(command, cwd=workdir, shell=True, check=True)


def _shell_path(path: Path) -> str:
    return path.resolve().as_posix()


def _load_render_props(context: RenderContext) -> dict:
    return json.loads(context.render_props_path.read_text(encoding="utf-8"))


def _resolve_render_entry(context: RenderContext) -> tuple[str, str]:
    props = _load_render_props(context)
    audio_src = str(props.get("audioSrc") or "").strip()
    video_src = str(props.get("videoSrc") or "").strip()
    if audio_src and not video_src and context.composition_id == "tldr-sample-cut":
        return ("src/audio-card-index.ts", "audio-card-sample-cut")
    return ("src/index.ts", context.composition_id)


def _write_metadata(context: RenderContext) -> dict:
    payload = {
        "video": context.output_video_path.name,
        "fileSizeBytes": context.output_video_path.stat().st_size,
        "renderProps": context.render_props_path.name,
        "previewFrames": [path.name for path in context.preview_paths],
        "compositionId": context.composition_id,
    }
    context.metadata_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return payload


def _write_process_note(context: RenderContext) -> None:
    content = f"""# Sample Cut {context.version.upper()} Process

## Output

- Final sample: `{context.output_video_path.name}`
- Metadata: `{context.metadata_path.name}`
- Render props archive: `{context.render_props_path.name}`

## Preview Frames

"""
    content += "\n".join(f"- `{path.name}`" for path in context.preview_paths)
    content += "\n\n## Note\n\n- This process note was created by the shared render script. Add editorial review notes in later iterations if needed.\n"
    context.process_note_path.write_text(content, encoding="utf-8")


def render_sample_cut(
    context: RenderContext,
    *,
    runner: Callable[[str], None] | Callable[..., None] = _default_runner,
) -> dict:
    if not context.render_props_path.exists():
        raise FileNotFoundError(
            f"Missing render props file: {context.render_props_path}"
        )

    context.output_dir.mkdir(parents=True, exist_ok=True)

    output_video_path = _shell_path(context.output_video_path)
    render_props_path = _shell_path(context.render_props_path)
    render_entry, composition_id = _resolve_render_entry(context)

    render_command = (
        f"npx remotion render {render_entry} {composition_id} "
        f'"{output_video_path}" '
        f"--props={render_props_path}"
    )
    runner(render_command, workdir=context.renderer_workdir)

    for second, preview_path in zip(
        context.preview_seconds, context.preview_paths, strict=True
    ):
        frame = round(second * 30)
        preview_shell_path = _shell_path(preview_path)
        still_command = (
            f"npx remotion still {render_entry} {composition_id} "
            f'"{preview_shell_path}" '
            f"--props={render_props_path} "
            f"--frame={frame}"
        )
        runner(still_command, workdir=context.renderer_workdir)

    metadata = _write_metadata(context)
    _write_process_note(context)
    return {
        "output_video": str(context.output_video_path),
        "metadata": metadata,
        "preview_paths": [str(path) for path in context.preview_paths],
        "process_note": str(context.process_note_path),
    }


def _parse_preview_seconds(raw: str) -> list[float]:
    values = [piece.strip() for piece in raw.split(",") if piece.strip()]
    return [float(value) for value in values]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Render a versioned TLDR sample cut and preview stills"
    )
    parser.add_argument("--topic-dir", required=True)
    parser.add_argument("--version", default="v1")
    parser.add_argument("--preview-seconds", default="1,8,20,26")
    parser.add_argument("--composition-id", default="tldr-sample-cut")
    args = parser.parse_args()

    context = create_render_context(
        Path(args.topic_dir),
        version=args.version,
        preview_seconds=_parse_preview_seconds(args.preview_seconds),
        composition_id=args.composition_id,
    )
    result = render_sample_cut(context)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
