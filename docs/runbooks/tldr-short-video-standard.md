# TLDR Short-Video Production Standard

This document fixes the canonical directory contract, script contract, documentation contract, and improvement loop for the TLDR short-video pipeline.

The goal is not just to make one topic work. The goal is to make the workflow stable enough that each iteration improves the system instead of creating more one-off workspace logic.

## Principles

- One canonical place for each artifact type.
- Shared automation lives in `scripts/tldr/`, not inside topic workspaces.
- Topic workspaces hold inputs, outputs, and review history only.
- Recorded A-roll is the truth source for subtitles and shot design.
- Every sample-cut review loop is versioned and never overwrites the prior version.
- Topic-specific lessons stay with the topic; reusable lessons get promoted into repo docs.

## Canonical Directory Contract

### Day-level workspace

```text
data/live/onlytrade/tldr_workspace/
  YYYY-MM-DD/
    day_manifest.json
    01_topic_slug/
    02_topic_slug/
```

### Topic-level workspace

```text
01_topic_slug/
  topic.json
  facts.en.md
  facts.cn.md
  script.cn.draft.md
  script.cn.edit.md
  script.cn.live30.md                 # optional, when a tighter recorded version exists
  teleprompter.cn.txt
  teleprompter.cn.live30.txt          # optional
  source_links.md
  broll_plan.json
  assets/
    real_asset_manifest.json          # optional
    source_asset_manifest.json        # optional
    <source screenshots and downloaded visuals>
  recording/
    video.mp4                         # canonical recorded A-roll path
    video_YYYYMMDD.mp4                # optional raw take or archived take
    video.stt.verbose.json
    video.stt.txt
    video.stt.cleaned.md
    video.subtitle.cues.json
    video.cut-plan.md
    sample_cut_plan.seed.md           # optional seed plan
  sample_cut_v1_assets/
  sample_cut_v1_asset_manifest.json
  sample_cut_v1_prep.md               # optional pre-recording cutaway and render-prep note
  sample_cut_v1/
    <sample mp4>
    <metadata json>
    <render props json>
    <process md>
    <preview stills>
  sample_cut_v2_assets/
  sample_cut_v2_asset_manifest.json
  sample_cut_v2/
  sample_cut_v3/
```

## Directory Rules

- `assets/` is for downloaded source visuals, product screenshots, and other non-recorded inputs.
- `recording/` is for the real A-roll and every derivative transcript or shot-design artifact.
- `recording/video.mp4` is always the selected canonical take, even if raw takes are also kept beside it.
- `sample_cut_vN_assets/` is for archived render inputs generated or copied for one review iteration.
- `sample_cut_vN/` is for rendered review outputs only.
- `sample_cut_v1_prep.md` is the recommended place to freeze a pre-recording asset package and intended cutaway order before the A-roll is recorded.
- Workspace-local planning files like `task_plan.md`, `findings.md`, and `progress.md` are allowed while actively developing a topic, but they are not part of the publish contract.

## Legacy Note

Some existing topics still place the recorded clip at `assets/video.mp4`. That is now legacy layout.

Going forward, the canonical A-roll source should be `recording/video.mp4`.

## Script Contract

All reusable automation must live under `scripts/tldr/`.

### Current shared scripts

- `scripts/tldr/build_topic_workspace.py`
- `scripts/tldr/build_sample_cut_assets.py`
- `scripts/tldr/extract_tldr_topics.py`
- `scripts/tldr/fetch_gmail_tldr.py`
- `scripts/tldr/fetch_tldr_public.py`
- `scripts/tldr/rank_tldr_topics.py`
- `scripts/tldr/render_sample_cut.py`
- `scripts/tldr/run_tldr_workspace_cycle.py`
- `scripts/tldr/transcribe_aroll.py`

### Fixed script categories

- `fetch_*` - external data retrieval only
- `extract_*` - parsing and normalization only
- `rank_*` - scoring, filtering, rewrite shaping
- `build_*` - deterministic file writers and asset packaging
- `transcribe_*` - STT generation from recorded A-roll
- `render_*` - sample-cut rendering and preview generation
- `verify_*` - validation, existence checks, duration checks, metadata checks
- `run_*` - orchestration only; no embedded topic-specific hacks

### Script rules

- No reusable script should be created inside a topic workspace.
- Topic workspaces may temporarily contain prototype scripts during exploration, but those scripts must be treated as throwaway prototypes and either deleted or upstreamed into `scripts/tldr/`.
- Every shared script should accept an explicit `--topic-dir` or `--workspace-root` style input instead of hardcoding one topic path.
- Every shared script should produce deterministic outputs in standard filenames.
- Every shared script must have a matching `test_*.py` file when the behavior is stable enough to test.

