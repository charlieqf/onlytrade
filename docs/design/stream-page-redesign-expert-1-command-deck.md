# Stream Page Redesign Prompt - Expert 1 (Command Deck)

## Role
You are a senior product UI engineer designing a **cinematic, high-signal trading terminal** for `onlytrade-web/src/pages/StreamingRoomPage.tsx`.

## Objective
Build a "Command Deck" stream UI that feels like a **sci-fi tactical display**—dense with data but emotionally engaging through motion and precision.

## Implementation (Current)
- **Route (formal)**: `/stream/command-deck?trader=<trader_id>`
- **Route (legacy alias)**: `/design/expert-1?trader=<trader_id>`
- **Page file**: `onlytrade-web/src/pages/design/Expert1CommandDeckPage.tsx`
- **Shared data hook**: `onlytrade-web/src/pages/design/phoneStreamShared.tsx`
- **Chart component**: `onlytrade-web/src/components/PhoneRealtimeKlineChart.tsx`

### Live Data Binding
- `positions`: `streamPacket.positions` (sorted by unrealized pnl magnitude)
- `decisions`: `streamPacket.decisions_latest` (fallback: `streamPacket.decision_audit_preview.records`)
- `chat`: `api.getRoomPublicMessages(roomId, 100)` with auto-scroll
- `focus symbol`: `latest decision -> thinking symbol -> largest position symbol`
- `market breadth (red/blue)`: `streamPacket.market_breadth` / `room_context.market_breadth`

### Phone-Specific Behavior
- Top chart uses **1d** bars with **30** points (about one month) for readability.
- Tactical avatar slot is bottom-left and resizable (size persisted in local storage).
- Decisions are tappable to pin chart symbol for 20 seconds.
- No betting or gifting controls are rendered in this page.

## Phone + Audience Constraint
- **Phone-native Portrait**: The interface must feel like a dedicated trading app, not a responsive website.
- **Mass Appeal Strategy**:
  - **"The Pilot's Seat"**: Make the viewer feel like a co-pilot.
  - **Active Traders**: Give them dense, real-time numbers (P&L, exposure).
  - **Casual Viewers**: Use color coding and "State Indicators" (e.g., "ATTACK MODE" vs "DEFENSE MODE") to explain complex states.

## Hard Requirements
- **Visuals**: Dark glass, neon accents (Cyberpunk/Bloomberg Terminal hybrid).
- **No Betting/Gifting**: Remove all social gimmicks. Focus on the *trade*.
- **Data Source**: Stream packet is the single source of truth.
- **Components**:
  - **Hero Chart**: The primary focus.
  - **Tactical Avatar**: Bottom-left, resizable, feels like a comms link.
  - **Data Rails**: Positions and Decisions are always accessible.

## Layout (Phone Portrait Only)
- **Z-Layering**:
  - **Layer 0 (Background)**: Deep void with subtle "grid breathing" animation.
  - **Layer 1 (Chart)**: Occupies top 55% of screen.
  - **Layer 2 (Data Deck)**: Bottom 45% scrollable deck (Positions | Decisions | Chat).
  - **Layer 3 (HUD)**: Floating Avatar (bottom-left) + Status Ticker (top).

## Component Spec

### 1) Focused K-line Chart (The "Windshield")
- **Height**: Fixed 55vh.
- **Smart Focus**:
  - Auto-switches to the most active symbol (`decision` > `thinking` > `largest position`).
  - **"Target Lock" Animation**: When switching symbols, use a "lock-on" reticle animation effect.
- **Overlays**:
  - Show executed trade markers *directly on the chart*.
  - Show "Thinking" annotations as ghost markers.

### 2) Tactical Avatar (The "Comms Link")
- **Position**: Bottom-left, floating over the chart/deck boundary.
- **Visuals**:
  - Hexagonal or squircle mask.
  - **Status Ring**: Glows varying colors based on agent state:
    - 🟢 **Executing**: Pulse Green.
    - 🟡 **Thinking**: Rotating Amber ring.
    - 🔴 **Loss/Drawdown**: Static Red strobe.
  - **Meta**: "LIVE DATA LINK" label below.

### 3) "Market Stress" Indicator
- **Location**: Top-right (Header area).
- **Function**: A horizontal bar or gauge showing the agent's internal "confidence" or "market volatility" perception.
- **Purpose**: Gives casual viewers an immediate sense of danger/opportunity.

### 4) The Data Deck (Bottom Half)
- **Tabbed Interface**:
  - **[ACTIVE] positions**: High-density table.
  - **[LOG] decisions**: Chronological list of actions.
  - **[COMMS] chat**: Read-only feed.
- **Interaction**: Swipe between tabs with **haptic feedback** (if available).

### 5) Decision Cards (The "Play-by-Play")
- **Visuals**:
  - **Impact Header**: "BUY BTC" in large bold type.
  - **Thesis Expander**: Tap to reveal the "Why?".
  - **Outcome Pill**: If the trade is closed, show the final P&L immediately on the card.

## Visual Polish ("State of the Art")
- **Typography**: Monospace numbers (`JetBrains Mono` or similar) for data. Clean sans-serif (`Inter`) for text.
- **Micro-interactions**:
  - Numbers tick up/down like a slot machine.
  - New decisions slide in with a heavy mechanical "clunk" sound/feel.
- **Color Palette**:
  - Deep Navy/Black background (`#050510`).
  - Neon Green (`#00FF94`) for profits.
  - Neon Red (`#FF0055`) for losses.
  - Amber (`#FFB800`) for system alerts.

## Interaction Patterns
- **Long Press**: On a position to see its full history.
- **Double Tap**: On the chart to reset zoom.
- **Haptics**: Critical for the "Tactical" feel. Trigger heavy haptic on:
  - New Trade Execution.
  - Stop Loss Trigger.

## Acceptance Checklist
- [ ] Interface looks like a modern trading terminal (clean, dark, neon).
- [ ] Avatar "Comms Link" feels alive (status rings).
- [ ] "Target Lock" animation makes symbol switching clear.
- [ ] No betting/gifting UI visible.
- [ ] Portrait mode feels native (thumb-reachable tabs).
