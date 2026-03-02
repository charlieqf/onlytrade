#!/usr/bin/env python3
import json
import os
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict
from urllib import error as url_error
from urllib import request as url_request


def _env_str(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    if value is None:
        return default
    return str(value).strip()


def _env_float(name: str, default: float) -> float:
    raw = _env_str(name)
    if not raw:
        return default
    try:
        return float(raw)
    except Exception:
        return default


def _env_int(name: str, default: int) -> int:
    raw = _env_str(name)
    if not raw:
        return default
    try:
        return int(raw)
    except Exception:
        return default


LOCAL_TTS_URL = _env_str("TTS_GATEWAY_LOCAL_TTS_URL", "http://101.227.82.130:13002/tts")
LOCAL_TTS_TIMEOUT_SEC = _env_float("TTS_GATEWAY_LOCAL_TTS_TIMEOUT_SEC", 20.0)

LOCAL_VOICES = {
    voice.strip()
    for voice in _env_str(
        "TTS_GATEWAY_LOCAL_VOICES",
        "zsy,lzr,GeMingQingNian_JiaoGuan,GeMingQingNian_JiaoShi,wf,zhoukai,zhangheng,leijun,xionger,rongmeme,bajie,nv1,houge,yunzedashu,guangxibiaoge,guizhouxiaogang,huangshang,liuyuxi,xuanyijiangjie,zhishuaiyingzi",
    ).split(",")
    if voice.strip()
}

COSY_FALLBACK_LOCAL_VOICE = _env_str("TTS_GATEWAY_COSY_FALLBACK_LOCAL_VOICE", "zsy")

TTS_GATEWAY_HOST = _env_str("TTS_GATEWAY_HOST", "0.0.0.0")
TTS_GATEWAY_PORT = _env_int("TTS_GATEWAY_PORT", 13003)


try:
    import websocket  # type: ignore
    from dashscope.audio.tts_v2.speech_synthesizer import Request  # type: ignore

    DASHSCOPE_READY = True
except Exception:
    websocket = None
    Request = None
    DASHSCOPE_READY = False


def _cosy_model_for_voice(voice_id: str) -> str:
    voice = (voice_id or "").strip()
    if voice.endswith("_v2"):
        return "cosyvoice-v2"
    if voice.endswith("_v3") or voice in {"longanyang", "longanhuan"}:
        return "cosyvoice-v3-flash"
    return _env_str("TTS_GATEWAY_COSY_DEFAULT_MODEL", "cosyvoice-v3-flash")


def _cosy_audio_format(media_type: str) -> str:
    media = (media_type or "").strip().lower()
    if media in {"raw", "pcm"}:
        return "pcm"
    if media in {"wav", "wave"}:
        return "wav"
    return "mp3"


def _content_type_for_media(media_type: str) -> str:
    media = (media_type or "").strip().lower()
    if media in {"raw", "pcm"}:
        return "audio/pcm"
    if media in {"wav", "wave"}:
        return "audio/wav"
    return "audio/mpeg"


def _is_cosy_voice(voice_id: str) -> bool:
    voice = (voice_id or "").strip()
    if not voice:
        return False
    if voice in LOCAL_VOICES:
        return False
    if voice.startswith("long") or voice.startswith("loong"):
        return True
    return False


def _forward_local(payload: Dict[str, Any]) -> Dict[str, Any]:
    req = url_request.Request(
        LOCAL_TTS_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with url_request.urlopen(req, timeout=LOCAL_TTS_TIMEOUT_SEC) as resp:
            body = resp.read() or b""
            return {
                "ok": True,
                "status": int(resp.status),
                "audio": body,
                "content_type": str(resp.headers.get("content-type") or "audio/wav"),
                "route": "local",
                "voice": str(payload.get("voice_id") or ""),
                "model": "local_tts",
            }
    except url_error.HTTPError as exc:
        err_text = exc.read().decode("utf-8", "ignore")[:240]
        return {
            "ok": False,
            "status": int(getattr(exc, "code", 500) or 500),
            "error": f"local_tts_http_{getattr(exc, 'code', 500)}:{err_text}",
        }
    except Exception as exc:
        return {
            "ok": False,
            "status": 502,
            "error": f"local_tts_request_failed:{str(exc)[:200]}",
        }


def _synthesize_cosy(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not DASHSCOPE_READY or Request is None or websocket is None:
        return {"ok": False, "status": 500, "error": "dashscope_sdk_unavailable"}

    api_key = _env_str("DASHSCOPE_API_KEY") or _env_str("OPENAI_API_KEY")
    if not api_key:
        return {"ok": False, "status": 500, "error": "dashscope_api_key_missing"}

    text = str(payload.get("text") or "").strip()
    if not text:
        return {"ok": False, "status": 400, "error": "text_required"}

    voice = str(payload.get("voice_id") or "").strip()
    if not voice:
        return {"ok": False, "status": 400, "error": "voice_id_required"}

    model = _cosy_model_for_voice(voice)
    media_type = str(payload.get("media_type") or "wav").strip().lower()
    speed = payload.get("speed_factor", 1.0)
    try:
        speed_value = float(speed)
    except Exception:
        speed_value = 1.0
    speed_value = max(0.5, min(2.0, speed_value))

    ws_url = _env_str(
        "DASHSCOPE_WEBSOCKET_URL", "wss://dashscope.aliyuncs.com/api-ws/v1/inference"
    )
    connect_timeout = max(
        5.0, _env_float("TTS_GATEWAY_COSY_WS_CONNECT_TIMEOUT_SEC", 15.0)
    )
    recv_timeout = max(10.0, _env_float("TTS_GATEWAY_COSY_WS_RECV_TIMEOUT_SEC", 60.0))

    req = Request(
        apikey=api_key,
        model=model,
        voice=voice,
        format=_cosy_audio_format(media_type),
        sample_rate=22050,
        volume=50,
        speech_rate=speed_value,
        pitch_rate=1.0,
    )

    headers = req.getWebsocketHeaders(headers=None, workspace=None)
    ws = None
    try:
        ws = websocket.create_connection(
            ws_url, timeout=connect_timeout, header=headers
        )
        ws.settimeout(recv_timeout)
        ws.send(req.getStartRequest({"enable_ssml": True}))

        start_deadline = _env_float("TTS_GATEWAY_COSY_START_TIMEOUT_SEC", 20.0)
        started = False
        failed_message = ""
        deadline_ts = start_deadline + time.time()
        while time.time() < deadline_ts:
            msg = ws.recv()
            if isinstance(msg, (bytes, bytearray)):
                continue
            data = json.loads(msg)
            event = str((data.get("header") or {}).get("event") or "")
            if event == "task-started":
                started = True
                break
            if event == "task-failed":
                failed_message = msg
                break
        if not started:
            if failed_message:
                return {
                    "ok": False,
                    "status": 502,
                    "error": f"cosy_task_failed:{failed_message[:220]}",
                }
            return {"ok": False, "status": 504, "error": "cosy_start_timeout"}

        ws.send(req.getContinueRequest(text))
        ws.send(req.getFinishRequest())

        chunks = []
        while True:
            msg = ws.recv()
            if isinstance(msg, (bytes, bytearray)):
                chunks.append(bytes(msg))
                continue
            data = json.loads(msg)
            event = str((data.get("header") or {}).get("event") or "")
            if event == "task-failed":
                return {
                    "ok": False,
                    "status": 502,
                    "error": f"cosy_task_failed:{msg[:220]}",
                }
            if event == "task-finished":
                break

        audio_bytes = b"".join(chunks)
        if not audio_bytes:
            return {"ok": False, "status": 502, "error": "cosy_empty_audio"}
        return {
            "ok": True,
            "status": 200,
            "audio": audio_bytes,
            "content_type": _content_type_for_media(media_type),
            "route": "cosy",
            "voice": voice,
            "model": model,
        }
    except Exception as exc:
        return {"ok": False, "status": 502, "error": f"cosy_failed:{str(exc)[:240]}"}
    finally:
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass


def _json_bytes(payload: Dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "onlytrade-tts-gateway/1.0"

    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = _json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(
                200,
                {
                    "success": True,
                    "dashscope_ready": DASHSCOPE_READY,
                    "local_tts_url": LOCAL_TTS_URL,
                    "local_voices": sorted(LOCAL_VOICES),
                    "cosy_fallback_local_voice": COSY_FALLBACK_LOCAL_VOICE,
                },
            )
            return
        if self.path == "/voices":
            self._send_json(
                200,
                {
                    "success": True,
                    "local": sorted(LOCAL_VOICES),
                    "cosy_examples": [
                        "longfeifei_v3",
                        "longanhuan",
                        "longanwen_v3",
                        "longyan_v3",
                        "longwan_v3",
                        "longanli_v3",
                    ],
                },
            )
            return
        self._send_json(404, {"success": False, "error": "not_found"})

    def do_POST(self):
        if self.path != "/tts":
            self._send_json(404, {"success": False, "error": "not_found"})
            return

        try:
            length = int(self.headers.get("Content-Length") or "0")
        except Exception:
            length = 0
        raw = self.rfile.read(max(0, length)) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8", "ignore"))
            if not isinstance(payload, dict):
                raise ValueError("payload_not_object")
        except Exception:
            self._send_json(400, {"success": False, "error": "invalid_json"})
            return

        voice = str(payload.get("voice_id") or "").strip()
        if not voice:
            self._send_json(400, {"success": False, "error": "voice_id_required"})
            return

        if voice in LOCAL_VOICES:
            result = _forward_local(payload)
        elif _is_cosy_voice(voice):
            result = _synthesize_cosy(payload)
            if not result.get("ok") and COSY_FALLBACK_LOCAL_VOICE:
                fallback_payload = dict(payload)
                fallback_payload["voice_id"] = COSY_FALLBACK_LOCAL_VOICE
                fallback = _forward_local(fallback_payload)
                if fallback.get("ok"):
                    fallback["route"] = "cosy_fallback_local"
                    fallback["model"] = _cosy_model_for_voice(voice)
                    fallback["voice"] = COSY_FALLBACK_LOCAL_VOICE
                    result = fallback
        else:
            result = _forward_local(payload)

        if not result.get("ok"):
            self._send_json(
                int(result.get("status") or 502),
                {
                    "success": False,
                    "error": str(result.get("error") or "tts_failed"),
                    "voice_id": voice,
                },
            )
            return

        audio = bytes(result.get("audio") or b"")
        self.send_response(int(result.get("status") or 200))
        self.send_header("Content-Type", str(result.get("content_type") or "audio/wav"))
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("x-tts-gateway-route", str(result.get("route") or "unknown"))
        self.send_header("x-tts-gateway-voice", str(result.get("voice") or ""))
        self.send_header("x-tts-gateway-model", str(result.get("model") or ""))
        self.end_headers()
        self.wfile.write(audio)

    def log_message(self, format: str, *args: Any) -> None:
        msg = "%s - - [%s] %s\n" % (
            self.address_string(),
            self.log_date_time_string(),
            format % args,
        )
        print(msg, end="")


def main() -> int:
    try:
        server = ThreadingHTTPServer((TTS_GATEWAY_HOST, TTS_GATEWAY_PORT), Handler)
        print(
            json.dumps(
                {
                    "msg": "tts_gateway_listening",
                    "host": TTS_GATEWAY_HOST,
                    "port": TTS_GATEWAY_PORT,
                    "local_tts_url": LOCAL_TTS_URL,
                    "dashscope_ready": DASHSCOPE_READY,
                },
                ensure_ascii=False,
            )
        )
        server.serve_forever()
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception:
        print(traceback.format_exc())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
