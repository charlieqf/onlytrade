import json
import os
import subprocess
import sys
from datetime import datetime, time
from pathlib import Path
from typing import Optional

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from scripts.akshare.run_cycle_if_market_open import SH_TZ


def is_cn_preopen_window(now: Optional[datetime] = None) -> bool:
    current = now or datetime.now(SH_TZ)
    if current.tzinfo is None:
        current = current.replace(tzinfo=SH_TZ)
    else:
        current = current.astimezone(SH_TZ)

    if current.weekday() >= 5:
        return False

    current_time = current.time()
    return time(6, 30) <= current_time <= time(9, 25)


def main() -> int:
    now = datetime.now(SH_TZ)
    preopen_only = (
        str(os.environ.get("ONLYTRADE_NEWS_DIGEST_PREOPEN_ONLY") or "false")
        .strip()
        .lower()
        == "true"
    )

    if preopen_only and not is_cn_preopen_window(now):
        print(
            json.dumps(
                {
                    "status": "skip",
                    "reason": "outside_cn_preopen_window",
                    "now_shanghai": now.isoformat(timespec="seconds"),
                    "preopen_only": True,
                },
                ensure_ascii=False,
            )
        )
        return 0

    run_cycle_path = Path(__file__).with_name("run_news_digest_cycle.py")
    command = [sys.executable, str(run_cycle_path), *sys.argv[1:]]
    completed = subprocess.run(command, check=False)
    return int(completed.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
