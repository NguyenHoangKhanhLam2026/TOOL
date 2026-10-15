import ctypes
import gc
import json
import os
import sys
import time
from contextlib import contextmanager


MINIMUM_AVAILABLE_RAM_MB = 2560
MINIMUM_REMAINING_RAM_MB = 1024
BACKBONE_FILES = (
    "vieneu_prefill.onnx",
    "vieneu_decode_step.onnx",
    "vieneu_acoustic_cached.onnx",
    "vieneu_backbone_shared.data",
    "vieneu_v3_heads.npz",
    "config.json",
    "tokenizer.json",
)
CODEC_FILES = (
    "moss_audio_tokenizer_decode_full.onnx",
    "moss_audio_tokenizer_decode_shared.data",
    "moss_audio_tokenizer_decode_step.onnx",
    "moss_audio_tokenizer_encode.onnx",
    "moss_audio_tokenizer_encode.data",
)


def available_memory_bytes():
    if os.name == "nt":
        class MemoryStatus(ctypes.Structure):
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

        status = MemoryStatus()
        status.dwLength = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.ullAvailPhys)
    try:
        return int(os.sysconf("SC_AVPHYS_PAGES") * os.sysconf("SC_PAGE_SIZE"))
    except (AttributeError, OSError, ValueError):
        return None


def process_rss_bytes():
    if os.name == "nt":
        from ctypes import wintypes

        class ProcessMemoryCounters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        get_current_process = kernel32.GetCurrentProcess
        get_current_process.restype = wintypes.HANDLE
        get_process_memory_info = kernel32.K32GetProcessMemoryInfo
        get_process_memory_info.argtypes = (
            wintypes.HANDLE,
            ctypes.POINTER(ProcessMemoryCounters),
            wintypes.DWORD,
        )
        get_process_memory_info.restype = wintypes.BOOL
        if get_process_memory_info(get_current_process(), ctypes.byref(counters), counters.cb):
            return int(counters.WorkingSetSize)
    try:
        with open("/proc/self/status", "r", encoding="ascii") as status_file:
            for line in status_file:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


def emit_memory(phase, **extra):
    available = available_memory_bytes()
    rss = process_rss_bytes()
    payload = {
        "event": "memory",
        "provider": "vieneu-v3-turbo-onnx-fp32",
        "phase": phase,
        "availableRamMb": round(available / (1024 * 1024), 1) if available is not None else None,
        "processRssMb": round(rss / (1024 * 1024), 1) if rss is not None else None,
        **extra,
    }
    print("VIENEU_MEMORY:" + json.dumps(payload, separators=(",", ":")), file=sys.stderr, flush=True)


@contextmanager
def exclusive_model_lock(lock_path, timeout_seconds=1800):
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    lock_file = open(lock_path, "a+b")
    try:
        lock_file.seek(0, os.SEEK_END)
        if lock_file.tell() == 0:
            lock_file.write(b"\0")
            lock_file.flush()
        started = time.monotonic()
        if os.name == "nt":
            import msvcrt

            while True:
                try:
                    lock_file.seek(0)
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() - started >= timeout_seconds:
                        raise TimeoutError("Hết thời gian chờ model VieNeu đang được một tác vụ khác sử dụng.")
                    time.sleep(0.5)
            try:
                yield
            finally:
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            while True:
                try:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() - started >= timeout_seconds:
                        raise TimeoutError("Hết thời gian chờ model VieNeu đang được một tác vụ khác sử dụng.")
                    time.sleep(0.5)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    finally:
        lock_file.close()


def check_model_files(request):
    onnx_dir = request["onnxDir"]
    codec_dir = request["codecDir"]
    required = [(onnx_dir, name) for name in BACKBONE_FILES]
    required.extend((codec_dir, name) for name in CODEC_FILES)
    missing = [
        os.path.join(directory, name)
        for directory, name in required
        if not os.path.isfile(os.path.join(directory, name))
        or os.path.getsize(os.path.join(directory, name)) == 0
    ]
    if missing:
        raise RuntimeError(
            "Thiếu dữ liệu VieNeu-TTS local. Chạy `npm run setup:vieneu` để tải model về ổ đĩa. "
            "Các tệp còn thiếu: " + ", ".join(missing[:4])
        )


