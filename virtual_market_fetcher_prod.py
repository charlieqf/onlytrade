#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Virtual Prediction Market Fetcher (Production Version for CentOS)
Fetches trending topics from Weibo and Zhihu and uses Qwen3-Max via Aliyun DashScope
to generate JSON-formatted prediction market events.
"""

import requests
import json
import time
import os
import logging
from datetime import datetime

try:
    from openai import OpenAI  # type: ignore
except Exception:
    OpenAI = None

import virtual_exchange_db  # Import our local virtual exchange DB

# ---------------- 配置区域 (Configuration) ----------------

# AI Model Configuration (Aliyun DashScope)
# Required: DASHSCOPE_API_KEY (or OPENAI_API_KEY)
DASHSCOPE_API_KEY = str(
    os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
).strip()
DASHSCOPE_BASE_URL = str(
    os.environ.get("DASHSCOPE_BASE_URL")
    or "https://dashscope.aliyuncs.com/compatible-mode/v1"
).strip()
MODEL_NAME = str(os.environ.get("POLYMARKET_LLM_MODEL") or "qwen3-max").strip()

# System Configuration
LOG_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "virtual_market_fetcher.log"
)

# Setup Logging for background execution on CentOS
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),  # Also print to console for manual testing
    ],
)

client = None
if DASHSCOPE_API_KEY and OpenAI is not None:
    try:
        client = OpenAI(
            api_key=DASHSCOPE_API_KEY,
            base_url=DASHSCOPE_BASE_URL,
        )
    except Exception as e:
        logging.error(f"Failed to initialize OpenAI client for DashScope: {e}")
        client = None


def _chat_completion_content(messages, temperature=0.7, max_tokens=300):
    if not DASHSCOPE_API_KEY:
        raise RuntimeError("missing_api_key")

    if client is not None:
        completion = client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return str(completion.choices[0].message.content or "")

    endpoint = f"{DASHSCOPE_BASE_URL.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
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


# ----------------- 数据抓取模块 (Data Fetching) -----------------


def fetch_weibo_hot():
    """Fetch Weibo Hot Search List (Entertainment/General Gossip)"""
    url = "https://weibo.com/ajax/side/hotSearch"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://weibo.com/",
    }
    try:
        logging.info("Attempting to fetch Weibo Hot Search...")
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()
        data = response.json()
        hot_list = data.get("data", {}).get("realtime", [])

        results = []
        for item in hot_list[:5]:  # Get top 5
            if "word" in item:
                results.append(
                    {
                        "source": "Weibo",
                        "title": item["word"],
                        "hot_score": str(item.get("raw_hot", 0)),
                        "label": item.get("label_name", ""),  # e.g., '爆', '热', '新'
                    }
                )
        logging.info(f"Successfully fetched {len(results)} items from Weibo.")
        return results
    except Exception as e:
        logging.error(f"Error fetching Weibo: {e}")
        return []


def fetch_zhihu_hot():
    """Fetch Zhihu Hot List (Tech/Finance/Deep Discussions)"""
    url = "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": "d_c0=placeholder;",  # Minimal cookie to bypass basic blocks
    }
    try:
        logging.info("Attempting to fetch Zhihu Hot List...")
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()
        data = response.json()
        hot_list = data.get("data", [])

        results = []
        for item in hot_list[:5]:
            target = item.get("target", {})
            results.append(
                {
                    "source": "Zhihu",
                    "title": target.get("title", ""),
                    "hot_score": str(item.get("detail_text", "")),
                }
            )
        logging.info(f"Successfully fetched {len(results)} items from Zhihu.")
        return results
    except Exception as e:
        logging.error(f"Error fetching Zhihu: {e}")
        return []


# ----------------- LLM 引擎模块 (LLM Engine) -----------------


def generate_market_via_llm(topic_data):
    """
    Uses Qwen3-Max to convert a hot topic into a prediction market JSON.
    """
    if not DASHSCOPE_API_KEY:
        logging.error(
            "DASHSCOPE_API_KEY/OPENAI_API_KEY missing. Skipping LLM generation."
        )
        return None

    logging.info(f"Invoking {MODEL_NAME} for topic: {topic_data['title']}")

    prompt = f"""你是一个冷酷的金融庄家，专门为名为"CyberMarket"的预测市场平台生成对赌盘口。
