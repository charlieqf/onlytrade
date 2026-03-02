import time
import random
import json
import logging
import sqlite3
import re
import os
import requests

try:
    from openai import OpenAI  # type: ignore
except Exception:
    OpenAI = None
from virtual_exchange_db import DB_FILE, place_bet, get_open_markets

# Configure LLM provider through environment variables.
# Required: DASHSCOPE_API_KEY (or OPENAI_API_KEY)
API_KEY = str(
    os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
).strip()
BASE_URL = str(
    os.environ.get("DASHSCOPE_BASE_URL")
    or "https://dashscope.aliyuncs.com/compatible-mode/v1"
).strip()
MODEL_NAME = str(os.environ.get("POLYMARKET_LLM_MODEL") or "qwen3-max").strip()

client = None
if API_KEY and OpenAI is not None:
    try:
        client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
    except Exception as e:
        logging.error(f"[LLM Init Error] failed to initialize client: {e}")
else:
    logging.warning(
        "[LLM Init Warning] DASHSCOPE_API_KEY/OPENAI_API_KEY missing, "
        "engine will run with heuristic fallback outputs."
    )


def _chat_completion_content(messages, temperature=0.7, max_tokens=300):
    if not API_KEY:
        raise RuntimeError("missing_api_key")

    if client is not None:
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return str(response.choices[0].message.content or "")

    endpoint = f"{BASE_URL.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MODEL_NAME,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    response = requests.post(endpoint, headers=headers, json=payload, timeout=45)
    response.raise_for_status()
    obj = response.json()
    choices = obj.get("choices") if isinstance(obj, dict) else None
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("invalid_llm_response")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    return str(content or "")


# In-memory queue for the batch-generated hivemind chat messages
chat_queue = []


def extract_json_from_llm_response(text):
    """Robustly extracts and parses JSON even if the LLM adds markdown fences or conversational text."""
    try:
        # First try direct parse
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON within markdown code blocks or curly braces
        match = re.search(r"```(?:json)?(.*?)```", text, re.DOTALL)
        if match:
            json_str = match.group(1).strip()
        else:
            # Fallback: find the first { or [ and the last } or ]
            start = text.find("{")
            end = text.rfind("}")
            start_arr = text.find("[")
            end_arr = text.rfind("]")

            if start_arr != -1 and end_arr != -1 and (start == -1 or start_arr < start):
                json_str = text[start_arr : end_arr + 1]
            elif start != -1 and end != -1:
                json_str = text[start : end + 1]
            else:
                raise ValueError("Could not locate JSON structure in response")

        return json.loads(json_str)


