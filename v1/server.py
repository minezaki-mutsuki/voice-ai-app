from __future__ import annotations

import asyncio
import base64
import json
import os
from pathlib import Path
from typing import Literal
from urllib.parse import quote

import httpx
import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = FastAPI(title="Connect Four Voice AI", version="1.0.0")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


def setting(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def azure_configured() -> bool:
    return all(
        (
            setting("AZURE_OPENAI_ENDPOINT"),
            setting("AZURE_OPENAI_API_KEY"),
            setting("AZURE_CHAT_DEPLOYMENT"),
            setting("AZURE_REALTIME_STT_DEPLOYMENT"),
        )
    )


def endpoint_base() -> str:
    return setting("AZURE_OPENAI_ENDPOINT").rstrip("/")


@app.get("/")
async def root():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/index.html")
async def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/health")
async def health():
    configured = azure_configured()
    return {
        "provider_default": setting("AI_PROVIDER", "azure").lower(),
        "azure_configured": configured,
        "chat_deployment": setting("AZURE_CHAT_DEPLOYMENT", "gpt-6-luna"),
        "realtime_deployment": setting("AZURE_REALTIME_STT_DEPLOYMENT", "gpt-realtime-whisper"),
    }


@app.get("/api/game-state")
async def mock_game_state():
    path = BASE_DIR / "mock" / "game-state.json"
    return json.loads(path.read_text(encoding="utf-8"))


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    mode: Literal["mock", "azure"] = "mock"
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)
    system_prompt: str = Field(default="", max_length=4000)
    emotion: str = Field(default="冷静", max_length=80)
    bluffing: bool = False
    personality: Literal["kind", "normal", "cheeky"] = "normal"


def mock_reply(request: ChatRequest) -> str:
    last_user = next((m.content for m in reversed(request.messages) if m.role == "user"), "")
    name = {"kind": "やさしいAI", "normal": "AI", "cheeky": "生意気AI"}[request.personality]
    mood = request.emotion
    if request.bluffing:
        opening = "ふふっ、もちろん想定どおりですよ。"
    elif mood == "自信":
        opening = "ふふっ、こちらの流れですね。"
    elif mood == "焦り":
        opening = "ちょっと待ってください、ここは慎重にいきます。"
    elif mood == "喜び":
        opening = "やりました！いい勝負でしたね。"
    elif mood == "悔しさ":
        opening = "今日はちょっと調子が悪かっただけです。"
    else:
        opening = "なかなかいい勝負ですね。"
    if last_user:
        return name + "です。" + opening + " 「" + last_user[:120] + "」というお話ですね。ゲームの盤面を見ながら、次の手も考えてみます。"
    return name + "です。" + opening


def sse(payload: dict, event: str | None = None) -> str:
    prefix = "event: " + event + "\n" if event else ""
    return prefix + "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"


async def mock_stream(request: ChatRequest):
    reply = mock_reply(request)
    # Short chunks make the Mock mode visibly stream just like the Azure mode.
    for start in range(0, len(reply), 8):
        yield sse({"delta": reply[start : start + 8]})
        await asyncio.sleep(0.035)
    yield sse({"done": True})


async def azure_stream(request: ChatRequest):
    if not azure_configured():
        yield sse({"message": "Azure設定が不足しています。.envのAPIキーとDeployment名を確認してください。"}, "error")
        return

    messages = [{"role": "system", "content": request.system_prompt or "日本語で自然に返答してください。"}]
    messages.extend({"role": m.role, "content": m.content} for m in request.messages[-30:])
    payload = {
        "model": setting("AZURE_CHAT_DEPLOYMENT"),
        "messages": messages,
        "stream": True,
    }
    headers = {"api-key": setting("AZURE_OPENAI_API_KEY"), "content-type": "application/json"}
    url = endpoint_base() + "/openai/v1/chat/completions"

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0)) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", errors="replace")
                    api_message = body[:1200]
                    secret = setting("AZURE_OPENAI_API_KEY")
                    if secret:
                        api_message = api_message.replace(secret, "[REDACTED]")
                    yield sse({"message": "Azure APIエラー (" + str(response.status_code) + "): " + api_message}, "error")
                    return
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        item = json.loads(data)
                        delta = item.get("choices", [{}])[0].get("delta", {}).get("content")
                        if delta:
                            yield sse({"delta": delta})
                    except (json.JSONDecodeError, IndexError, AttributeError, TypeError):
                        continue
        yield sse({"done": True})
    except httpx.TimeoutException:
        yield sse({"message": "Azureへの接続がタイムアウトしました。Endpointとネットワークを確認してください。"}, "error")
    except httpx.HTTPError as exc:
        yield sse({"message": "AzureへのHTTP接続に失敗しました: " + str(exc)[:500]}, "error")
    except Exception as exc:
        yield sse({"message": "チャット処理に失敗しました: " + str(exc)[:500]}, "error")


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    generator = mock_stream(request) if request.mode == "mock" else azure_stream(request)
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def transcription_session_update() -> str:
    deployment = setting("AZURE_REALTIME_STT_DEPLOYMENT", "gpt-realtime-whisper")
    event = {
        "type": "session.update",
        "session": {
            "type": "transcription",
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": 24000},
                    "transcription": {"model": deployment, "language": "ja"},
                }
            },
        },
    }
    # turn_detection is intentionally omitted. The browser decides when to commit.
    return json.dumps(event)


