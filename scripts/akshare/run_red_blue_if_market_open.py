from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from scripts.akshare.run_cycle_if_market_open import SH_TZ, is_cn_a_market_open


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

    run_cycle_path = Path(__file__).with_name("run_red_blue_cycle.py")
    command = [sys.executable, str(run_cycle_path), *sys.argv[1:]]
    completed = subprocess.run(command, check=False)
    return int(completed.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
