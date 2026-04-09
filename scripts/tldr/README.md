# TLDR Scripts Contract

This directory is the shared automation surface for the TLDR workflow.

## Rule

If logic is reusable across topics, it belongs here.

If logic is only a temporary experiment for one topic, it may start in that topic workspace, but it must either:

- be upstreamed into `scripts/tldr/`, or
- be deleted once the experiment is over

## Script Naming

- `fetch_*` - get raw input from external systems
- `extract_*` - parse and normalize data
- `rank_*` - score and rewrite candidate topics
- `build_*` - write deterministic files and assets
- `transcribe_*` - create STT artifacts from recorded A-roll
- `render_*` - render sample-cut outputs and still previews
- `verify_*` - validate output integrity and required files
- `run_*` - orchestration entrypoints

## Current Shared Scripts

- `analyze_aroll_quality.py`
- `build_gaze_calibration.py`
- `build_audio_card_assets.py`
- `clean_transcript.py`
- `gaze_calibration.example.json`
- `build_topic_workspace.py`
- `build_sample_cut_assets.py`
- `extract_tldr_topics.py`
- `fetch_gmail_tldr.py`
- `fetch_tldr_public.py`
- `rank_tldr_topics.py`
- `render_sample_cut.py`
- `run_audio_card_factory.py`
- `run_tldr_workspace_cycle.py`
- `transcribe_aroll.py`

## Audio Card Workflow

For audio-only vertical shorts that start from a dropped `mp3` file:

- `clean_transcript.py` - deterministic STT cleanup that rewrites `recording/video.stt.cleaned.md`
- `build_audio_card_assets.py` - generates pure text card images and `sample_cut_vN_asset_manifest.json`
- `run_audio_card_factory.py` - watches an input folder, creates per-audio workspaces, skips completed hashes, and renders previews plus mp4 outputs

Recommended macOS / mac mini entrypoint:

```bash
uv run --with faster-whisper --with pillow python -m scripts.tldr.run_audio_card_factory \
  --input-dir /path/to/mp3-dropbox \
  --workspace-root /path/to/audio-card-workspace
```

Add `--once` for a single scan instead of continuous watching.

## Missing Shared Scripts To Add Next

- `verify_sample_cut.py`

## Optional A-Roll Quality Analysis

- `analyze_aroll_quality.py` is default-off by design.
- Enable it only when you want the pipeline to score eye-contact / face-on-camera quality and emit `recording/video.quality.json`.
- The current v1 implementation is CPU-first and does not require a GPU.
- The script is intended to suggest weaker A-roll ranges for B-roll coverage, not to hallucinate better face direction where no good take exists.
- For calibrated `camera` vs `prompter` classification, see `gaze_calibration.example.json` and `docs/runbooks/tldr-prompter-detection.md`.
- Use `build_gaze_calibration.py` to turn a short camera-looking range and a short prompter-looking range into `recording/video.gaze_calibration.json`.

## Proven Scope From The Anthropic Harness Run

The next shared scripts should absorb these now-proven responsibilities:

### `build_sample_cut_assets.py`

- accept `--topic-dir` and `--version`
- package real source visuals from `assets/`
- generate only the minimum helper cards needed for the first review cut
- write `sample_cut_vN_asset_manifest.json`
- support a pre-recording asset-prep mode so the visual package can be finalized before A-roll arrives

### `render_sample_cut.py`

- accept `--topic-dir` and `--version`
- read standard render props from `sample_cut_vN/sample_cut_vN_render_props.json`
- render the sample mp4 plus preview stills
- archive metadata and process notes beside the render outputs

### `verify_sample_cut.py`

- fail if the canonical recording is missing
- fail if preview frames or metadata are missing
- verify the rendered sample still has spoken audio
- enforce the first-cut quality bar from the runbooks instead of allowing low-information outputs to pass silently

## Testing Rule

Every stable shared script should have a matching `test_*.py` file in this directory.

## Path Rule

Shared scripts should accept paths as arguments, such as:

- `--workspace-root`
- `--topic-dir`
- `--version`

Do not hardcode a single topic path in a shared script.
