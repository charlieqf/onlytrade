# Stream Page Redesign Prompt - Expert 2 (Mobile Broadcast First)

## Role
You are a principal design director for a **financial news network**, optimizing a live AI trading stream for a **mass (TikTok/YouTube Shorts) audience**.

## Goal
Create a "Broadcast First" layout where the data is presented as a **narrative**. The user isn't just watching a chart; they are watching a *show* about the market.

## Implementation (Current)
- **Route (formal)**: `/stream/mobile-broadcast?trader=<trader_id>`
- **Route (legacy alias)**: `/design/expert-2?trader=<trader_id>`
- **Page file**: `onlytrade-web/src/pages/design/Expert2MobileBroadcastPage.tsx`
- **Shared data hook**: `onlytrade-web/src/pages/design/phoneStreamShared.tsx`
- **Chart component**: `onlytrade-web/src/components/PhoneRealtimeKlineChart.tsx`

### Live Data Binding
- `featured decision`: rotates through live decision cards from `streamPacket.decisions_latest`
- `ticker`: derived from current `streamPacket.positions`
- `chat`: public room chat feed from runtime API
- `market breadth`: red/blue counts from `streamPacket.market_breadth`

### Phone-Specific Behavior
- Hero chart uses **1d/30** (about one month) for cleaner broadcast readability.
- Avatar is rendered as PiP-style slot with resize controls.
- Lower area is read-only chat display with auto-scroll and unseen-message jump.
- No betting/gifting actions are included in this page.

## Audience Coverage
- **The "Scroller"**: Needs to understand what's happening in <3 seconds.
- **The Fan**: Wants to see the "Face" (Avatar) and hear the "Voice" (Text/Narrative).
- **The Trader**: Needs accurate tickers and price action.

## Core UX Narrative
"Breaking News: AI Trader just entered a massive position on BTC."

## Layout (Phone Portrait Only)
- **Composition**:
  - **Top**: "On Air" Status & Ticker.
  - **Middle (Hero)**: Chart + Avatar "Picture-in-Picture".
  - **Bottom**: "Lower Third" dynamic overlays + Scrolling Chat.

## Component Spec

### 1) The "Broadcast" Chart
- **Visuals**: Clean, TV-ready K-line chart. Fewer grid lines, clearer candles.
- **Annotations**:
  - Big descriptive labels on the chart: "Entry @ 65k", "Stop Hit".
  - **"Breaking" Pulse**: When a new trade happens, flash the chart borders.

### 2) The "Anchor" Avatar (PiP)
- **Position**: Bottom-right (or left), styled like a news anchor's PiP window.
- **State**:
  - **LIVE Ring**: A red "LIVE" badge that pulses.
  - **Mood Background**: The background *behind* the avatar changes color based on P&L (Green = Euphoric, Red = Panic, Blue = Neutral).

### 3) "Breaking News" Ticker
- **Location**: Very bottom of the screen (sticky).
- **Content**: Continuous scrolling text of positions, prices, and *narrative summaries* (e.g., "Holding BTC Long", "Sold ETH for +2% profit").
- **Style**: Classic news ticker (yellow text on black, or white on blue).

### 4) Dynamic "Lower Thirds" (The Narrative Engine)
- **Function**: Replaces the static "Decisions" list.
- **Behavior**:
  - When a decision happens, a **Lower Third** card slides in from the left overlaying the bottom of the chart.
  - Content: "DECISION: BUY 0.5 BTC - 'Momentum breakout detected'".
  - Stays for 8 seconds, then slides out (or stacks if busy).
- **History**: Users can tap a "Log" button to see past cards.

### 5) Public Chat (The "Audience Interaction")
- **Style**: Transparent gradient overlay at the bottom (like TikTok live comments).
- **Sentiment Pills**: Next to the chat, show a live "Audience Sentiment" meter (Bullish/Bearish) based on chat keywords (mockup for now).
- **Read-Only**: Clear "Live Feed" label.

## Visual Polish ("State of the Art")
- **Motion Graphics**:
  - Transitions should feel like broadcast wipes (slide + fade).
  - Use "Glints" and "Shimmers" on high-value events (like a big win).
- **Typography**: Heavy, condensed fonts for headlines (`Impact` or `Oswald` style).
- **Colors**: High contrast. Broadcast safe colors.

## Engagement Hooks (Without Betting)
- **"Session Momentum" Bar**: A simple gauge at the top:
  - ⬅️ Bears Winning ... Bulls Winning ➡️
  - Derived from recent P&L trajectory.
- **"Snapshots"**: Allow users to tap a "Share this moment" button (renders a clean image of the chart + avatar + P&L overlay).

## Acceptance Checklist
- [ ] Feels like Bloomberg TV meets TikTok.
- [ ] "Lower Thirds" effectively convey the story without clutter.
- [ ] Avatar sits in a professional "Anchor" frame.
- [ ] Scrolling Ticker adds constant "liveness".
- [ ] No static tables—everything flows or slides.
