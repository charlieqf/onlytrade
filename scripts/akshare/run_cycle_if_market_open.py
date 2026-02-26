from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo


SH_TZ = ZoneInfo("Asia/Shanghai")
RUN_CYCLE_TIMEOUT_SEC = max(20, int(os.getenv("AKSHARE_RUN_CYCLE_TIMEOUT_SEC", "55")))


def is_cn_a_market_open(now: datetime | None = None) -> bool:
    current = now or datetime.now(SH_TZ)
    if current.tzinfo is None:
        current = current.replace(tzinfo=SH_TZ)
    else:
        current = current.astimezone(SH_TZ)

    if current.weekday() >= 5:
        return False

    current_time = current.time()
    morning_open = time(9, 30) <= current_time <= time(11, 30)
    afternoon_open = time(13, 0) <= current_time <= time(15, 0)
    return morning_open or afternoon_open


def main() -> int:
    now = datetime.now(SH_TZ)
    if not is_cn_a_market_open(now):
        print(
            json.dumps(
                {
                    "status": "skip",
                    "reason": "outside_cn_a_session",
                    "now_shanghai": now.isoformat(timespec="seconds"),
                },
                ensure_ascii=False,
            )
        )
        return 0

    run_cycle_path = Path(__file__).with_name("run_cycle.py")
    command = [sys.executable, str(run_cycle_path), *sys.argv[1:]]
    try:
        completed = subprocess.run(command, check=False, timeout=RUN_CYCLE_TIMEOUT_SEC)
        return int(completed.returncode)
    except subprocess.TimeoutExpired:
        print(
            json.dumps(
                {
                    "status": "error",
                    "reason": "run_cycle_timeout",
                    "timeout_sec": RUN_CYCLE_TIMEOUT_SEC,
                    "now_shanghai": now.isoformat(timespec="seconds"),
                },
                ensure_ascii=False,
            )
        )
        return 124


if __name__ == "__main__":
    raise SystemExit(main())
