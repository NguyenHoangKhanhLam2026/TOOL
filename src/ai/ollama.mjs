export async function generateWithOllama(prompt, settings) {
  const url = new URL('/api/generate', settings.ollamaBaseUrl || 'http://127.0.0.1:11434');
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: settings.ollamaModel || 'qwen2.5:7b', prompt, format: 'json', stream: false }),
    signal: AbortSignal.timeout(180_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Ollama không khả dụng (${response.status}). ${body.error || ''}`.trim());
  if (!body.response) throw new Error('Ollama không trả về nội dung.');
  return body.response;
}
