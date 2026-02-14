# Streaming Agent Messages (Chinese Output) - 3 Message Types

This doc describes how to make agents feel like "danmu" livestream hosts: frequent, conversational, short Chinese lines, while staying grounded and auditable.

## Product decision

- The app is Mainland China oriented.
- All agent talk in the UI is **Chinese** (CN and US markets). US tickers remain uppercase (e.g. `QQQ`, `XLK`, `AAPL`).

## Goals

- Proactive streamer-style messages every **15-20 seconds** during market hours.
- Trade reasoning broadcast every **1 minute** (aligned to decision cadence).
- Replies to user messages are short and interactive.
- Messages are TTS-friendly:
  - short sentences
  - natural pauses
  - no long numeric strings

## Non-goals (v1)

- True real-time speech streaming (TTS comes later).
- Long-form explanations.

## Message Types

### Type 1: Trade Thinking / Reasoning / Decision (every 1m)

Purpose: show the "thinking chain" that attracts viewers, but remain auditable.

Recommended structure (3 beats):

1) Market/sector one-liner (from `market_overview`)
2) Symbol one-liner (from symbol feature brief)
3) Action + "what would change my mind" (from the actual decision)

Output constraints:

- Chinese
- max 3 short sentences

Delivery:

- Primary: decision UI reasoning steps
- Optional: also post a short public chat broadcast once per minute

### Type 2: Proactive streamer talk (every 15-20s)

Purpose: "nearly nonstop" human-like chatter.

Output constraints:

- Chinese, 1-2 short sentences
- no markdown, no bullet lists
- no claims of real broker execution
- safe to read aloud by TTS

Allowed content:

- Market pulse / sector rotation (from `market_overview`)
- Symbol micro commentary (from symbol brief)
- Headline-only news mentions (from `news.digest.v1` titles)
- Casual engagement / small talk (explicitly allowed)

Topic rotation (to feel human and avoid repetition):

- market pulse
- sector rotation
- symbol watch
- risk discipline
- plan / triggers
- ask-the-room engagement question
- casual small talk

Anti-spam controls:

- room-level in-flight lock (avoid multiple generations due to polling)
- dedupe/similarity filtering vs last N messages

### Type 3: Reply to a user message (immediate)

Purpose: "read danmu" vibe.

Output constraints:

- Chinese, 1-2 short sentences
- lightly playful / interactive, but not cringe
- if uncertain, say so (do not invent facts)

## Context inputs (small + grounded)

The streamer message generator should receive a small structured context object:

- `latest_decision_brief`
- `symbol_brief` (feature snapshot + last bar time)
- `market_overview_brief` (benchmark or proxy_watchlist; include stale flags)
- `today_news_brief` (titles only)
- `chat_history_tail`

Rule: the generator may only cite values present in this context.

## Default cadence

- Proactive interval: 18 seconds (configurable)
- Sentence length: hard-capped by post-processing

## Acceptance Criteria

- During market open + agent running, proactive public messages appear about every 15-20 seconds.
- All messages are Chinese, short, and safe for future TTS.
- Messages do not hallucinate facts; any missing/stale data is handled via generic talk or explicit caution.
