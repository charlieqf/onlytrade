#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import pathlib
import subprocess
import time
import urllib.error
import urllib.request


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def unwrap_data(payload):
    if (
        isinstance(payload, dict)
        and isinstance(payload.get("success"), bool)
        and "data" in payload
    ):
        return payload.get("data")
    return payload


class Api:
    def __init__(self, base: str, timeout: int = 20):
        self.base = base.rstrip("/")
        self.timeout = timeout

    def req(self, method: str, path: str, payload=None):
        body = None
        headers = {}
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            f"{self.base}{path}", data=body, method=method, headers=headers
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                text = resp.read().decode("utf-8", errors="replace")
                code = int(resp.getcode())
                try:
                    data = json.loads(text)
                except json.JSONDecodeError:
                    data = {"raw": text}
                return code, data
        except urllib.error.HTTPError as exc:
            text = exc.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                data = {"raw": text}
            return int(exc.code), data
        except Exception as exc:
            return 0, {"error": str(exc)}

    def get(self, path: str):
        return self.req("GET", path)

    def post(self, path: str, payload=None):
        return self.req("POST", path, payload or {})


def append_jsonl(path: pathlib.Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def run_cycle(repo_root: pathlib.Path):
    cmd = [
        "timeout",
        "-k",
        "5s",
        "55s",
        str(repo_root / ".venv-akshare/bin/python"),
        "scripts/akshare/run_cycle.py",
        "--symbols",
        "002131,300058,002342,600519,300059,600089,600986,601899,002050,002195",
    ]
    p = subprocess.run(cmd, cwd=str(repo_root), capture_output=True, text=True)
    return {
        "returncode": int(p.returncode),
        "stdout": p.stdout[-2000:],
        "stderr": p.stderr[-2000:],
    }


def read_last_frame_ts_ms(canonical_path: pathlib.Path):
    try:
        payload = json.loads(canonical_path.read_text(encoding="utf-8"))
        frames = payload.get("frames") or []
        if not frames:
            return None
        return int(frames[-1].get("event_ts_ms") or 0) or None
    except Exception:
        return None


def summarize_window(rows):
    if not rows:
        return {
            "checks": 0,
            "core_ok_rate": None,
            "llm_rate": None,
            "readiness_ok_rate": None,
            "stale_rate": None,
        }

    checks = len(rows)
    core_ok = sum(1 for r in rows if r.get("core_ok") is True)
    llm = sum(1 for r in rows if r.get("decision_source") == "llm.openai")
    ready_ok = sum(1 for r in rows if r.get("readiness_level") == "OK")
    stale = sum(1 for r in rows if r.get("live_stale") is True)
    return {
        "checks": checks,
        "core_ok_rate": core_ok / checks,
        "llm_rate": llm / checks,
        "readiness_ok_rate": ready_ok / checks,
        "stale_rate": stale / checks,
    }


def parse_args():
    ap = argparse.ArgumentParser(
        description="Live-mode stability watchdog with autofix"
    )
    ap.add_argument("--repo-root", default="/opt/onlytrade")
    ap.add_argument("--api-base", default="http://127.0.0.1:18080")
    ap.add_argument("--agent-id", default="t_001")
    ap.add_argument("--duration-min", type=int, default=120)
    ap.add_argument("--probe-interval-sec", type=int, default=60)
    ap.add_argument("--review-interval-min", type=int, default=5)
    ap.add_argument("--max-fresh-age-sec", type=int, default=180)
    ap.add_argument("--log-dir", default="/opt/onlytrade/logs/soak")
    return ap.parse_args()


def main():
    args = parse_args()
    repo_root = pathlib.Path(args.repo_root).resolve()
    canonical = repo_root / "data/live/onlytrade/frames.1m.json"

    run_id = (
        dt.datetime.utcnow().strftime("%Y%m%d_%H%M%S") + f"_livefix_{args.agent_id}"
    )
    run_dir = pathlib.Path(args.log_dir).resolve() / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    api = Api(args.api_base)

    append_jsonl(
        run_dir / "events.jsonl",
        {"ts": now_iso(), "event": "start", "config": vars(args)},
    )

    window = []
    next_review = time.time() + max(60, args.review_interval_min * 60)
    deadline = time.time() + max(60, args.duration_min * 60)

    while time.time() < deadline:
        ts_ms = int(time.time() * 1000)

        rs_code, rs_payload = api.get("/api/replay/runtime/status")
        rt_code, rt_payload = api.get("/api/agent/runtime/status")
        sp_code, sp_payload = api.get(
            f"/api/rooms/{args.agent_id}/stream-packet?decision_limit=5"
        )
        dc_code, dc_payload = api.get(
            f"/api/decisions/latest?trader_id={args.agent_id}&limit=5"
        )

        rs = unwrap_data(rs_payload) if rs_code == 200 else {}
        rt = unwrap_data(rt_payload) if rt_code == 200 else {}
        sp = unwrap_data(sp_payload) if sp_code == 200 else {}
        dc = unwrap_data(dc_payload) if dc_code == 200 else []

        frame_ts = read_last_frame_ts_ms(canonical)
        fresh_age_sec = ((ts_ms - frame_ts) / 1000) if frame_ts else None
        live_stale = bool(((rs or {}).get("live_file") or {}).get("stale"))

        decision_latest = (sp or {}).get("decision_latest") or {}
        decision_meta = (sp or {}).get("decision_meta") or {}
        readiness = (decision_meta or {}).get("data_readiness") or {}

        metric = {
            "ts": now_iso(),
            "replay_status_code": rs_code,
            "runtime_status_code": rt_code,
            "stream_packet_code": sp_code,
            "decisions_code": dc_code,
            "core_ok": (
                rs_code == 200 and rt_code == 200 and sp_code == 200 and dc_code == 200
            ),
            "live_data_mode": (rs or {}).get("data_mode"),
            "live_stale": live_stale,
            "fresh_age_sec": fresh_age_sec,
            "decision_source": decision_latest.get("decision_source"),
            "readiness_level": readiness.get("level"),
            "readiness_reasons": readiness.get("reasons") or [],
            "runtime_running": bool((rt or {}).get("running")),
            "cycle_ms": (rt or {}).get("cycle_ms"),
        }
        append_jsonl(run_dir / "metrics.jsonl", metric)
        window.append(metric)

        needs_fix = False
        fix_reasons = []
        if live_stale:
            needs_fix = True
            fix_reasons.append("live_file_stale")
        if fresh_age_sec is not None and fresh_age_sec > args.max_fresh_age_sec:
            needs_fix = True
            fix_reasons.append("frame_too_old")
        if (metric["readiness_level"] or "") == "ERROR" and "data_too_stale" in metric[
            "readiness_reasons"
        ]:
            needs_fix = True
            fix_reasons.append("decision_readiness_data_too_stale")

        if needs_fix:
            result = run_cycle(repo_root)
            append_jsonl(
                run_dir / "actions.jsonl",
                {
                    "ts": now_iso(),
                    "action": "run_cycle",
                    "reasons": fix_reasons,
                    "result": result,
                },
            )

        if time.time() >= next_review:
            append_jsonl(
                run_dir / "reviews.jsonl",
                {
                    "ts": now_iso(),
                    "window": summarize_window(window),
                },
            )
            window = []
            next_review = time.time() + max(60, args.review_interval_min * 60)

        time.sleep(max(10, args.probe_interval_sec))

    append_jsonl(run_dir / "events.jsonl", {"ts": now_iso(), "event": "done"})


if __name__ == "__main__":
    main()
