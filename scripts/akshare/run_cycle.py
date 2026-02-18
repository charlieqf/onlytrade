from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from scripts.akshare.collector import run_collection
from scripts.akshare.converter import run_conversion
from scripts.akshare.common import to_code


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run AKShare collect + convert cycle")
    parser.add_argument(
        "--symbols",
        default="002131,300058,002342,600519,300059,600089,600986,601899,002050,002195",
    )
    parser.add_argument("--tail-bars", type=int, default=8)
    parser.add_argument(
        "--raw-minute-path", default="data/live/akshare/raw_minute.jsonl"
    )
    parser.add_argument(
        "--raw-quotes-path", default="data/live/akshare/raw_quotes.json"
    )
    parser.add_argument(
        "--checkpoint-path", default="data/live/akshare/checkpoint.json"
    )
    parser.add_argument(
        "--canonical-path", default="data/live/onlytrade/frames.1m.json"
    )
    parser.add_argument("--max-frames", type=int, default=20000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    symbols = [to_code(item) for item in args.symbols.split(",") if item.strip()]

    collect_summary = run_collection(
        symbols=symbols,
        raw_minute_path=Path(args.raw_minute_path),
        raw_quotes_path=Path(args.raw_quotes_path),
        checkpoint_path=Path(args.checkpoint_path),
        tail_bars=args.tail_bars,
    )

    convert_summary = run_conversion(
        raw_minute_path=Path(args.raw_minute_path),
        output_path=Path(args.canonical_path),
        max_frames=max(1000, int(args.max_frames)),
    )

    print(
        json.dumps(
            {
                "collector": collect_summary,
                "converter": convert_summary,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
