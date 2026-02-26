#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import random
import time
from datetime import datetime, timedelta, timezone
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path


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

TOPIC_WEIGHTS = {
    "stock": 35,
    "trade": 20,
    "news": 15,
    "casual": 20,
    "offtopic": 10,
}

NICKNAME_PREFIXES = [
    "阿秋",
    "小北",
    "木子",
    "云朵",
    "老K",
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

CONTENT_MODES = ("template", "mixed", "llm")


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
        self, category: str, symbols: list[str], time_context: dict | None = None
    ) -> dict:
        symbol_hint = ", ".join(symbols[:8]) if symbols else "600519.SH"
        tc = time_context or shanghai_time_context()
        now_iso = str(tc.get("now_iso") or "")
        hhmm = str(tc.get("hhmm") or "")
        day_part = str(tc.get("day_part") or "")
        user_prompt = (
            "你在生成直播间观众消息。"
            f"类别: {category}。"
            f"可参考股票代码: {symbol_hint}。"
            f"当前本地时间(Asia/Shanghai): {now_iso} ({hhmm}, {day_part})。"
            "输出一条中文自然口语，10-28字，单句，不要解释，不要引号。"
            "时间语境必须一致：白天不要出现下班/晚饭/晚安等夜间表达。"
        )
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": "你负责生成真实直播弹幕，语气像普通散户，偶尔随意闲聊。",
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


def shanghai_time_context(ts_ms: int | None = None) -> dict:
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


def filter_templates_for_time(templates: list[str], day_part: str) -> list[str]:
    out = [item for item in templates if is_time_appropriate_text(item, day_part)]
    return out if out else templates


def pick_topic_text(symbols: list[str], day_part: str) -> tuple[str, str]:
    categories = list(TOPIC_WEIGHTS.keys())
    weights = [TOPIC_WEIGHTS[key] for key in categories]
    category = random.choices(categories, weights=weights, k=1)[0]
    pool = filter_templates_for_time(list(TOPIC_GROUPS[category]), day_part)
    template = random.choice(pool)
    symbol = random.choice(symbols) if symbols else "600519.SH"
    return category, template.format(symbol=symbol)


def build_random_nickname(index: int, used: set[str]) -> str:
    for _ in range(24):
        candidate = (
            f"{random.choice(NICKNAME_PREFIXES)}"
            f"{random.choice(NICKNAME_SUFFIXES)}"
            f"{random.randint(0, 99):02d}"
        )
        if candidate not in used:
            used.add(candidate)
            return candidate

    fallback = f"观众{index + 1:02d}_{random.randint(100, 999)}"
    used.add(fallback)
    return fallback


def pick_message_text(
    symbols: list[str],
    content_mode: str,
    llm_ratio: float,
    llm_client: LlmClient | None,
    time_context: dict,
) -> tuple[str, str, str, str | None]:
    day_part = str(time_context.get("day_part") or "")
    category, template_text = pick_topic_text(symbols, day_part)
    ratio = max(0.0, min(1.0, float(llm_ratio)))
    use_llm = content_mode == "llm" or (
        content_mode == "mixed" and random.random() < ratio
    )
    if use_llm and llm_client is not None:
        result = llm_client.generate(
            category=category, symbols=symbols, time_context=time_context
        )
        if result.get("ok"):
            text = normalize_generated_text(str(result.get("text") or ""))
            if text and is_time_appropriate_text(text, day_part):
                return category, text, "llm", None
            return (
                category,
                template_text,
                "template_fallback",
                "llm_time_mismatch",
            )
        return (
            category,
            template_text,
            "template_fallback",
            str(result.get("error") or "llm_failed"),
        )

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
    parser.add_argument("--llm-model", default="gpt-4o-mini")
    parser.add_argument(
        "--llm-base-url",
        default=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    )
    parser.add_argument("--llm-timeout-sec", type=int, default=12)
    parser.add_argument("--llm-max-tokens", type=int, default=64)
    parser.add_argument("--llm-temperature", type=float, default=0.9)
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

    llm_client: LlmClient | None = None
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

    viewers: list[Viewer] = []
    used_nicknames: set[str] = set()
    for i in range(max(1, int(args.viewers))):
        nickname = build_random_nickname(i, used_nicknames)
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

    while time.time() < end_at:
        if args.constant_tempo:
            delay = max(0.0, next_send_at - time.time())
            if delay > 0:
                time.sleep(delay)

        viewer = random.choice(viewers)
        time_ctx = shanghai_time_context()
        category, body, content_source, llm_error = pick_message_text(
            symbols=symbols,
            content_mode=str(args.content_mode),
            llm_ratio=float(args.llm_ratio),
            llm_client=llm_client,
            time_context=time_ctx,
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
            text = f"@agent {body}"
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
        if llm_error:
            row["llm_error"] = llm_error

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
        "log_path": str(log_path),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
