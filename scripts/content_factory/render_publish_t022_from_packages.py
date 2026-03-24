import argparse
import base64
import hashlib
import json
import mimetypes
import os
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.content_factory.retained_video_manifest_merge import atomic_write_json


ROOM_ID = "t_022"
PROGRAM_SLUG = "china-bigtech"
PROGRAM_TITLE = "内容工厂·国内大厂"
DEFAULT_PACKAGE_JSON = (
    REPO_ROOT
    / "data"
    / "live"
    / "onlytrade"
    / "topic_packages"
    / "china_bigtech_packages.json"
)
DEFAULT_LOCAL_BATCH_MANIFEST = (
    REPO_ROOT
    / "data"
    / "live"
    / "onlytrade"
    / "content_factory"
    / "china_bigtech_factory_live.batch.json"
)
DEFAULT_LOCAL_VIDEO_DIR = (
    REPO_ROOT / "data" / "live" / "onlytrade" / "content_videos" / ROOM_ID
)
DEFAULT_LOCAL_POSTER_DIR = (
    REPO_ROOT / "data" / "live" / "onlytrade" / "content_posters" / ROOM_ID
)
DEFAULT_TOPIC_IMAGE_DIR = (
    REPO_ROOT / "data" / "live" / "onlytrade" / "topic_images" / "t_019"
)
DEFAULT_TOPIC_AUDIO_DIR = (
    REPO_ROOT / "data" / "live" / "onlytrade" / "topic_audio" / "t_019"
)
DEFAULT_RENDERER_DIR = REPO_ROOT / "content-factory-renderer"
DEFAULT_VM_HOST = "113.125.202.169"
DEFAULT_VM_PORT = "21522"
DEFAULT_VM_USER = "root"
DEFAULT_VM_KEY = str(Path.home() / ".ssh" / "cn169_ed25519")
DEFAULT_REMOTE_ROOT = "/opt/onlytrade"


