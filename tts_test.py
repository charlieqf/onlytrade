import json
import logging as logger
import requests
import pyaudio

# 配置音频参数
RATE = 32000        # 采样率
CHANNELS = 1        # 单声道
FORMAT = pyaudio.paInt16  # 16位深度，通常TTS都是
CHUNK = 2000        # 每一块采样数，可适当调整
URL = url = "http://101.227.82.130:13002/tts"

'''
下面是支持的音色列表
自有_女,zsy
自有_陆主任,lzr
自有_革命青年_教官,GeMingQingNian_JiaoGuan
自有_革命青年_教师,GeMingQingNian_JiaoShi
自有_王方,wf
自有_周凯,zhoukai
自有_张衡,zhangheng
自有_雷军,leijun
自有_熊二,xionger
自有_容嬷嬷,rongmeme
自有_八戒,bajie
自有_女生旁白,nv1
自有_猴哥,houge
自有_云泽大叔,yunzedashu
自有_广西表哥,guangxibiaoge
自有_贵州小刚,guizhouxiaogang
自有_皇上,huangshang
自有_刘语熙,liuyuxi
自有_悬疑讲解,xuanyijiangjie
自有_直率英子,zhishuaiyingzi
'''

payload = {
    "text": "亲爱的朋友们，欢迎来到这个属于我们共同成长的空间，让我们暂时放下外界的喧嚣，聆听内心的声音。",
    "text_lang": "zh",
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
    "speed_factor": 1.2,
    "media_type": "raw",
    "streaming_mode": True,
    "seed": 100,
    "parallel_infer": True,
    "repetition_penalty": 1.35,
    "sample_steps": 32,
    "super_sampling": False,
    "sample_rate": 32000,
    "fragment_interval": 0.01,
    "voice_id": "xuanyijiangjie",
}

headers = {"Content-Type": "application/json"}

import time
p = pyaudio.PyAudio()
stream = p.open(format=FORMAT,
                channels=CHANNELS,
                rate=RATE,
                output=True,
                frames_per_buffer=CHUNK)
def main():
    t1 = time.perf_counter()
    with requests.post(URL, headers=headers, json=payload, stream=True) as resp:
        if resp.status_code == 200:
            # try:
            # 接受流并实时播放
            is_first = True
            len_chunk = 0
            with open("../output/test.pcm", "wb") as f:
                for chunk in resp.iter_content(chunk_size=CHUNK * 2):  # 2 bytes per sample
                    if is_first:
                        print(time.perf_counter() - t1)
                        is_first = False
                    if chunk:
                        len_chunk += len(chunk)
                        f.write(chunk)
                        stream.write(chunk)
                    else:
                        break
                print("语音时长 %f " % (len_chunk / RATE / 2))
                stream.stop_stream()
                stream.close()
                p.terminate()
        else:
            print("Error:", resp.status_code, resp.text)



if __name__ == "__main__":
    main()
    # data = main_2()
    # p = pyaudio.PyAudio()
    # stream = p.open(format=pyaudio.paInt16,
    #                 channels=1,
    #                 rate=16000,
    #                 output=True,
    #                 frames_per_buffer=CHUNK)
    # stream.write(data)
    # stream.stop_stream()
    # stream.close()