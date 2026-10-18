import json
import os
import re
import sys
import traceback
import inspect

import numpy as np
import soundfile as sf
import torch


def emit(event, value):
    print(f"{event}:{json.dumps(value, ensure_ascii=False)}", file=sys.stderr, flush=True)


def enable_cpu_file_backed_weights():
    """Load CPU checkpoints from disk-backed mappings to avoid a second full copy."""
    if torch.cuda.is_available():
        return

    original_torch_load = torch.load
    supports_mmap = "mmap" in inspect.signature(original_torch_load).parameters

    if supports_mmap:
        def torch_load_mmap(file, *args, **kwargs):
            map_location = kwargs.get("map_location", args[0] if args else None)
            is_cpu = map_location is None or str(map_location) == "cpu"
            is_checkpoint = (
                isinstance(file, (str, os.PathLike))
                and os.path.basename(os.fspath(file)).lower() in {"llm.pt", "flow.pt", "hift.pt"}
            )
            if is_cpu and is_checkpoint:
                kwargs.setdefault("mmap", True)
            return original_torch_load(file, *args, **kwargs)

        torch.load = torch_load_mmap

    original_load_state_dict = torch.nn.Module.load_state_dict
    supports_assign = "assign" in inspect.signature(original_load_state_dict).parameters
    if supports_assign:
        def load_state_dict_file_backed(module, state_dict, *args, **kwargs):
            positional_assign = len(args) >= 2
            if not positional_assign and "assign" not in kwargs:
                try:
                    parameters = module.parameters()
                    first_parameter = next(parameters, None)
                    if first_parameter is None or first_parameter.device.type == "cpu":
                        kwargs["assign"] = True
                except (AttributeError, StopIteration):
                    pass
            return original_load_state_dict(module, state_dict, *args, **kwargs)

        torch.nn.Module.load_state_dict = load_state_dict_file_backed


def concise_instruction(value):
    """Map verbose script notes to short CosyVoice 3 control prompts.

    Long free-form directions were being spoken aloud by the local model.
    Short, standard prompts keep the target Chinese text as the spoken content.
    """
    source = str(value or "")
    emphasized = re.search(r'短语“([^”]{1,12})”', source)
    is_repeat = "这是教学复读" in source
    is_question = "问句" in source or "疑问" in source
    is_exclamation = "感叹语气" in source or "感叹句" in source
    is_practice = "像带领观众跟读一样" in source or "重点短语" in source

    if is_practice:
        style = "请清楚、连贯地读出词语。"
    elif is_question:
        style = "请稍慢、清晰地用疑问语气朗读。" if is_repeat else "请用自然疑问语气朗读。"
    elif is_exclamation:
        style = "请稍慢、清晰地用感叹语气朗读。" if is_repeat else "请用自然、有活力的语气朗读。"
    elif is_repeat:
        style = "请稍慢、清晰地朗读。"
    elif emphasized:
        style = f'请自然朗读，稍强调“{emphasized.group(1)}”。'
    else:
        style = "请用标准普通话，自然、亲切地朗读。"

    return f"You are a helpful assistant. {style}<|endofprompt|>"


def main():
    with open(sys.argv[1], "r", encoding="utf-8") as source:
        request = json.load(source)

    try:
        enable_cpu_file_backed_weights()
        source_dir = os.path.abspath(request["sourceDir"])
        sys.path.insert(0, os.path.join(source_dir, "third_party", "Matcha-TTS"))
        sys.path.insert(0, source_dir)
        from cosyvoice.cli.cosyvoice import AutoModel

        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
        model = AutoModel(model_dir=request["modelDir"])
        reference_text = request["referenceText"].strip()
        reference_path = request["referencePath"]
        if not reference_text or not os.path.isfile(reference_path):
            raise ValueError("CosyVoice 3 cần tệp WAV mẫu và bản chép chính xác của nội dung trong mẫu.")
        if not reference_text.startswith("You are a helpful assistant.<|endofprompt|>"):
            reference_text = "You are a helpful assistant.<|endofprompt|>" + reference_text

        items = request.get("items") or [request]
        for index, item in enumerate(items, start=1):
            chunks = []
            speed = 1.0
            instruction = concise_instruction(item.get("instruction"))
            synthesis = model.inference_instruct2(
                item["text"], instruction, reference_path, stream=False, speed=speed
            ) if instruction else model.inference_zero_shot(
                item["text"], reference_text, reference_path, stream=False, speed=speed
            )
            for result in synthesis:
                chunks.append(result["tts_speech"].detach().cpu().numpy().reshape(-1))
            if not chunks:
                raise RuntimeError("CosyVoice 3 không trả về audio.")
            audio = np.concatenate(chunks)
            if audio.size == 0 or not np.isfinite(audio).all():
                raise RuntimeError("CosyVoice 3 tạo audio rỗng hoặc không hợp lệ.")
            os.makedirs(os.path.dirname(item["outputPath"]), exist_ok=True)
            sf.write(item["outputPath"], audio, int(model.sample_rate), subtype="PCM_16")
            emit("COSYVOICE_PROGRESS", {"index": index, "total": len(items), "segmentId": item.get("segmentId")})
        emit("COSYVOICE_COMPLETE", {"count": len(items)})
    except Exception as error:
        emit("COSYVOICE_ERROR", {"message": str(error), "trace": traceback.format_exc()[-4000:]})
        raise


if __name__ == "__main__":
    main()
