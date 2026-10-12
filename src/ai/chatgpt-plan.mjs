import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../config.mjs';
import { log } from '../database/db.mjs';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const credentialPath = path.join(PATHS.private, 'chatgpt-plan.json');
const hostIdPath = path.join(PATHS.private, 'chatgpt-host-id.txt');
const pending = new Map();
let refreshPromise;

function readCredential() {
  try { return JSON.parse(fs.readFileSync(credentialPath, 'utf8')); } catch { return null; }
}

function writeCredential(value) {
  const temp = `${credentialPath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, credentialPath);
  try { fs.chmodSync(credentialPath, 0o600); } catch { /* Windows ACLs govern this file. */ }
}

function hostId() {
  if (!fs.existsSync(hostIdPath)) fs.writeFileSync(hostIdPath, `urn:uuid:${crypto.randomUUID()}`, { mode: 0o600 });
  return fs.readFileSync(hostIdPath, 'utf8').trim();
}

export function chatgptStatus() {
  const record = readCredential();
  return {
    connected: Boolean(record?.access_token && record?.scopes?.includes('chatgpt.tokens.use.direct')),
    email: record?.email || null,
    expiresAt: record?.expires_at || null,
    scopes: record?.scopes || []
  };
}

export function beginChatGPTSignIn() {
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = `http://127.0.0.1:${process.env.APP_PORT || 3001}/auth/callback`;
  const record = readCredential();
  const clientId = record?.client_id || 'dynamic_agent_client';
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    resource,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    ext_agent_host_id: hostId()
  });
  if (clientId === 'dynamic_agent_client') params.set('agent_name_hint', 'Auto English Reels Studio');
  if (record?.id_token) params.set('id_token_hint', record.id_token);
  if (record?.email) params.set('login_hint', record.email);
  pending.set(state, { nonce, verifier, redirectUri, clientId, createdAt: Date.now() });
  for (const [key, item] of pending) if (Date.now() - item.createdAt > 10 * 60_000) pending.delete(key);
  return `${issuer}/api/accounts/authorize?${params}`;
}

export async function completeChatGPTSignIn(url) {
  const state = url.searchParams.get('state');
  const attempt = state && pending.get(state);
  if (!attempt) throw new Error('Đăng nhập ChatGPT hết hạn hoặc sai state. Hãy thử kết nối lại.');
  pending.delete(state);
  if (url.searchParams.get('error')) throw new Error(`OpenAI từ chối hoặc không hoàn tất xác thực (${url.searchParams.get('error')}).`);
  const code = url.searchParams.get('code');
  const issuedClientId = url.searchParams.get('client_id') || attempt.clientId;
  if (!code || !issuedClientId || issuedClientId === 'dynamic_agent_client') throw new Error('Không nhận được authorization code hoặc client ID đã đăng ký.');
  if (attempt.clientId !== 'dynamic_agent_client' && issuedClientId !== attempt.clientId) throw new Error('Client ID trả về không khớp kết nối ChatGPT đã chọn.');

  const response = await fetch(`${issuer}/api/accounts/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: issuedClientId, code,
      code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource }),
    signal: AbortSignal.timeout(20_000)
  });
  const tokens = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OpenAI token exchange thất bại (${tokens.error || response.status}).`);
  const claims = await validateIdToken(tokens.id_token, issuedClientId, attempt.nonce);
  const scopes = String(tokens.scope || url.searchParams.get('scope') || '').split(/\s+/).filter(Boolean);
  if (!scopes.includes('chatgpt.tokens.use.direct')) throw new Error('Tài khoản chưa cấp quyền dùng ChatGPT plan cho ứng dụng này.');
  const credential = {
    issuer, subject: claims.sub, email: claims.email || '', client_id: issuedClientId,
    ext_agent_host_id: hostId(), id_token: tokens.id_token,
    access_token: tokens.access_token, refresh_token: tokens.refresh_token,
    token_type: tokens.token_type || 'Bearer', scopes,
    expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    saved_at: new Date().toISOString()
  };
  writeCredential(credential);
  return { email: credential.email, expiresAt: credential.expires_at };
}

