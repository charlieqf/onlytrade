# TLDR Short-Video Standardization Roadmap

## Goal

Turn the current topic-by-topic TLDR short-video workflow into a stable, versioned, highly automatable production system.

## Fixed Decisions

1. Directory contract is defined by `docs/runbooks/tldr-short-video-standard.md`.
2. Shared automation belongs under `scripts/tldr/`.
3. Recorded A-roll is the truth source for subtitles and shot planning.
4. Sample-cut review loops are versioned as `sample_cut_vN_assets/` and `sample_cut_vN/`.
5. Topic-local reusable scripts are prototypes, not the final architecture.

## Current Gaps

- STT generation is currently achieved through a workspace-local prototype instead of a shared script.
- Sample-cut asset generation is currently topic-local and version-local.
- Render and verification steps are reproducible but not yet wrapped in standard shared entrypoints.
- The canonical A-roll path is not yet enforced consistently across older topics.

## Next Implementation Steps

### 1. Shared STT script

Status: implemented as `scripts/tldr/transcribe_aroll.py`

Responsibilities now implemented:

- accept `--topic-dir`
- read `recording/video.mp4`
- write `video.stt.verbose.json`, `video.stt.txt`
- optionally write a first-pass cleaned transcript scaffold via `--write-cleaned-scaffold`

Current dependency note:

- the script lazily imports `faster_whisper`
- recommended invocation is `uv run --with faster-whisper python -m scripts.tldr.transcribe_aroll ...`

### 2. Shared sample-cut asset builder

Status: implemented as `scripts/tldr/build_sample_cut_assets.py`

Responsibilities now implemented:

- accept `--topic-dir` and `--version`
- package source visuals into `sample_cut_vN_assets/`
- write `sample_cut_vN_asset_manifest.json`
- copy renderer assets into `content-factory-renderer/public/tldr-sample/<topic>-vN/`

Current design note:

- the shared script now provides a reusable wrapper and a topic-profile registry
- Anthropic harness is the first registered profile migrated from a topic-local builder prototype

### 3. Shared sample-cut renderer

Status: implemented as `scripts/tldr/render_sample_cut.py`

Responsibilities now implemented:

- accept `--topic-dir` and `--version`
- read `sample_cut_vN/sample_cut_vN_render_props.json`
- render mp4 and preview stills
- write metadata json

Current design note:

- the shared script builds generic Remotion commands from topic path, version, composition id, and preview timestamps
- it also writes a standardized process note stub beside the render outputs

### 4. Shared verification script

Create `scripts/tldr/verify_sample_cut.py`.

Responsibilities:

- check required files exist
- check preview frames exist
- check video duration metadata exists
- return machine-readable success/failure output

### 5. Status tracking upgrade

Extend day/topic manifests so each topic can move through explicit production states:

- `draft_generated`
- `recorded`
- `stt_ready`
- `cut_plan_ready`
- `sample_cut_vN_ready`
- `publish_ready`

## Continuous Improvement Rule

Every iteration should produce two outputs:

1. the immediate topic improvement
2. one reusable system improvement in docs or shared scripts

If a fix only exists inside one topic workspace after it has proven useful twice, the system is failing to learn.

## Proven Lessons Promoted On 2026-03-26

- A strong `sample_cut_v1` can be achieved with real source visuals plus only two helper cards.
- If the spoken opening starts with a thesis, the title block and source pill must identify the article immediately.
- Pre-recording asset preparation is worthwhile when the source article already contains rich screenshots, gifs, or before/after outputs.
- Real before/after product outputs inside comparison cards outperform abstract placeholder graphics.
