import asyncio
import json
import os
import sys

try:
    import edge_tts
except ImportError as exc:
    raise SystemExit("Thiếu edge-tts. Chạy: python -m pip install -r packages/tts-engine/python/requirements.txt") from exc


async def stream_word_boundary_audio(request, output):
    word_boundaries = []
    for attempt in range(1, 4):
        try:
            os.remove(output)
        except FileNotFoundError:
            pass
        word_boundaries.clear()
        communicate = edge_tts.Communicate(
            text=request["text"],
            voice=request["voice"],
            rate=request.get("rate", "+0%"),
            boundary="WordBoundary",
        )
        try:
            with open(output, "wb") as audio_file:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_file.write(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        word_boundaries.append({
                            "offsetTicks": int(chunk["offset"]),
                            "durationTicks": int(chunk["duration"]),
                            "text": str(chunk["text"]),
                        })
            return word_boundaries
        except Exception as exc:
            if "no audio was received" not in str(exc).lower() or attempt == 3:
                raise
            await asyncio.sleep(attempt * 0.8)


async def main():
    with open(sys.argv[1], "r", encoding="utf-8") as source:
        request = json.load(source)
    output = request["output"]
    os.makedirs(os.path.dirname(output), exist_ok=True)
    word_boundaries = []
    warning = None

    if request.get("wordTimingsPath"):
        try:
            word_boundaries = await stream_word_boundary_audio(request, output)
        except Exception as exc:
            # A service/package response without WordBoundary metadata is not a
            # synthesis failure. Retry audio-only and mark the clip unaligned;
            # never invent word timestamps from text length or clip duration.
            message = str(exc)
            lower_message = message.lower()
            if "wordboundary" not in lower_message and "boundary" not in lower_message and "metadata" not in lower_message and "no audio was received" not in lower_message:
                raise
            try:
                os.remove(output)
            except FileNotFoundError:
                pass
            word_boundaries.clear()
            communicate = edge_tts.Communicate(
                text=request["text"],
                voice=request["voice"],
                rate=request.get("rate", "+0%"),
            )
            try:
                await communicate.save(output)
            except Exception as fallback_exc:
                raise RuntimeError(
                    f"WordBoundary synthesis failed ({message[:240]}); "
                    f"audio-only retry failed: {fallback_exc}"
                ) from fallback_exc
            warning = f"WordBoundary metadata was unavailable; audio-only retry succeeded: {message[:240]}"
    else:
        communicate = edge_tts.Communicate(
            text=request["text"],
            voice=request["voice"],
            rate=request.get("rate", "+0%"),
        )
        await communicate.save(output)

    if not os.path.isfile(output) or os.path.getsize(output) < 1024:
        raise RuntimeError("Edge TTS không tạo ra tệp âm thanh hợp lệ.")

    if request.get("wordTimingsPath"):
        with open(request["wordTimingsPath"], "w", encoding="utf-8") as timings_file:
            json.dump({"wordBoundaries": word_boundaries, "warning": warning}, timings_file, ensure_ascii=False)


asyncio.run(main())
