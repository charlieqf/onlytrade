#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import os
import pathlib
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def unwrap_data(payload):
    if (
        isinstance(payload, dict)
        and isinstance(payload.get("success"), bool)
        and "data" in payload
    ):
        return payload.get("data")
    return payload


class ApiClient:
    def __init__(self, base_url: str, timeout_sec: int = 20):
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec

    def _request(self, method: str, path: str, payload=None, timeout_sec=None):
        timeout = timeout_sec or self.timeout_sec
        url = f"{self.base_url}{path}"
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url=url, method=method, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                status = int(resp.getcode())
                try:
                    parsed = json.loads(body)
                except json.JSONDecodeError:
                    parsed = {"raw": body}
                return status, parsed
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = {"raw": body}
            return int(exc.code), parsed
        except Exception as exc:
            return 0, {"error": str(exc)}

    def get(self, path: str, timeout_sec=None):
        return self._request("GET", path, payload=None, timeout_sec=timeout_sec)

    def post(self, path: str, payload=None, timeout_sec=None):
        return self._request(
            "POST", path, payload=payload or {}, timeout_sec=timeout_sec
        )


class Logger:
    def __init__(self, path: pathlib.Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def log(self, msg: str):
        line = f"[{now_iso()}] {msg}"
        print(line, flush=True)
        with self.path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


def append_jsonl(path: pathlib.Path, item):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(item, ensure_ascii=False) + "\n")


