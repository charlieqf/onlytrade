# TLDR A-Roll Sample Cut Workflow

This runbook captures the practical workflow and failure modes from turning a real recorded TLDR topic video into a reviewable vertical sample cut.

Canonical repo contract:

- `docs/runbooks/tldr-short-video-standard.md`

Current reference topic:

- Workspace: `data/live/onlytrade/tldr_workspace/2026-03-23/01_openai_is_throwing_everything_into_building_a_fully_automated_researcher`
- Latest sample: `sample_cut_v3/openai_researcher_sample_v3.mp4`

## Scope

Use this workflow when:

- the topic source is already known
- the operator has a real A-roll recording
- the first goal is a reviewable sample cut, not a final publish-ready master
- speed matters more than perfect motion design

Do not start from the original draft script as ground truth. Use the recorded A-roll as the truth source.

## Source-of-truth order

1. Real recorded A-roll
2. STT transcript from that recording
3. Source article / source screenshots / source timeline facts
4. Topic package draft script

This order matters. The recorded clip can drift from the original script, so downstream subtitles and B-roll timing should align to the actual spoken content, not the draft.

## Directory contract

For each topic, keep these folders separate:

- `recording/` - canonical A-roll source plus STT output, cleaned transcript, subtitle cues, cut plan
- `sample_cut_v1_assets/`, `sample_cut_v2_assets/` - archived source images and generated cards
- `sample_cut_v1/`, `sample_cut_v2/`, `sample_cut_v3/` - rendered outputs, previews, metadata, process notes

Do not overwrite prior sample versions. Every review loop should create a new `sample_cut_vN/` folder.

## Working flow

### 1) Inspect the real A-roll first

- confirm duration, fps, and aspect ratio
- confirm whether the source file already contains an audio track
- note obvious tail noise or dead-air sections before subtitle work

For the reference clip, `video_materials/tldr/video.mp4` was:

- `540x960`
- `~29.9fps`
- `30.0s`
- with real `AAC mono` audio

### 2) Generate STT from the recorded clip

Write both:

- raw verbose STT JSON
- clean text transcript for editorial review

Reference files:

- `recording/video.stt.verbose.json`
- `recording/video.stt.txt`
- `recording/video.stt.cleaned.md`

The cleaned transcript should remove obvious recognition errors but preserve the real spoken structure.

### 3) Build subtitle cues from actual speech

Create short cue lines that are readable in a vertical short video. Keep them punchy.

Reference file:

- `recording/video.subtitle.cues.json`

Guidelines:

- 1 short sentence or 1 short clause per cue
- prefer fewer, bigger cues over many tiny cues
- leave a little dwell time on important conclusion lines

### 4) Build the cut plan from transcript + facts

Do not insert B-roll everywhere. In a ~30s vertical short, A-roll should remain dominant.

Use only a few cutaways, each with a clear job:

- source credibility
- concrete timeline / factual structure
- industry impact / why it matters

Reference file:

- `recording/video.cut-plan.md`

### 5) Prefer real visuals first

Priority order for B-roll assets:

1. Real article screenshot / title image / real source image
2. Real timeline facts rendered into a dense info card
3. Generated explanatory card only when real screenshots are insufficient

Current stronger default for a ~30s first cut:

- use real source visuals for most of the cutaways
- keep generated helper cards to 2 or fewer when possible
- reserve generated cards for mechanism explanation and quantified comparison, not generic filler

For the reference sample, the MIT Technology Review hero image was archived and reused as the visual base for the generated cards.

Reference manifests:

- `sample_cut_v1_asset_manifest.json`
- `sample_cut_v2_asset_manifest.json`

### 6) Render with the dedicated sample-cut composition

Current implementation lives in `content-factory-renderer/`:

- `content-factory-renderer/src/TldrSampleCut.tsx`
- `content-factory-renderer/src/tldrSampleCutPlan.ts`
- `content-factory-renderer/src/Root.tsx`

Current pattern:

- real A-roll via `OffthreadVideo`
- timed cutaways via `Sequence`
- burnt-in subtitle cue box
- static per-sample render props archived beside outputs

### 6.5) Pre-recording asset prep is worth doing

If the article already has rich screenshots, gifs, or before/after outputs, prepare the first asset package before recording.

Recommended pre-recording outputs:

- `assets/source_asset_manifest.json`
- `assets/real_asset_manifest.json`
- `sample_cut_v1_assets/`
- `sample_cut_v1_asset_manifest.json`
- `sample_cut_v1_prep.md`

This reduces the post-recording path to:

