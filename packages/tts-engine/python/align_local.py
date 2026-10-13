import json
import math
import os
import sys


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

    model_name = os.environ.get("AERS_ALIGNMENT_MODEL", "base")
    download_root = os.environ.get("AERS_ALIGNMENT_MODEL_DIR")
    options = {"device": "cpu", "dq": True}
    if download_root:
        options["download_root"] = download_root
    try:
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

    results = []
    for item in items:
        try:
            language = str(item.get("language") or "en").split("-", 1)[0].lower()
            if language not in ("en", "vi"):
                language = "en"
            aligned = model.align(
                item["audioPath"],
                item["text"],
                language=language,
                verbose=None,
                remove_instant_words=True,
                failure_threshold=0.2,
            )
            boundaries = []
            for segment in getattr(aligned, "segments", []) or []:
                for word in getattr(segment, "words", []) or []:
                    start = float(getattr(word, "start", float("nan")))
                    end = float(getattr(word, "end", float("nan")))
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