def write_json(path: pathlib.Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def kill_runtime_api_server_processes(repo_root: pathlib.Path):
    target_cwd = str((repo_root / "runtime-api").resolve())
    killed = []
    proc_root = pathlib.Path("/proc")
    if not proc_root.exists():
        return killed

    try:
        pids = os.listdir(str(proc_root))
    except Exception:
        return killed

    for pid in pids:
        if not pid.isdigit():
            continue
        proc_dir = proc_root / pid
        try:
            cwd = os.readlink(proc_dir / "cwd")
            cmdline_raw = (proc_dir / "cmdline").read_bytes()
            cmdline = cmdline_raw.replace(b"\x00", b" ").decode(
                "utf-8", errors="ignore"
            )
        except Exception:
            continue
        if cwd != target_cwd:
            continue
        if "node" not in cmdline or "server.mjs" not in cmdline:
            continue
        try:
            os.kill(int(pid), signal.SIGKILL)
            killed.append(int(pid))
        except Exception:
            pass
    return killed


def start_backend(
    repo_root: pathlib.Path,
    run_dir: pathlib.Path,
    mode: str,
    logger: Logger,
    replay_speed: int = 1,
):
    killed = kill_runtime_api_server_processes(repo_root)
    logger.log(f"killed runtime-api server pids={killed}")

    env = os.environ.copy()
    env["PORT"] = "18080"

    if mode == "replay":
        env["RUNTIME_DATA_MODE"] = "replay"
        env["STRICT_LIVE_MODE"] = "false"
        env["REPLAY_SPEED"] = str(max(1, int(replay_speed)))
        env["REPLAY_LOOP"] = "false"
        env["AGENT_DECISION_EVERY_BARS"] = "1"
        env["CHAT_PUBLIC_PROACTIVE_INTERVAL_MS"] = "18000"
        env["ROOM_EVENTS_STREAM_PACKET_INTERVAL_MS"] = "10000"
    elif mode == "live":
        env.pop("RUNTIME_DATA_MODE", None)
        env.pop("STRICT_LIVE_MODE", None)
        env.pop("REPLAY_SPEED", None)
        env.pop("REPLAY_LOOP", None)
        env.pop("AGENT_DECISION_EVERY_BARS", None)
        env.pop("CHAT_PUBLIC_PROACTIVE_INTERVAL_MS", None)
        env.pop("ROOM_EVENTS_STREAM_PACKET_INTERVAL_MS", None)
    else:
        raise ValueError(f"unsupported mode={mode}")

    log_path = run_dir / f"runtime-{mode}.log"
    log_file = log_path.open("a", encoding="utf-8")
    proc = subprocess.Popen(
        ["node", "server.mjs"],
        cwd=str(repo_root / "runtime-api"),
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    logger.log(f"started backend mode={mode} pid={proc.pid} log={log_path}")
    return proc.pid


def wait_for_health(api: ApiClient, logger: Logger, timeout_sec: int = 90):
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        code, payload = api.get("/health", timeout_sec=5)
        if code == 200:
            logger.log("health check passed")
            return True
        time.sleep(1)
    logger.log("health check timed out")
    return False


def ensure_target_agent_state(api: ApiClient, target_agent: str, logger: Logger):
    code, payload = api.get("/api/traders")
    traders = unwrap_data(payload) if code == 200 else []
    traders = traders if isinstance(traders, list) else []

    for row in traders:
        trader_id = str(row.get("trader_id", "")).strip()
        is_running = bool(row.get("is_running"))
        if not trader_id.startswith("t_"):
            continue
        if trader_id == target_agent and not is_running:
            api.post(f"/api/agents/{trader_id}/start", {})
            logger.log(f"started target agent {trader_id}")
        elif trader_id != target_agent and is_running:
            api.post(f"/api/agents/{trader_id}/stop", {})
            logger.log(f"stopped non-target CN-A agent {trader_id}")

    api.post(f"/api/agents/{target_agent}/start", {})
    logger.log(f"ensured target agent running {target_agent}")


def restore_agent_states(api: ApiClient, baseline_traders, logger: Logger):
    for row in baseline_traders:
        trader_id = str(row.get("trader_id", "")).strip()
        if not trader_id:
            continue
        should_run = bool(row.get("is_running"))
        path = (
            f"/api/agents/{trader_id}/start"
            if should_run
            else f"/api/agents/{trader_id}/stop"
        )
        code, payload = api.post(path, {})
        logger.log(
            f"restore agent {trader_id} running={should_run} status={code} resp={payload}"
        )


class SseWatcher(threading.Thread):
    def __init__(
        self,
        url: str,
        out_path: pathlib.Path,
        logger: Logger,
        stop_event: threading.Event,
    ):
        super().__init__(daemon=True)
        self.url = url
        self.out_path = out_path
        self.logger = logger
        self.stop_event = stop_event

    def run(self):
        self.out_path.parent.mkdir(parents=True, exist_ok=True)
        while not self.stop_event.is_set():
            try:
                req = urllib.request.Request(self.url, method="GET")
                with urllib.request.urlopen(req, timeout=130) as resp:
                    with self.out_path.open("ab") as f:
                        while not self.stop_event.is_set():
                            chunk = resp.read(4096)
                            if not chunk:
                                break
                            f.write(chunk)
            except Exception as exc:
                with self.out_path.open("ab") as f:
                    marker = f"\n# reconnect {now_iso()} error={exc}\n".encode(
                        "utf-8", errors="ignore"
                    )
                    f.write(marker)
                time.sleep(2)


def events_status_code(api_base: str, room_id: str):
    url = f"{api_base}/api/rooms/{room_id}/events?decision_limit=5"
    req = urllib.request.Request(url=url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            _ = resp.read(1)
            return int(resp.getcode())
    except urllib.error.HTTPError as exc:
        return int(exc.code)
    except Exception:
        return 0


def configure_replay_one_day(
    api: ApiClient, logger: Logger, start_cursor: int, replay_speed: int
):
    speed = max(1, int(replay_speed))
    api.post("/api/replay/runtime/control", {"action": "set_speed", "speed": speed})
    api.post("/api/replay/runtime/control", {"action": "set_loop", "loop": False})
    api.post(
        "/api/agent/runtime/control",
        {"action": "set_decision_every_bars", "decision_every_bars": 1},
    )
    api.post("/api/dev/factory-reset", {"cursor_index": max(0, int(start_cursor))})
    api.post("/api/agent/runtime/control", {"action": "resume"})
    api.post("/api/replay/runtime/control", {"action": "resume"})
    logger.log(
        f"configured replay speed={speed} loop=false cadence=1 start_cursor="
        f"{max(0, int(start_cursor))} and resumed runtime"
    )


def bootstrap_chat_session(api: ApiClient, logger: Logger):
    code, payload = api.post("/api/chat/session/bootstrap", {})
    data = unwrap_data(payload) if code == 200 else {}
    session_id = str((data or {}).get("user_session_id", "")).strip()
    logger.log(f"bootstrap chat session status={code} session={session_id}")
    return session_id


def send_mention_and_wait_reply(
    api: ApiClient, room_id: str, session_id: str, timeout_sec: int = 90
):
    text = f"@agent autopilot check {int(time.time())}"
    sent_ts = int(time.time() * 1000)
    payload = {
        "user_session_id": session_id,
        "visibility": "public",
        "message_type": "public_mention_agent",
        "text": text,
    }
    post_code, post_resp = api.post(f"/api/chat/rooms/{room_id}/messages", payload)
    if post_code != 200:
        return {
            "ok": False,
            "error": "mention_post_failed",
            "status": post_code,
            "resp": post_resp,
            "sent_ts_ms": sent_ts,
        }

    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        code, payload = api.get(f"/api/chat/rooms/{room_id}/public?limit=30")
        rows = unwrap_data(payload) if code == 200 else {}
        messages = rows.get("messages", []) if isinstance(rows, dict) else []
        for msg in messages:
            if str(msg.get("sender_type", "")) != "agent":
                continue
            created = int(msg.get("created_ts_ms") or 0)
            if created < sent_ts:
                continue
            return {
                "ok": True,
                "reply_ts_ms": created,
                "latency_ms": max(0, created - sent_ts),
                "reply_text": str(msg.get("text", "")),
                "sent_ts_ms": sent_ts,
            }
        time.sleep(5)

    return {
        "ok": False,
        "error": "mention_timeout",
        "sent_ts_ms": sent_ts,
    }


def build_summary(run_dir: pathlib.Path):
    metrics_path = run_dir / "metrics.jsonl"
    mentions_path = run_dir / "mentions.jsonl"

    metrics = []
    mentions = []
    if metrics_path.exists():
        with metrics_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    metrics.append(json.loads(line))
                except Exception:
                    pass

    if mentions_path.exists():
        with mentions_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    mentions.append(json.loads(line))
                except Exception:
                    pass

    endpoint_checks = len(metrics)
    endpoint_all_ok = sum(1 for m in metrics if m.get("all_core_ok") is True)
    decision_counts = [
        int(m.get("audit_count") or 0)
        for m in metrics
        if isinstance(m.get("audit_count"), int)
    ]
    decision_timestamps = [
        str(m.get("decision_ts") or "").strip()
        for m in metrics
        if str(m.get("decision_ts") or "").strip()
    ]
    decision_source_llm_checks = sum(
        1 for m in metrics if m.get("decision_source") == "llm.openai"
    )
    readiness_ok_checks = sum(1 for m in metrics if m.get("readiness_level") == "OK")
    forced_hold_checks = sum(1 for m in metrics if m.get("forced_hold") is True)

    decision_ts_change_count = 0
    prev_decision_ts = None
    for ts in decision_timestamps:
        if prev_decision_ts is None:
            prev_decision_ts = ts
            continue
        if ts != prev_decision_ts:
            decision_ts_change_count += 1
            prev_decision_ts = ts

    audit_count_capped_at_limit = (
        bool(decision_counts)
        and decision_counts[0] == decision_counts[-1]
        and max(decision_counts) >= 50
    )
    replay_day = [
        int(m.get("day_index") or 0)
        for m in metrics
        if isinstance(m.get("day_index"), int)
    ]
    mention_ok = sum(1 for m in mentions if m.get("ok") is True)
    mention_total = len(mentions)
    latencies = [
        int(m.get("latency_ms"))
        for m in mentions
        if m.get("ok") and isinstance(m.get("latency_ms"), int)
    ]

    return {
        "generated_at": now_iso(),
        "endpoint_checks": endpoint_checks,
        "endpoint_all_ok_checks": endpoint_all_ok,
        "endpoint_all_ok_rate": (endpoint_all_ok / endpoint_checks)
        if endpoint_checks
        else None,
        "audit_count_start": decision_counts[0] if decision_counts else None,
        "audit_count_end": decision_counts[-1] if decision_counts else None,
        "audit_count_growth": (decision_counts[-1] - decision_counts[0])
        if len(decision_counts) >= 2
        else None,
        "audit_count_capped_at_limit": audit_count_capped_at_limit,
        "decision_ts_first": decision_timestamps[0] if decision_timestamps else None,
        "decision_ts_last": decision_timestamps[-1] if decision_timestamps else None,
        "decision_ts_change_count": decision_ts_change_count,
        "llm_checks": decision_source_llm_checks,
        "llm_ratio": (decision_source_llm_checks / endpoint_checks)
        if endpoint_checks
        else None,
        "readiness_ok_checks": readiness_ok_checks,
        "readiness_ok_rate": (readiness_ok_checks / endpoint_checks)
        if endpoint_checks
        else None,
        "forced_hold_checks": forced_hold_checks,
        "forced_hold_rate": (forced_hold_checks / endpoint_checks)
        if endpoint_checks
        else None,
        "day_index_start": replay_day[0] if replay_day else None,
        "day_index_end": replay_day[-1] if replay_day else None,
        "mentions_total": mention_total,
        "mentions_ok": mention_ok,
        "mentions_ok_rate": (mention_ok / mention_total) if mention_total else None,
        "mention_latency_ms_p50": sorted(latencies)[len(latencies) // 2]
        if latencies
        else None,
        "mention_latency_ms_max": max(latencies) if latencies else None,
    }


def summarize_window(window_metrics):
    checks = len(window_metrics)
    if checks <= 0:
        return {
            "checks": 0,
            "core_ok_rate": None,
            "llm_ratio": None,
            "readiness_ok_rate": None,
            "forced_hold_rate": None,
        }

    core_ok = sum(1 for r in window_metrics if r.get("all_core_ok") is True)
    llm = sum(1 for r in window_metrics if r.get("decision_source") == "llm.openai")
    readiness_ok = sum(1 for r in window_metrics if r.get("readiness_level") == "OK")
    forced_hold = sum(1 for r in window_metrics if r.get("forced_hold") is True)

    return {
        "checks": checks,
        "core_ok_rate": core_ok / checks,
        "llm_ratio": llm / checks,
        "readiness_ok_rate": readiness_ok / checks,
        "forced_hold_rate": forced_hold / checks,
    }


def run_review_checkpoint(
    api: ApiClient,
    logger: Logger,
    target_agent: str,
    window_metrics,
    run_dir: pathlib.Path,
    replay_speed: int,
):
    reviews_path = run_dir / "reviews.jsonl"
    review = {
        "ts": now_iso(),
        "window": summarize_window(window_metrics),
        "actions": [],
    }

    # Pause to review every window.
    api.post("/api/agent/runtime/control", {"action": "pause"})
    api.post("/api/replay/runtime/control", {"action": "pause"})
    review["actions"].append("pause_runtime_replay")

    # Re-assert desired runtime knobs (safe, reversible).
    target_speed = max(1, int(replay_speed))
    api.post(
        "/api/agent/runtime/control",
        {"action": "set_decision_every_bars", "decision_every_bars": 1},
    )
    api.post(
        "/api/replay/runtime/control",
        {"action": "set_speed", "speed": target_speed},
    )
    api.post("/api/replay/runtime/control", {"action": "set_loop", "loop": False})
    review["actions"].append(f"enforce_speed{target_speed}_loopfalse_cadence1")

    # If any instability observed in the window, re-assert target-only CN-A agent state.
    core_ok_rate = review["window"].get("core_ok_rate")
    if core_ok_rate is not None and core_ok_rate < 1.0:
        ensure_target_agent_state(api, target_agent, logger)
        review["actions"].append("reassert_target_agent_state")

    # Resume execution after review.
    api.post("/api/agent/runtime/control", {"action": "resume"})
    api.post("/api/replay/runtime/control", {"action": "resume"})
    review["actions"].append("resume_runtime_replay")

    append_jsonl(reviews_path, review)
    logger.log(
        "review checkpoint: "
        f"checks={review['window']['checks']} "
        f"core_ok_rate={review['window']['core_ok_rate']} "
        f"llm_ratio={review['window']['llm_ratio']} "
        f"readiness_ok_rate={review['window']['readiness_ok_rate']} "
        f"actions={','.join(review['actions'])}"
    )


def parse_args():
    parser = argparse.ArgumentParser(
        description="CN-A 1-day replay autopilot soak runner"
    )
    parser.add_argument("--repo-root", default="/opt/onlytrade")
    parser.add_argument("--api-base", default="http://127.0.0.1:18080")
    parser.add_argument("--agent-id", default="t_001")
    parser.add_argument("--duration-min", type=int, default=245)
    parser.add_argument("--start-cursor", type=int, default=240)
    parser.add_argument("--mention-interval-min", type=int, default=20)
    parser.add_argument("--probe-interval-sec", type=int, default=60)
    parser.add_argument("--review-interval-min", type=int, default=5)
    parser.add_argument("--replay-speed", type=int, default=1)
    parser.add_argument("--log-dir", default="/opt/onlytrade/logs/soak")
    return parser.parse_args()


def main():
    args = parse_args()
    repo_root = pathlib.Path(args.repo_root).resolve()
    run_id = (
        dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M%S") + f"_{args.agent_id}"
    )
    run_dir = pathlib.Path(args.log_dir).resolve() / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    logger = Logger(run_dir / "runner.log")
    api = ApiClient(args.api_base)

    write_json(
        run_dir / "config.json",
        {
            "run_id": run_id,
            "started_at": now_iso(),
            "repo_root": str(repo_root),
            "api_base": args.api_base,
            "agent_id": args.agent_id,
            "duration_min": args.duration_min,
            "mention_interval_min": args.mention_interval_min,
            "probe_interval_sec": args.probe_interval_sec,
            "review_interval_min": args.review_interval_min,
            "replay_speed": max(1, int(args.replay_speed)),
        },
    )

    baseline_traders = []
    baseline_replay = {}
    code, payload = api.get("/api/traders")
    if code == 200:
        baseline_traders = (
            unwrap_data(payload) if isinstance(unwrap_data(payload), list) else []
        )
    write_json(run_dir / "baseline_traders.json", baseline_traders)

    code, payload = api.get("/api/replay/runtime/status")
    if code == 200:
        baseline_replay = (
            unwrap_data(payload) if isinstance(unwrap_data(payload), dict) else {}
        )
    write_json(run_dir / "baseline_replay_status.json", baseline_replay)

    logger.log("baseline captured")

    stop_event = threading.Event()
    sse_thread = None
    session_id = ""

    try:
        start_backend(
            repo_root,
            run_dir,
            mode="replay",
            logger=logger,
            replay_speed=args.replay_speed,
        )
        if not wait_for_health(api, logger):
            raise RuntimeError("backend_failed_to_boot_in_replay_mode")

        ensure_target_agent_state(api, args.agent_id, logger)
        configure_replay_one_day(api, logger, args.start_cursor, args.replay_speed)

        session_id = bootstrap_chat_session(api, logger)

        sse_url = f"{args.api_base}/api/rooms/{args.agent_id}/events?decision_limit=5"
        sse_thread = SseWatcher(sse_url, run_dir / "events.sse.log", logger, stop_event)
        sse_thread.start()
        logger.log("started SSE watcher")

        metrics_path = run_dir / "metrics.jsonl"
        mentions_path = run_dir / "mentions.jsonl"

        start_time = time.time()
        deadline = start_time + max(30, args.duration_min * 60)
        next_mention_at = time.time() + max(120, args.mention_interval_min * 60)
        next_review_at = time.time() + max(60, args.review_interval_min * 60)

        start_day_index = None
        consecutive_core_failures = 0
        window_metrics = []

        while time.time() < deadline:
            replay_code, replay_payload = api.get("/api/replay/runtime/status")
            runtime_code, runtime_payload = api.get("/api/agent/runtime/status")
            stream_code, stream_payload = api.get(
                f"/api/rooms/{args.agent_id}/stream-packet?decision_limit=5"
            )
            audit_code, audit_payload = api.get(
                f"/api/agents/{args.agent_id}/decision-audit/latest?limit=50"
            )
            chat_code, chat_payload = api.get(
                f"/api/chat/rooms/{args.agent_id}/public?limit=20"
            )
            events_code = events_status_code(args.api_base, args.agent_id)

            replay = unwrap_data(replay_payload) if replay_code == 200 else {}
            runtime = unwrap_data(runtime_payload) if runtime_code == 200 else {}
            stream = unwrap_data(stream_payload) if stream_code == 200 else {}
            audit = unwrap_data(audit_payload) if audit_code == 200 else {}
            chat = unwrap_data(chat_payload) if chat_code == 200 else {}

            day_index = int((replay or {}).get("day_index") or 0)
            day_bar_index = int((replay or {}).get("day_bar_index") or 0)
            day_bar_count = int((replay or {}).get("day_bar_count") or 0)
            replay_running = bool((replay or {}).get("running"))
            replay_completed = bool((replay or {}).get("completed"))
            runtime_running = bool((runtime or {}).get("running"))
            audit_count = int((audit or {}).get("count") or 0)

            decision_meta = (stream or {}).get("decision_meta") or {}
            readiness = (decision_meta or {}).get("data_readiness") or {}

            metric = {
                "ts": now_iso(),
                "replay_code": replay_code,
                "runtime_code": runtime_code,
                "stream_code": stream_code,
                "audit_code": audit_code,
                "chat_code": chat_code,
                "events_code": events_code,
                "day_index": day_index,
                "day_bar_index": day_bar_index,
                "day_bar_count": day_bar_count,
                "replay_running": replay_running,
                "replay_completed": replay_completed,
                "runtime_running": runtime_running,
                "audit_count": audit_count,
                "decision_source": ((stream or {}).get("decision_latest") or {}).get(
                    "decision_source"
                ),
                "decision_ts": ((stream or {}).get("decision_latest") or {}).get(
                    "timestamp"
                ),
                "forced_hold": bool((decision_meta or {}).get("forced_hold")),
                "readiness_level": (readiness or {}).get("level"),
                "public_message_count": len((chat or {}).get("messages", []))
                if isinstance(chat, dict)
                else 0,
            }
            metric["all_core_ok"] = all(
                x == 200
                for x in [
                    metric["replay_code"],
                    metric["runtime_code"],
                    metric["stream_code"],
                    metric["audit_code"],
                    metric["events_code"],
                ]
            )
            append_jsonl(metrics_path, metric)
            window_metrics.append(metric)

            if start_day_index is None and day_index > 0:
                start_day_index = day_index
                logger.log(f"captured start_day_index={start_day_index}")

            if metric["all_core_ok"]:
                consecutive_core_failures = 0
            else:
                consecutive_core_failures += 1

            if not runtime_running:
                api.post("/api/agent/runtime/control", {"action": "resume"})
                logger.log("runtime was paused, issued resume")

            if (
                not replay_running
                and start_day_index is not None
                and day_index <= start_day_index
            ):
                if replay_completed or (
                    day_bar_count > 0 and day_bar_index >= (day_bar_count - 1)
                ):
                    logger.log(
                        "replay reached dataset end on current day; treating as one-day completion"
                    )
                    break
                api.post("/api/replay/runtime/control", {"action": "resume"})
                logger.log("replay paused before day transition, issued resume")

            if consecutive_core_failures >= 3:
                logger.log("core endpoint failures >= 3, issuing soft resume controls")
                api.post("/api/agent/runtime/control", {"action": "resume"})
                api.post("/api/replay/runtime/control", {"action": "resume"})
                consecutive_core_failures = 0

            if session_id and time.time() >= next_mention_at:
                mention_result = send_mention_and_wait_reply(
                    api, args.agent_id, session_id, timeout_sec=90
                )
                mention_result["ts"] = now_iso()
                append_jsonl(mentions_path, mention_result)
                logger.log(
                    f"mention result ok={mention_result.get('ok')} latency_ms={mention_result.get('latency_ms')}"
                )
                next_mention_at = time.time() + max(60, args.mention_interval_min * 60)

                if not mention_result.get("ok"):
                    session_id = bootstrap_chat_session(api, logger)
                    logger.log("mention failed, rotated chat session")

            if time.time() >= next_review_at:
                run_review_checkpoint(
                    api=api,
                    logger=logger,
                    target_agent=args.agent_id,
                    window_metrics=window_metrics,
                    run_dir=run_dir,
                    replay_speed=args.replay_speed,
                )
                window_metrics = []
                next_review_at = time.time() + max(60, args.review_interval_min * 60)

            if replay_completed:
                logger.log("replay marked completed=true; finishing run")
                break

            if start_day_index is not None and day_index > start_day_index:
                logger.log(
                    f"one replay day completed: start_day={start_day_index}, now_day={day_index}"
                )
                break

            time.sleep(max(10, args.probe_interval_sec))

        logger.log("monitor loop finished")
    finally:
        stop_event.set()
        if sse_thread is not None:
            sse_thread.join(timeout=3)

        api.post("/api/agent/runtime/control", {"action": "pause"})
        api.post("/api/replay/runtime/control", {"action": "pause"})

        try:
            restore_agent_states(api, baseline_traders, logger)
        except Exception as exc:
            logger.log(f"restore_agent_states failed: {exc}")

        try:
            start_backend(repo_root, run_dir, mode="live", logger=logger)
            wait_for_health(api, logger, timeout_sec=90)
        except Exception as exc:
            logger.log(f"live restore restart failed: {exc}")

        replay_code, replay_payload = api.get("/api/replay/runtime/status")
        replay_data = unwrap_data(replay_payload) if replay_code == 200 else {}
        write_json(
            run_dir / "restore_replay_status.json",
            {
                "status_code": replay_code,
                "payload": replay_payload,
                "data_mode": (replay_data or {}).get("data_mode"),
            },
        )

        summary = build_summary(run_dir)
        summary["ended_at"] = now_iso()
        summary["restore_data_mode"] = (replay_data or {}).get("data_mode")
        write_json(run_dir / "summary.json", summary)
        logger.log(f"summary: {summary}")


if __name__ == "__main__":
    main()
