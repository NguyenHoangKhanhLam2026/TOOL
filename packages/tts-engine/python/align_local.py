import json
import math
import os
import sys
import gc
import numpy as np

MINIMUM_AVAILABLE_RAM_MB = 2560
MINIMUM_REMAINING_RAM_MB = 1024


def available_memory_bytes():
    if os.name == "nt":
        import ctypes

        class MemoryStatusEx(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatusEx()
        status.dwLength = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.ullAvailPhys)
        return None
    try:
        return int(os.sysconf("SC_AVPHYS_PAGES") * os.sysconf("SC_PAGE_SIZE"))
    except (AttributeError, OSError, ValueError):
        return None


def write_result(path, result):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False)


def main():
    with open(sys.argv[1], "r", encoding="utf-8") as source:
        request = json.load(source)

    output_path = request["outputPath"]
    items = request.get("items") or [request]
    try:
        import stable_whisper
    except ImportError:
        write_result(output_path, {
            "status": "unavailable",
            "results": [{
                "segmentId": item.get("segmentId"),
                "status": "unavailable",
                "source": None,
                "wordBoundaries": [],
                "warning": "stable-ts chưa được cài; không có forced aligner local để căn chỉnh.",
            } for item in items],
        })
        return

    model_name = os.environ.get("AERS_ALIGNMENT_MODEL", "small")
    download_root = os.environ.get("AERS_ALIGNMENT_MODEL_DIR")
    options = {"device": "cpu", "dq": True}
    if download_root:
        options["download_root"] = download_root
    available = available_memory_bytes()
    minimum = int(os.environ.get("AERS_ALIGNMENT_MINIMUM_AVAILABLE_MB", MINIMUM_AVAILABLE_RAM_MB)) * 1024 * 1024
    if available is not None and available < minimum:
        available_mb = round(available / (1024 * 1024), 1)
        warning = (
            f"CÄƒn highlight bá»‹ bá» qua Ä‘á»ƒ báº£o vá»‡ RAM: cÃ²n {available_mb} MB, "
            f"cáº§n {minimum // (1024 * 1024)} MB trÆ°á»›c khi náº¡p whisper."
        )
        write_result(output_path, {
            "status": "unavailable",
            "results": [{
                "segmentId": item.get("segmentId"), "status": "unavailable", "source": None,
                "wordBoundaries": [], "warning": warning,
            } for item in items],
        })
        return
    try:
        import torch
        torch.set_num_threads(4)
        # Load one local model and reuse it for every unaligned clip in this batch.
        model = stable_whisper.load_model(model_name, **options)
    except Exception as exc:
        warning = f"stable-ts model could not be loaded: {str(exc)[:400]}"
        write_result(output_path, {
            "status": "unavailable",
            "results": [{
                "segmentId": item.get("segmentId"),
                "status": "unavailable",
                "source": None,
                "wordBoundaries": [],
                "warning": warning,
            } for item in items],
        })
        return

    remaining = available_memory_bytes()
    minimum_remaining = int(os.environ.get("AERS_ALIGNMENT_MINIMUM_REMAINING_MB", MINIMUM_REMAINING_RAM_MB)) * 1024 * 1024
    if remaining is not None and remaining < minimum_remaining:
        remaining_mb = round(remaining / (1024 * 1024), 1)
        del model
        gc.collect()
        warning = (
            f"CÄƒn highlight bá»‹ bá» qua Ä‘á»ƒ báº£o vá»‡ RAM sau khi náº¡p whisper: cÃ²n {remaining_mb} MB, "
            f"cáº§n giá»¯ láº¡i {minimum_remaining // (1024 * 1024)} MB."
        )
        write_result(output_path, {
            "status": "unavailable",
            "results": [{
                "segmentId": item.get("segmentId"), "status": "unavailable", "source": None,
                "wordBoundaries": [], "warning": warning,
            } for item in items],
        })
        return

    results = []
    from stable_whisper.audio import load_audio
    leading_pad_seconds = max(0.0, min(0.75, float(os.environ.get("AERS_ALIGNMENT_LEADING_PAD_SECONDS", "0.25"))))
    leading_pad_samples = round(leading_pad_seconds * 16000)
    for item in items:
        try:
            language = str(item.get("language") or "en").split("-", 1)[0].lower()
            if language not in ("en", "vi"):
                language = "en"
            waveform = load_audio(item["audioPath"], sr=16000, verbose=None)
            if leading_pad_samples:
                waveform = np.pad(waveform, (leading_pad_samples, 0), mode="constant")
            aligned = model.align(
                waveform,
                item["text"],
                language=language,
                verbose=None,
                # Speech is already segmented by the app. Letting stable-ts
                # split again on punctuation can break abbreviations such as
                # a.m. and cause the opening word to be dropped.
                presplit=False,
                remove_instant_words=False,
                failure_threshold=0.2,
            )
            boundaries = []
            for segment in getattr(aligned, "segments", []) or []:
                for word in getattr(segment, "words", []) or []:
                    start = float(getattr(word, "start", float("nan"))) - leading_pad_seconds
                    end = float(getattr(word, "end", float("nan"))) - leading_pad_seconds
                    start = max(0.0, start)
                    end = max(start, end)
                    text = str(getattr(word, "word", "")).strip()
                    if text and math.isfinite(start) and math.isfinite(end) and end > start:
                        boundaries.append({"text": text, "startSeconds": start, "endSeconds": end})

            if not boundaries:
                raise RuntimeError("stable-ts không trả về mốc từ hợp lệ.")
            results.append({
                "segmentId": item.get("segmentId"),
                "status": "aligned",
                "source": "stable-ts-local",
                "wordBoundaries": boundaries,
                "warning": None,
            })
        except Exception as exc:
            results.append({
                "segmentId": item.get("segmentId"),
                "status": "failed",
                "source": None,
                "wordBoundaries": [],
                "warning": f"stable-ts local alignment failed: {str(exc)[:400]}",
            })

    write_result(output_path, {"status": "complete", "results": results})


if __name__ == "__main__":
    main()
