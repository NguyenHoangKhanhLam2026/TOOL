import gc
import json
import os
import sys
from pathlib import Path


def emit(event, payload):
    print(f"SUPERTONIC_{event}:" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")), file=sys.stderr, flush=True)


def main():
    if len(sys.argv) != 2:
        raise ValueError("Supertonic worker expects one request file.")
    with open(sys.argv[1], "r", encoding="utf-8") as request_file:
        request = json.load(request_file)
    items = request.get("items") or []
    if not items:
        return

    from supertonic import TTS

    model_dir = str(request["modelDir"])
    engine = TTS(model="supertonic-3", model_dir=model_dir, auto_download=False,
                 intra_op_num_threads=max(1, min(8, int(request.get("threads", 4)))))
    emit("MEMORY", {"phase": "model-loaded", "model": "Supertonic 3", "segmentCount": len(items), "device": "CPU"})
    try:
        for index, item in enumerate(items, start=1):
            voice = str(item.get("voice", "F1"))
            if voice not in {"F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"}:
                raise ValueError(f"Unsupported Supertonic Korean voice: {voice}")
            text = str(item.get("text", "")).strip()
            if not text:
                raise ValueError(f"Empty Korean text at segment {index}.")
            output = Path(item["outputPath"])
            output.parent.mkdir(parents=True, exist_ok=True)
            style = engine.get_voice_style(voice)
            wav, _duration = engine.synthesize(
                text,
                voice_style=style,
                speed=max(0.7, min(1.4, float(item.get("speed", 1.0)))),
                lang="ko",
            )
            engine.save_audio(wav, str(output))
            timing_path = item.get("timingPath")
            if timing_path:
                timing = Path(timing_path)
                timing.parent.mkdir(parents=True, exist_ok=True)
                timing.write_text(json.dumps({
                    "provider": "supertonic-3-ko",
                    "source": None,
                    "wordBoundaries": [],
                    "warning": "Supertonic 3 does not return word-level timings.",
                }, ensure_ascii=False), encoding="utf-8")
            if not output.is_file() or output.stat().st_size < 1024:
                raise RuntimeError(f"Supertonic produced an invalid WAV at segment {index}.")
            emit("PROGRESS", {"index": index, "total": len(items), "segmentId": item.get("segmentId")})
    finally:
        del engine
        gc.collect()
        emit("MEMORY", {"phase": "model-released", "device": "CPU"})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("ERROR", {"message": str(error)})
        print(f"Supertonic Korean TTS failed: {error}", file=sys.stderr, flush=True)
        raise
