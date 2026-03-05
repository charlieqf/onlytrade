import sqlite3
import time
import json
import logging
import os
import random
import re
import urllib.parse
import urllib.request
from datetime import datetime
from virtual_exchange_db import DB_FILE, get_open_markets
from sensitive_topic_filter import (
    append_sensitive_audit_samples,
    evaluate_sensitive_text,
    load_sensitive_topic_policy,
)

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))


def _load_optional_env_file(file_path):
    if not file_path or not os.path.isfile(file_path):
        return
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            for raw_line in f:
                line = str(raw_line or "").strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = str(key or "").strip()
                if not key:
                    continue
                if key in os.environ:
                    continue
                os.environ[key] = str(value or "").strip()
    except Exception:
        return


_load_optional_env_file(os.path.join(REPO_ROOT, "runtime-api", ".env.local"))

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
    1, int(os.environ.get("POLYMARKET_MAX_MARKET_POOL_SIZE", "20"))
)
MARKET_ROTATION_SECONDS = max(
    6, int(float(os.environ.get("POLYMARKET_BRIDGE_ROTATE_SEC", "18")))
)
BRIDGE_ROOM_ID = str(os.environ.get("POLYMARKET_BRIDGE_ROOM_ID") or "t_015").strip()
RUNTIME_API_BASE = (
    str(os.environ.get("POLYMARKET_BRIDGE_RUNTIME_BASE") or "http://127.0.0.1:18080")
    .strip()
    .rstrip("/")
)
FOLLOW_COMMENTARY_FINISH = (
    str(os.environ.get("POLYMARKET_BRIDGE_FOLLOW_COMMENTARY_FINISH") or "true")
    .strip()
    .lower()
    != "false"
)
COMMENTARY_POLL_INTERVAL_SEC = max(
    0.5, float(os.environ.get("POLYMARKET_BRIDGE_COMMENTARY_POLL_SEC") or 1.2)
)
MIN_ROTATE_AFTER_COMMENTARY_MS = max(
    0,
    int(
        float(
            os.environ.get("POLYMARKET_BRIDGE_MIN_ROTATE_AFTER_COMMENTARY_MS") or 1200
        )
    ),
)
PREFETCH_LEAD_MS = max(
    0,
    int(float(os.environ.get("POLYMARKET_BRIDGE_PREFETCH_LEAD_MS") or 2500)),
)
LEGACY_BANNED_TOPIC_SUBSTRINGS = ["截肢", "三八红旗手"]
SENSITIVE_FILTER_ROOM_ID = (
    str(
        os.environ.get("POLYMARKET_BRIDGE_SENSITIVE_FILTER_ROOM_ID")
        or BRIDGE_ROOM_ID
        or "t_015"
    )
    .strip()
    .lower()
)
SENSITIVE_POLICY = load_sensitive_topic_policy()
SENSITIVE_FILTER_STATS = {
    "room_id": SENSITIVE_FILTER_ROOM_ID,
    "mode": "hard_block",
    "total_seen": 0,
    "filtered_count": 0,
    "kept_count": 0,
    "filtered_categories": {},
}
SENSITIVE_FILTER_AUDIT_SAMPLES = []


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


def _contains_banned_topic(value):
    text = str(value or "").strip()
    if not text:
        return False
    SENSITIVE_FILTER_STATS["total_seen"] = (
        int(SENSITIVE_FILTER_STATS.get("total_seen") or 0) + 1
    )
    if any(token in text for token in LEGACY_BANNED_TOPIC_SUBSTRINGS):
        SENSITIVE_FILTER_STATS["filtered_count"] = (
            int(SENSITIVE_FILTER_STATS.get("filtered_count") or 0) + 1
        )
        categories = SENSITIVE_FILTER_STATS.get("filtered_categories")
        if not isinstance(categories, dict):
            categories = {}
            SENSITIVE_FILTER_STATS["filtered_categories"] = categories
        categories["legacy_banned"] = int(categories.get("legacy_banned") or 0) + 1
        if len(SENSITIVE_FILTER_AUDIT_SAMPLES) < 24:
            SENSITIVE_FILTER_AUDIT_SAMPLES.append(
                {
                    "text": text[:220],
                    "categories": ["legacy_banned"],
                    "matches": [{"category": "legacy_banned", "token": "legacy"}],
                }
            )
        return True

    check = evaluate_sensitive_text(
        text,
        room_id=SENSITIVE_FILTER_ROOM_ID,
        policy=SENSITIVE_POLICY,
    )
    if bool(check.get("blocked")):
        SENSITIVE_FILTER_STATS["filtered_count"] = (
            int(SENSITIVE_FILTER_STATS.get("filtered_count") or 0) + 1
        )
        categories = SENSITIVE_FILTER_STATS.get("filtered_categories")
        if not isinstance(categories, dict):
            categories = {}
            SENSITIVE_FILTER_STATS["filtered_categories"] = categories
        for category in check.get("categories") or []:
            key = str(category or "").strip().lower()
            if not key:
                continue
            categories[key] = int(categories.get(key) or 0) + 1
        if len(SENSITIVE_FILTER_AUDIT_SAMPLES) < 24:
            SENSITIVE_FILTER_AUDIT_SAMPLES.append(
                {
                    "text": text[:220],
                    "categories": list(check.get("categories") or []),
                    "matches": list(check.get("matches") or []),
                }
            )
        return True

    SENSITIVE_FILTER_STATS["kept_count"] = (
        int(SENSITIVE_FILTER_STATS.get("kept_count") or 0) + 1
    )
    return False


