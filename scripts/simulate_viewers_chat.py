#!/usr/bin/env python3

import argparse
from collections import deque
import json
import os
import random
import re
import time
from datetime import datetime, timedelta, timezone
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple


def now_ms() -> int:
    return int(time.time() * 1000)


class ApiClient:
    def __init__(self, base_url: str, timeout_sec: int = 20):
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec

    def _request(self, method: str, path: str, payload=None):
        url = f"{self.base_url}{path}"
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url=url, method=method, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                parsed = json.loads(body) if body else {}
                return int(resp.getcode()), parsed
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = {"raw": body}
            return int(exc.code), parsed
        except Exception as exc:
            return 0, {"error": str(exc)}

    def get(self, path: str):
        return self._request("GET", path, payload=None)

    def post(self, path: str, payload=None):
        return self._request("POST", path, payload=payload or {})


def unwrap_data(payload):
    if (
        isinstance(payload, dict)
        and "data" in payload
        and isinstance(payload.get("success"), bool)
    ):
        return payload.get("data")
    return payload


def append_jsonl(path: Path, item):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(item, ensure_ascii=False) + "\n")


@dataclass
class Viewer:
    nickname: str
    session_id: str


STOCK_TOPICS = [
    "{symbol} 现在这波是突破还是假突破？",
    "今天 {symbol} 量能一般，要不要先减仓？",
    "{symbol} 这个位置适合低吸吗？",
    "我看 {symbol} 5分钟有背离，怎么看？",
]

TRADE_TOPICS = [
    "现在仓位控制在几成更稳？",
    "止损一般放多宽比较合理？",
    "今天这种震荡盘该追涨吗？",
    "如果连续两笔亏损，是否先暂停交易？",
]

NEWS_TOPICS = [
    "刚才那条新闻会影响白酒板块吗？",
    "海外市场波动会不会传导到A股？",
    "今天政策消息偏利好还是中性？",
    "科技线新闻这么多，短线会不会拥挤？",
]

CASUAL_TOPICS = [
    "主播喝口水，慢一点讲我在记笔记。",
    "今天心态有点炸，给点稳住节奏的建议。",
    "这波讲解很清楚，继续冲！",
    "盘面有点无聊，来一句今日交易格言。",
    "我在路上听直播，信号断断续续也要跟上。",
    "今天该怎么安排复盘节奏，求个模板。",
    "你一般复盘多久？我老是坚持不住。",
    "我家猫又踩键盘了，差点帮我下单。",
]

OFFTOPIC_TOPICS = [
    "有人在看球吗，比分到哪了？",
    "我这边下雨了，今天状态有点分心。",
    "今天开会开麻了，来点提神的话。",
    "最近有什么好看的剧，休息时想放松一下。",
    "今天靠咖啡续命，给点专注建议。",
    "今天通勤有点挤，脑子还没缓过来。",
]

TOPIC_GROUPS = {
    "stock": STOCK_TOPICS,
    "trade": TRADE_TOPICS,
    "news": NEWS_TOPICS,
    "casual": CASUAL_TOPICS,
    "offtopic": OFFTOPIC_TOPICS,
}

POLYMARKET_PREDICT_TOPICS = [
    "你觉得这条事件接下来24小时会继续发酵吗？",
    "我倾向正方，但还想听听反方最强理由。",
    "这条消息如果被权威确认，概率会不会再抬一档？",
    "现在看更像短时噪声还是趋势变化？",
    "这条线索里你最看重哪一个事实点？",
    "这事件像烟雾弹还是前奏？大家来押观点，不押情绪。",
]

POLYMARKET_COMMENT_TOPICS = [
    "这条新闻信息量挺大，先把时间线捋一下。",
    "我更关心消息源可靠性，谁有一手来源？",
    "先不急下结论，等下一条权威更新再看。",
    "这个事件背景挺复杂，求主播拆一下关键节点。",
    "同样是高热度，这条和上一条的性质不太一样。",
]

POLYMARKET_JOKE_TOPICS = [
    "我先端好瓜子看剧情反转，谁先来写结局。",
    "今天不是刷K线，是追事件更新速度。",
    "我这边弹幕比电视剧还精彩，继续继续。",
    "我家猫刚点头，表示反方也有戏。",
    "先别吵，给正方反方都留一口气。",
]

POLYMARKET_TOPIC_GROUPS = {
    "predict": POLYMARKET_PREDICT_TOPICS,
    "comment": POLYMARKET_COMMENT_TOPICS,
    "joke": POLYMARKET_JOKE_TOPICS,
}

