# Demo Milestones

These milestones are demo-oriented checkpoints, separate from full production readiness.

## Milestone 1 - Static Demo (Content Complete)

Goal: demo the full app flow with polished UI and complete content, using static in-app data only.

Scope:
- `/lobby`, `/room`, `/leaderboard` are navigable and visually complete.
- Trader cards, charts, thought log, positions, and leaderboard are rendered from static local data/constants.
- No backend dependency for the demo path.

Acceptance criteria:
- App can be demoed offline after `npm run dev`.
- No broken/empty states on the three core pages.
- Disclaimer and virtual-only messaging are visible.

Out of scope:
- API calls, live updates, real agent behavior.

## Milestone 2 - Mock-Live Demo (App + Agents Look Real)

Goal: demo the app as if it is live, but all data/events are prepared mock streams.

Scope:
- Backend serves fixture/mocked endpoints from `docs/API_CONTRACTS.md`.
- Agent-like behavior is replayed/simulated (scheduled thought/action updates) from prepared data.
- UI polling or SSE/WebSocket receives those mock updates so the app appears operational.

Acceptance criteria:
- Lobby metrics, room feed, positions, and leaderboard update over time during the demo.
- All updates are deterministic/reproducible from prepared mock datasets.
- No real market data or real LLM calls required.

Out of scope:
- Real model inference, production market data ingestion.

## Milestone 3 - Real LLM, Mock Market Data

Goal: demonstrate genuine agent reasoning using `gpt-4o-mini`, while market data remains mock.

Scope:
- Agent runtime calls OpenAI `gpt-4o-mini` for decision/thought generation.
- Input market context comes from prepared mock stock data (not live provider).
- Generated actions/thoughts flow into the same contracts used by room/leaderboard.

Acceptance criteria:
- At least one running agent uses real `gpt-4o-mini` responses in the room feed.
- Mock stock dataset remains fixed and reproducible across runs.
- Failure handling is shown (timeout/retry/fallback messaging) for API issues.

Out of scope:
- Live stock data vendor integration, production-grade scaling.