def select_candidate_markets(open_markets):
    if not open_markets:
        return []

    # SQLite CURRENT_TIMESTAMP is UTC; compare against UTC to avoid timezone skew.
    now = datetime.utcnow()
    current_year = now.year
    max_age_seconds = MAX_MARKET_AGE_HOURS * 3600.0
    candidates = []
    for market in open_markets:
        title = str(market.get("title") or "").strip()
        source_topic = str(market.get("source_topic") or "").strip()
        merged_topic_text = f"{title} {source_topic}".strip()
        if _contains_banned_topic(merged_topic_text):
            continue
        old_year = False
        for token in re.findall(r"(20\d{2})年", title):
            if int(token) < current_year:
                old_year = True
                break
        if old_year:
            continue
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

    return candidates


def _estimate_tts_duration_ms(text):
    body = str(text or "")
    if not body:
        return 2200
    char_count = len(body)
    punct_count = len(re.findall(r"[。！？!?；;，,]", body))
    # Be conservative: longanhuan + stream playback can be noticeably slower.
    base = int((char_count / 2.4) * 1000)
    pauses = punct_count * 260
    return max(2800, min(base + pauses + 1200, 120000))


def _fetch_latest_commentary(room_id):
    if not room_id:
        return None
    try:
        query = urllib.parse.urlencode({"room_id": room_id, "limit": 1})
        url = f"{RUNTIME_API_BASE}/api/polymarket/commentary/feed?{query}"
        req = urllib.request.Request(url=url, method="GET")
        with urllib.request.urlopen(req, timeout=2.5) as resp:
            body = resp.read().decode("utf-8", errors="replace")
        payload = json.loads(body) if body else {}
        data = payload.get("data") if isinstance(payload, dict) else payload
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list) or not items:
            return None
        row = items[0] if isinstance(items[0], dict) else None
        if not row:
            return None
        return {
            "id": str(row.get("id") or "").strip(),
            "market_id": str(row.get("market_id") or "").strip(),
            "text": str(row.get("text") or "").strip(),
            "created_ts_ms": int(row.get("created_ts_ms") or 0),
        }
    except Exception:
        return None


def _pick_next_market_id(candidate_markets, current_market_id):
    if not candidate_markets:
        return None
    ids = [str(m.get("id") or "").strip() for m in candidate_markets if m.get("id")]
    ids = [x for x in ids if x]
    if not ids:
        return None
    if len(ids) == 1:
        return ids[0]
    pool = [x for x in ids if x != str(current_market_id or "").strip()]
    if not pool:
        pool = ids
    return random.choice(pool)


def _bet_side_label(bet_type):
    side = str(bet_type or "").strip().upper()
    if side == "YES":
        return "正方"
    if side == "NO":
        return "反方"
    return "中立"


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

    row_keys = set(m_row.keys())

    def col(name, default=""):
        if name not in row_keys:
            return default
        value = m_row[name]
        return default if value is None else value

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
        "source_topic": str(col("source_topic", "") or "").strip(),
        "source_source": str(col("source_source", "") or "").strip(),
        "source_hot_score": str(col("source_hot_score", "") or "").strip(),
        "news_summary": str(col("news_summary", "") or "").strip(),
        "news_key_points": str(col("news_key_points", "") or "").strip(),
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
        side_label = _bet_side_label(b["bet_type"])
        amount_text = f"{float(b['amount']):,.0f}"

        # We don't have reasoning stored in base BETS table yet, so we generate a UI string
        if is_ai:
            text = f"AI观点更新：观点值{amount_text}，倾向{side_label}。"
            msg_type = "agent"
        else:
            text = f"观众观点：观点值{amount_text}，倾向{side_label}。"
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


def build_safe_idle_state(reason="safe_filter_no_candidates"):
    now_ms = int(time.time() * 1000)
    return {
        "market": {
            "id": "safe_idle",
            "title": "当前暂无可用安全话题，正在筛选中",
            "yes_outcome": "等待中",
            "no_outcome": "观察中",
            "initial_prob": 0.5,
            "current_prob": 0.5,
            "close_time": "--",
            "volume": 0,
            "liquidity": 0,
            "source_topic": "",
            "source_source": reason,
            "source_hot_score": "",
            "news_summary": "系统已启用硬过滤，正在等待新的安全事件进入轮播。",
            "news_key_points": "[]",
        },
        "balances": {},
        "logs": [
            {
                "id": 0,
                "sender": "System",
                "type": "info",
                "text": "安全过滤生效：当前无可播话题，稍后自动刷新。",
                "time": now_ms,
            }
        ],
        "ai_pnl": 0,
        "last_update": now_ms,
    }