- put the chosen take at `recording/video.mp4`
- generate STT
- clean subtitle cues from the real speech
- write render props
- render and verify

### 7) Verify the rendered output directly

Always verify:

- output file exists
- output has audio track
- output duration matches intended cut
- transition boundary frames do not flash back to A-roll unintentionally
- card assets actually contain readable content

For sample review, save preview frames around risky transition points.

## Styling lessons

### Title

- two-line title works better than one long line for hook density
- in this topic, the stronger structure was:
  - `OpenAI全力押注`
  - `AI研究员`
- the second line should be larger than the first

### Subtitle box

- big bottom subtitles help for review, but too big blocks the face and B-roll
- moving the subtitle box upward slightly improves breathing room
- a warm off-white subtitle card with a red-orange left accent reads closer to Xiaohongshu / WeCom / WeChat-video aesthetics than the original dark caption bar

### Source line

- remove generic top labels like `TLDR AI / 新闻快评`
- keep one compact source badge instead, such as `MIT Technology Review · Jakub Pachocki 访谈`

### Article-intro rule

- if the speaker starts with a thesis or conclusion instead of naming the article, the title block and source badge must introduce the article immediately
- the viewer should know what article is being discussed before the first subtitle cue finishes

### Helper-card quality bar

- generated cards must be genuinely editorial, not decorative
- each card should answer exactly one question
- keep the key information above the subtitle-safe zone
- if the topic language is Chinese, prefer Chinese-first labels unless the English label itself is essential
- if a card feels like a slide deck slide, simplify it until it feels like a dense short-video explainer

## Failure modes we hit

### 1) "No sound" was actually low-volume sound

The rendered sample still had an audio stream, but the perceived loudness was lower than the source clip.

What we verified:

- source clip contained `AAC mono`
- rendered sample contained `AAC stereo`
- extracted sample audio still transcribed correctly via Whisper

What fixed the perceived problem:

- increase A-roll playback volume in the composition
- provide a louder review copy when needed

### 2) Card-to-card transition flashed back to A-roll

Root cause:

- each cutaway used a fade-in from `opacity=0`
- when one card ended and the next card started, the next card briefly exposed the underlying A-roll during its first frames

Fix:

- remove the fade-in on adjacent full-screen cutaways
- keep the cutaway fully opaque from its first frame

### 3) Generated cards looked empty or low-information

Root causes:

- too much decorative panel chrome and not enough editorial text
- real source screenshot not being used strongly enough
- text fit logic letting content fall awkwardly across lines

Fixes:

- treat each card as an information artifact, not a design placeholder
- make every card answer one question:
  - what happened?
  - what is the timeline?
  - who gets affected?
- keep dense but readable text blocks

### 3.5) Too many helper cards reduced first-cut quality

Root cause:

- using cards as default explanation surfaces even when the article already had strong real visuals

Fix:

- for a ~30s first cut, treat `2 helper cards max` as the stronger default
- use real screenshots, gifs, and before/after outputs for the rest of the explanatory load

### 3.6) A good first cut does not need to be overbuilt

What worked well in the Anthropic harness topic:

- A-roll opening with immediate article identification in the title area
- one mechanism card
- one quantified comparison card
- real before/after article visuals embedded inside the comparison card
- return to A-roll for the closing judgment

### 4) Stray dot / punctuation artifacts in generated cards

Root causes:

- newline handling and punctuation wrapping could strand one tiny glyph on a line by itself

Fixes:

- split wrapping logic by paragraphs
- adjust font size / punctuation when a line break creates a visual artifact

## Current outputs to inspect

- `sample_cut_v1/openai_researcher_sample_v1.mp4`
- `sample_cut_v2/openai_researcher_sample_v2.mp4`
- `sample_cut_v3/openai_researcher_sample_v3.mp4`

Useful verification frames:

- `sample_cut_v3/preview_1s.jpg`
- `sample_cut_v3/preview_7_9s.jpg`
- `sample_cut_v3/preview_8_1s.jpg`
- `sample_cut_v3/preview_24s.jpg`

## Recommended next iteration order

When polishing future samples, use this order:

1. speech and subtitle alignment
2. audio loudness and tail trim
3. title and subtitle readability
4. transition correctness
5. real-source B-roll quality
6. generated info-card quality
7. music / sound design / polish

## Minimal handoff checklist

- confirm the topic workspace path
- inspect `recording/` files first
- inspect latest `sample_cut_vN_process.md`
- inspect archived asset manifest
- review preview frames before rendering another revision
- create `sample_cut_v(N+1)/`, never overwrite earlier versions
