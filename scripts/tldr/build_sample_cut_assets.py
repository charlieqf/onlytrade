from __future__ import annotations

import argparse
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _normalize_version(version: str) -> str:
    version = version.strip()
    return version if version.startswith("v") else f"v{version}"


def _load_topic_json(topic_dir: Path) -> dict[str, Any]:
    topic_path = topic_dir / "topic.json"
    if not topic_path.exists():
        raise FileNotFoundError(f"Missing topic.json: {topic_path}")
    return json.loads(topic_path.read_text(encoding="utf-8"))


@dataclass
class AssetBuildContext:
    root_dir: Path
    topic_dir: Path
    topic_key: str
    topic_data: dict[str, Any]
    version: str
    public_slug: str
    asset_dir: Path
    archive_dir: Path
    public_dir: Path
    manifest_path: Path

    def ensure_dirs(self) -> None:
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        self.public_dir.mkdir(parents=True, exist_ok=True)

    def copy_asset(self, src_name: str, dest_name: str) -> None:
        src = self.asset_dir / src_name
        if not src.exists():
            raise FileNotFoundError(f"Missing source asset: {src}")
        shutil.copyfile(src, self.archive_dir / dest_name)
        shutil.copyfile(src, self.public_dir / dest_name)

    def root_relative(self, path: Path) -> str:
        return str(path.relative_to(self.root_dir)).replace("\\", "/")

    def renderer_asset(self, name: str) -> str:
        return f"tldr-sample/{self.public_slug}-{self.version}/{name}"


def create_asset_context(
    topic_dir: Path,
    *,
    version: str,
    root_dir: Path | None = None,
    public_slug: str,
) -> AssetBuildContext:
    topic_dir = Path(topic_dir)
    root_dir = Path(root_dir) if root_dir is not None else _repo_root()
    topic_data = _load_topic_json(topic_dir)
    topic_key = str(topic_data["topic_key"])
    version = _normalize_version(version)
    return AssetBuildContext(
        root_dir=root_dir,
        topic_dir=topic_dir,
        topic_key=topic_key,
        topic_data=topic_data,
        version=version,
        public_slug=public_slug,
        asset_dir=topic_dir / "assets",
        archive_dir=topic_dir / f"sample_cut_{version}_assets",
        public_dir=root_dir
        / f"content-factory-renderer/public/tldr-sample/{public_slug}-{version}",
        manifest_path=topic_dir / f"sample_cut_{version}_asset_manifest.json",
    )


