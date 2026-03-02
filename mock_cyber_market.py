import json
import time
import random
import os

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_OUTPUT_FILE = os.path.join(
    REPO_ROOT, "onlytrade-web", "public", "cyber_market_live.json"
)
DIST_OUTPUT_FILE = os.path.join(
    REPO_ROOT, "onlytrade-web", "dist", "cyber_market_live.json"
)


def resolve_output_files():
    files = [PUBLIC_OUTPUT_FILE]
    dist_dir = os.path.dirname(DIST_OUTPUT_FILE)
    if os.path.isdir(dist_dir):
        files.append(DIST_OUTPUT_FILE)
    return files


# Define multiple markets to rotate through
MARKETS = [
    {
        "id": "mkt_test_001",
        "title": "[科技] OpenAI会在本周四(3月5日)的旧金山春季前瞻会上正式宣布GPT-5吗？",
        "yes_outcome": "正式宣布",
        "no_outcome": "继续跳票",
        "initial_prob": 0.68,
        "current_prob": 0.68,
        "close_time": "2026-03-06",
        "volume": 85000000,
        "liquidity": 12500000,
    },
    {
        "id": "mkt_test_002",
        "title": "[A股] 本周两会期间(3月4日-11日)，上证指数能否成功突破并站稳3700点大关？",
        "yes_outcome": "突破3700",
        "no_outcome": "承压回落",
        "initial_prob": 0.55,
        "current_prob": 0.55,
        "close_time": "2026-03-12",
        "volume": 150000000,
        "liquidity": 28000000,
    },
    {
        "id": "mkt_test_003",
        "title": "[体育] 3月中旬的欧冠1/8决赛次回合，皇马能否在主场逆转曼城成功晋级？",
        "yes_outcome": "皇马晋级",
        "no_outcome": "曼城守住",
        "initial_prob": 0.42,
        "current_prob": 0.42,
        "close_time": "2026-03-19",
        "volume": 4600000,
        "liquidity": 1150000,
    },
    {
        "id": "mkt_test_004",
        "title": "[加密] 本周末前，比特币(BTC)价格能否一举突破100,000美元整数关口？",
        "yes_outcome": "破10万刀",
        "no_outcome": "冲击失败",
        "initial_prob": 0.31,
        "current_prob": 0.31,
        "close_time": "2026-03-08",
        "volume": 310000000,
        "liquidity": 53000000,
    },
    {
        "id": "mkt_test_005",
        "title": "[汽车] 小米汽车SU8会在3月底的春季新品发布会上公布最终售价区间吗？",
        "yes_outcome": "公布售价",
        "no_outcome": "仅概念展示",
        "initial_prob": 0.82,
        "current_prob": 0.82,
        "close_time": "2026-03-31",
        "volume": 12200000,
        "liquidity": 850000,
    },
    {
        "id": "mkt_test_006",
        "title": "[游戏] 《黑神话：悟空》DLC“狮驼岭”会在3月的GDC游戏开发者大会放出演示吗？",
        "yes_outcome": "放实机演示",
        "no_outcome": "完全没消息",
        "initial_prob": 0.28,
        "current_prob": 0.28,
        "close_time": "2026-03-24",
        "volume": 8900000,
        "liquidity": 1500000,
    },
]

state = {
    "market": MARKETS[0],
    "balances": {"AI_Agent_Zero": 1854200.50, "Chat_Hivemind": 789500.20},
    "logs": [
        {
            "id": 1,
            "sender": "System",
            "type": "info",
            "text": "Virtual Market initialized.",
            "time": int(time.time() * 1000),
        }
    ],
    "ai_pnl": 12500.0,
    "last_update": int(time.time() * 1000),
}

current_market_index = 0
true_prob = state["market"]["initial_prob"]
drift_direction = 1
market_start_time = time.time()


def generate_mock_name():
    names = [
        "加密老猫",
        "杭州王老板",
        "韭菜_889",
        "A股第一牛",
        "Quantum_Trader",
        "BTC_Whale",
        "Degen_Ape",
        "Web3_Builder",
        "币圈打工人",
        "高频量化机器人",
        "Solana狙击手",
        "套牢的胖子",
        "财富自由之路",
        "Polymarket大神",
        "神秘大户_0x8F",
    ]
    return random.choice(names)


