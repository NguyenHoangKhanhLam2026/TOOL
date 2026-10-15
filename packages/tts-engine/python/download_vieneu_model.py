import os
import shutil
from pathlib import Path


def main():
    from huggingface_hub import hf_hub_download, snapshot_download

    model_dir = Path(os.environ["VIENEU_MODEL_DIR"])
    codec_dir = model_dir / "codec"
    model_dir.mkdir(parents=True, exist_ok=True)
    codec_dir.mkdir(parents=True, exist_ok=True)

    print("Downloading VieNeu-TTS v3 Turbo FP32 ONNX files...", flush=True)
    snapshot_download(
        repo_id="pnnbao-ump/VieNeu-TTS-v3-Turbo",
        local_dir=str(model_dir),
        allow_patterns=["onnx_update/*"],
    )

    print("Downloading the MOSS ONNX codec...", flush=True)
    codec_files = (
        "moss_audio_tokenizer_decode_full.onnx",
        "moss_audio_tokenizer_decode_shared.data",
        "moss_audio_tokenizer_decode_step.onnx",
        "codec_browser_onnx_meta.json",
        "moss_audio_tokenizer_encode.onnx",
        "moss_audio_tokenizer_encode.data",
    )
    for name in codec_files:
        try:
            cached_file = hf_hub_download("OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX", name)
        except Exception:
            if name.endswith(".json"):
                continue
            raise
        shutil.copy2(cached_file, codec_dir / name)

    needed = [
        model_dir / "onnx_update" / name
        for name in (
            "vieneu_prefill.onnx",
            "vieneu_decode_step.onnx",
            "vieneu_acoustic_cached.onnx",
            "vieneu_backbone_shared.data",
            "vieneu_v3_heads.npz",
            "config.json",
            "tokenizer.json",
        )
    ]
    needed.extend(codec_dir / name for name in (
        "moss_audio_tokenizer_decode_full.onnx",
        "moss_audio_tokenizer_decode_shared.data",
        "moss_audio_tokenizer_decode_step.onnx",
        "moss_audio_tokenizer_encode.onnx",
        "moss_audio_tokenizer_encode.data",
    ))
    missing = [str(file) for file in needed if not file.is_file() or file.stat().st_size == 0]
    if missing:
        raise RuntimeError("Model download finished but files are missing: " + ", ".join(missing))
    print("VieNeu-TTS model files are ready on disk; no model was loaded into RAM.", flush=True)


if __name__ == "__main__":
    main()
