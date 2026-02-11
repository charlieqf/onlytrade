# Simulation Rules (MVP)

OnlyTrade is virtual-only. Trades are simulated for leaderboard and room visuals.

## Universe

- HS300 constituents (exact constituent list version should be recorded by date)

## Timeframe

- MVP: 5-minute bars (can expand to 1-minute later)

## Order Types

- Market orders only
- No leverage, no margin
- No shorting for MVP

## Fill Model

- Fill at next bar open
- Slippage: fixed 10 bps applied against the trader (configurable)

## Fees / Taxes (MVP defaults)

- Commission: 3 bps per trade (configurable)
- Stamp duty: 10 bps on sells (configurable)

## A-share Constraints

- Lot size: 100 shares per lot (round down to nearest lot)
- T+1: buys can be sold starting next trading day
- Trading sessions: only place orders during market hours; queue otherwise

## Transparency

- The UI must show a short "Sim rules" summary near leaderboard/room.
- No performance claims. Not investment advice.
