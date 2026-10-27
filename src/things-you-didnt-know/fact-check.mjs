import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_SOURCE_BYTES = 1_500_000;

function isPublicAddress(address) {
  const ipType = net.isIP(address);
  if (ipType === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  }
  if (ipType === 6) {
    const lower = address.toLowerCase();
    return lower === '::' || lower === '::1' ? false
      : !(lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8')
        || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')
        || lower.startsWith('ff') || lower.startsWith('::ffff:127.')
        || lower.startsWith('::ffff:10.') || lower.startsWith('::ffff:192.168.'));
  }
  return false;
}

async function safeSourceUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Chỉ cho phép URL https công khai.');
  if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) throw new Error('URL nguồn không được trỏ đến mạng nội bộ.');
  if (net.isIP(url.hostname)) {
    if (!isPublicAddress(url.hostname)) throw new Error('URL nguồn không được trỏ đến IP riêng.');
  } else {
    const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new Error('Tên miền nguồn không phân giải về IP công khai.');
  }
  return url;
}

async function fetchBounded(url, signal) {
  let target = await safeSourceUrl(url);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await fetch(target, { redirect: 'manual', signal, headers: { 'user-agent': 'ThingsYouDidntKnowSourceCheck/1.0 (+local content review)' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 4) throw new Error('Nguồn chuyển hướng quá nhiều lần.');
      target = await safeSourceUrl(new URL(location, target).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Nguồn trả HTTP ${response.status}.`);
    const type = response.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml\+xml/iu.test(type)) throw new Error('Nguồn không trả về nội dung web dạng văn bản để kiểm tra.');
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_SOURCE_BYTES) throw new Error('Trang nguồn vượt giới hạn đọc 1,5 MB.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Không đọc được nội dung trang nguồn.');
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SOURCE_BYTES) { await reader.cancel(); throw new Error('Trang nguồn vượt giới hạn đọc 1,5 MB.'); }
      chunks.push(value);
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks));
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1]?.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim() || '';
    const text = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/giu, ' ')
      .replace(/<[^>]+>/gu, ' ').replace(/&nbsp;|&#160;/giu, ' ').replace(/&amp;/giu, '&')
      .replace(/&quot;|&#34;/giu, '"').replace(/&#39;|&apos;/giu, "'").replace(/&lt;/giu, '<').replace(/&gt;/giu, '>')
      .replace(/\s+/gu, ' ').trim();
    return { finalUrl: target.toString(), title, text, status: 'retrieved', contentType: type, bytes };
  }
  throw new Error('Không truy cập được nguồn.');
}

export async function inspectThingsYouDidntKnowSources(sources = []) {
  const checkedAt = new Date().toISOString();
  const results = await Promise.all((Array.isArray(sources) ? sources : []).slice(0, 3).map(async (source) => {
    try {
      const fetched = await fetchBounded(source.url, AbortSignal.timeout(12_000));
      const evidence = String(source.evidence || '').trim();
      const evidenceHintFound = evidence.length >= 24 && fetched.text.toLocaleLowerCase().includes(evidence.toLocaleLowerCase().slice(0, 90));
      return { ...source, url: fetched.finalUrl, fetchedTitle: fetched.title, fetchedAt: checkedAt,
        retrievalStatus: 'accessible', accessible: true, host: new URL(fetched.finalUrl).hostname,
        evidenceHintFound, pageTextLength: fetched.text.length, verification: 'human-review-required' };
    } catch (error) {
      return { ...source, fetchedAt: checkedAt, retrievalStatus: 'unavailable', accessible: false,
        retrievalError: String(error.message || error).slice(0, 240), verification: 'human-review-required' };
    }
  }));
  const accessible = results.filter((item) => item.accessible).length;
  return {
    sources: results, checkedAt, accessibleCount: accessible, verified: false,
    status: accessible ? 'sources-accessible-needs-review' : 'needs-review',
    note: accessible
      ? 'Trang nguồn đã truy cập được; việc trang hỗ trợ đầy đủ fact cần người dùng xác nhận.'
      : 'Không truy cập được nguồn để xác minh; giữ Reel ở trạng thái cần duyệt.'
  };
}