def agent_zero_decision(market):
    """
    Simulates the primary AI agent evaluating an event and placing a deliberate,
    reasoned bet based on current odds.
    """
    if client is None:
        fallback_bet_type = (
            "YES" if float(market.get("current_prob") or 0.5) < 0.5 else "NO"
        )
        return {
            "bet_type": fallback_bet_type,
            "amount": random.randint(500, 8000),
            "reason": "环境变量未配置，使用回退策略执行",
        }

    content = ""
    prompt = f"""
    You are an aggressive algorithmic trading agent named 'AI_Agent_Zero' participating in a virtual prediction market.
    The current open market is: {market["title"]}
    The YES outcome is '{market["yes_outcome"]}'. The NO outcome is '{market["no_outcome"]}'.
    The current probability (price) for YES is {market["current_prob"]:.2%}.
    
    Decide whether to buy YES or NO right now. Provide a highly technical, quantitative, or news-driven reason (max 40 Chinese chars).
    Return ONLY a raw JSON object adhering EXACTLY to this schema (no markdown formatting):
    {{
        "bet_type": "YES" or "NO",
        "amount": <integer between 500 and 15000>,
        "reason": "<technical Chinese reason>"
    }}
    """
    try:
        content = _chat_completion_content(
            [{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=260,
        )
        data = extract_json_from_llm_response(content)

        logging.info(
            f"[LLM Agent] Decided: {data['bet_type']} ${data['amount']} -> {data['reason']}"
        )
        return data
    except Exception as e:
        logging.error(f"[LLM Agent Error] {e} | Raw Reply: {content or 'None'}")
        return None


def generate_hivemind_batch(market):
    """
    Batch generates 30 unique chat messages from degenerate retail traders reacting to the market.
    """
    if client is None:
        return [
            "冲冲冲！",
            "先观望一下",
            "梭哈是一种智慧",
            "感觉有内幕交易",
            "家人们稳住",
        ]

    content = ""
    prompt = f"""
    You are simulating a lively, slightly degenerate Chinese crypto and stock trading community discussing a prediction market event.
    The market is: {market["title"]}
    The current YES probability is {market["current_prob"]:.2%}.
    
    Generate an array of exactly 30 distinct, localized, and emotionally varied chat messages (each under 20 chars).
    Use slang like "梭哈", "韭菜", "天台", "爆仓", "加仓", "家人们".
    Some should express buying YES, some NO, some just panic or euphoria.
    Return ONLY a JSON array of strings. Example: ["直接梭哈YES，别怂！", "家人们，我先跑了", "这波必定是NO", ...]
    """
    try:
        content = _chat_completion_content(
            [{"role": "user", "content": prompt}],
            temperature=0.8,
            max_tokens=500,
        )
        messages = extract_json_from_llm_response(content)

        if isinstance(messages, list) and len(messages) > 0:
            logging.info(
                f"[Hivemind] Successfully generated {len(messages)} fresh chat messages."
            )
            return messages
        else:
            raise ValueError("LLM did not return a valid list")
    except Exception as e:
        logging.error(f"[Hivemind LLM Error] {e}")
        # Fallback messages if LLM fails
        return [
            "冲冲冲！",
            "先观望一下",
            "梭哈是一种智慧",
            "感觉有内幕交易",
            "跟着AI大聪明下注",
        ]


def generate_mock_name():
    names = [
        "加密老猫",
        "杭州王老板",
        "韭菜_889",
        "A股第一牛",
        "Quantum_Trader",
        "BTC_Whale",
        "Degen_Ape",
        "Web3_Builder",
        "币圈打工人",
        "高频量化机器人",
        "Solana狙击手",
        "套牢的胖子",
        "财富自由之路",
        "Polymarket大神",
        "神秘大户_0x8F",
    ]
    name = f"{random.choice(names)}_{random.randint(10, 99)}"

    # Ensure user exists in DB for foreign key constraints dynamically
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "INSERT OR IGNORE INTO USERS (id, username, balance) VALUES (?, ?, ?)",
        (f"u_{hash(name)}", name, 50000.0),
    )
    conn.commit()
    conn.close()

    return f"u_{hash(name)}"


def run_agents():
    logging.info("Starting LLM-Driven Polymarket Trading Engine...")
    global chat_queue

    last_agent_run = 0

    while True:
        try:
            markets = get_open_markets()
            if not markets:
                logging.info("No open markets found. Waiting...")
                time.sleep(5)
                continue

            # Pick a random market to focus activity on
            target_market = random.choice(markets)

            # --- 1. AI Agent Trading (Every ~30 seconds) ---
            if time.time() - last_agent_run > 30:
                decision = agent_zero_decision(target_market)
                if decision:
                    place_bet(
                        "user_ai",
                        target_market["id"],
                        decision["bet_type"],
                        decision["amount"],
                    )
                    # Note: To see the 'reason' in the UI without schema changes, we could encode it in the amount or a separate table,
                    # but for this MVP, the bridge just formats AI transactions as "AI Execution".
                last_agent_run = time.time()

            # --- 2. Hivemind Simulation (High Frequency 1-3s) ---
            # Refill the chat queue if empty using batch LLM call
            if not chat_queue:
                chat_queue = generate_hivemind_batch(target_market)

            if chat_queue:
                msg = chat_queue.pop(0)
                # Parse intent from the LLM generated string to create a real DB bet
                bet_type = (
                    "YES"
                    if "YES" in msg.upper() or "是" in msg
                    else "NO"
                    if "NO" in msg.upper() or "否" in msg or "反买" in msg
                    else random.choice(["YES", "NO"])
                )
                amount = random.randint(100, 5000)

                # Execute user trade
                user_id = generate_mock_name()
                place_bet(user_id, target_market["id"], bet_type, amount)
                logging.info(f"[Chat Executed] {user_id} -> {msg[:15]}...")

            time.sleep(random.uniform(1.0, 3.0))

        except Exception as e:
            logging.error(f"Engine Loop Error: {e}")
            time.sleep(5)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    run_agents()
