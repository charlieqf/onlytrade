---
name: tldr-aroll-sample-cut
description: Use when turning a recorded TLDR-style真人口播 short video into a reviewable vertical sample cut with STT, subtitles, timed B-roll, and iterative sample versions. Use when the A-roll differs from the original draft script, when a 30-second news-style cut needs a few high-value cutaways, or when debugging issues like low perceived volume, empty cards, or flashback between adjacent full-screen B-roll shots.
---

# TLDR A-Roll Sample Cut

## Overview

Use the real recorded A-roll as the truth source, not the draft script. The winning pattern is: STT first, editorial structure second, then a small number of high-value cutaways.

## When to Use

- You have a real recorded talking-head clip for a TLDR topic
- The speaker did not follow the original script exactly
- You need a first playable sample, not a final polished master
- The video is short, usually around 30 seconds
- You need to burn subtitles and insert a few source/timeline/impact visuals

Do not use this skill for pure TTS-only videos or long-form documentary edits.

## Core Workflow

1. Inspect the source video first
2. Generate STT from the recorded clip
3. Clean the transcript into an editorially usable text
4. Build short subtitle cues from the real speech
5. Create a cut plan with only a few cutaways
6. Prefer real-source visuals first
7. Generate info cards only for missing structure
8. Render a versioned sample cut and save verification frames

## Source-of-Truth Order

Always trust inputs in this order:

1. recorded A-roll
2. STT transcript
3. source article facts
4. draft script

If the speaker improvised, subtitles and B-roll timing must follow the recording, not the draft.

## B-Roll Pattern

For a ~30s short, use at most 3 cutaways:

- `source` - why this news is real / credible
- `timeline` - what concrete schedule or structure matters
- `impact` - who gets affected / why it matters

This keeps the A-roll dominant while still adding information density.

Stronger current default for a first review cut:

- let real source visuals carry most of the explanation
- keep generated helper cards to 2 or fewer when possible
- reserve generated cards for mechanism explanation and quantified comparison, not filler

## Asset Priority

Use visuals in this order:

1. real article screenshot or real source image
2. real facts rendered as dense info cards
3. generated cards only when real screenshots are insufficient

Generated cards must be information-first, not decorative placeholders.

If the article already has strong screenshots, gifs, or before/after outputs, prepare the first asset package before recording so the post-recording path is only STT, subtitle cleanup, props, render, and verify.

## Subtitle Rules

- Subtitle lines should be short and heavy, not transcript dumps
- In a vertical short, one strong subtitle card is better than multiple tiny caption lines
- Put the subtitle box slightly above the bottom edge
- Keep enough face room in the lower third

## Styling Rules

- Remove generic top labels if they add no information
- Use a strong two-line title when possible
- Prefer warm off-white + coral/red accents for short-video social aesthetics
- Make the second line bigger if it contains the main hook term

If the spoken opening starts with a thesis instead of naming the article directly, the title block and source pill must introduce the article in the first second.

## Versioning Rules

Never overwrite the previous review cut.

Use:

- `sample_cut_v1/`
- `sample_cut_v2/`
- `sample_cut_v3/`

Each version should contain:

- rendered mp4
- render props json
- process note
- preview frames for risky transitions

## Common Failures

### "The sample has no sound"

Check whether the output actually lacks an audio track or just has lower perceived volume.

- inspect source and rendered streams
- extract audio and test loudness if needed
- transcribe the extracted audio to verify speech still exists

### Adjacent cutaways flash back to A-roll

Cause:

- each full-screen card fades in from transparent

Fix:

- remove fade-in on adjacent full-screen cutaways
- keep the next card fully opaque from frame 0

### A generated card shows a weird dot or tiny artifact

Cause:

- punctuation or newline wrapping produced an orphan glyph line

Fix:

- split wrapping by paragraphs
- reduce title size or remove trailing punctuation where needed

### The cards feel empty

Cause:

- too much panel decoration and not enough actual editorial payload

Fix:

- every card must answer one specific question
- use real facts and real source screenshots first
- do not add empty text panels just for layout symmetry

### The cards feel like low-quality slides

Cause:

- too many helper cards
- labels and structure feel like presentation slides instead of editorial artifacts
- important content sits too low and fights the subtitle box

Fix:

- treat `2 helper cards max` as the stronger default for a ~30s first cut
- keep key information above the subtitle-safe zone
- prefer Chinese-first labels for Chinese-language videos unless the English term itself is the point
- use real before/after visuals inside comparison cards instead of abstract placeholder graphics

## Repo Paths From The Reference Implementation

- Runbook: `docs/runbooks/tldr-aroll-sample-cut.md`
- Sample renderer: `content-factory-renderer/src/TldrSampleCut.tsx`
- Sample timing helper: `content-factory-renderer/src/tldrSampleCutPlan.ts`
- Reference workspace: `data/live/onlytrade/tldr_workspace/2026-03-23/01_openai_is_throwing_everything_into_building_a_fully_automated_researcher`

## Minimal Handoff Checklist

- read the topic `recording/` folder first
- read the latest `sample_cut_vN_process.md`
- inspect archived asset manifests before generating new assets
- if the article has rich visuals, prepare `sample_cut_v1_assets/` and `sample_cut_v1_prep.md` before recording
- render into a new `sample_cut_vN/` folder
- save transition preview frames before claiming a fix worked
