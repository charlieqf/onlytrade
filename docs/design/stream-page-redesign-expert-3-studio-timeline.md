# Stream Page Redesign Prompt - Expert 3 (Studio Timeline)

## Role
You are a lead UX architect for a **professional analytics platform**, redesigning the stream page as a **"Living Timeline"** of market events.

## Redesign Intent
Move beyond static lists. The stream is a **story**. The UI should allow users to **scrub through time**, see cause-and-effect, and understand the "Why" behind every move.

## Implementation (Current)
- **Route (formal)**: `/stream/studio-timeline?trader=<trader_id>`
- **Route (legacy alias)**: `/design/expert-3?trader=<trader_id>`
- **Page file**: `onlytrade-web/src/pages/design/Expert3StudioTimelinePage.tsx`
- **Shared data hook**: `onlytrade-web/src/pages/design/phoneStreamShared.tsx`
- **Chart component**: `onlytrade-web/src/components/PhoneRealtimeKlineChart.tsx`

### Live Data Binding
- Timeline merges:
  - decision events from `streamPacket.decisions_latest`
  - chat events from room public chat feed
- Event selection updates `selectedEventId` and can pin the chart symbol.
- Position strip uses live `streamPacket.positions`.
- Market red/blue breadth uses `streamPacket.market_breadth`.

### Phone-Specific Behavior
- Top chart uses **1d/30** to keep symbol context readable.
- Decision-node tap pins symbol for 20 seconds.
- Bottom chat preview is read-only and auto-scrollable.
- No betting/gifting controls are included in this page.

## Phone-First + Mass Appeal Constraint
- **Interactive, not just visible**: Allow users to touch and explore the history.
- **Visual Storytelling**: Icons, thumbnails, and connectors lines between events.

## Non-Negotiables
- **No Betting/Gifting**: The focus is on *analysis* and *transparency*.
- **Canonical Data**: The timeline must perfectly match the stream packet history.

## Information Architecture

### A. Main Stage (The "Canvas")
- **Chart**: Occupies top 50%.
- **Event Markers**:
  - Pucks on the chart timeline corresponding to decisions.
  - Connector lines drawing from the puck to the specific candle.
- **"Key Moment" Highlights**:
  - Significant P&L changes (+/- 5%) get a larger, glowing marker.

### B. The Interactive Timeline (The "Spine")
- **Location**: Replaces the standard list view. A vertical or horizontal rail.
- **Interaction**:
  - **Scrubbing**: Dragging the timeline highlights the corresponding marker on the chart.
  - **Snapshots**: Each timeline item has a mini chart snapshot (sparkline) showing the price action *at that moment*.
- **Content**:
  - **Decision Nodes**: "BUY BTC".
  - **Insight Nodes**: "Agent detected volume spike" (Plain English).
  - **System Nodes**: "Risk Management triggered: Position size reduced".

### C. Context Module (The "Inspector")
- **Behavior**: When a timeline node is selected (or latest by default), this panel shows the deep details.
  - **Reasoning**: Full text analysis.
  - **Market State**: Volatility, Volume, RSI at that specific moment.
  - **Chat Context**: What were people saying *then*?

## Mobile Adaptation Rule
- **The "Reel" Layout**:
  - Top: Live Chart.
  - Bottom: Vertical scrolling timeline (like a Twitter/X thread).
  - **Hero Item**: The most recent event is expanded at the top of the timeline.

## Avatar and Future Digital Human
- **Position**: Integrated into the "Inspector" panel header.
- **Role**: The "Narrator".
- **Visuals**: When a new timeline item appears, the Avatar animates (gestures) to point at it.
- **Placeholder**: "Analyst Seat (Voice Inactive)".

## Visual Guidelines ("State of the Art")
- **Threaded UI**: Use lines to connect related events (e.g., Entry -> Take Profit -> Exit).
- **Rich Media Cards**: Timeline items look like high-quality widgets, not text rows.
- **Depth**: Use z-index to show "current" vs "historical" items. Current items pop out.

## Broad Viewer Hooks
- **"The Story So Far"**: A pinned card at the top of the timeline summarizing the last hour ("Agent is aggressively long on Tech").
- **Win/Loss Badges**: Big, colorful stamps on closed positions (`WIN +12%` / `LOSS -2%`).
- **Explorable History**: Even casuals like to scroll back and see "What happened there?".

## Implementation Notes
- **State Management**: Needs a robust selection model (`selectedEventId`).
- **Performance**: Virtualize the timeline list.
- **Sync**: Chart markers and timeline items must be 1:1 synchronized.

## QA Checklist
- [ ] Timeline scrolling is smooth (60fps).
- [ ] Selecting a past event correctly highlights the chart history.
- [ ] "Key Moment" markers successfully draw attention.
- [ ] Narrative flow is clear: Action -> Result -> Analysis.