def _npm_executable() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_packages(package_json_path: Path) -> List[Dict[str, Any]]:
    raw = json.loads(package_json_path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        packages = raw
    elif isinstance(raw, dict) and isinstance(raw.get("packages"), list):
        packages = raw.get("packages") or []
    else:
        raise ValueError(
            "package JSON must be a TopicPackage[] or an object with a packages list"
        )
    return [dict(item) for item in packages if isinstance(item, dict)]


def _sanitize_token(value: Any, fallback: str) -> str:
    text = str(value or "").strip().lower()
    out = []
    for char in text:
        if char.isalnum():
            out.append(char)
        else:
            out.append("_")
    token = "".join(out).strip("_")
    while "__" in token:
        token = token.replace("__", "_")
    return token or fallback


def _segment_date_token(package: Dict[str, Any]) -> str:
    published_at = str(package.get("published_at") or "").strip()
    digits = "".join(char for char in published_at if char.isdigit())
    if len(digits) >= 8:
        return digits[:8]
    return datetime.now(timezone.utc).strftime("%Y%m%d")


def build_segment_id(package: Dict[str, Any]) -> str:
    entity_key = _sanitize_token(package.get("entity_key"), "topic")
    digest = hashlib.sha1(
        str(
            package.get("topic_id")
            or package.get("id")
            or package.get("title")
            or entity_key
        ).encode("utf-8", errors="ignore")
    ).hexdigest()[:6]
    return "cf_{0}_{1}_{2}".format(entity_key, _segment_date_token(package), digest)


def _as_file_uri(path_value: Path) -> str:
    return path_value.resolve().as_uri()


def _as_media_src(path_value: Path) -> str:
    mime_type, _ = mimetypes.guess_type(str(path_value))
    encoded = base64.b64encode(path_value.read_bytes()).decode("ascii")
    return "data:{0};base64,{1}".format(
        mime_type or "application/octet-stream", encoded
    )


def _resolve_local_asset_path(value: str, *, fallback_dir: Path) -> Optional[Path]:
    raw = str(value or "").strip()
    if not raw:
        return None
    candidate = Path(raw)
    search_paths: List[Path] = []
    if candidate.is_absolute():
        search_paths.append(candidate)
    else:
        search_paths.extend(
            [
                (REPO_ROOT / candidate).resolve(),
                (fallback_dir / candidate).resolve(),
                (fallback_dir / candidate.name).resolve(),
            ]
        )
    for path in search_paths:
        if path.is_file():
            return path
    return None


def _package_visuals(package: Dict[str, Any]) -> List[Dict[str, str]]:
    visuals = []
    for item in package.get("selected_visuals") or []:
        if not isinstance(item, dict):
            continue
        local_value = str(
            item.get("local_path")
            or item.get("local_file")
            or item.get("image_file")
            or ""
        ).strip()
        local_path = _resolve_local_asset_path(
            local_value, fallback_dir=DEFAULT_TOPIC_IMAGE_DIR
        )
        if local_path is None:
            continue
        visuals.append(
            {
                "type": str(item.get("type") or "visual").strip() or "visual",
                "src": _as_media_src(local_path),
            }
        )
    return visuals[:3]


def _resolved_visual_paths(package: Dict[str, Any]) -> List[Dict[str, Any]]:
    visuals = []
    for item in package.get("selected_visuals") or []:
        if not isinstance(item, dict):
            continue
        local_value = str(
            item.get("local_path")
            or item.get("local_file")
            or item.get("image_file")
            or ""
        ).strip()
        local_path = _resolve_local_asset_path(
            local_value, fallback_dir=DEFAULT_TOPIC_IMAGE_DIR
        )
        if local_path is None:
            continue
        visuals.append(
            {
                "type": str(item.get("type") or "visual").strip() or "visual",
                "path": local_path,
            }
        )
    return visuals[:3]


def _package_audio_path(package: Dict[str, Any]) -> Optional[Path]:
    return _resolve_local_asset_path(
        str(package.get("audio_local_path") or package.get("audio_file") or ""),
        fallback_dir=DEFAULT_TOPIC_AUDIO_DIR,
    )


def _estimated_duration_sec(package: Dict[str, Any]) -> float:
    raw = package.get("script_estimated_seconds")
    try:
        duration = float(str(raw)) if raw is not None else 60.0
    except (TypeError, ValueError):
        duration = 60.0
    return max(1.0, round(duration, 2))


def _copy_poster(package: Dict[str, Any], destination: Path) -> bool:
    for item in package.get("selected_visuals") or []:
        if not isinstance(item, dict):
            continue
        local_value = str(
            item.get("local_path")
            or item.get("local_file")
            or item.get("image_file")
            or ""
        ).strip()
        source = _resolve_local_asset_path(
            local_value, fallback_dir=DEFAULT_TOPIC_IMAGE_DIR
        )
        if source is None:
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(str(source), str(destination))
        return True
    return False


def _normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _build_headline_text(package: Dict[str, Any], segment_id: str) -> str:
    return _normalize_text(
        package.get("screen_title") or package.get("title") or segment_id
    )


def _condense_commentary_script(value: Any) -> str:
    text = _normalize_text(value)
    if not text:
        return ""

    text = re.sub(
        r"^(今天我们来聊聊|今天我们看到|今天聊聊|先看这件事)[，,：:]?", "", text
    )
    sentences = [
        part.strip() for part in re.split(r"(?<=[。！？!?])", text) if part.strip()
    ]
    if not sentences:
        return text

    preferred = []
    for sentence in sentences:
        if sentence.startswith("接下来要看"):
            continue
        preferred.append(sentence)
        if len(preferred) >= 2:
            break

    condensed = "".join(preferred) if preferred else sentences[0]
    return condensed.strip()


def _build_commentary_text(package: Dict[str, Any]) -> str:
    for candidate in (
        package.get("topic_reason"),
        package.get("commentary_text"),
        package.get("screen_commentary"),
    ):
        text = _normalize_text(candidate)
        if text:
            return text

    condensed_script = _condense_commentary_script(package.get("commentary_script"))
    if condensed_script:
        return condensed_script

    return _normalize_text(package.get("summary_facts"))


def _build_render_props(
    *,
    package: Dict[str, Any],
    segment_id: str,
    audio_src: str,
    staged_visuals: Sequence[Dict[str, str]],
) -> Dict[str, Any]:
    return {
        "title": str(package.get("screen_title") or package.get("title") or segment_id),
        "summary": str(
            package.get("summary_facts") or package.get("commentary_script") or ""
        ),
        "headlineText": _build_headline_text(package, segment_id),
        "commentaryText": _build_commentary_text(package),
        "audioSrc": audio_src,
        "audioDurationInSeconds": _estimated_duration_sec(package),
        "visuals": list(staged_visuals),
    }


def _stage_render_media(
    *,
    renderer_dir: Path,
    segment_id: str,
    audio_path: Path,
    visuals: Sequence[Dict[str, Any]],
) -> Tuple[str, List[Dict[str, str]], Path]:
    stage_root = renderer_dir / "public" / "t022-render-assets" / segment_id
    if stage_root.exists():
        shutil.rmtree(stage_root)
    stage_root.mkdir(parents=True, exist_ok=True)

    staged_audio_name = "audio{0}".format(audio_path.suffix or ".bin")
    shutil.copyfile(str(audio_path), str(stage_root / staged_audio_name))
    audio_src = "/t022-render-assets/{0}/{1}".format(segment_id, staged_audio_name)

    staged_visuals: List[Dict[str, str]] = []
    for index, visual in enumerate(visuals):
        source_path = visual["path"]
        suffix = source_path.suffix or ".bin"
        staged_name = "visual-{0:02d}{1}".format(index + 1, suffix)
        shutil.copyfile(str(source_path), str(stage_root / staged_name))
        staged_visuals.append(
            {
                "type": str(visual.get("type") or "visual"),
                "src": "/t022-render-assets/{0}/{1}".format(segment_id, staged_name),
            }
        )

    return audio_src, staged_visuals, stage_root


def _build_segment_row(
    package: Dict[str, Any], segment_id: str, video_file: str, poster_file: str
) -> Dict[str, Any]:
    topic_id = str(package.get("topic_id") or package.get("id") or segment_id).strip()
    title = _build_headline_text(package, topic_id)
    summary = str(
        package.get("summary_facts") or package.get("commentary_script") or ""
    ).strip()
    return {
        "id": segment_id,
        "topic_id": topic_id,
        "title": title,
        "summary": summary,
        "headline_text": title,
        "commentary_text": _build_commentary_text(package),
        "published_at": str(package.get("published_at") or "").strip(),
        "duration_sec": _estimated_duration_sec(package),
        "video_file": video_file,
        "poster_file": poster_file,
        "video_api_url": "/api/content-factory/videos/{0}/{1}".format(
            ROOM_ID, video_file
        ),
        "poster_api_url": "/api/content-factory/posters/{0}/{1}".format(
            ROOM_ID, poster_file
        ),
    }


def _build_batch_manifest(segments: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "schema_version": "content.factory.feed.v1",
        "room_id": ROOM_ID,
        "program_slug": PROGRAM_SLUG,
        "program_title": PROGRAM_TITLE,
        "as_of": _utc_now_iso(),
        "segment_count": len(segments),
        "segments": segments,
    }


def render_segment(
    package: Dict[str, Any],
    *,
    renderer_dir: Path,
    local_video_dir: Path,
    local_poster_dir: Path,
) -> Optional[Tuple[Dict[str, Any], Path, Path]]:
    audio_path = _package_audio_path(package)
    if audio_path is None or not audio_path.is_file():
        return None
    visuals = _resolved_visual_paths(package)
    if len(visuals) != 3:
        return None

    segment_id = build_segment_id(package)
    video_path = local_video_dir / (segment_id + ".mp4")
    poster_path = local_poster_dir / (segment_id + ".jpg")
    local_video_dir.mkdir(parents=True, exist_ok=True)
    local_poster_dir.mkdir(parents=True, exist_ok=True)
    audio_src, staged_visuals, stage_root = _stage_render_media(
        renderer_dir=renderer_dir,
        segment_id=segment_id,
        audio_path=audio_path,
        visuals=visuals,
    )

    props = _build_render_props(
        package=package,
        segment_id=segment_id,
        audio_src=audio_src,
        staged_visuals=staged_visuals,
    )
    command = [
        _npm_executable(),
        "--prefix",
        str(renderer_dir),
        "run",
        "render:segment",
        "--",
        str(video_path),
        "--props={0}".format(json.dumps(props, ensure_ascii=False)),
    ]
    try:
        subprocess.run(command, cwd=str(renderer_dir), check=True)
    finally:
        shutil.rmtree(stage_root, ignore_errors=True)
    if not video_path.is_file():
        return None
    if not _copy_poster(package, poster_path):
        return None
    segment_row = _build_segment_row(
        package,
        segment_id=segment_id,
        video_file=video_path.name,
        poster_file=poster_path.name,
    )
    return segment_row, video_path, poster_path


def _create_tgz(
    archive_path: Path, base_dir: Path, files: Sequence[Path]
) -> Optional[Path]:
    if not files:
        return None
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(str(archive_path), "w:gz") as tar:
        for file_path in files:
            tar.add(str(file_path), arcname=file_path.name)
    return archive_path


def _run_command(
    command: Sequence[str], *, disable_msys_path_conversion: bool = False
) -> None:
    env = None
    if disable_msys_path_conversion and os.name == "nt":
        env = os.environ.copy()
        env["MSYS2_ARG_CONV_EXCL"] = "*"
        env["MSYS_NO_PATHCONV"] = "1"
    subprocess.run(list(command), cwd=str(REPO_ROOT), check=True, env=env)


def _remote_paths(remote_root: str) -> Dict[str, str]:
    live_root = remote_root.rstrip("/") + "/data/live/onlytrade"
    return {
        "remote_root": remote_root.rstrip("/"),
        "manifest": live_root + "/content_factory/china_bigtech_factory_live.json",
        "incoming": live_root
        + "/content_factory/china_bigtech_factory_live.incoming.json",
        "video_dir": live_root + "/content_videos/{0}".format(ROOM_ID),
        "poster_dir": live_root + "/content_posters/{0}".format(ROOM_ID),
        "merge_script": remote_root.rstrip("/")
        + "/scripts/content_factory/retained_video_manifest_merge.py",
    }


def upload_batch(
    manifest_path: Path,
    video_files: Sequence[Path],
    poster_files: Sequence[Path],
    *,
    vm_host: str,
    vm_port: str,
    vm_user: str,
    vm_key: str,
    remote_root: str,
    retain_limit: int,
) -> None:
    remote = _remote_paths(remote_root)
    ssh_base = [
        "ssh",
        "-p",
        str(vm_port),
        "-i",
        str(vm_key),
        "{0}@{1}".format(vm_user, vm_host),
    ]
    scp_base = ["scp", "-P", str(vm_port), "-i", str(vm_key)]

    mkdir_command = "mkdir -p {0} {1} {2} {3}".format(
        shlex.quote(str(Path(remote["manifest"]).parent).replace("\\", "/")),
        shlex.quote(str(Path(remote["incoming"]).parent).replace("\\", "/")),
        shlex.quote(remote["video_dir"]),
        shlex.quote(remote["poster_dir"]),
    )
    _run_command(ssh_base + [mkdir_command], disable_msys_path_conversion=True)
    _run_command(
        scp_base
        + [
            str(manifest_path),
            "{0}@{1}:{2}".format(vm_user, vm_host, remote["incoming"]),
        ],
        disable_msys_path_conversion=True,
    )

    with tempfile.TemporaryDirectory(prefix="t022_push_") as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        video_archive = _create_tgz(
            temp_dir / "t022-videos.tgz", manifest_path.parent, video_files
        )
        poster_archive = _create_tgz(
            temp_dir / "t022-posters.tgz", manifest_path.parent, poster_files
        )
        if video_archive is not None:
            _run_command(
                scp_base
                + [
                    str(video_archive),
                    "{0}@{1}:{2}/t022-videos.tgz".format(
                        vm_user, vm_host, remote["remote_root"]
                    ),
                ],
                disable_msys_path_conversion=True,
            )
        if poster_archive is not None:
            _run_command(
                scp_base
                + [
                    str(poster_archive),
                    "{0}@{1}:{2}/t022-posters.tgz".format(
                        vm_user, vm_host, remote["remote_root"]
                    ),
                ],
                disable_msys_path_conversion=True,
            )

    merge_command = " && ".join(
        [
            "set -euo pipefail",
            "if [ -f {0}/t022-videos.tgz ]; then tar -xzf {0}/t022-videos.tgz -C {1}; rm -f {0}/t022-videos.tgz; fi".format(
                shlex.quote(remote["remote_root"]), shlex.quote(remote["video_dir"])
            ),
            "if [ -f {0}/t022-posters.tgz ]; then tar -xzf {0}/t022-posters.tgz -C {1}; rm -f {0}/t022-posters.tgz; fi".format(
                shlex.quote(remote["remote_root"]), shlex.quote(remote["poster_dir"])
            ),
            "python3 {0} --existing {1} --incoming {2} --output {1} --retain-limit {3} --video-dir {4} --poster-dir {5} --room-id {6} --program-slug {7}".format(
                shlex.quote(remote["merge_script"]),
                shlex.quote(remote["manifest"]),
                shlex.quote(remote["incoming"]),
                int(retain_limit),
                shlex.quote(remote["video_dir"]),
                shlex.quote(remote["poster_dir"]),
                shlex.quote(ROOM_ID),
                shlex.quote(PROGRAM_SLUG),
            ),
            "rm -f {0}".format(shlex.quote(remote["incoming"])),
        ]
    )
    _run_command(
        ssh_base + ["bash", "-lc", merge_command],
        disable_msys_path_conversion=True,
    )


def run_publish(args: argparse.Namespace) -> int:
    package_json = Path(args.package_json).resolve()
    if not package_json.exists():
        raise FileNotFoundError("package JSON not found: {0}".format(package_json))

    packages = _load_packages(package_json)
    local_video_dir = Path(args.local_video_dir).resolve()
    local_poster_dir = Path(args.local_poster_dir).resolve()
    batch_manifest_path = Path(args.batch_manifest).resolve()
    renderer_dir = Path(args.renderer_dir).resolve()

    rendered_segments = []
    rendered_videos = []
    rendered_posters = []

    for package in packages:
        try:
            rendered = render_segment(
                package,
                renderer_dir=renderer_dir,
                local_video_dir=local_video_dir,
                local_poster_dir=local_poster_dir,
            )
        except subprocess.CalledProcessError as exc:
            print(
                "[t022-render] skip topic {0}: renderer failed ({1})".format(
                    package.get("topic_id") or package.get("id") or "unknown",
                    exc.returncode,
                ),
                file=sys.stderr,
            )
            continue
        if rendered is None:
            continue
        segment_row, video_path, poster_path = rendered
        rendered_segments.append(segment_row)
        rendered_videos.append(video_path)
        rendered_posters.append(poster_path)

    batch_manifest = _build_batch_manifest(rendered_segments)
    atomic_write_json(str(batch_manifest_path), batch_manifest)

    if not rendered_segments:
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": "no_rendered_segments",
                    "package_json": str(package_json),
                    "batch_manifest": str(batch_manifest_path),
                },
                ensure_ascii=False,
            )
        )
        return 3

    upload_batch(
        batch_manifest_path,
        rendered_videos,
        rendered_posters,
        vm_host=args.vm_host,
        vm_port=args.vm_port,
        vm_user=args.vm_user,
        vm_key=args.vm_key,
        remote_root=args.remote_root,
        retain_limit=args.retain_limit,
    )
    print(
        json.dumps(
            {
                "ok": True,
                "package_json": str(package_json),
                "batch_manifest": str(batch_manifest_path),
                "segment_count": len(rendered_segments),
                "video_dir": str(local_video_dir),
                "poster_dir": str(local_poster_dir),
            },
            ensure_ascii=False,
        )
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Render and publish t_022 segments from TopicPackage JSON"
    )
    parser.add_argument("--package-json", default=str(DEFAULT_PACKAGE_JSON))
    parser.add_argument("--batch-manifest", default=str(DEFAULT_LOCAL_BATCH_MANIFEST))
    parser.add_argument("--local-video-dir", default=str(DEFAULT_LOCAL_VIDEO_DIR))
    parser.add_argument("--local-poster-dir", default=str(DEFAULT_LOCAL_POSTER_DIR))
    parser.add_argument("--renderer-dir", default=str(DEFAULT_RENDERER_DIR))
    parser.add_argument("--vm-host", default=DEFAULT_VM_HOST)
    parser.add_argument("--vm-port", default=DEFAULT_VM_PORT)
    parser.add_argument("--vm-user", default=DEFAULT_VM_USER)
    parser.add_argument("--vm-key", default=DEFAULT_VM_KEY)
    parser.add_argument("--remote-root", default=DEFAULT_REMOTE_ROOT)
    parser.add_argument("--retain-limit", type=int, default=20)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return run_publish(args)


if __name__ == "__main__":
    raise SystemExit(main())
