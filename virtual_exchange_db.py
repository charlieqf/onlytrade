import sqlite3
import uuid
from datetime import datetime
import threading
import logging

DB_FILE = "virtual_market.db"
# A simple lock for thread safety since we might access it from multiple threads (e.g. fetcher script + stream UI backend)
db_lock = threading.Lock() 

# ----------------- Database Initialization -----------------

def init_db():
    """Initializes the SQLite database with required tables."""
    with db_lock:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 1. Markets Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS MARKETS (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                yes_outcome TEXT NOT NULL,
                no_outcome TEXT NOT NULL,
                initial_prob REAL NOT NULL,
                current_prob REAL NOT NULL,
                status TEXT DEFAULT 'OPEN', -- OPEN, CLOSED, RESOLVED_YES, RESOLVED_NO
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                close_time TEXT NOT NULL
            )
        ''')
        
        # 2. Users Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS USERS (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                balance REAL DEFAULT 100000.0 -- Starting with 100k Virtual USD
            )
        ''')
        
        # 3. Bets Table (Ledger)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS BETS (
                id TEXT PRIMARY KEY,
                market_id TEXT,
                user_id TEXT,
                bet_type TEXT, -- 'YES' or 'NO'
                amount REAL,
                price_at_entry REAL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(market_id) REFERENCES MARKETS(id),
                FOREIGN KEY(user_id) REFERENCES USERS(id)
            )
        ''')
        
        # Seed default users if they don't exist
        cursor.execute("INSERT OR IGNORE INTO USERS (id, username, balance) VALUES (?, ?, ?)", 
                       ("user_ai", "AI_Agent_Zero", 1000000.0)) # AI has a larger starting bankroll
        cursor.execute("INSERT OR IGNORE INTO USERS (id, username, balance) VALUES (?, ?, ?)", 
                       ("user_chat", "Twitch_Hivemind", 50000.0))
        
        conn.commit()
        conn.close()
        logging.info("Database initialized successfully.")

# ----------------- Market Operations -----------------

def create_market(market_json):
    """Inserts a new market from the LLM generated JSON into the DB."""
    market_id = "mkt_" + str(uuid.uuid4())[:8]
    
    with db_lock:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        initial_prob = float(market_json.get('initial_yes_probability', 0.5))
        
        cursor.execute('''
            INSERT INTO MARKETS (id, title, yes_outcome, no_outcome, initial_prob, current_prob, close_time)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            market_id,
            market_json['title'],
            market_json['yes_outcome'],
            market_json['no_outcome'],
            initial_prob,
            initial_prob, # current prob starts as initial
            market_json.get('close_time', 'T+24H')
        ))
        conn.commit()
        conn.close()
    
    logging.info(f"Market Created: {market_id} - {market_json['title'][:30]}...")
    return market_id

def get_open_markets():
    """Returns a list of all OPEN markets."""
    with db_lock:
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM MARKETS WHERE status = 'OPEN' ORDER BY created_at DESC")
        rows = cursor.fetchall()
        conn.close()
    return [dict(row) for row in rows]

# ----------------- Trading Engine (Betting Logic) -----------------

