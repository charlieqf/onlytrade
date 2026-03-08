import json
import requests
import os
import subprocess

# 配置
URL = "http://101.227.82.130:13002/tts"
RATE = 32000

voices = [
    "lzr", 
    "leijun", 
    "nv1", 
    "liuyuxi", 
    "zhishuaiyingzi", 
    "yunzedashu"
]

text = "大家好，这里是基于 Transformer 架构的 TTS 生成测试。我们将通过 monitoring 系统监控 latency 和 API response time。"

payload_template = {
    "text": text,
    "text_lang": "auto",
    "ref_audio_path": "voice/张舒怡.wav",
    "prompt_lang": "zh",
    "aux_ref_audio_paths": [],
    "top_k": 30,
    "top_p": 1,
    "temperature": 1,
    "text_split_method": "cut5",
    "batch_size": 32,
    "batch_threshold": 0.75,
    "split_bucket": True,
    "speed_factor": 1.0,
    "media_type": "wav",
    "streaming_mode": False,
    "seed": 100,
    "parallel_infer": True,
    "repetition_penalty": 1.35,
    "sample_steps": 32,
    "super_sampling": False,
    "sample_rate": 32000,
}

headers = {"Content-Type": "application/json"}

for voice in voices:
    print(f"Generating for {voice}...")
    payload = payload_template.copy()
    payload["voice_id"] = voice
    
    wav_file = f"{voice}.wav"
    
    with requests.post(URL, headers=headers, json=payload) as resp:
        if resp.status_code == 200:
            with open(wav_file, "wb") as f:
                f.write(resp.content)
            print(f"Saved {wav_file}")
        else:
            print(f"Error for {voice}: {resp.status_code}")
            print(resp.text)
