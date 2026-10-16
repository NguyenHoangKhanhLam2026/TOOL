export function describeSpawnError(command, error) {
  const code = error?.code || String(error?.message || '').match(/\bspawn\s+([A-Z0-9_]+)/i)?.[1] || 'UNKNOWN';
  const executable = error?.path || command;
  const hint = code === 'EPERM' || code === 'EACCES'
    ? 'Không thể khởi chạy tiến trình con; Windows hoặc môi trường chạy đã từ chối quyền tạo tiến trình.'
    : code === 'ENOENT'
      ? 'Không tìm thấy chương trình hoặc đường dẫn đang chạy.'
      : 'Không khởi chạy được chương trình.';
  const detail = error?.message && error.message !== `spawn ${code}` ? ` Chi tiết: ${error.message}` : '';
  const wrapped = new Error(`${hint} Lệnh: ${executable} (spawn ${code}).${detail}`, { cause: error });
  wrapped.code = code;
  wrapped.syscall = 'spawn';
  wrapped.path = executable;
  return wrapped;
}
