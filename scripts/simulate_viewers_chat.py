#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
import time
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
]

TOPIC_GROUPS = {
    "stock": STOCK_TOPICS,
    "trade": TRADE_TOPICS,
    "news": NEWS_TOPICS,
    "casual": CASUAL_TOPICS,
}


def pick_topic_text(symbols: list[str]) -> tuple[str, str]:
    category = random.choice(["stock", "trade", "news", "casual"])
    template = random.choice(TOPIC_GROUPS[category])
    symbol = random.choice(symbols) if symbols else "600519.SH"
    return category, template.format(symbol=symbol)


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

    viewers: list[Viewer] = []
    for i in range(max(1, int(args.viewers))):
        nickname = f"观众{i + 1:02d}"
        code, payload = api.post(
            "/api/chat/session/bootstrap", {"user_nickname": nickname}
        )
        data = unwrap_data(payload) if code == 200 else {}
        session_id = str((data or {}).get("user_session_id") or "").strip()
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
            {"ok": True, "viewers": len(viewers), "room_id": args.room_id},
            ensure_ascii=False,
        )
    )

    end_at = time.time() + max(1, int(args.duration_min)) * 60
    sent = 0
    reply_expected = 0
    reply_ok = 0
    reply_fail = 0

    while time.time() < end_at:
        viewer = random.choice(viewers)
        category, body = pick_topic_text(symbols)

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
            "viewer": viewer.nickname,
            "user_session_id": viewer.session_id,
            "visibility": visibility,
            "message_type": message_type,
            "topic": category,
            "text": text,
            "status": code,
            "ok": code == 200,
        }

        if expect_reply:
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

        time.sleep(
            random.uniform(
                max(0.2, float(args.min_interval_sec)),
                max(float(args.min_interval_sec), float(args.max_interval_sec)),
            )
        )

    summary = {
        "ok": True,
        "room_id": args.room_id,
        "viewers": len(viewers),
        "messages_sent": sent,
        "reply_expected": reply_expected,
        "reply_ok": reply_ok,
        "reply_fail": reply_fail,
        "reply_ok_rate": (reply_ok / reply_expected) if reply_expected else None,
        "log_path": str(log_path),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
