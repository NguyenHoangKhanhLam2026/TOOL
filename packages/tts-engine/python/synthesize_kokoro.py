import ctypes
import gc
import json
import os
import sys


def available_memory_bytes():
    if os.name == "nt":
        class MemoryStatus(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
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
                ("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
            ]
        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        get_current_process = kernel32.GetCurrentProcess
        get_current_process.restype = wintypes.HANDLE
        get_memory_info = kernel32.K32GetProcessMemoryInfo
        get_memory_info.argtypes = (wintypes.HANDLE, ctypes.POINTER(ProcessMemoryCounters), wintypes.DWORD)
        get_memory_info.restype = wintypes.BOOL
        if get_memory_info(get_current_process(), ctypes.byref(counters), counters.cb):
            return int(counters.WorkingSetSize)
    try:
        with open("/proc/self/status", "r", encoding="ascii") as status_file:
            for line in status_file:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def emit_memory(phase, **extra):
    available = available_memory_bytes()
    rss = process_rss_bytes()
    print("KOKORO_MEMORY:" + json.dumps({
        "event": "memory", "provider": "kokoro-onnx-cpu", "phase": phase,
        "availableRamMb": round(available / (1024 * 1024), 1) if available is not None else None,
        "processRssMb": round(rss / (1024 * 1024), 1) if rss is not None else None,
        "vramMb": 0, "device": "CPUExecutionProvider", **extra,
    }, separators=(",", ":")), file=sys.stderr, flush=True)


def require_files(request):
    missing = [path for path in (request["modelPath"], request["voicesPath"])
               if not os.path.isfile(path) or os.path.getsize(path) == 0]
    if missing:
        raise RuntimeError("Thiếu model Kokoro local. Chạy `npm run setup:kokoro`. Tệp thiếu: " + ", ".join(missing))


def main():
    with open(sys.argv[1], "r", encoding="utf-8") as request_file:
        request = json.load(request_file)
    items = request.get("items") or []
    if not items:
        return
    require_files(request)
    emit_memory("before-load", segmentCount=len(items))
    available = available_memory_bytes()
    minimum = int(request.get("minimumAvailableRamMb", 2560)) * 1024 * 1024
    if available is not None and available < minimum:
        raise MemoryError(f"Chưa nạp Kokoro: RAM trống còn {available / (1024 * 1024):.0f} MB, cần tối thiểu {minimum / (1024 * 1024):.0f} MB.")

    engine = None
    try:
        import soundfile as sf
        from kokoro_onnx import Kokoro

        engine = Kokoro(request["modelPath"], request["voicesPath"])
        emit_memory("model-loaded", segmentCount=len(items), modelVersion=request.get("modelVersion", "kokoro-v1.0"))
        remaining = int(request.get("minimumRemainingRamMb", 1024)) * 1024 * 1024
        available_after_load = available_memory_bytes()
        if available_after_load is not None and available_after_load < remaining:
            raise MemoryError(f"RAM trống sau khi nạp Kokoro còn {available_after_load / (1024 * 1024):.0f} MB, dưới ngưỡng dự trữ {remaining / (1024 * 1024):.0f} MB.")

        for index, item in enumerate(items, start=1):
            available_now = available_memory_bytes()
            if available_now is not None and available_now < 512 * 1024 * 1024:
                raise MemoryError(f"Tạm dừng Kokoro vì RAM trống xuống còn {available_now / (1024 * 1024):.0f} MB.")
            voice = str(item["voice"])
            language = "en-gb" if voice.startswith(("bf_", "bm_")) else "en-us"
            audio, sample_rate = engine.create(
                str(item["text"]), voice=voice,
                speed=max(0.5, min(1.25, float(item.get("speed", 1.0)))),
                lang=language,
            )
            output = item["outputPath"]
            os.makedirs(os.path.dirname(output), exist_ok=True)
            sf.write(output, audio, int(sample_rate), subtype="PCM_16", format="WAV")
            with open(item["timingPath"], "w", encoding="utf-8") as timing_file:
                json.dump({
                    "provider": "kokoro-onnx-cpu", "source": None, "wordBoundaries": [],
                    "warning": "Kokoro chưa trả word timing; dùng forced alignment local nếu được bật.",
                }, timing_file, ensure_ascii=False)
            if os.path.getsize(output) < 1024:
                raise RuntimeError(f"Kokoro tạo tệp audio không hợp lệ ở đoạn {index}.")
            print("KOKORO_PROGRESS:" + json.dumps({"index": index, "total": len(items)}), file=sys.stderr, flush=True)
            emit_memory("synthesizing", segmentIndex=index, segmentCount=len(items))
        emit_memory("synthesis-complete", segmentCount=len(items))
    finally:
        if engine is not None:
            try:
                voices = getattr(engine, "voices", None)
                if voices is not None and hasattr(voices, "close"):
                    voices.close()
            except Exception:
                pass
            del engine
        gc.collect()
        emit_memory("model-references-released")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Kokoro TTS failed: {error}", file=sys.stderr, flush=True)
        raise