POLYMARKET_TOPIC_WEIGHTS = {
    "predict": 55,
    "comment": 30,
    "joke": 15,
}

POLYMARKET_BANNED_WORDS = [
    "出手",
    "下单",
    "交易",
    "买入",
    "卖出",
    "建仓",
    "加仓",
    "减仓",
    "止损",
    "仓位",
]

POLYMARKET_WORD_REPLACEMENTS = {
    "出手": "发言",
    "下单": "下判断",
    "交易": "讨论",
    "买入": "支持",
    "卖出": "反对",
    "建仓": "表态",
    "加仓": "提高关注",
    "减仓": "降低关注",
    "止损": "风险边界",
    "仓位": "观点权重",
}

TOPIC_WEIGHTS = {
    "stock": 40,
    "trade": 23,
    "news": 25,
    "casual": 10,
    "offtopic": 2,
}

CATEGORY_STYLE_HINT = {
    "stock": "围绕具体股票、价格或分时结构发问，像真实散户。",
    "trade": "围绕仓位、止损、风控或执行纪律发问。",
    "news": "结合一条新闻标题，问可能影响到的板块或个股。",
    "casual": "轻松一句，但要和交易节奏或心态相关。",
    "offtopic": "可以轻微生活化，但不要偏离盘中场景。",
}

NICKNAME_PREFIXES = [
    "阿秋",
    "小北",
    "木子",
    "云朵",
    "阿宁",
    "星河",
    "小橙",
    "山海",
    "小鹿",
    "阿杰",
    "豆包",
    "南风",
]

NICKNAME_SUFFIXES = [
    "看盘",
    "短线",
    "路人",
    "学徒",
    "打工人",
    "散户",
    "夜猫",
    "慢慢来",
    "稳一点",
    "不追高",
]

POLYMARKET_NICKNAME_SUFFIXES = [
    "路人",
    "学徒",
    "打工人",
    "夜猫",
    "慢慢来",
    "稳一点",
    "围观",
    "吃瓜",
]

CONTENT_MODES = ("template", "mixed", "llm")


def merge_symbol_pool(
    base_symbols: List[str], extra_symbols: List[str], limit: int = 16
) -> List[str]:
    out: List[str] = []
    for raw in [*(base_symbols or []), *(extra_symbols or [])]:
        sym = str(raw or "").strip().upper()
        if not sym:
            continue
        if sym not in out:
            out.append(sym)
        if len(out) >= max(1, int(limit)):
            break
    return out


def to_float(value) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def as_dict(value) -> Dict:
    return value if isinstance(value, dict) else {}


def build_room_prompt_context(
    api: ApiClient, room_id: str
) -> Tuple[Optional[Dict], Optional[str]]:
    safe_room = urllib.parse.quote(str(room_id or "").strip())
    code, payload = api.get(f"/api/rooms/{safe_room}/stream-packet?decision_limit=3")
    if code != 200:
        return None, f"room_context_http_{code}"

    data = unwrap_data(payload)
    if not isinstance(data, dict):
        return None, "room_context_invalid_payload"

    ctx = as_dict(data.get("room_context"))
    latest = as_dict(data.get("decision_latest"))
    latest_head = {}
    latest_decisions = latest.get("decisions")
    if isinstance(latest_decisions, list) and latest_decisions:
        first = latest_decisions[0]
        if isinstance(first, dict):
            latest_head = first

    symbols: List[str] = []
    decision_symbol = str(latest_head.get("symbol") or "").strip().upper()
    if decision_symbol:
        symbols.append(decision_symbol)

    prices: List[str] = []
    positions_raw = data.get("positions")
    positions = positions_raw if isinstance(positions_raw, list) else []
    for row in positions[:6]:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get("symbol") or "").strip().upper()
        if symbol and symbol not in symbols:
            symbols.append(symbol)
        if not symbol:
            continue
        mark = to_float(row.get("mark_price"))
        pnl = to_float(row.get("unrealized_pnl"))
        if mark is None:
            continue
        suffix = ""
        if pnl is not None:
            suffix = f"(浮盈{pnl:+.0f})"
        prices.append(f"{symbol}现价{mark:.2f}{suffix}")

    news_titles = []
    raw_titles = ctx.get("news_digest_titles")
    if not isinstance(raw_titles, list) or not raw_titles:
        digest = as_dict(data.get("news_digest"))
        raw_titles = (
            digest.get("titles") if isinstance(digest.get("titles"), list) else []
        )
    for item in raw_titles or []:
        title = str(item or "").strip()
        if title:
            news_titles.append(title)
        if len(news_titles) >= 4:
            break

    decision_line = ""
    if latest_head:
        action = str(latest_head.get("action") or "").strip().upper() or "HOLD"
        conf = to_float(latest_head.get("confidence"))
        px = to_float(latest_head.get("price"))
        qty = to_float(latest_head.get("quantity"))
        conf_text = f" 置信{conf:.2f}" if conf is not None else ""
        px_text = f" 参考价{px:.2f}" if px is not None else ""
        qty_text = f" 数量{qty:.0f}" if qty is not None else ""
        decision_line = f"{decision_symbol or 'UNKNOWN'} {action}{conf_text}{px_text}{qty_text}".strip()

    out = {
        "market_overview": str(ctx.get("market_overview_brief") or "").strip(),
        "market_breadth": str(ctx.get("market_breadth_summary") or "").strip(),
        "news_titles": news_titles,
        "decision": decision_line,
        "price_samples": prices[:4],
        "symbol_candidates": symbols[:12],
        "time_context": ctx.get("time_context")
        if isinstance(ctx.get("time_context"), dict)
        else None,
    }
    return out, None