async def relay_browser_audio(browser: WebSocket, upstream):
    while True:
        incoming = await browser.receive()
        if incoming["type"] == "websocket.disconnect":
            return
        if incoming.get("bytes") is not None:
            encoded = base64.b64encode(incoming["bytes"]).decode("ascii")
            await upstream.send(json.dumps({"type": "input_audio_buffer.append", "audio": encoded}))
        elif incoming.get("text"):
            try:
                command = json.loads(incoming["text"])
            except json.JSONDecodeError:
                continue
            if command.get("type") == "commit":
                await upstream.send(json.dumps({"type": "input_audio_buffer.commit"}))
            elif command.get("type") == "ping":
                await browser.send_json({"type": "pong"})


async def relay_azure_events(browser: WebSocket, upstream):
    async for raw in upstream:
        try:
            event = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        kind = event.get("type", "")
        if kind == "session.updated":
            await browser.send_json({"type": "ready", "mode": "azure"})
        elif kind == "error":
            error = event.get("error", {})
            message = error.get("message", "Realtime APIからエラーが返されました。") if isinstance(error, dict) else str(error)
            await browser.send_json({"type": "error", "message": message})
        elif kind in (
            "conversation.item.input_audio_transcription.delta",
            "conversation.item.input_audio_transcription.completed",
            "conversation.item.input_audio_transcription.failed",
        ):
            await browser.send_json(event)


@app.websocket("/ws/transcription")
async def transcription_socket(browser: WebSocket):
    await browser.accept()
    mode = browser.query_params.get("mode", "mock").lower()
    if mode != "azure":
        await browser.send_json({"type": "ready", "mode": "mock"})
        try:
            while True:
                incoming = await browser.receive()
                if incoming["type"] == "websocket.disconnect":
                    return
                if incoming.get("text"):
                    try:
                        command = json.loads(incoming["text"])
                    except json.JSONDecodeError:
                        continue
                    if command.get("type") == "commit":
                        await browser.send_json(
                            {
                                "type": "conversation.item.input_audio_transcription.completed",
                                "transcript": "（Mock音声認識）音声入力を確認しました。テキスト欄からも会話できます。",
                            }
                        )
        except WebSocketDisconnect:
            return
        return

    if not azure_configured():
        await browser.send_json(
            {"type": "error", "message": "Azure設定が不足しています。.envのAPIキーとDeployment名を確認してください。"}
        )
        await browser.close(code=1011)
        return

    endpoint = endpoint_base()
    if endpoint.startswith("https://"):
        ws_endpoint = "wss://" + endpoint[len("https://") :]
    elif endpoint.startswith("http://"):
        ws_endpoint = "ws://" + endpoint[len("http://") :]
    else:
        ws_endpoint = "wss://" + endpoint
    upstream_url = ws_endpoint.rstrip("/") + "/openai/v1/realtime?intent=transcription"
    headers = {"api-key": setting("AZURE_OPENAI_API_KEY")}

    try:
        async with websockets.connect(
            upstream_url,
            additional_headers=headers,
            open_timeout=15,
            ping_interval=20,
            max_size=8 * 1024 * 1024,
        ) as upstream:
            await upstream.send(transcription_session_update())
            await browser.send_json({"type": "connecting", "mode": "azure"})
            send_task = asyncio.create_task(relay_browser_audio(browser, upstream))
            receive_task = asyncio.create_task(relay_azure_events(browser, upstream))
            done, pending = await asyncio.wait(
                {send_task, receive_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                exception = task.exception()
                if exception:
                    raise exception
    except WebSocketDisconnect:
        return
    except Exception as exc:
        message = "Azure Realtime接続に失敗しました。APIキー、Deployment名、リソース対応状況を確認してください。"
        # Keep secrets and raw request headers out of the browser.
        await browser.send_json({"type": "error", "message": message, "detail": str(exc)[:350]})
        try:
            await browser.close(code=1011)
        except Exception:
            pass
