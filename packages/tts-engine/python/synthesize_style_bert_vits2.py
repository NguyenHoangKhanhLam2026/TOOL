import json
import os
import sys
import traceback

import numpy as np
import soundfile as sf
import torch


def emit(event, value):
    print(f"{event}:{json.dumps(value, ensure_ascii=False)}", file=sys.stderr, flush=True)


def main():
    with open(sys.argv[1], "r", encoding="utf-8") as source:
        request = json.load(source)

    try:
        from pathlib import Path
        from style_bert_vits2.constants import Languages
        from style_bert_vits2.nlp import bert_models
        from style_bert_vits2.tts_model import TTSModel

        # The cached DeBERTa config advertises float16 even though its
        # checkpoint and the SBV2 acoustic checkpoints are float32. SBV2 feeds
        # DeBERTa features directly into float32 projection layers, so keep the
        # feature extractor on the same dtype to avoid Half/Float conv errors.
        japanese_bert = bert_models.load_model(
            Languages.JP, "ku-nlp/deberta-v2-large-japanese-char-wwm"
        )
        japanese_bert.to(device="cpu", dtype=torch.float32)
        bert_models.load_tokenizer(Languages.JP, "ku-nlp/deberta-v2-large-japanese-char-wwm")
        model = TTSModel(
            model_path=Path(request["modelPath"]),
            config_path=Path(request["configPath"]),
            style_vec_path=Path(request["stylePath"]),
            device="cpu",
        )
        style = request.get("style") or "Neutral"
        if style not in model.style2id:
            raise ValueError(f"Style-Bert-VITS2 style is unavailable: {style}")

        items = request.get("items") or [request]
        for index, item in enumerate(items, start=1):
            sample_rate, audio = model.infer(
                text=item["text"],
                language=Languages.JP,
                speaker_id=0,
                style=style,
                length=1.0 / max(0.5, min(1.5, float(item.get("speed") or 1.0))),
            )
            audio = np.asarray(audio)
            if audio.size == 0 or not np.isfinite(audio).all():
                raise RuntimeError("Style-Bert-VITS2 produced empty or invalid audio")
            os.makedirs(os.path.dirname(item["outputPath"]), exist_ok=True)
            sf.write(item["outputPath"], audio, int(sample_rate), subtype="PCM_16")
            emit("SBV2_PROGRESS", {"index": index, "total": len(items), "segmentId": item.get("segmentId")})
        emit("SBV2_COMPLETE", {"count": len(items)})
    except Exception as error:
        emit("SBV2_ERROR", {"message": str(error), "trace": traceback.format_exc()[-4000:]})
        raise


if __name__ == "__main__":
    main()
