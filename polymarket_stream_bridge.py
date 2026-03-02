import sqlite3
import time
import json
import logging
import os
import random
from datetime import datetime
from virtual_exchange_db import DB_FILE, get_open_markets

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_OUTPUT_FILE = os.path.join(
    REPO_ROOT, "onlytrade-web", "public", "cyber_market_live.json"
)
DIST_OUTPUT_FILE = os.path.join(
    REPO_ROOT, "onlytrade-web", "dist", "cyber_market_live.json"
)
MAX_MARKET_AGE_HOURS = max(
    0.5, float(os.environ.get("POLYMARKET_MAX_MARKET_AGE_HOURS", "4"))
)
MAX_MARKET_POOL_SIZE = max(
    1, int(os.environ.get("POLYMARKET_MAX_MARKET_POOL_SIZE", "12"))
)


def resolve_output_files():
    files = [PUBLIC_OUTPUT_FILE]
    dist_dir = os.path.dirname(DIST_OUTPUT_FILE)
    if os.path.isdir(dist_dir):
        files.append(DIST_OUTPUT_FILE)
    return files


def _parse_sqlite_created_at(raw_value):
    text = str(raw_value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text[:19], "%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


def select_candidate_markets(open_markets):
    if not open_markets:
        return []

    now = datetime.now()
    max_age_seconds = MAX_MARKET_AGE_HOURS * 3600.0
    candidates = []
    for market in open_markets:
        created_dt = _parse_sqlite_created_at(market.get("created_at"))
        if created_dt is None:
            continue
        age_seconds = (now - created_dt).total_seconds()
        if age_seconds < 0:
            age_seconds = 0
        if age_seconds <= max_age_seconds:
            candidates.append(market)
        if len(candidates) >= MAX_MARKET_POOL_SIZE:
            break

    if candidates:
        return candidates
    return open_markets[:MAX_MARKET_POOL_SIZE]


def calculate_ai_pnl(cursor):
    """
    Approximates AI PNL by summing the current value of their positions
    vs entry cost in OPEN markets.
    """
    cursor.execute("""
        SELECT b.bet_type, b.amount, b.price_at_entry, m.current_prob
        FROM BETS b
        JOIN MARKETS m ON b.market_id = m.id
        WHERE b.user_id = 'user_ai' AND m.status = 'OPEN'
    """)
    bets = cursor.fetchall()

    pnl = 0.0
    for bet in bets:
        b_type, amount, entry_price, current_true_prob = bet
        current_price = (
            current_true_prob if b_type == "YES" else (1.0 - current_true_prob)
        )
        # Simplified: Quantity = amount / entry_price. Current Value = Quantity * current_price
        if entry_price > 0:
            qty = amount / entry_price
            current_value = qty * current_price
            pnl += current_value - amount

    return pnl


def build_state(conn, cursor, market_id):
    """Constructs the JSON state expected by CyberPredictionPage"""

    # 1. Market Data
    cursor.execute("SELECT * FROM MARKETS WHERE id = ?", (market_id,))
    m_row = cursor.fetchone()
    if not m_row:
        return None

    cursor.execute("SELECT SUM(amount) FROM BETS WHERE market_id = ?", (market_id,))
    volume = (cursor.fetchone()[0] or 0.0) + 150000.0  # Add base simulated volume

    market_data = {
        "id": m_row["id"],
        "title": m_row["title"],
        "yes_outcome": m_row["yes_outcome"],
        "no_outcome": m_row["no_outcome"],
        "initial_prob": m_row["initial_prob"],
        "current_prob": m_row["current_prob"],
        "close_time": m_row["close_time"],
        "volume": volume,
        "liquidity": volume * 0.15,  # Approx liquidity depth
    }

    # 2. Balances
    cursor.execute("SELECT username, balance FROM USERS")
    users = cursor.fetchall()
    balances = {u["username"]: u["balance"] for u in users}

    # 3. Logs (Last 15 bets for this market)
    cursor.execute(
        """
        SELECT b.id, u.username, b.bet_type, b.amount, b.timestamp 
        FROM BETS b
        JOIN USERS u ON b.user_id = u.id
        WHERE b.market_id = ?
        ORDER BY b.timestamp DESC LIMIT 15
    """,
        (market_id,),
    )
    bet_rows = cursor.fetchall()

    logs = []
    # Reverse so oldest in the limit comes first, UI reverses it again or displays naturally
    for b in reversed(bet_rows):
        # Very simple conversion of timestamp to JS epoch ms if it's standard format
        try:
            # Assumes format "YYYY-MM-DD HH:MM:SS" SQLite default
            dt = time.strptime(b["timestamp"][:19], "%Y-%m-%d %H:%M:%S")
            ts_ms = int(time.mktime(dt)) * 1000
        except:
            ts_ms = int(time.time() * 1000)

        is_ai = b["username"] == "AI_Agent_Zero"

        # We don't have reasoning stored in base BETS table yet, so we generate a UI string
        if is_ai:
            text = f"[{b['bet_type']} 建仓 ${b['amount']:,.0f}] AI Execution"
            msg_type = "agent"
        else:
            text = f"下单 ${b['amount']:,.0f} 买入 {b['bet_type']}。"
            msg_type = "user"

        logs.append(
            {
                "id": hash(b["id"]),
                "sender": b["username"],
                "type": msg_type,
                "text": text,
                "time": ts_ms,
            }
        )

    if not logs:
        logs = [
            {
                "id": 0,
                "sender": "System",
                "type": "info",
                "text": f"Tracking initialized for {market_data['title']}",
                "time": int(time.time() * 1000),
            }
        ]

    # 4. AI PNL
    ai_pnl = calculate_ai_pnl(cursor)

    return {
        "market": market_data,
        "balances": balances,
        "logs": logs,
        "ai_pnl": ai_pnl,
        "last_update": int(time.time() * 1000),
    }


def run_bridge():
    """Continuously exports the DB state to the React frontend JSON file."""
    output_files = resolve_output_files()
    print(f"Starting Polymarket Stream Bridge...")
    for f in output_files:
        print(f"Bridging SQLite DB to: {f}")
        os.makedirs(os.path.dirname(f), exist_ok=True)

    last_rotation_time = time.time()
    current_market_id = None

    while True:
        try:
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            open_markets = get_open_markets()
            if not open_markets:
                time.sleep(2)
                continue

            candidate_markets = select_candidate_markets(open_markets)
            if not candidate_markets:
                time.sleep(2)
                continue
            candidate_ids = {m["id"] for m in candidate_markets if m.get("id")}

            # Rotate target market every 15 seconds for UI viewing
            if (
                current_market_id is None
                or current_market_id not in candidate_ids
                or (time.time() - last_rotation_time > 15)
            ):
                # Pick a random open market to focus the stream on
                current_market_id = random.choice(candidate_markets)["id"]
                last_rotation_time = time.time()

            state = build_state(conn, cursor, current_market_id)
            conn.close()

            if state:
                for file_path in output_files:
                    tmp_path = f"{file_path}.tmp"
                    with open(tmp_path, "w", encoding="utf-8") as f:
                        json.dump(state, f, ensure_ascii=False, indent=2)
                    os.replace(tmp_path, file_path)

        except Exception as e:
            logging.error(f"Bridge error: {e}")

        time.sleep(1.0)  # Refresh UI state every 1s


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    run_bridge()