def build_sample_cut_assets(
    topic_dir: Path,
    *,
    version: str,
    root_dir: Path | None = None,
    profiles: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    topic_dir = Path(topic_dir)
    topic_data = _load_topic_json(topic_dir)
    topic_key = str(topic_data["topic_key"])
    profiles = profiles or PROFILES
    profile = profiles.get(topic_key)
    if profile is None:
        raise KeyError(
            f"No sample-cut asset profile registered for topic_key={topic_key}"
        )

    context = create_asset_context(
        topic_dir,
        version=version,
        root_dir=root_dir,
        public_slug=str(profile["public_slug"]),
    )
    context.ensure_dirs()

    build_payload = profile["builder"](context)
    manifest_payload = {
        "topic": topic_key,
        "recording_ready": (topic_dir / "recording" / "video.mp4").exists(),
        "expected_source_video": context.root_relative(
            topic_dir / "recording" / "video.mp4"
        ),
        **build_payload,
    }
    context.manifest_path.write_text(
        json.dumps(manifest_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest_payload


def _anthropic_builder(context: AssetBuildContext) -> dict[str, Any]:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

    W = 1080
    H = 1920
    FONT_REG = r"C:\Windows\Fonts\msyh.ttc"
    FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"

    def font(path: str, size: int) -> ImageFont.FreeTypeFont:
        return ImageFont.truetype(path, size)

    def make_bg(image_name: str, crop=None, blur: int = 8) -> Image.Image:
        image = Image.open(context.asset_dir / image_name).convert("RGB")
        if crop is not None:
            image = image.crop(crop)
        image = ImageOps.fit(image, (W, H), method=Image.Resampling.LANCZOS)
        image = image.filter(ImageFilter.GaussianBlur(blur))
        overlay = Image.new("RGBA", (W, H), (14, 16, 24, 112))
        return Image.alpha_composite(image.convert("RGBA"), overlay)

    def rounded_panel(
        draw: ImageDraw.ImageDraw, box, fill=(255, 248, 241, 244), radius: int = 38
    ) -> None:
        draw.rounded_rectangle(
            box, radius=radius, fill=fill, outline=(255, 255, 255, 28), width=2
        )

    def tag(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, fill) -> None:
        f = font(FONT_REG, 30)
        bbox = draw.textbbox((0, 0), text, font=f)
        width = bbox[2] - bbox[0] + 40
        height = bbox[3] - bbox[1] + 24
        draw.rounded_rectangle((x, y, x + width, y + height), radius=26, fill=fill)
        draw.text((x + 20, y + 11), text, font=f, fill=(255, 255, 255))

    def wrap(
        draw: ImageDraw.ImageDraw,
        text: str,
        font_obj: ImageFont.FreeTypeFont,
        max_width: int,
    ) -> str:
        lines: list[str] = []
        for paragraph in text.split("\n"):
            current = ""
            for char in paragraph:
                candidate = current + char
                bbox = draw.textbbox((0, 0), candidate, font=font_obj)
                if current and (bbox[2] - bbox[0]) > max_width:
                    lines.append(current)
                    current = char
                else:
                    current = candidate
            if current:
                lines.append(current)
            if not paragraph:
                lines.append("")
        return "\n".join(lines)

    def fit_text(
        draw: ImageDraw.ImageDraw,
        box,
        text: str,
        font_path: str,
        start: int,
        min_size: int,
        fill,
        spacing: int = 8,
    ) -> None:
        x1, y1, x2, y2 = box
        for size in range(start, min_size - 1, -2):
            f = font(font_path, size)
            wrapped = wrap(draw, text, f, x2 - x1)
            bbox = draw.multiline_textbbox((x1, y1), wrapped, font=f, spacing=spacing)
            if bbox[3] - bbox[1] <= (y2 - y1):
                draw.multiline_text(
                    (x1, y1), wrapped, font=f, fill=fill, spacing=spacing
                )
                return
        f = font(font_path, min_size)
        wrapped = wrap(draw, text, f, x2 - x1)
        draw.multiline_text((x1, y1), wrapped, font=f, fill=fill, spacing=spacing)

    def paste_preview(base: Image.Image, src_name: str, box, radius: int = 24) -> None:
        preview = Image.open(context.asset_dir / src_name).convert("RGB")
        preview = ImageOps.fit(
            preview, (box[2] - box[0], box[3] - box[1]), method=Image.Resampling.LANCZOS
        )
        mask = Image.new("L", (preview.width, preview.height), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rounded_rectangle(
            (0, 0, preview.width, preview.height), radius=radius, fill=255
        )
        base.paste(preview, (box[0], box[1]), mask)

    def build_architecture_card() -> None:
        base = make_bg("harness_initial_screen.png", crop=(40, 0, 1850, 1100), blur=10)
        draw = ImageDraw.Draw(base)
        rounded_panel(draw, (54, 90, 1026, 1350))
        tag(draw, 96, 126, "机制", (255, 92, 122, 255))
        fit_text(
            draw,
            (96, 230, 950, 420),
            "真正拉开差距的\n是这套 harness",
            FONT_BOLD,
            78,
            54,
            (24, 24, 28),
            10,
        )
        fit_text(
            draw,
            (100, 448, 948, 540),
            "文章的重点不是模型多会写，而是工程闭环怎么跑起来",
            FONT_REG,
            34,
            26,
            (92, 92, 100),
            8,
        )

        blocks = [
            ((96, 612, 986, 800), "Planner", "拆任务\n定 sprint\n把目标压成可交付小步"),
            (
                (96, 826, 986, 1014),
                "Generator",
                "写代码\n提交改动\n留下 git 记录和进度",
            ),
            (
                (96, 1040, 986, 1228),
                "Evaluator",
                "Playwright 真测\n发现 bug\n决定能不能过关",
            ),
        ]
        colors = [
            ((255, 245, 240, 230), (228, 69, 87)),
            ((245, 249, 255, 230), (64, 113, 255)),
            ((239, 249, 243, 230), (23, 145, 90)),
        ]
        for (box, title, body), (fill, accent) in zip(blocks, colors, strict=True):
            rounded_panel(draw, box, fill=fill, radius=30)
            draw.rounded_rectangle(
                (box[0] + 28, box[1] + 24, box[0] + 210, box[1] + 78),
                radius=22,
                fill=accent,
            )
            draw.text(
                (box[0] + 56, box[1] + 38),
                title,
                font=font(FONT_REG, 30),
                fill=(255, 255, 255),
            )
            fit_text(
                draw,
                (box[0] + 264, box[1] + 32, box[2] - 32, box[3] - 26),
                body,
                FONT_BOLD,
                36,
                28,
                (32, 35, 40),
                6,
            )

        rounded_panel(draw, (96, 1260, 986, 1334), fill=(255, 244, 239, 216), radius=24)
        fit_text(
            draw,
            (126, 1278, 950, 1320),
            "辅助轨道：sprint contract / context compaction / git progress",
            FONT_BOLD,
            28,
            22,
            (228, 69, 87),
            4,
        )
        out = context.archive_dir / "architecture-card.jpg"
        base.convert("RGB").save(out, quality=95)
        shutil.copyfile(out, context.public_dir / "architecture-card.jpg")

    def build_comparison_card() -> None:
        base = make_bg("solo_gameplay_fail.png", crop=(0, 0, 1600, 1000), blur=9)
        draw = ImageDraw.Draw(base)
        rounded_panel(draw, (54, 90, 1026, 1360))
        tag(draw, 96, 126, "结果差距", (255, 92, 122, 255))
        fit_text(
            draw,
            (96, 230, 956, 420),
            "单代理只能做雏形\nHarness 才接近产品",
            FONT_BOLD,
            76,
            50,
            (24, 24, 28),
            10,
        )
        fit_text(
            draw,
            (100, 448, 948, 540),
            "Anthropic 最有分量的数据，不是 demo 漂不漂亮，而是完整工程闭环到底值不值钱。",
            FONT_REG,
            32,
            26,
            (92, 92, 100),
            8,
        )

        left = (96, 612, 508, 1268)
        right = (572, 612, 986, 1268)
        rounded_panel(draw, left, fill=(255, 242, 240, 234), radius=32)
        rounded_panel(draw, right, fill=(240, 248, 242, 234), radius=32)
        draw.rounded_rectangle((126, 636, 290, 690), radius=22, fill=(228, 69, 87))
        draw.rounded_rectangle((602, 636, 806, 690), radius=22, fill=(23, 145, 90))
        draw.text((171, 650), "Solo run", font=font(FONT_REG, 28), fill=(255, 255, 255))
        draw.text(
            (664, 650), "Full harness", font=font(FONT_REG, 28), fill=(255, 255, 255)
        )
        draw.text(
            (126, 730), "20 分钟 / 9 美元", font=font(FONT_BOLD, 42), fill=(228, 69, 87)
        )
        draw.text(
            (602, 730),
            "6 小时 / 200 美元",
            font=font(FONT_BOLD, 42),
            fill=(23, 145, 90),
        )
        fit_text(
            draw,
            (126, 792, 470, 872),
            "能做出看起来像样的页面\n但很容易半途断掉",
            FONT_BOLD,
            34,
            26,
            (32, 35, 40),
            6,
        )
        fit_text(
            draw,
            (602, 792, 948, 872),
            "能持续修 bug、补功能\n开始接近可用产品",
            FONT_BOLD,
            34,
            26,
            (32, 35, 40),
            6,
        )
        paste_preview(base, "solo_gameplay_fail.png", (126, 908, 478, 1150))
        paste_preview(base, "harness_gameplay.png", (602, 908, 954, 1150))
        fit_text(
            draw,
            (126, 1178, 468, 1234),
            "问题不是模型会不会写，而是工程回路没闭上。",
            FONT_REG,
            26,
            22,
            (103, 76, 82),
            4,
        )
        fit_text(
            draw,
            (602, 1178, 950, 1234),
            "投入更大，但任务拆解、测试和回退终于形成系统。",
            FONT_REG,
            26,
            22,
            (63, 93, 74),
            4,
        )
        rounded_panel(draw, (96, 1288, 986, 1342), fill=(255, 246, 241, 216), radius=22)
        fit_text(
            draw,
            (126, 1300, 956, 1332),
            "行业信号：coding agent 的竞争，开始从模型能力转向工程系统能力。",
            FONT_BOLD,
            26,
            22,
            (228, 69, 87),
            4,
        )
        out = context.archive_dir / "comparison-card.jpg"
        base.convert("RGB").save(out, quality=95)
        shutil.copyfile(out, context.public_dir / "comparison-card.jpg")

    context.copy_asset("harness_initial_screen.png", "source-hero.png")
    context.copy_asset("playwright_testing_gif.gif", "playwright-testing.gif")
    context.copy_asset("solo_gameplay_fail.png", "solo-fail.png")
    context.copy_asset("harness_gameplay.png", "harness-win.png")
    build_architecture_card()
    build_comparison_card()

    return {
        "renderer_assets": [
            context.renderer_asset("source-hero.png"),
            context.renderer_asset("playwright-testing.gif"),
            context.renderer_asset("solo-fail.png"),
            context.renderer_asset("harness-win.png"),
            context.renderer_asset("architecture-card.jpg"),
            context.renderer_asset("comparison-card.jpg"),
        ],
        "archived_assets": [
            context.root_relative(context.archive_dir / "source-hero.png"),
            context.root_relative(context.archive_dir / "playwright-testing.gif"),
            context.root_relative(context.archive_dir / "solo-fail.png"),
            context.root_relative(context.archive_dir / "harness-win.png"),
            context.root_relative(context.archive_dir / "architecture-card.jpg"),
            context.root_relative(context.archive_dir / "comparison-card.jpg"),
        ],
        "font_files": [FONT_REG, FONT_BOLD],
    }


PROFILES: dict[str, dict[str, Any]] = {
    "anthropic_harness_design": {
        "public_slug": "anthropic-harness",
        "builder": _anthropic_builder,
    }
}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build sample-cut asset package for a TLDR topic"
    )
    parser.add_argument("--topic-dir", required=True)
    parser.add_argument("--version", default="v1")
    args = parser.parse_args()
    result = build_sample_cut_assets(Path(args.topic_dir), version=args.version)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
