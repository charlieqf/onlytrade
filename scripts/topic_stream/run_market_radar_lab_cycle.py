import os
import sys
from pathlib import Path
from typing import Any, Dict

if __package__ in (None, ""):
    repo_root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(repo_root))

from scripts.topic_stream import run_china_bigtech_cycle as base


base.ROOM_ID = "t_020"
base.PROGRAM_SLUG = "market-radar-lab"
base.PROGRAM_TITLE = "市场快评实验室"
base.PROGRAM_STYLE = "market_commentary_lab"
base.DEFAULT_OUTPUT_PATH = (
    base.REPO_ROOT / "data/live/onlytrade/topic_stream/market_radar_lab_live.json"
)
base.DEFAULT_IMAGE_DIR = base.REPO_ROOT / "data/live/onlytrade/topic_images/t_020"
base.DEFAULT_AUDIO_DIR = base.REPO_ROOT / "data/live/onlytrade/topic_audio/t_020"
base.DEFAULT_CACHE_PATH = (
    base.REPO_ROOT
    / "data/live/onlytrade/topic_stream/market_radar_lab_commentary_cache.json"
)
base.DEFAULT_TTS_VOICE_ID = os.getenv("TOPIC_STREAM_T020_TTS_VOICE", "longxiu_v2")


def _market_radar_user_prompt(entity: Dict[str, Any], row: Dict[str, Any]) -> str:
    return "\n".join(
        [
            f"program: {base.PROGRAM_SLUG}",
            f"entity: {base._safe_text(entity.get('label'), 80)}",
            f"sector: {base._safe_text(entity.get('sector'), 24)}",
            f"headline: {base._safe_text(row.get('title'), 220)}",
            f"summary: {base._safe_text(row.get('summary'), 360)}",
            f"source: {base._safe_text(row.get('source'), 80) or 'n/a'}",
            f"tone_notes: {base._safe_text(entity.get('tone_notes'), 160) or '情绪拉满、快语速、像直播间里直接开麦'}",
            "hard_rules:",
            "- 第一段第一句必须是开场炸点，短促、刺激、能立刻抓人",
            "- 口播整体要像60秒盯盘快评，不要像资讯总结或行业周报",
            "- 必须有鲜明判断和态度，但判断要建立在已给事实之上",
            "- 可以用短句、反问、感叹，允许自然使用 这波不小 / 重点来了 / 别眨眼 这类直播口头感",
            "- 禁止使用 表面上看 / 先把事实摆清楚 / 真正值得看的 这类拖沓模板句",
            "- 结尾必须留下后续观察钩子，例如 接下来要看 / 后面要看 / 真正刺激的是下一步",
        ]
    )


def _market_radar_fallback_commentary(
    entity: Dict[str, Any], row: Dict[str, Any]
) -> Dict[str, Any]:
    label = base._safe_text(entity.get("label"), 40)
    summary = base._safe_text(row.get("summary"), 260)
    title = base._safe_text(row.get("title"), 80)
    script = (
        f"{label}这条，先别划走！"
        f"{title}这一下，不是普通热闹，是市场情绪又被点了一把火。"
        f"事实先拎出来：{summary}。"
        f"我的判断很直接，这种消息一旦连上预期差、连上情绪面，后面的波动就不会小。"
        f"说白了，大家现在盯的不是新闻本身，而是它会不会继续放大成行业节奏和资金话题。"
        f"要是后续动作够硬，这条线还会继续冲；要是落地发虚，热度掉头也会非常快。"
        f"接下来要看，管理层后手、市场反馈和对手回应，到底还能不能把这把火越烧越旺！"
    )
    block = {
        "screen_title": f"{label}这条消息，把情绪直接点着了",
        "summary_facts": summary or title,
        "commentary_script": script,
        "screen_tags": [label, "Fast take", "Momentum", "Next move"],
        "topic_reason": "high-intensity market commentary on an attention spike",
    }
    return base.validate_generated_block(block) or {
        **block,
        "script_estimated_seconds": base.english._estimate_material_seconds(script),
    }


base.COMMENTARY_SYSTEM_PROMPT = "\n".join(
    [
        "你是《市场快评实验室》的固定主播。",
        "你要把市场热点改写成可直接口播的中文快评节目。",
        '{"screen_title":"...","summary_facts":"...","commentary_script":"...","screen_tags":["..."],"topic_reason":"..."}',
        "要求：",
        "- screen_title: 12-28字，像直播封面标题，短、狠、有市场感。",
        "- summary_facts: 只写事实摘要，不夹带未经证实断言。",
        "- commentary_script: 60-90秒口播，必须有60秒快评的压迫感、推进感和情绪拉力。",
        "- commentary_script 第一段第一句就要炸场，像直播间抢话筒开麦，先把注意力钩住。",
        "- commentary_script 要像真人盯盘快评，不要像平淡播报稿，不要像复述新闻。",
        "- commentary_script 必须有明确态度和锐利评论，但不能脱离事实乱下结论。",
        "- commentary_script 多用短句、快句、口语句，允许自然使用感叹词、反问句和节奏停顿。",
        "- commentary_script 禁止通篇温吞、书面、克制，禁止写成企业宣传稿或中性分析摘要。",
        "- commentary_script 必须包含一个后续观察钩子，例如 接下来要看 / 真正要看 / 后面要看。",
        "- screen_tags: 3-5个短标签。",
        "- 不要给投资建议，不要输出 JSON 以外文本。",
    ]
)
base._commentary_user_prompt = _market_radar_user_prompt
base._fallback_commentary = _market_radar_fallback_commentary


if __name__ == "__main__":
    base.main()
