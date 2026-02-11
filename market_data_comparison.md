# Market Data Solutions: A-shares & US Stocks

## 1. US Stock Market (Real-time)

| Provider | Cost (Est.) | Latency | Key Pros/Cons |
| :--- | :--- | :--- | :--- |
| **Alpaca** | Free (IEX) / $99/mo | < 1s | Excellent Python SDK. Free tier uses IEX (low volume but real-time). |
| **Polygon.io** | $29 - $100+/mo | ~20ms | Best-in-class performance. Unlimited API calls. |
| **Finnhub** | Free / $29/mo | ~1s | Good "all-in-one" (Stocks, Crypto, News). |
| **FMP** | $19.99/mo | ~100ms | Highly cost-effective for individual developers. |

---

## 2. A-share Market (Real-time)

| Provider | Cost (Est.) | Latency | Key Pros/Cons |
| :--- | :--- | :--- | :--- |
| **iTick** | Free / Pro | < 500ms | 2025 Recommended. Supports WebSocket; good coverage for A-shares. |
| **Tushare Pro** | Points / Donation | 1-3s | Reliable community support. Requires "Integrity Points". |
| **AKShare (Lib)** | Free (Open Source) | 3-5s | Wraps Sina/Tencent. Zero cost, but high risk of IP block; no WebSocket. |
| **RiceQuant / JoinQuant** | From 2000 CNY/yr | < 1s | Professional-grade. More for serious quants than "streaming bots". |

---

## 4. Final Recommendation for OnlyTrade

### US Stocks: **Alpaca (Free Tier)**
- Use the **IEX feed**. Even though it only represents ~3% of volume, the price moves are real-time and free. It's perfect for a social bot where 100% precision isn't required but "live feel" is.

### A-shares: **iTick or AKShare**
- **iTick**: If you want millisecond performance and WebSocket.
- **AKShare**: If you want zero cost and can tolerate a few seconds of delay. Since A-share markets are less volatile than US/Crypto, a 3-5s lag is often acceptable for a social commentary bot.

## 4. Latency Chain
1. **Source Delay**: The provider's delay (WebSocket is fastest).
2. **Analysis Delay**: GPT-4o-mini processing time (1-3s).
3. **Total Latency**: Expect 2-5s from a price move to an Agent's comment. **This is acceptable for "Human-like" behavior.**