def main():
    with open(sys.argv[1], "r", encoding="utf-8") as request_file:
        request = json.load(request_file)
    items = request.get("items") or []
    if not items:
        return

    minimum_available_ram_mb = int(request.get("minimumAvailableRamMb", MINIMUM_AVAILABLE_RAM_MB))
    minimum_remaining_ram_mb = int(request.get("minimumRemainingRamMb", MINIMUM_REMAINING_RAM_MB))
    check_model_files(request)
    emit_memory("waiting-for-model-lock", segmentCount=len(items))
    with exclusive_model_lock(request["lockPath"]):
        available = available_memory_bytes()
        emit_memory("before-load", minimumAvailableRamMb=minimum_available_ram_mb)
        minimum = minimum_available_ram_mb * 1024 * 1024
        if available is not None and available < minimum:
            available_mb = round(available / (1024 * 1024), 1)
            raise MemoryError(
                f"VieNeu-TTS chưa được nạp vì RAM trống còn {available_mb} MB; "
                f"cần tối thiểu {minimum_available_ram_mb} MB để tránh làm máy thiếu bộ nhớ."
            )

        engine = None
        try:
            from vieneu import Vieneu
            import onnxruntime as ort
            import soundfile as sf

            if "CPUExecutionProvider" not in ort.get_available_providers():
                raise RuntimeError("ONNX Runtime chưa có CPUExecutionProvider cho VieNeu-TTS.")

            engine = Vieneu(
                mode="v3turbo",
                backbone_repo=request["modelDir"],
                backend="onnx",
                precision="fp32",
                onnx_dir=request["onnxDir"],
                codec_dir=request["codecDir"],
                threads=4,
                max_batch_size=1,
            )
            emit_memory("model-loaded", sampleRate=int(engine.sample_rate), precision="fp32")
            available_after_load = available_memory_bytes()
            if available_after_load is not None and available_after_load < minimum_remaining_ram_mb * 1024 * 1024:
                available_mb = round(available_after_load / (1024 * 1024), 1)
                raise MemoryError(
                    f"VieNeu đã nạp nhưng RAM trống còn {available_mb} MB, dưới mức dự trữ "
                    f"{minimum_remaining_ram_mb} MB; dừng tạo giọng và giải phóng model."
                )

            for index, item in enumerate(items, start=1):
                available_before_segment = available_memory_bytes()
                if available_before_segment is not None and available_before_segment < 768 * 1024 * 1024:
                    available_mb = round(available_before_segment / (1024 * 1024), 1)
                    raise MemoryError(
                        f"Tạm dừng VieNeu vì RAM khả dụng xuống còn {available_mb} MB; "
                        "tiến trình sẽ giải phóng model ngay sau khi kết thúc."
                    )
                voice = engine.resolve_voice_name(str(item["voice"]))
                if not voice:
                    raise ValueError(f"Không tìm thấy giọng VieNeu '{item['voice']}'.")
                audio = engine.infer(
                    str(item["text"]),
                    voice=voice,
                    apply_watermark=False,
                    batch_size=1,
                )
                if audio is None or len(audio) < 1:
                    raise RuntimeError(f"VieNeu không tạo được audio cho đoạn {index}.")

                output = item["outputPath"]
                os.makedirs(os.path.dirname(output), exist_ok=True)
                sf.write(output, audio, int(engine.sample_rate), subtype="PCM_16", format="WAV")
                with open(item["timingPath"], "w", encoding="utf-8") as timing_file:
                    json.dump({
                        "provider": "vieneu-v3-turbo-onnx-fp32",
                        "source": None,
                        "wordBoundaries": [],
                        "warning": "VieNeu-TTS không trả WordBoundary; sẽ dùng forced alignment local nếu đã cài stable-ts.",
                    }, timing_file, ensure_ascii=False)
                if os.path.getsize(output) < 1024:
                    raise RuntimeError(f"VieNeu tạo tệp audio không hợp lệ cho đoạn {index}.")
                print("VIENEU_PROGRESS:" + json.dumps({"index": index, "total": len(items)}), file=sys.stderr, flush=True)

            emit_memory("synthesis-complete", segmentCount=len(items))
        finally:
            if engine is not None:
                try:
                    engine.engine = None
                except Exception:
                    pass
                del engine
            gc.collect()
            emit_memory("model-references-released")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"VieNeu-TTS synthesis failed: {error}", file=sys.stderr, flush=True)
        raise