## Target Shared CLI Surface

The following commands are the target steady-state interface for short-video production automation:

```text
python -m scripts.tldr.run_tldr_workspace_cycle ...
python -m scripts.tldr.transcribe_aroll --topic-dir <topic>
python -m scripts.tldr.build_sample_cut_assets --topic-dir <topic> --version vN
python -m scripts.tldr.render_sample_cut --topic-dir <topic> --version vN
python -m scripts.tldr.verify_sample_cut --topic-dir <topic> --version vN
```

Not all of these entrypoints exist yet. They are the fixed target contract that future automation work should converge on.

Current note: `transcribe_aroll.py`, `build_sample_cut_assets.py`, and `render_sample_cut.py` now exist. The remaining target shared entrypoint is verify.

## Documentation Contract

### Repo-level docs

- `docs/runbooks/tldr-short-video-standard.md` - canonical contract for structure and scripts
- `docs/runbooks/tldr-aroll-sample-cut.md` - editorial and production runbook for sample-cut execution
- `docs/plans/<date>-tldr-short-video-*.md` - roadmap, architecture decisions, implementation plans

### Topic-level docs

- `recording/video.cut-plan.md` - topic-specific editorial shot plan
- `sample_cut_vN/sample_cut_vN_process.md` - what changed in this review iteration
- `sample_cut_vN_asset_manifest.json` - exact archived render inputs for that version
- `sample_cut_v1_prep.md` - optional pre-recording prep note documenting which real visuals and helper cards are already approved before the A-roll arrives

## Approved V1 Quality Bar

An acceptable first review cut is now defined more tightly than before.

### A good `sample_cut_v1` should usually have:

- real recorded A-roll at `recording/video.mp4`
- STT-driven subtitles based on the actual spoken take
- no more than 3 cutaways total in a ~30s short
- no more than 2 generated helper cards unless a real source gap makes a third one unavoidable
- real article screenshots, gifs, or before/after product visuals doing most of the explanatory work

### Title and source rule

- If the spoken opening starts with a thesis instead of naming the article directly, the title block and source pill must establish the article in the first second of the edit.

### Card quality rule

- Helper cards must be top-heavy, subtitle-safe, and answer one precise question only.
- Avoid low-information decorative cards.
- For Chinese-language videos, helper cards should prefer Chinese-first labels unless the English term itself is the point.

### Comparison rule

- If the article provides real before/after or baseline/upgrade outputs, use those inside the comparison visual instead of abstract placeholder diagrams.

## Workflow States

Each topic should move through these states conceptually, even if the current manifest does not yet store all of them:

1. `draft_generated`
2. `script_edited`
3. `recorded`
4. `stt_ready`
5. `cut_plan_ready`
6. `sample_cut_v1_ready`
7. `sample_cut_vN_reviewed`
8. `publish_ready`

## Improvement Loop

### Topic-specific feedback

Put these in the topic workspace:

- card readability issues
- subtitle timing issues
- audio problems
- topic-specific B-roll decisions

### Reusable lessons

Promote these into repo docs when they repeat:

- stable file naming rules
- subtitle layout rules
- versioning rules
- card design heuristics
- validation checks
- script responsibilities

### Promotion rule

If a lesson appears in 2 or more topics, it should leave the workspace and enter repo documentation or shared scripts.

## Automation Direction

### Phase 1 - Human-in-the-loop

- workspace generation automated
- script editing manual
- recording manual
- subtitle cleanup manual
- sample-cut iteration semi-manual

### Phase 2 - Standardized operator workflow

- fixed scripts for STT, asset packaging, render, and verify
- no topic-local reusable scripts
- review outputs always versioned the same way
- pre-recording asset preparation can be done before the A-roll arrives, so the post-recording path is reduced to STT -> subtitle cleanup -> render props -> render -> verify

### Phase 3 - High automation

- one orchestrator can take a topic from workspace bundle to reviewable sample cut
- human feedback only changes structured inputs and version notes
- reusable lessons continuously migrate from topic workspace into shared code and docs

## Current Enforcement Decision

Effective immediately:

- use `recording/video.mp4` as the canonical A-roll path for new work
- do not create new reusable `build_sample_cut_vN_assets.py` scripts inside topic folders as the long-term pattern
- treat current workspace-local builders as prototypes to upstream into `scripts/tldr/`
- keep versioned sample-cut outputs and process notes exactly as documented above