async function validateIdToken(token, clientId, nonce) {
  const [headerPart, payloadPart, signaturePart] = String(token || '').split('.');
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('OpenAI ID token không hợp lệ.');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Thuật toán ID token không được hỗ trợ.');
  const configRes = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
  if (!configRes.ok) throw new Error('Không tải được OpenID configuration từ OpenAI.');
  const config = await configRes.json();
  const keysRes = await fetch(config.jwks_uri, { signal: AbortSignal.timeout(10_000) });
  if (!keysRes.ok) throw new Error('Không tải được khóa ký ID token từ OpenAI.');
  const jwks = await keysRes.json();
  const jwk = jwks.keys?.find((item) => item.kid === header.kid && item.kty === 'RSA');
  if (!jwk) throw new Error('Không tìm thấy khóa ký ID token.');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const validSignature = crypto.verify('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), key, Buffer.from(signaturePart, 'base64url'));
  const audOk = claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId));
  if (!validSignature || claims.iss !== issuer || !audOk || claims.nonce !== nonce || Number(claims.exp) <= Date.now() / 1000) {
    throw new Error('Không xác minh được chữ ký hoặc claim của OpenAI ID token.');
  }
  return claims;
}

async function currentAccessToken() {
  const credential = readCredential();
  if (!credential?.access_token) throw new Error('Chưa kết nối tài khoản ChatGPT.');
  if (credential.expires_at > Date.now() + 60_000) return credential.access_token;
  if (!credential.refresh_token) throw new Error('Phiên ChatGPT hết hạn; hãy kết nối lại.');
  if (!refreshPromise) refreshPromise = (async () => {
    const response = await fetch(`${issuer}/api/accounts/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: credential.client_id,
        refresh_token: credential.refresh_token, resource }), signal: AbortSignal.timeout(20_000)
    });
    const next = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Không làm mới được phiên ChatGPT (${next.error || response.status}).`);
    const merged = { ...credential, ...next, scopes: String(next.scope || credential.scopes.join(' ')).split(/\s+/).filter(Boolean),
      expires_at: Date.now() + Number(next.expires_in || 3600) * 1000, saved_at: new Date().toISOString() };
    writeCredential(merged);
    return merged.access_token;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function generateWithChatGPT(prompt) {
  const token = await currentAccessToken();
  const modelRes = await fetch(`${resource}/models`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!modelRes.ok) throw new Error(`Không đọc được danh sách model ChatGPT (${modelRes.status}).`);
  const models = await modelRes.json();
  const model = models.models?.find((item) => item.visibility === 'list')?.slug || models.data?.[0]?.id;
  if (!model) throw new Error('Tài khoản không trả về model khả dụng.');
  const response = await fetch(`${resource}/responses`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, instructions: 'Chỉ trả về JSON hợp lệ đúng schema đã yêu cầu. Không dùng Markdown.',
      input: [{ role: 'user', content: prompt }], store: false, stream: true }), signal: AbortSignal.timeout(180_000)
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ChatGPT Responses API trả lỗi ${response.status}: ${body.slice(0, 300)}`);
  }
  let text = '';
  let completed = false;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    for (const event of events) {
      const line = event.split(/\r?\n/).find((part) => part.startsWith('data: '));
      if (!line) continue;
      try {
        const item = JSON.parse(line.slice(6));
        if (item.type === 'response.output_text.delta') text += item.delta || '';
        if (item.type === 'response.failed') throw new Error(`ChatGPT plan request thất bại (${item.response?.error?.code || 'unknown'}).`);
        if (item.type === 'response.completed') completed = true;
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
    if (done) break;
  }
  if (!completed) throw new Error('Kết nối ChatGPT kết thúc trước response.completed.');
  return text;
}

export async function disconnectChatGPT() {
  const credential = readCredential();
  if (!credential) return { disconnected: false, revocationConfirmed: false };
  let revocationConfirmed = false;
  try {
    if (credential.refresh_token && credential.client_id) {
      const configResponse = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
      const config = await configResponse.json();
      if (config.revocation_endpoint) {
        const response = await fetch(config.revocation_endpoint, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: credential.refresh_token, token_type_hint: 'refresh_token', client_id: credential.client_id }),
          signal: AbortSignal.timeout(8000)
        });
        revocationConfirmed = response.status === 200;
      }
    }
  } catch (error) {
    log('WARN', 'CHATGPT_REVOCATION_UNCONFIRMED', `Không xác nhận được thu hồi phiên ChatGPT: ${error.message}`);
  }
  fs.rmSync(credentialPath, { force: true });
  return { disconnected: true, revocationConfirmed };
}
