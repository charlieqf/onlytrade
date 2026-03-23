from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def _read_script(name: str) -> str:
    return (REPO_ROOT / "scripts" / "topic_stream" / name).read_text(encoding="utf-8")


def test_t019_push_script_avoids_direct_canonical_json_overwrite() -> None:
    content = _read_script("local_collect_and_push_t019.sh")
    assert '"$LOCAL_JSON" "$VM_USER@$VM_HOST:$REMOTE_JSON"' not in content
    assert "REMOTE_JSON_TMP" not in content
    assert "mv '$REMOTE_JSON_TMP' '$REMOTE_JSON'" not in content


def test_t019_push_script_defaults_to_20_topics() -> None:
    content = _read_script("local_collect_and_push_t019.sh")
    assert '--limit-total "${T019_LIMIT_TOTAL:-20}"' in content


def test_t019_push_script_uses_remote_retained_merge_flow() -> None:
    content = _read_script("local_collect_and_push_t019.sh")
    assert "REMOTE_INCOMING_JSON" in content
    assert "retained_feed_merge.py" in content
    assert "T019_RETAIN_LIMIT" in content or "--retain-limit" in content
    assert '--image-dir "$REMOTE_IMAGE_DIR"' in content
    assert '--audio-dir "$REMOTE_AUDIO_DIR"' in content


def test_t022_push_script_regenerates_packages_before_rendering() -> None:
    content = (
        REPO_ROOT / "scripts" / "content_factory" / "local_render_and_push_t022.sh"
    ).read_text(encoding="utf-8")
    assert "scripts/topic_stream/run_china_bigtech_cycle.py" in content
    assert '--package-output "$PACKAGE_JSON"' in content
    assert "scripts/content_factory/render_publish_t022_from_packages.py" in content


def test_t022_push_script_preserves_remote_root_across_msys_boundary() -> None:
    content = (
        REPO_ROOT / "scripts" / "content_factory" / "local_render_and_push_t022.sh"
    ).read_text(encoding="utf-8")
    assert "MSYS2_ARG_CONV_EXCL='--remote-root='" in content
    assert '--remote-root="$REMOTE_ROOT"' in content