def _write_bridge_state(output_files, state):
    if not state:
        return
    for file_path in output_files:
        tmp_path = f"{file_path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, file_path)


def run_bridge():
    """Continuously exports the DB state to the React frontend JSON file."""
    output_files = resolve_output_files()
    print(f"Starting Polymarket Stream Bridge...")
    for f in output_files:
        print(f"Bridging SQLite DB to: {f}")
        os.makedirs(os.path.dirname(f), exist_ok=True)

    last_rotation_time = time.time()
    current_market_id = None
    next_rotate_after_ts_ms = 0
    last_seen_commentary_id = ""
    last_commentary_poll_ts = 0.0
    latest_commentary_row = None
    last_sensitive_log_ts = 0.0

    while True:
        try:
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            open_markets = get_open_markets()
            if not open_markets:
                conn.close()
                time.sleep(2)
                continue

            candidate_markets = select_candidate_markets(open_markets)
            if not candidate_markets:
                idle_state = build_safe_idle_state()
                _write_bridge_state(output_files, idle_state)
                append_sensitive_audit_samples(
                    SENSITIVE_FILTER_AUDIT_SAMPLES,
                    source="polymarket_stream_bridge",
                    room_id=SENSITIVE_FILTER_ROOM_ID,
                    max_rows=240,
                )
                conn.close()
                time.sleep(2)
                continue
            candidate_ids = {m["id"] for m in candidate_markets if m.get("id")}

            now_ts = time.time()
            now_ms = int(now_ts * 1000)

            if (
                FOLLOW_COMMENTARY_FINISH
                and (now_ts - last_commentary_poll_ts) >= COMMENTARY_POLL_INTERVAL_SEC
            ):
                last_commentary_poll_ts = now_ts
                latest_commentary = _fetch_latest_commentary(BRIDGE_ROOM_ID)
                if latest_commentary:
                    latest_commentary_row = latest_commentary
                    commentary_id = str(latest_commentary.get("id") or "")
                    if commentary_id and commentary_id != last_seen_commentary_id:
                        last_seen_commentary_id = commentary_id
                        created_ts_ms = int(latest_commentary.get("created_ts_ms") or 0)
                        text = str(latest_commentary.get("text") or "")
                        market_id = str(
                            latest_commentary.get("market_id") or ""
                        ).strip()
                        if market_id and (
                            not current_market_id or market_id == current_market_id
                        ):
                            estimated_finish_ms = (
                                created_ts_ms + _estimate_tts_duration_ms(text)
                            )
                            planned_rotate_ms = max(
                                now_ms + MIN_ROTATE_AFTER_COMMENTARY_MS,
                                estimated_finish_ms - PREFETCH_LEAD_MS,
                            )
                            next_rotate_after_ts_ms = max(
                                now_ms,
                                planned_rotate_ms,
                            )

            should_rotate_after_commentary = (
                next_rotate_after_ts_ms > 0 and now_ms >= next_rotate_after_ts_ms
            )

            # Rotate by fallback cadence, or immediately after TTS-estimated finish.
            if (
                current_market_id is None
                or current_market_id not in candidate_ids
                or should_rotate_after_commentary
                or (now_ts - last_rotation_time > MARKET_ROTATION_SECONDS)
            ):
                picked = _pick_next_market_id(candidate_markets, current_market_id)
                if picked:
                    current_market_id = picked
                    last_rotation_time = now_ts
                    if should_rotate_after_commentary:
                        next_rotate_after_ts_ms = 0

            state = build_state(conn, cursor, current_market_id)
            conn.close()

            if state:
                _write_bridge_state(output_files, state)

            if (now_ts - last_sensitive_log_ts) >= 30:
                last_sensitive_log_ts = now_ts
                filtered_categories = dict(
                    sorted(
                        (
                            SENSITIVE_FILTER_STATS.get("filtered_categories") or {}
                        ).items(),
                        key=lambda item: int(item[1]),
                        reverse=True,
                    )
                )
                logging.info(
                    "SensitiveFilter stats: seen=%s filtered=%s kept=%s categories=%s",
                    int(SENSITIVE_FILTER_STATS.get("total_seen") or 0),
                    int(SENSITIVE_FILTER_STATS.get("filtered_count") or 0),
                    int(SENSITIVE_FILTER_STATS.get("kept_count") or 0),
                    json.dumps(filtered_categories, ensure_ascii=False),
                )
                append_sensitive_audit_samples(
                    SENSITIVE_FILTER_AUDIT_SAMPLES,
                    source="polymarket_stream_bridge",
                    room_id=SENSITIVE_FILTER_ROOM_ID,
                    max_rows=240,
                )

        except Exception as e:
            logging.error(f"Bridge error: {e}")

        time.sleep(1.0)  # Refresh UI state every 1s


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    run_bridge()
