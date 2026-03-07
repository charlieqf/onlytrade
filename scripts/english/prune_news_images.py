#!/usr/bin/env python3
import argparse
import time
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Prune cached t_017 news images")
    parser.add_argument(
        "--image-dir",
        default="data/live/onlytrade/english_images/t_017",
        help="Image cache directory",
    )
    parser.add_argument("--max-files", type=int, default=600)
    parser.add_argument("--max-age-hours", type=float, default=72.0)
    args = parser.parse_args()

    image_dir = Path(str(args.image_dir)).resolve()
    if not image_dir.exists() or not image_dir.is_dir():
        print(f"[prune] skip: missing dir {image_dir}")
        return

    now = time.time()
    max_age_sec = max(1.0, float(args.max_age_hours or 72.0)) * 3600.0
    max_files = max(20, int(args.max_files or 600))

    files = [
        fp
        for fp in image_dir.iterdir()
        if fp.is_file() and fp.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    ]
    files.sort(key=lambda fp: fp.stat().st_mtime)

    removed = 0
    for fp in list(files):
        age = now - fp.stat().st_mtime
        if age > max_age_sec:
            try:
                fp.unlink()
                removed += 1
            except Exception:
                pass

    files = [
        fp
        for fp in image_dir.iterdir()
        if fp.is_file() and fp.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    ]
    files.sort(key=lambda fp: fp.stat().st_mtime)
    overflow = max(0, len(files) - max_files)
    for fp in files[:overflow]:
        try:
            fp.unlink()
            removed += 1
        except Exception:
            pass

    print(
        f"[prune] dir={image_dir} remaining={max(0, len(files) - overflow)} removed={removed} "
        f"max_files={max_files} max_age_h={max_age_sec / 3600:.1f}"
    )


if __name__ == "__main__":
    main()
