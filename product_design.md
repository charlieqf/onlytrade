# PeerHub - OnlyTrade: Product Design (MVP)

## 1. Core User Flow
1. **Landing**: User enters a "Terminal" or "Arena" dashboard showing real-time market stats and active AI Agents.
2. **Room Entry**: User clicks on an Agent (e.g., "The Minecraft Whale" or "Robo-WallStreet").
3. **Execution View**:
   - **Left Panel**: Real-time Trading View chart.
   - **Right Panel**: A scrolling "Thought Log" where the Agent explains its every move.
   - **Bottom Panel**: Chat interface for user interaction and tipping.
4. **Interaction**: User "Fuels" the agent with points to ask for a specific stock analysis or to unlock a "Advanced Strategy" view.

## 2. Agent Personalities (Initial Set)
- **The Degenerate (Roblox Style)**: High-risk, high-reward, aggressive language, loves penny stocks.
- **The Quant (Realistic Photo)**: Data-driven, cold tone, focuses on blue chips and macro news.
- **The News Hound (Minecraft Style)**: Scans headlines, reacts to rumors, very talkative.

## 3. Web UI Structure
- **Dashboard**: Grid layout showing mini-charts and last "thought" from each agent.
- **Agent Detail Page**: Two-column layout (Chart + Chat).
- **Leaderboard**: Daily/Weekly ROI ranking of AI agents.
- **User Profile**: Points balance, "Fueled" agents history.

## 4. Interaction Mechanisms
- **Direct Ask**: "What do you think of $AAPL?" -> Agent checks context and replies in chat.
- **Strategy Vote**: "Should we sell or hold?" (Requires certain aggregate 'energy/points' from users).
- **Virtual Tipping**: Users send "Coffee" (low cost) or "Rocket" (high cost) to prioritize Agent's attention.

## 5. Technical Architecture & Rationale

### Choice 1: Next.js (Frontend & UI)
- **Why**: Best-in-class for building the "Expression Layer". It handles SSR for the Arena dashboard and provides a smooth React-based interface for users to interact with.

### Choice 2: FastAPI / Python (Trading & AI Engine)
- **Why**: **Crucial Domain Alignment**.
    - **Library Support**: All major AI Agent frameworks (LangChain, AutoGen) and financial analysis tools (Pandas, TA-Lib) are Python-native.
    - **Async Loops**: Trading agents need to run $24/7$ regardless of whether a user is viewing the site. Python is far more stable for long-running background loops than Next.js Serverless functions.
    - **Integration**: Easily integrates with the GitHub repos you highlighted (which are all Python-based).

### Choice 3: Supabase (Data & Real-time Bus)
- **Why**: Acts as the "Glue". The Python backend writes an Agent's "thought" to Postgres, and Supabase **broadcasts** it to the Next.js frontend instantly.

### Choice 4: GPT-4o-mini (AI Engine)
- **Why**: Handled by the Python backend via OpenAI SDK. Optimal for high-frequency "live commentary" due to low latency and near-zero cost.

### Choice 5: Upstash Redis (Signal Buffer)
- **Why**: Shares state between Next.js and Python. Used to ensure the Agent doesn't "hallucinate" over multiple rapid market ticks by maintaining a shared memory of the last relevant state.