class LlmClient:
    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str,
        timeout_sec: int,
        max_tokens: int,
        temperature: float,
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = max(3, int(timeout_sec))
        self.max_tokens = max(24, int(max_tokens))
        self.temperature = max(0.0, min(1.5, float(temperature)))

    def generate(
        self,
        category: str,
        symbols: List[str],
        time_context: Optional[Dict] = None,
        room_prompt_context: Optional[Dict] = None,
        recent_texts: Optional[List[str]] = None,
    ) -> Dict:
        symbol_hint = ", ".join(symbols[:8]) if symbols else "600519.SH"
        tc = time_context or shanghai_time_context()
        now_iso = str(tc.get("now_iso") or "")
        hhmm = str(tc.get("hhmm") or "")
        day_part = str(tc.get("day_part") or "")

        rpc = room_prompt_context or {}
        market_line = str(rpc.get("market_overview") or "").strip()[:160]
        breadth_line = str(rpc.get("market_breadth") or "").strip()[:120]
        decision_line = str(rpc.get("decision") or "").strip()[:120]

        news_titles_raw = rpc.get("news_titles")
        news_titles = news_titles_raw if isinstance(news_titles_raw, list) else []
        news_snippets = [
            str(x or "").strip() for x in news_titles[:3] if str(x or "").strip()
        ]
        news_line = "；".join(news_snippets)[:180]

        price_samples_raw = rpc.get("price_samples")
        price_samples = price_samples_raw if isinstance(price_samples_raw, list) else []
        price_snippets = [
            str(x or "").strip() for x in price_samples[:3] if str(x or "").strip()
        ]
        price_line = "；".join(price_snippets)[:180]

        recents = []
        for item in recent_texts or []:
            text = str(item or "").strip()
            if text:
                recents.append(text[:30])
            if len(recents) >= 8:
                break
        recent_line = " | ".join(recents)

        style_hint = CATEGORY_STYLE_HINT.get(category, CATEGORY_STYLE_HINT["stock"])
        user_prompt = (
            "你在生成直播间观众消息。"
            f"类别: {category}。"
            f"写作要求: {style_hint}。"
            f"可参考股票代码: {symbol_hint}。"
            f"当前本地时间(Asia/Shanghai): {now_iso} ({hhmm}, {day_part})。"
            f"市场摘要: {market_line or '暂无'}。"
            f"宽度摘要: {breadth_line or '暂无'}。"
            f"最新决策: {decision_line or '暂无'}。"
            f"实时价格样本: {price_line or '暂无'}。"
            f"新闻标题: {news_line or '暂无'}。"
            f"最近弹幕(避免重复句式): {recent_line or '无'}。"
            "输出一条中文自然口语，12-34字，单句，不要解释，不要引号。"
            "时间语境必须一致：白天不要出现下班/晚饭/晚安等夜间表达。"
            "不要复述系统字段名，不要生成空泛鸡汤。"
        )
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": "你负责生成真实直播弹幕，语气像普通散户，优先贴合当下行情/新闻/价格上下文。",
                },
                {"role": "user", "content": user_prompt},
            ],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }

        req = urllib.request.Request(
            url=f"{self.base_url}/chat/completions",
            method="POST",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                parsed = json.loads(body) if body else {}
                choices = parsed.get("choices") if isinstance(parsed, dict) else None
                if not isinstance(choices, list) or not choices:
                    return {"ok": False, "error": "llm_no_choices"}
                first = choices[0] if isinstance(choices[0], dict) else {}
                msg = first.get("message") if isinstance(first, dict) else {}
                text = ""
                if isinstance(msg, dict):
                    text = str(msg.get("content") or "")
                text = normalize_generated_text(text)
                if not text:
                    return {"ok": False, "error": "llm_empty"}
                return {"ok": True, "text": text}
        except urllib.error.HTTPError as exc:
            code = int(exc.code)
            return {"ok": False, "error": f"llm_http_{code}"}
        except Exception as exc:
            return {"ok": False, "error": f"llm_error:{exc}"}


def normalize_generated_text(text: str) -> str:
    value = str(text or "").replace("\n", " ").strip()
    value = value.strip('"')
    value = value.strip("'")
    value = " ".join(value.split())
    return value[:120].strip()


def shanghai_time_context(ts_ms: Optional[int] = None) -> Dict:
    tz = timezone(timedelta(hours=8))
    now = (
        datetime.now(tz)
        if ts_ms is None
        else datetime.fromtimestamp(ts_ms / 1000.0, tz)
    )
    mins = now.hour * 60 + now.minute
    if 330 <= mins < 540:
        day_part = "early_morning"
    elif 540 <= mins < 690:
        day_part = "morning_session"
    elif 690 <= mins < 780:
        day_part = "lunch_break"
    elif 780 <= mins < 900:
        day_part = "afternoon_session"
    elif 900 <= mins < 1140:
        day_part = "evening"
    else:
        day_part = "night"
    return {
        "timezone": "Asia/Shanghai",
        "now_iso": now.isoformat(timespec="seconds"),
        "hhmm": now.strftime("%H:%M"),
        "day_part": day_part,
        "minutes_since_midnight": mins,
    }


def is_time_appropriate_text(text: str, day_part: str) -> bool:
    value = str(text or "").strip()
    if not value:
        return False

    night_life = (
        "下班",
        "晚饭",
        "晚餐",
        "今晚",
        "夜宵",
        "熬夜",
        "晚安",
        "睡觉",
        "收工",
    )
    morning_only = ("早安", "早餐", "刚起床", "上班路上", "早盘刚开", "刚到公司")

    if day_part in (
        "early_morning",
        "morning_session",
        "lunch_break",
        "afternoon_session",
    ):
        if any(token in value for token in night_life):
            return False

    if day_part in ("evening", "night"):
        if any(token in value for token in morning_only):
            return False

    return True


def filter_templates_for_time(templates: List[str], day_part: str) -> List[str]:
    out = [item for item in templates if is_time_appropriate_text(item, day_part)]
    return out if out else templates


def is_polymarket_room(room_id: str) -> bool:
    rid = str(room_id or "").strip().lower()
    if rid == "t_015":
        return True
    extra = str(os.environ.get("POLYMARKET_VIEWER_ROOM_IDS") or "").strip()
    if not extra:
        return False
    rows = [x.strip().lower() for x in extra.split(",") if x.strip()]
    return rid in rows


def sanitize_polymarket_viewer_text(text: str) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    for src, dst in POLYMARKET_WORD_REPLACEMENTS.items():
        value = value.replace(src, dst)
    for token in POLYMARKET_BANNED_WORDS:
        value = value.replace(token, "")
    value = " ".join(value.split())
    return value[:120].strip()


def compact_polymarket_event_title(text: str, max_len: int = 96) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    value = re.sub(r"\s+", " ", value)
    limit = max(24, int(max_len or 96))
    if len(value) <= limit:
        return value
    sliced = value[:limit]
    soft_boundary = max(12, int(limit * 0.6))
    cut_idx = -1
    for i in range(len(sliced) - 1, soft_boundary - 1, -1):
        if sliced[i] in "，。！？；、:：-—| ":
            cut_idx = i
            break
    core = sliced[: cut_idx if cut_idx > 0 else len(sliced)].rstrip(
        "，。！？；、:：-—| "
    )
    return f"{core}…" if core else ""


def looks_stock_like_text(text: str) -> bool:
    value = str(text or "").strip()
    if not value:
        return False
    if re.search(r"\b\d{6}\.(?:SZ|SH)\b", value):
        return True
    stock_tokens = [
        "量能",
        "资金",
        "利好",
        "利空",
        "涨停",
        "跌停",
        "涨幅",
        "跌幅",
        "开盘",
        "收盘",
        "中间价",
        "主力合约",
        "净回笼",
    ]
    return any(token in value for token in stock_tokens)


def normalize_topic_key(text: str) -> str:
    value = str(text or "").strip().lower()
    if not value:
        return ""
    value = re.sub(r"^\s*[\[【][^\]】]{1,12}[\]】]\s*", "", value)
    value = re.sub(r"\s+", "", value)
    value = re.sub(r"[，,。.!！?？:：;；~`'\"“”‘’\-_=+()\[\]{}<>/\\]", "", value)
    return value[:120]


def resolve_polymarket_topic_key(room_prompt_context: Optional[Dict]) -> str:
    rpc = room_prompt_context if isinstance(room_prompt_context, dict) else {}
    raw_titles = rpc.get("news_titles")
    news_titles = raw_titles if isinstance(raw_titles, list) else []
    for item in news_titles:
        text = str(item or "").strip()
        if not text:
            continue
        key = normalize_topic_key(text)
        if key:
            return key
    market_line = str(rpc.get("market_overview") or "").strip()
    if market_line:
        return normalize_topic_key(market_line)
    return ""


def pick_topic_text(
    symbols: List[str],
    day_part: str,
    polymarket_mode: bool = False,
    room_prompt_context: Optional[Dict] = None,
) -> Tuple[str, str]:
    if polymarket_mode:
        categories = list(POLYMARKET_TOPIC_WEIGHTS.keys())
        weights = [POLYMARKET_TOPIC_WEIGHTS[key] for key in categories]
        category = random.choices(categories, weights=weights, k=1)[0]
        pool = filter_templates_for_time(
            list(POLYMARKET_TOPIC_GROUPS.get(category) or []),
            day_part,
        )
        template = random.choice(pool)
        rpc = room_prompt_context if isinstance(room_prompt_context, dict) else {}
        raw_news_titles = rpc.get("news_titles")
        news_titles = raw_news_titles if isinstance(raw_news_titles, list) else []
        event_title = ""
        for item in news_titles:
            text = str(item or "").strip()
            if text:
                event_title = re.sub(r"^\s*[\[【][^\]】]{1,12}[\]】]\s*", "", text)
                break
        if event_title and random.random() < 0.45:
            compact_title = compact_polymarket_event_title(event_title, max_len=96)
            if compact_title:
                template = f"就这条“{compact_title}”，你更站正方还是反方？"
        return category, sanitize_polymarket_viewer_text(template)

    categories = list(TOPIC_WEIGHTS.keys())
    weights = [TOPIC_WEIGHTS[key] for key in categories]
    category = random.choices(categories, weights=weights, k=1)[0]
    pool = filter_templates_for_time(list(TOPIC_GROUPS[category]), day_part)
    template = random.choice(pool)
    symbol = random.choice(symbols) if symbols else "600519.SH"
    return category, template.format(symbol=symbol)


def build_random_nickname(
    index: int, used: Set[str], polymarket_mode: bool = False
) -> str:
    suffix_pool = POLYMARKET_NICKNAME_SUFFIXES if polymarket_mode else NICKNAME_SUFFIXES
    for _ in range(24):
        candidate = (
            f"{random.choice(NICKNAME_PREFIXES)}"
            f"{random.choice(suffix_pool)}"
            f"{random.randint(0, 99):02d}"
        )
        if candidate not in used:
            used.add(candidate)
            return candidate

    fallback = f"观众{index + 1:02d}_{random.randint(100, 999)}"
    used.add(fallback)
    return fallback


def pick_message_text(
    symbols: List[str],
    content_mode: str,
    llm_ratio: float,
    llm_client: Optional[LlmClient],
    time_context: Dict,
    polymarket_mode: bool = False,
    room_prompt_context: Optional[Dict] = None,
    recent_texts: Optional[List[str]] = None,
) -> Tuple[str, str, str, Optional[str]]:
    day_part = str(time_context.get("day_part") or "")
    category, template_text = pick_topic_text(
        symbols,
        day_part,
        polymarket_mode=polymarket_mode,
        room_prompt_context=room_prompt_context,
    )
    ratio = max(0.0, min(1.0, float(llm_ratio)))
    use_llm = content_mode == "llm" or (
        content_mode == "mixed" and random.random() < ratio
    )
    if use_llm and llm_client is not None:
        result = llm_client.generate(
            category=category,
            symbols=symbols,
            time_context=time_context,
            room_prompt_context=room_prompt_context,
            recent_texts=recent_texts,
        )
        if result.get("ok"):
            text = normalize_generated_text(str(result.get("text") or ""))
            recent_set = {
                str(x or "").strip()
                for x in (recent_texts or [])
                if str(x or "").strip()
            }
            if (
                text
                and is_time_appropriate_text(text, day_part)
                and text not in recent_set
            ):
                if polymarket_mode:
                    text = sanitize_polymarket_viewer_text(text)
                if not text:
                    return (
                        category,
                        template_text,
                        "template_fallback",
                        "polymarket_sanitized_empty",
                    )
                return category, text, "llm", None
            return (
                category,
                template_text,
                "template_fallback",
                "llm_time_mismatch_or_repeat",
            )
        return (
            category,
            template_text,
            "template_fallback",
            str(result.get("error") or "llm_failed"),
        )

    if polymarket_mode:
        template_text = sanitize_polymarket_viewer_text(template_text)
    return category, template_text, "template", None


def poll_reply(
    api: ApiClient,
    room_id: str,
    viewer: Viewer,
    visibility: str,
    sent_ts_ms: int,
    timeout_sec: int,
) -> dict:
    deadline = time.time() + max(5, timeout_sec)
    while time.time() < deadline:
        if visibility == "private":
            query = urllib.parse.urlencode(
                {"user_session_id": viewer.session_id, "limit": 30}
            )
            code, payload = api.get(f"/api/chat/rooms/{room_id}/private?{query}")
        else:
            code, payload = api.get(f"/api/chat/rooms/{room_id}/public?limit=30")

        data = unwrap_data(payload) if code == 200 else {}
        messages = data.get("messages", []) if isinstance(data, dict) else []
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            if str(msg.get("sender_type")) != "agent":
                continue
            created = int(msg.get("created_ts_ms") or 0)
            if created < sent_ts_ms:
                continue
            return {
                "ok": True,
                "reply_ts_ms": created,
                "latency_ms": max(0, created - sent_ts_ms),
                "reply_text": str(msg.get("text") or ""),
            }
        time.sleep(2)
    return {"ok": False, "error": "reply_timeout"}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Simulate multiple viewers chatting with one room agent"
    )
    parser.add_argument("--api-base", default="http://127.0.0.1:18080")
    parser.add_argument("--room-id", default="t_001")
    parser.add_argument(
        "--room-mode",
        choices=("auto", "stock", "polymarket"),
        default="auto",
        help="Force viewer content mode by room type",
    )
    parser.add_argument("--viewers", type=int, default=8)
    parser.add_argument("--duration-min", type=int, default=30)
    parser.add_argument("--min-interval-sec", type=float, default=3.0)
    parser.add_argument("--max-interval-sec", type=float, default=8.0)
    parser.add_argument("--reply-timeout-sec", type=int, default=30)
    parser.add_argument("--reply-mode", choices=("none", "blocking"), default="none")
    parser.add_argument("--constant-tempo", dest="constant_tempo", action="store_true")
    parser.add_argument(
        "--no-constant-tempo", dest="constant_tempo", action="store_false"
    )
    parser.set_defaults(constant_tempo=True)
    parser.add_argument("--content-mode", choices=CONTENT_MODES, default="template")
    parser.add_argument("--llm-ratio", type=float, default=0.35)
    parser.add_argument(
        "--llm-model",
        default=os.environ.get("CHAT_OPENAI_MODEL", "qwen3-max"),
    )
    parser.add_argument(
        "--llm-base-url",
        default=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    )
    parser.add_argument("--llm-timeout-sec", type=int, default=12)
    parser.add_argument("--llm-max-tokens", type=int, default=64)
    parser.add_argument("--llm-temperature", type=float, default=0.9)
    parser.add_argument("--context-refresh-sec", type=float, default=15.0)
    parser.add_argument("--recent-window-size", type=int, default=18)
    parser.add_argument(
        "--use-room-context", dest="use_room_context", action="store_true"
    )
    parser.add_argument(
        "--no-use-room-context", dest="use_room_context", action="store_false"
    )
    parser.set_defaults(use_room_context=True)
    parser.add_argument(
        "--symbols",
        default="002131.SZ,300058.SZ,002342.SZ,600519.SH,300059.SZ,600089.SH,600986.SH,601899.SH,002050.SZ,002195.SZ",
    )
    parser.add_argument("--log-path", default="logs/soak/viewer-sim/messages.jsonl")
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    random.seed(args.seed)

    symbols = [
        s.strip().upper() for s in str(args.symbols or "").split(",") if s.strip()
    ]
    api = ApiClient(args.api_base)
    log_path = Path(args.log_path)
    room_mode = str(getattr(args, "room_mode", "auto") or "auto").strip().lower()
    if room_mode == "polymarket":
        polymarket_mode = True
    elif room_mode == "stock":
        polymarket_mode = False
    else:
        polymarket_mode = is_polymarket_room(str(args.room_id))

    llm_client: Optional[LlmClient] = None
    api_key = str(os.environ.get("OPENAI_API_KEY") or "").strip()
    if args.content_mode in ("mixed", "llm"):
        if not api_key:
            if args.content_mode == "llm":
                print(
                    json.dumps(
                        {
                            "ok": False,
                            "error": "missing_openai_api_key",
                            "hint": "Set OPENAI_API_KEY or use --content-mode template",
                        },
                        ensure_ascii=False,
                    )
                )
                return 1
        else:
            llm_client = LlmClient(
                api_key=api_key,
                model=str(args.llm_model),
                base_url=str(args.llm_base_url),
                timeout_sec=int(args.llm_timeout_sec),
                max_tokens=int(args.llm_max_tokens),
                temperature=float(args.llm_temperature),
            )

    viewers: List[Viewer] = []
    used_nicknames: Set[str] = set()
    for i in range(max(1, int(args.viewers))):
        nickname = build_random_nickname(
            i, used_nicknames, polymarket_mode=polymarket_mode
        )
        code, payload = api.post(
            "/api/chat/session/bootstrap", {"user_nickname": nickname}
        )
        data = unwrap_data(payload) if code == 200 else {}
        if not isinstance(data, dict):
            data = {}
        session_id = str(data.get("user_session_id") or "").strip()
        if not session_id:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": "bootstrap_failed",
                        "nickname": nickname,
                        "status": code,
                        "payload": payload,
                    },
                    ensure_ascii=False,
                )
            )
            return 1
        viewers.append(Viewer(nickname=nickname, session_id=session_id))

    print(
        json.dumps(
            {
                "ok": True,
                "viewers": len(viewers),
                "room_id": args.room_id,
                "content_mode": args.content_mode,
                "llm_enabled": llm_client is not None,
            },
            ensure_ascii=False,
        )
    )

    end_at = time.time() + max(1, int(args.duration_min)) * 60
    next_send_at = time.time()
    sent = 0
    reply_expected = 0
    reply_ok = 0
    reply_fail = 0
    llm_used = 0
    llm_fallback = 0
    llm_fail = 0
    recent_texts = deque(maxlen=max(4, int(args.recent_window_size)))
    topic_window_cap = 240
    sent_polymarket_topic_keys: Set[str] = set()
    sent_polymarket_topic_order: deque[str] = deque(maxlen=topic_window_cap)

    room_prompt_context: Optional[Dict] = None
    room_ctx_error: Optional[str] = None
    room_ctx_fetch_ok = 0
    room_ctx_fetch_fail = 0
    room_ctx_next_refresh_ms = 0
    context_refresh_ms = max(3000, int(float(args.context_refresh_sec) * 1000))

    while time.time() < end_at:
        if args.constant_tempo:
            delay = max(0.0, next_send_at - time.time())
            if delay > 0:
                time.sleep(delay)

        if bool(args.use_room_context):
            now_tick_ms = now_ms()
            if room_prompt_context is None or now_tick_ms >= room_ctx_next_refresh_ms:
                fetched_ctx, fetch_error = build_room_prompt_context(
                    api, str(args.room_id)
                )
                room_ctx_next_refresh_ms = now_tick_ms + context_refresh_ms
                if fetched_ctx:
                    room_prompt_context = fetched_ctx
                    room_ctx_error = None
                    room_ctx_fetch_ok += 1
                else:
                    room_ctx_error = fetch_error or "room_context_fetch_failed"
                    room_ctx_fetch_fail += 1

        dynamic_symbols_raw = (
            room_prompt_context.get("symbol_candidates")
            if isinstance(room_prompt_context, dict)
            else []
        )
        dynamic_symbols = (
            [
                str(x or "").strip().upper()
                for x in dynamic_symbols_raw
                if str(x or "").strip()
            ]
            if isinstance(dynamic_symbols_raw, list)
            else []
        )
        effective_symbols = merge_symbol_pool(symbols, dynamic_symbols, limit=16)

        topic_key = ""
        if polymarket_mode:
            topic_key = resolve_polymarket_topic_key(room_prompt_context)
            if topic_key and topic_key in sent_polymarket_topic_keys:
                next_interval = random.uniform(
                    max(0.2, float(args.min_interval_sec)),
                    max(float(args.min_interval_sec), float(args.max_interval_sec)),
                )
                if args.constant_tempo:
                    next_send_at += next_interval
                    if next_send_at < time.time() - max(
                        1.0, float(args.max_interval_sec)
                    ):
                        next_send_at = time.time()
                else:
                    time.sleep(next_interval)
                continue

        viewer = random.choice(viewers)
        room_time_ctx = (
            room_prompt_context.get("time_context")
            if isinstance(room_prompt_context, dict)
            else None
        )
        time_ctx = (
            room_time_ctx
            if isinstance(room_time_ctx, dict)
            else shanghai_time_context()
        )
        category, body, content_source, llm_error = pick_message_text(
            symbols=effective_symbols,
            content_mode=str(args.content_mode),
            llm_ratio=float(args.llm_ratio),
            llm_client=llm_client,
            time_context=time_ctx,
            polymarket_mode=polymarket_mode,
            room_prompt_context=room_prompt_context,
            recent_texts=list(recent_texts),
        )
        if content_source == "llm":
            llm_used += 1
        elif content_source == "template_fallback":
            llm_fallback += 1
            llm_fail += 1

        mode = random.random()
        if mode < 0.45:
            visibility = "public"
            message_type = "public_mention_agent"
            mention_name = "小真" if polymarket_mode else "agent"
            text = f"@{mention_name} {body}"
            expect_reply = True
        elif mode < 0.75:
            visibility = "private"
            message_type = "private_agent_dm"
            text = body
            expect_reply = True
        else:
            visibility = "public"
            message_type = "public_plain"
            text = body
            expect_reply = False

        sent_ts_ms = now_ms()
        payload = {
            "user_session_id": viewer.session_id,
            "user_nickname": viewer.nickname,
            "visibility": visibility,
            "message_type": message_type,
            "text": text,
        }
        code, resp = api.post(f"/api/chat/rooms/{args.room_id}/messages", payload)
        if code == 200 and body:
            recent_texts.append(str(body))
            if polymarket_mode and topic_key:
                if topic_key not in sent_polymarket_topic_keys:
                    sent_polymarket_topic_keys.add(topic_key)
                    if len(sent_polymarket_topic_order) >= topic_window_cap:
                        dropped = sent_polymarket_topic_order.popleft()
                        sent_polymarket_topic_keys.discard(dropped)
                    sent_polymarket_topic_order.append(topic_key)
        row = {
            "ts_ms": sent_ts_ms,
            "time_context": time_ctx,
            "viewer": viewer.nickname,
            "user_session_id": viewer.session_id,
            "visibility": visibility,
            "message_type": message_type,
            "topic": category,
            "content_source": content_source,
            "text": text,
            "status": code,
            "ok": code == 200,
        }
        if topic_key:
            row["topic_key"] = topic_key
        if llm_error:
            row["llm_error"] = llm_error
        if room_ctx_error:
            row["room_context_error"] = room_ctx_error

        if expect_reply and str(args.reply_mode) == "blocking":
            reply_expected += 1
            if code == 200:
                reply = poll_reply(
                    api=api,
                    room_id=args.room_id,
                    viewer=viewer,
                    visibility=visibility,
                    sent_ts_ms=sent_ts_ms,
                    timeout_sec=args.reply_timeout_sec,
                )
                row["reply"] = reply
                if reply.get("ok"):
                    reply_ok += 1
                else:
                    reply_fail += 1
            else:
                row["reply"] = {"ok": False, "error": "message_post_failed"}
                reply_fail += 1

        append_jsonl(log_path, row)
        sent += 1

        next_interval = random.uniform(
            max(0.2, float(args.min_interval_sec)),
            max(float(args.min_interval_sec), float(args.max_interval_sec)),
        )
        if args.constant_tempo:
            next_send_at += next_interval
            if next_send_at < time.time() - max(1.0, float(args.max_interval_sec)):
                next_send_at = time.time()
        else:
            time.sleep(next_interval)

    summary = {
        "ok": True,
        "room_id": args.room_id,
        "viewers": len(viewers),
        "messages_sent": sent,
        "reply_expected": reply_expected,
        "reply_ok": reply_ok,
        "reply_fail": reply_fail,
        "reply_ok_rate": (reply_ok / reply_expected) if reply_expected else None,
        "reply_mode": str(args.reply_mode),
        "constant_tempo": bool(args.constant_tempo),
        "content_mode": args.content_mode,
        "llm_used": llm_used,
        "llm_fail": llm_fail,
        "llm_fallback": llm_fallback,
        "use_room_context": bool(args.use_room_context),
        "room_context_fetch_ok": room_ctx_fetch_ok,
        "room_context_fetch_fail": room_ctx_fetch_fail,
        "last_room_context_error": room_ctx_error,
        "log_path": str(log_path),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
