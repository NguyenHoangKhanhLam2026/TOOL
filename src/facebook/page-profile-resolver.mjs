import {
  getFacebookPageProfile,
  listFacebookPageProfiles,
  setFacebookPageVerification,
  facebookPageProfileMatchesLanguage
} from '../database/db.mjs';
import { facebookTokenSaved, MetaGraphAdapter } from '../../packages/facebook-engine/meta-graph-adapter.mjs';

function isExpiredAccessToken(error) {
  return Number(error?.code) === 190
    || /error validating access token|session has expired|oauth exception.*\b190\b/i.test(String(error?.message || error));
}

function matchingPageProfiles(pageId, contentLanguage = null) {
  const profiles = [getFacebookPageProfile('legacy'), ...listFacebookPageProfiles().map(({ id }) => getFacebookPageProfile(id))];
  const seen = new Set();
  return profiles.filter((profile) => {
    if (!profile || profile.pageId !== pageId || seen.has(profile.id) || !facebookTokenSaved(profile.tokenFile)) return false;
    if (contentLanguage && !facebookPageProfileMatchesLanguage(profile.id, contentLanguage)) return false;
    seen.add(profile.id);
    return true;
  });
}

export function facebookPageHasSavedToken(pageId, contentLanguage = null) {
  return Boolean(pageId && matchingPageProfiles(String(pageId), contentLanguage).length);
}

/**
 * Verify the configured Page with its selected token. If that token has expired,
 * try another locally saved profile only when it targets the exact same Page ID.
 * Every candidate is checked against Meta immediately before it is returned.
 */
export async function verifyFacebookPageTarget(profile, { contentLanguage = null } = {}) {
  if (!profile?.pageId) throw Object.assign(new Error(`Cấu hình Page "${profile?.label || 'chưa chọn'}" chưa có Page ID.`), { permanentMetaPermission: true });

  if (contentLanguage && !facebookPageProfileMatchesLanguage(profile.id, contentLanguage)) {
    throw Object.assign(new Error('Cấu hình Page không được gán cho ngôn ngữ của video.'), { permanentMetaPermission: true });
  }
  const primary = { ...profile, pageId: String(profile.pageId) };
  const primaryHasToken = facebookTokenSaved(primary.tokenFile);
  const failures = [];
  const candidates = [
    ...(primaryHasToken ? [primary] : []),
    ...matchingPageProfiles(primary.pageId, contentLanguage).filter((candidate) => candidate.id !== primary.id)
  ];
  if (!primaryHasToken) {
    failures.push({ profile: primary, error: new Error('Cấu hình này chưa có token đã lưu.') });
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.id !== primary.id && primaryHasToken && !isExpiredAccessToken(failures[0]?.error)) break;
    try {
      const result = await new MetaGraphAdapter(candidate.pageId, { tokenFile: candidate.tokenFile }).checkConnection();
      setFacebookPageVerification(candidate.id, { verified: true, pageName: result.pageName });
      if (candidate.id !== primary.id) setFacebookPageVerification(primary.id, { verified: false });
      return { profile: candidate, pageCheck: result, usedFallback: candidate.id !== primary.id };
    } catch (error) {
      setFacebookPageVerification(candidate.id, { verified: false });
      failures.push({ profile: candidate, error });
    }
  }

  const first = failures[0]?.error || new Error('Không xác minh được Page với Meta.');
  const checkedProfiles = failures.map(({ profile: candidate, error }) =>
    `"${candidate.label}" (${candidate.id === 'legacy' ? 'Facebook Page hiện tại' : 'Page profile'}): ${error.message}`
  ).join(' · ');
  const message = failures.length > 1
    ? `Không xác minh được Page ID ${primary.pageId}. ${checkedProfiles}. Cập nhật token trong đúng cấu hình Page rồi kiểm tra lại.`
    : `Không xác minh được cấu hình Page "${primary.label || primary.id}" (Page ID ${primary.pageId}): ${first.message}`;
  throw Object.assign(new Error(message), {
    code: first.code, subcode: first.subcode, cause: first,
    ...(Number(first.code) === 190 || !primaryHasToken ? { permanentMetaPermission: true } : {})
  });
}
