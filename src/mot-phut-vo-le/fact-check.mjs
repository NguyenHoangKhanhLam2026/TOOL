const SENSITIVE_TOPIC_RE = /\b(sức khỏe|bệnh|thuốc|điều trị|tài chính|đầu tư|cổ phiếu|tiền mã hóa|luật|pháp luật|tòa án|lịch sử|khoa học|nghiên cứu|chẩn đoán|dinh dưỡng)\b/iu;
const CLAIM_RE = /\b(theo nghiên cứu|chứng minh rằng|đã được chứng minh|100%|luôn luôn|không bao giờ|tất cả mọi người)\b/iu;

export function reviewMotPhutVoLeFactClaims(content, { sources = [] } = {}) {
  const sourceList = Array.isArray(sources) ? sources.filter((item) => item && typeof item === 'object') : [];
  const combined = `${content?.topic || ''}\n${content?.scriptText || ''}`;
  const sensitive = SENSITIVE_TOPIC_RE.test(combined);
  const absoluteClaim = CLAIM_RE.test(combined);
  const verified = sourceList.length > 0 && sourceList.every((item) => item.url && item.title);
  const flags = [];
  if (sensitive && !verified) flags.push('sensitive-topic-without-source');
  if (absoluteClaim) flags.push('absolute-claim-needs-review');
  return Object.freeze({
    status: verified ? 'sources-attached-not-independently-audited' : 'not-externally-verified',
    externalVerificationClaimed: false,
    requiresCarefulWording: sensitive,
    flags,
    sources: sourceList.map(({ url, title, publisher = null, accessedAt = null }) => ({ url: String(url), title: String(title), publisher, accessedAt }))
  });
}
