import asyncio
import json
import os
import sys

try:
    import edge_tts
except ImportError as exc:
    raise SystemExit("Thiếu edge-tts. Chạy: python -m pip install -r packages/tts-engine/python/requirements.txt") from exc


async def main():
    with open(sys.argv[1], "r", encoding="utf-8") as source:
        request = json.load(source)
    output = request["output"]
    os.makedirs(os.path.dirname(output), exist_ok=True)
    communicate = edge_tts.Communicate(text=request["text"], voice=request["voice"], rate=request.get("rate", "+0%"))
    await communicate.save(output)
    if not os.path.isfile(output) or os.path.getsize(output) < 1024:
        raise RuntimeError("Edge TTS không tạo ra tệp âm thanh hợp lệ.")


asyncio.run(main())
