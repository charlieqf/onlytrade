#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
import urllib.request
from pathlib import Path


NEWS_KW = [
    "新闻",
    "快讯",
    "消息",
    "政策",
    "市场",
    "板块",
    "AI",
    "OpenAI",
    "英伟达",
    "Nvidia",
    "美联储",
    "宏观",
]


def fetch_json(api_base: str, path: str) -> dict:
    req = urllib.request.Request(url=f"{api_base.rstrip('/')}{path}", method="GET")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def normalize_text(text: str) -> str:
    return "".join(
        ch
        for ch in str(text or "").lower()
        if ch.isalnum() or "\u4e00" <= ch <= "\u9fff"
    )[:120]


def p95(values: list[float]) -> float | None:
    if not values:
        return None
    arr = sorted(values)
    idx = max(0, min(len(arr) - 1, int(len(arr) * 0.95) - 1))
    return float(arr[idx])


def write_jsonl(path: Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Monitor replay chat quality and emit alerts"
    )
    p.add_argument("--api-base", default="http://127.0.0.1:18080")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--rooms", default="t_001,t_002,t_003,t_004")
    p.add_argument("--window-min", type=int, default=15)
    p.add_argument("--sample-interval-sec", type=int, default=60)
    p.add_argument("--max-min", type=int, default=90)
    p.add_argument("--gap-p95-spike-sec", type=float, default=40.0)
    p.add_argument("--repetition-spike-rate", type=float, default=0.45)
    p.add_argument("--low-news-mention-rate", type=float, default=0.20)
    p.add_argument("--alert-cooldown-min", type=int, default=5)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    run_dir = Path(args.run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    rooms = [x.strip() for x in str(args.rooms or "").split(",") if x.strip()]
    if not rooms:
        raise SystemExit("rooms_required")

    samples_path = run_dir / "chat_quality_samples.jsonl"
    alerts_path = run_dir / "chat_quality_alerts.jsonl"
    final_path = run_dir / "chat_quality_final.json"

    start = time.time()
    max_seconds = max(1, int(args.max_min)) * 60
    last_alert_ts_by_key: dict[str, int] = {}

    while True:
        ts_ms = int(time.time() * 1000)
        replay = fetch_json(args.api_base, "/api/replay/runtime/status").get("data", {})
        completed = bool(replay.get("completed"))

        window_start_ms = ts_ms - max(1, int(args.window_min)) * 60 * 1000

        room_metrics: dict[str, dict] = {}
        aggregate_count = 0
        aggregate_news = 0
        aggregate_unique = 0
        aggregate_gaps: list[float] = []

        for room in rooms:
            chat_path = Path(f"/opt/onlytrade/data/chat/rooms/{room}/public.jsonl")
            rows: list[dict] = []
            if chat_path.exists():
                for line in chat_path.read_text(encoding="utf-8").splitlines():
                    if not line.strip():
                        continue
                    try:
                        row = json.loads(line)
                    except Exception:
                        continue
                    created = int(row.get("created_ts_ms") or 0)
                    if created < window_start_ms:
                        continue
                    rows.append(row)

            proactive = [
                r
                for r in rows
                if r.get("sender_type") == "agent"
                and r.get("agent_message_kind") == "proactive"
            ]
            proactive.sort(key=lambda x: int(x.get("created_ts_ms") or 0))

            ts_list = [
                int(r.get("created_ts_ms") or 0)
                for r in proactive
                if int(r.get("created_ts_ms") or 0) > 0
            ]
            gaps = [
                (ts_list[i] - ts_list[i - 1]) / 1000.0
                for i in range(1, len(ts_list))
                if ts_list[i] > ts_list[i - 1]
            ]
            gap_p95 = p95(gaps)

            normalized = [normalize_text(r.get("text") or "") for r in proactive]
            unique_count = len(set(x for x in normalized if x))
            repetition_rate = (
                (1.0 - (unique_count / len(normalized))) if normalized else None
            )

            news_mentions = sum(
                1
                for r in proactive
                if any(k in str(r.get("text") or "") for k in NEWS_KW)
            )
            news_rate = (news_mentions / len(proactive)) if proactive else None

            metrics = {
                "window_minutes": int(args.window_min),
                "proactive_count": len(proactive),
                "gap_p95_sec": gap_p95,
                "news_mention_rate": news_rate,
                "repetition_rate": repetition_rate,
            }
            room_metrics[room] = metrics

            aggregate_count += len(proactive)
            aggregate_news += news_mentions
            aggregate_unique += unique_count
            aggregate_gaps.extend(gaps)

            alerts: list[tuple[str, str]] = []
            if (
                gap_p95 is not None
                and len(proactive) >= 8
                and gap_p95 > float(args.gap_p95_spike_sec)
            ):
                alerts.append(
                    (
                        "gap_p95_spike",
                        f"{gap_p95:.1f}s > {float(args.gap_p95_spike_sec):.1f}s",
                    )
                )
            if (
                repetition_rate is not None
                and len(proactive) >= 8
                and repetition_rate > float(args.repetition_spike_rate)
            ):
                alerts.append(
                    (
                        "repetition_spike",
                        f"{repetition_rate:.2f} > {float(args.repetition_spike_rate):.2f}",
                    )
                )
            if (
                news_rate is not None
                and len(proactive) >= 8
                and news_rate < float(args.low_news_mention_rate)
            ):
                alerts.append(
                    (
                        "low_news_mention",
                        f"{news_rate:.2f} < {float(args.low_news_mention_rate):.2f}",
                    )
                )

            for code, detail in alerts:
                key = f"{room}:{code}"
                last_ts = last_alert_ts_by_key.get(key, 0)
                if ts_ms - last_ts >= max(1, int(args.alert_cooldown_min)) * 60 * 1000:
                    row = {
                        "ts_ms": ts_ms,
                        "room_id": room,
                        "code": code,
                        "detail": detail,
                        "metrics": metrics,
                    }
                    write_jsonl(alerts_path, row)
                    print(json.dumps({"alert": row}, ensure_ascii=False), flush=True)
                    last_alert_ts_by_key[key] = ts_ms

        sample = {
            "ts_ms": ts_ms,
            "replay": {
                "running": bool(replay.get("running")),
                "completed": completed,
                "cursor_index": replay.get("cursor_index"),
                "timeline_length": replay.get("timeline_length"),
                "speed": replay.get("speed"),
            },
            "aggregate": {
                "window_minutes": int(args.window_min),
                "proactive_count": aggregate_count,
                "gap_p95_sec": p95(aggregate_gaps),
                "news_mention_rate": (aggregate_news / aggregate_count)
                if aggregate_count
                else None,
                "repetition_rate": (1.0 - (aggregate_unique / aggregate_count))
                if aggregate_count
                else None,
            },
            "rooms": room_metrics,
        }
        write_jsonl(samples_path, sample)

        if completed:
            break
        if time.time() - start > max_seconds:
            break
        time.sleep(max(5, int(args.sample_interval_sec)))

    samples = (
        [
            json.loads(line)
            for line in samples_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        if samples_path.exists()
        else []
    )
    alerts = (
        [
            json.loads(line)
            for line in alerts_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        if alerts_path.exists()
        else []
    )
    last = samples[-1] if samples else {}

    final = {
        "run_dir": str(run_dir),
        "samples_count": len(samples),
        "alerts_count": len(alerts),
        "alerts_by_code": {
            code: sum(1 for a in alerts if a.get("code") == code)
            for code in sorted(set(a.get("code") for a in alerts if a.get("code")))
        },
        "latest_replay": last.get("replay") or {},
        "latest_aggregate": last.get("aggregate") or {},
        "latest_rooms": last.get("rooms") or {},
        "thresholds": {
            "gap_p95_spike_sec": float(args.gap_p95_spike_sec),
            "repetition_spike_rate": float(args.repetition_spike_rate),
            "low_news_mention_rate": float(args.low_news_mention_rate),
        },
    }
    final_path.write_text(
        json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"final": final}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