目前抓取到的网络热点是：『{topic_data["title"]}』，数据来源：{topic_data["source"]}，当前热度标识：{topic_data.get("label") or topic_data.get("hot_score")}。

请基于这个突发热点，生成一个非黑即白（Yes或No）、结果明确可验证的对赌盘口。
要求：
1. 盘口事件必须是短期内（例如 12 小时、24 小时或 48 小时）能看到结果的。
2. 初始胜率 (initial_yes_probability) 必须在你根据常理和经验判断后给出一个 0.10 到 0.90 之间的合理浮点数。
3. 返回的结果必须是纯粹的 JSON 格式，不要包含任何 Markdown 语法（如 ```json 等），不要任何前言后语。

返回 JSON 结构体如下：
{{
  "title": "[热点分类前缀] 具体的盘口描述问题？",
  "yes_outcome": "是，发生XXX情况",
  "no_outcome": "否，发生XXX情况（与Yes对立）",
  "initial_yes_probability": 0.50,
  "close_time": "T+24H"
}}
"""
    result_text = ""
    try:
        result_text = _chat_completion_content(
            [
                {
                    "role": "system",
                    "content": "你是一个严格输出 JSON 数据的机器人分析师。",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=300,
        )
        result_text = result_text.strip()

        # Clean up potential markdown formatting from LLM response
        if result_text.startswith("```json"):
            result_text = result_text[7:]
        if result_text.startswith("```"):
            result_text = result_text[3:]
        if result_text.endswith("```"):
            result_text = result_text[:-3]

        result_text = result_text.strip()

        # Verify it's valid JSON
        market_json = json.loads(result_text)
        logging.info(f"Successfully generated market JSON for: {topic_data['title']}")
        return market_json

    except json.JSONDecodeError as e:
        logging.error(f"Failed to parse LLM output as JSON. Output was: {result_text}")
        return None
    except Exception as e:
        logging.error(f"Error calling Qwen API: {e}")
        return None


# ----------------- 主流程 (Main Loop) -----------------


def process_markets():
    logging.info("=== Starting Data Ingestion Cycle ===")

    # 1. Fetch Data
    weibo_topics = fetch_weibo_hot()
    time.sleep(2)  # Be polite to APIs
    zhihu_topics = fetch_zhihu_hot()

    all_topics = weibo_topics + zhihu_topics

    if not all_topics:
        logging.warning("No topics fetched from any source. Cycle ending.")
        return

    # Initialize DB if not exists
    virtual_exchange_db.init_db()

    # 2. Process via LLM (Just doing top 1 from each source to save API calls during testing)
    topics_to_process = []
    if weibo_topics:
        topics_to_process.append(weibo_topics[0])
    if zhihu_topics:
        topics_to_process.append(zhihu_topics[0])

    generated_markets = []

    for topic in topics_to_process:
        market_data = generate_market_via_llm(topic)
        if market_data:
            generated_markets.append(market_data)
            # 3. Save to SQLite database (Phase 3 Integration)
            market_id = virtual_exchange_db.create_market(market_data)
            logging.info(
                f"Successfully saved to Virtual Exchange DB. Market ID: {market_id}"
            )
        time.sleep(1)  # Rate limiting for LLM API

    logging.info(
        f"=== Cycle Complete. Generated and saved {len(generated_markets)} new markets. ==="
    )


if __name__ == "__main__":
    process_markets()

    # Example instructions for running on CentOS:
    # 1. Install deps: pip3 install requests openai
    # 2. Add to crontab:
    #    */15 * * * * cd /path/to/script && /usr/bin/python3 virtual_market_fetcher_prod.py
