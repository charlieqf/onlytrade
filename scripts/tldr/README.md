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

- `build_topic_workspace.py`
- `build_sample_cut_assets.py`
- `extract_tldr_topics.py`
- `fetch_gmail_tldr.py`
- `fetch_tldr_public.py`
- `rank_tldr_topics.py`
- `render_sample_cut.py`
- `run_tldr_workspace_cycle.py`
- `transcribe_aroll.py`

## Missing Shared Scripts To Add Next

- `verify_sample_cut.py`

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