def rotate_market():
    global current_market_index, true_prob, market_start_time
    current_market_index = (current_market_index + 1) % len(MARKETS)
    state["market"] = MARKETS[current_market_index]
    true_prob = state["market"]["initial_prob"]
    market_start_time = time.time()

    state["logs"].append(
        {
            "id": int(time.time() * 1000),
            "sender": "System",
            "type": "info",
            "text": f"--- SWITCHING FORECAST TARGET: {state['market']['title']} ---",
            "time": int(time.time() * 1000),
        }
    )


def generate_messages():
    global true_prob, drift_direction, market_start_time

    # Rotate market every 5 seconds for the demo
    if time.time() - market_start_time > 5:
        rotate_market()
        return

    volatility = 0.02
    if random.random() < 0.1:
        drift_direction *= -1

    delta = (random.random() * volatility * drift_direction) + (
        random.random() * 0.005 - 0.0025
    )
    true_prob = max(0.01, min(0.99, true_prob + delta))

    bet_types = []
    if delta > 0:
        bet_types = ["YES"] * 4 + ["NO"] * 1
    else:
        bet_types = ["NO"] * 4 + ["YES"] * 1

    bet_type = random.choice(bet_types)
    amount = random.randint(100, 50000)
    sender = "AI_Agent_Zero" if random.random() < 0.25 else generate_mock_name()
    msg_type = "agent" if sender == "AI_Agent_Zero" else "user"

    if msg_type == "agent":
        reasons = [
            "监控到链上巨鲸资金异动",
            "期权市场IV(隐含波动率)飙升暗示突破",
            "社交媒体情绪分析达到极度贪婪区间",
            "订单薄买盘深度瞬间增加300%",
            "历史因子回测显示当前盈亏比>3.5",
            "捕捉到内部人士场外建仓信号",
            "新闻NLP模型解析出强烈的利好预期",
            "跨市场套利模型触发自动下单指令",
        ]
        text = f"[{bet_type} 建仓 ${amount:,}] {random.choice(reasons)}。计算胜率: {true_prob:.1%}，执行策略: 动量跟随。"
        state["balances"]["AI_Agent_Zero"] -= amount

        if random.random() < 0.4:
            sim_pnl = amount * random.uniform(0.1, 0.5)
            state["ai_pnl"] += sim_pnl
            state["balances"]["AI_Agent_Zero"] += amount + sim_pnl
        elif random.random() < 0.3:
            sim_loss = amount * random.uniform(0.1, 0.8)
            state["ai_pnl"] -= sim_loss

    else:
        reactions = [
            "直接梭哈了兄弟们，别怂！",
            "跟着大哥吃肉！",
            "这不肯定血本无归吗，反买别墅靠海",
            "冲冲冲，赢了会所嫩模",
            "底裤都押上了",
            "感觉药丸，赶紧止损",
            "这是送钱行情啊，我加仓了",
            "庄家要开始洗盘了，大家坐稳",
            "这波格局要大，拿到最后",
            "爆仓了，天台风好大",
            "别拉了，我还没上车！",
            f"重仓了 {bet_type}，听天由命吧",
            "这概率还能再假点吗？",
        ]
        if random.random() < 0.4:
            # 40% chance of just a chat message without a bet explicitly mentioned
            text = random.choice(reactions)
        else:
            # 60% chance of a bet action + reaction
            text = f"下单 ${amount:,} 买入 {bet_type}。{random.choice(reactions)}"
            state["market"]["volume"] += amount

        state["balances"]["Chat_Hivemind"] += random.randint(-5000, 8000)

    new_log = {
        "id": int(time.time() * 1000) + random.randint(1, 1000),
        "sender": sender,
        "type": msg_type,
        "text": text,
        "time": int(time.time() * 1000),
    }

    state["market"]["current_prob"] = true_prob
    state["market"]["volume"] += amount
    state["logs"].append(new_log)

    if len(state["logs"]) > 50:
        state["logs"] = state["logs"][-50:]


def run():
    output_files = resolve_output_files()
    print(f"Starting Multi-Market Mock Data Generator...")
    for file_path in output_files:
        print(f"Writing static JSON to: {file_path}")
        os.makedirs(os.path.dirname(file_path), exist_ok=True)

    while True:
        generate_messages()
        state["last_update"] = int(time.time() * 1000)

        for file_path in output_files:
            tmp_path = f"{file_path}.tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(state, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, file_path)

        time.sleep(random.uniform(0.2, 0.8))


if __name__ == "__main__":
    run()
