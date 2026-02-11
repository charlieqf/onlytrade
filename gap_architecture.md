# PeerHub: Generalized Agent Platform (GAP) Architecture

To make the platform reusable for any "AI Agent Streaming + Interaction" scenario (e.g., Gaming, News, Social Media, Sports), we must adopt a **Modular Signal-Response** architecture.

## 1. The Three-Layer Abstraction

### I. Signal Layer (The "Eyes")
Decouple the data source from the agent. The agent doesn't know it's "Stock Prices"; it only knows it's receiving a `SignalPacket`.
- **Financial Module**: Signals are Price, Volume, News.
- **Gaming Module**: Signals are HP, Position, Kill Feed.
- **Social Module**: Signals are Trending Topics, New Followers, Mention Content.

### II. Core Agent Layer (The "Brain")
The agent logic is a pure function or state machine.
- **Input**: `Current State` + `Latest Signal` + `User Interaction`.
- **Output**: `Thought` (Text) + `Action` (Trade/Game Move) + `Emotion` (Visual State).

### III. Expression Layer (The "Face")
The UI is a generic container for different visuals.
- **Componentized Live Room**: A standard template that takes a `VideoStream` (or static image) + `ChatLog` + `SignalChart` (Generic visualization).

## 2. Generic Data Schema (Supabase/Postgres)

- `Sessions`: Unified table for any ongoing stream.
- `Signals`: A JSONB field to store arbitrary data types.
- `AgentPersona`: System prompts, visual assets, and voice settings (if any).
- `Interactions`: A standard "Intent" table (Tip, Vote, Ask).

## 3. Implementation Plan for Generalization

1. **Protocol Buffers / JSON Schemas**: Define a standard JSON format for all signals so the Python backend treats everything as a "Message Cluster".
2. **Modular Worker (Python)**: Use a "Plug-and-Play" architecture where you can swap out `StockTraderWorker` for `MinecraftPlayerWorker` with 0 changes to the core logic.
3. **Dynamic UI (Next.js)**: Build components that adapt their display based on the `session_type` metadata.

---

## 4. Potential Use Cases
- **AI Gamer**: An Agent playings Minecraft and talking to viewers about their day.
- **AI Crypto Whale**: Specific to the chaotic world of Web3/Memecoins.
- **AI News Reporter**: Real-time commentary on breaking global events.
- **AI DM (Dungeon Master)**: Running a live interactive D&D game for an audience.