def place_bet(user_id, market_id, bet_type, amount):
    """
    Simulates a user placing a bet.
    Returns (success: bool, message: str)
    """
    bet_type = bet_type.upper()
    if bet_type not in ['YES', 'NO']:
        return False, "Invalid bet type. Must be YES or NO."
    if amount <= 0:
        return False, "Bet amount must be greater than 0."

    with db_lock:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 1. Check User Balance
        cursor.execute("SELECT balance FROM USERS WHERE id = ?", (user_id,))
        user = cursor.fetchone()
        if not user:
            conn.close()
            return False, "User not found."
        
        current_balance = user[0]
        if current_balance < amount:
            conn.close()
            return False, f"Insufficient funds. Balance: {current_balance}"
            
        # 2. Check Market Status & Get Current Price
        cursor.execute("SELECT status, current_prob FROM MARKETS WHERE id = ?", (market_id,))
        market = cursor.fetchone()
        if not market:
            conn.close()
            return False, "Market not found."
        
        if market[0] != 'OPEN':
            conn.close()
            return False, "Market is not OPEN for betting."
            
        current_prob = market[1]
        price_at_entry = current_prob if bet_type == 'YES' else (1.0 - current_prob)
        
        # 3. Deduct Balance
        new_balance = current_balance - amount
        cursor.execute("UPDATE USERS SET balance = ? WHERE id = ?", (new_balance, user_id))
        
        # 4. Record Bet
        bet_id = "bet_" + str(uuid.uuid4())[:8]
        cursor.execute('''
            INSERT INTO BETS (id, market_id, user_id, bet_type, amount, price_at_entry)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (bet_id, market_id, user_id, bet_type, amount, price_at_entry))
        
        conn.commit()
    
    # 5. Recalculate odds outside the main transaction lock to avoid hanging
    _recalculate_odds(conn, cursor, market_id, current_prob)
    conn.close()
    
    return True, f"Successfully placed ${amount} on {bet_type} @ {price_at_entry:.2f}"

def _recalculate_odds(conn, cursor, market_id, old_prob):
    """
    Dynamically adjusts the market price (Yes probability) based on total pool ratio.
    Simplified AMM simulation.
    """
    # Calculate total YES volume and total NO volume
    cursor.execute("SELECT SUM(amount) FROM BETS WHERE market_id = ? AND bet_type = 'YES'", (market_id,))
    yes_volume = cursor.fetchone()[0] or 0.0
    
    cursor.execute("SELECT SUM(amount) FROM BETS WHERE market_id = ? AND bet_type = 'NO'", (market_id,))
    no_volume = cursor.fetchone()[0] or 0.0
    
    total_volume = yes_volume + no_volume
    
    # If there is volume, adjust price towards the ratio of the pool.
    # To prevent wild swings on the first bet, we blend it with the initial probability.
    cursor.execute("SELECT initial_prob FROM MARKETS WHERE id = ?", (market_id,))
    initial_prob = cursor.fetchone()[0]
    
    # Base weight representing "liquidity" already in the market by the creator
    BASE_LIQUIDITY = 1000.0 
    
    if total_volume > 0:
        new_yes_prob = ((initial_prob * BASE_LIQUIDITY) + yes_volume) / (BASE_LIQUIDITY + total_volume)
    else:
        new_yes_prob = initial_prob
        
    # Cap boundaries
    new_yes_prob = max(0.01, min(0.99, new_yes_prob))
    
    if abs(new_yes_prob - old_prob) > 0.001:
        cursor.execute("UPDATE MARKETS SET current_prob = ? WHERE id = ?", (new_yes_prob, market_id))
        conn.commit()
        logging.info(f"Odds Updated for {market_id}: {old_prob:.4f} -> {new_yes_prob:.4f}")

# ----------------- Debug / Testing Execution -----------------
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
    
    print("--- 1. Initializing DB ---")
    init_db()
    
    print("\n--- 2. Creating Mock Market ---")
    mock_market = {
        "title": "[测试] 今晚A股是否会有救市政策发布？",
        "yes_outcome": "是",
        "no_outcome": "否",
        "initial_yes_probability": 0.40
    }
    mid = create_market(mock_market)
    
    print("\n--- 3. Testing Betting Engine ---")
    # AI Bets big on YES
    success, msg = place_bet("user_ai", mid, "YES", 5000.0)
    print(f"AI Bet: {msg}")
    
    # Chat Bets on NO
    success, msg = place_bet("user_chat", mid, "NO", 1000.0)
    print(f"Chat Bet: {msg}")
    
    print("\n--- 4. Checking Final Market Odds ---")
    markets = get_open_markets()
    for m in markets:
        print(f"Market: {m['title'][:20]}... | Initial Prob: {m['initial_prob']:.2f} | Current Prob: {m['current_prob']:.4f}")
