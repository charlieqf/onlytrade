import requests
import json
import time

def fetch_weibo_hot():
    """Fetch Weibo Hot Search List (Entertainment/General Gossip)"""
    url = "https://weibo.com/ajax/side/hotSearch"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        response = requests.get(url, headers=headers, timeout=10)
        data = response.json()
        hot_list = data.get('data', {}).get('realtime', [])
        
        results = []
        for item in hot_list[:5]: # Get top 5
            if 'word' in item:
                results.append({
                    "source": "Weibo",
                    "title": item['word'],
                    "hot_score": item.get('raw_hot', 0),
                    "label": item.get('label_name', '') # e.g., '爆', '热', '新'
                })
        return results
    except Exception as e:
        print(f"Error fetching Weibo: {e}")
        return []

def fetch_zhihu_hot():
    """Fetch Zhihu Hot List (Tech/Deep Discussions)"""
    url = "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        # Zhihu requires strict headers sometimes, an empty cookie string usually bypasses simple blocks
        "Cookie": "d_c0=placeholder;" 
    }
    try:
        response = requests.get(url, headers=headers, timeout=10)
        data = response.json()
        hot_list = data.get('data', [])
        
        results = []
        for item in hot_list[:5]:
            target = item.get('target', {})
            results.append({
                "source": "Zhihu",
                "title": target.get('title', ''),
                "hot_score": item.get('detail_text', ''),
                "excerpt": target.get('excerpt', '')[:50] + "..."
            })
        return results
    except Exception as e:
        print(f"Error fetching Zhihu: {e}")
        return []

def generate_market_via_llm(topic_data):
    """
    Mock LLM Call to convert a hot topic into a prediction market.
    In production, you will replace this with an actual OpenAI / DeepSeek / Kimi API call.
    """
    print(f"\n[AI特工大脑] 正在分析抓取的热点: 『{topic_data['title']}』 (来源: {topic_data['source']})")
    
    # ---------------- 核心Prompt模板 (供后续接入真实大模型使用) ----------------
    prompt = f"""
    你是一个残酷无情的赛博金融庄家。目前的网络热点是：『{topic_data['title']}』，来源：{topic_data['source']}。
    请你为这个新闻生成一个非黑即白（Yes/No）、且在24小时内能验证结果的对赌盘口。
    返回严格的JSON格式：
    {{ "title": "盘口标题", "yes_outcome": "肯定结果", "no_outcome": "否定结果", "initial_yes_probability": 0.5, "close_time": "2026-XX-XX..." }}
    """
    # -------------------------------------------------------------------------
    
    time.sleep(1.5) # 模拟大模型思考延迟
    
    #  mock response:
    if topic_data['source'] == 'Weibo':
        return {
            "title": f"【内娱大瓜】关于『{topic_data['title']}』，24小时内当事人（或其工作室）是否会发布正式微博回应或辟谣？",
            "yes_outcome": "是，发布官方盖章声明",
            "no_outcome": "否，选择冷处理或仅网签回应",
            "initial_yes_probability": 0.25,
            "close_time": "T+24H"
        }
    else:
        return {
            "title": f"【科技与商业】关于『{topic_data['title']}』事件，涉事主体/平台当日股价（或估值预期）是否会下跌超过5%？",
            "yes_outcome": "是，市场情绪恐慌引发抛售",
            "no_outcome": "否，市场情绪平稳",
            "initial_yes_probability": 0.40,
            "close_time": "T+12H"
        }

def main():
    print("="*60)
    print("     赛博预测市场 - 数据抓取与盘口生成引擎 (MVP)     ")
    print("="*60)
    
    print("\n[ 系统 ] 步骤 1: 扫描微博实时热搜榜 (吃瓜/娱乐向)...")
    weibo_topics = fetch_weibo_hot()
    if not weibo_topics:
         print("  -> 微博抓取失败或无数据，正在使用模拟数据...")
         weibo_topics = [{"source": "Weibo", "title": "周杰伦新专辑官宣连发三首新歌", "hot_score": "8000000", "label": "爆"}]
    for idx, t in enumerate(weibo_topics):
        label_str = f"[{t['label']}] " if t['label'] else ""
        print(f"  {idx+1}. {label_str}{t['title']} (热度: {t['hot_score']})")

    print("\n[ 系统 ] 步骤 2: 扫描知乎全站热榜 (科技/深度向)...")
    zhihu_topics = fetch_zhihu_hot()
    if not zhihu_topics:
         print("  -> 知乎抓取失败或无数据，正在使用模拟数据...")
         zhihu_topics = [{"source": "Zhihu", "title": "马斯克宣布 xAI 正式开源 3000亿参数大模型，将带来哪些行业地震？", "hot_score": "1500万热度", "excerpt": ""}]
    for idx, t in enumerate(zhihu_topics):
        print(f"  {idx+1}. {t['title']} ({t['hot_score']})")

    print("\n[ 系统 ] 步骤 3: 触发大模型 (LLM) 自动生成对赌盘口...")
    
    # 选微博的第一条测试
    if weibo_topics:
        market1 = generate_market_via_llm(weibo_topics[0])
        print("  -> 生成完毕 (微博向盘口):")
        print(json.dumps(market1, indent=2, ensure_ascii=False))
        
    # 选知乎的第一条测试
    if zhihu_topics:
        market2 = generate_market_via_llm(zhihu_topics[0])
        print("  -> 生成完毕 (知乎向盘口):")
        print(json.dumps(market2, indent=2, ensure_ascii=False))
        
    print("\n[ 系统 ] 测试完成。下一步任务：将此JSON写入SQLite数据库，并推送至前端大屏。")

if __name__ == "__main__":
    main()
