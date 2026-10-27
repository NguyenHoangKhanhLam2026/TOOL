import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA, PRIVATE_DIR } from '../config.mjs';
import { THINGS_YOU_DIDNT_KNOW_DEFAULTS, normalizeThingsYouDidntKnowSettings } from './settings.mjs';

const STORE_DIR = path.join(DATA, 'things-you-didnt-know');
const SETTINGS_PATH = path.join(STORE_DIR, 'settings.json');
const TOKEN_PATH = path.join(PRIVATE_DIR, 'things-you-didnt-know', 'facebook-page-token.txt');

export function thingsYouDidntKnowSettingsPath() { return SETTINGS_PATH; }
export function thingsYouDidntKnowFacebookTokenPath() { return TOKEN_PATH; }

export function getThingsYouDidntKnowSettings() {
  try { return normalizeThingsYouDidntKnowSettings(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))); }
  catch { return normalizeThingsYouDidntKnowSettings(THINGS_YOU_DIDNT_KNOW_DEFAULTS); }
}

function writeSettings(value) {
  const settings = normalizeThingsYouDidntKnowSettings(value);
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const tempPath = `${SETTINGS_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tempPath, SETTINGS_PATH);
  return settings;
}

export function saveThingsYouDidntKnowSettings(patch = {}) {
  const current = getThingsYouDidntKnowSettings();
  const next = normalizeThingsYouDidntKnowSettings({ ...current, ...patch });
  const pageChanged = next.facebookPageId !== current.facebookPageId;
  return writeSettings({ ...next,
    facebookPageName: pageChanged ? '' : current.facebookPageName,
    facebookPageVerified: pageChanged ? false : current.facebookPageVerified
  });
}

export function saveThingsYouDidntKnowFacebookPage({ pageId = '', accessToken = '' } = {}) {
  const id = String(pageId || '').trim();
  if (id && !/^\d{5,}$/.test(id)) throw new Error('Page ID phải gồm ít nhất 5 chữ số.');
  const token = String(accessToken || '').trim();
  if (token && token.length < 20) throw new Error('Page Access Token không hợp lệ.');
  if (token) {
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    const tempPath = `${TOKEN_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tempPath, token, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(tempPath, 0o600); } catch { }
    fs.renameSync(tempPath, TOKEN_PATH);
  }
  const current = getThingsYouDidntKnowSettings();
  const pageChanged = id !== current.facebookPageId;
  if (pageChanged && !token) fs.rmSync(TOKEN_PATH, { force: true });
  const verificationMustReset = pageChanged || Boolean(token);
  return writeSettings({ ...current, facebookPageId: id,
    facebookPageName: verificationMustReset ? '' : current.facebookPageName,
    facebookPageVerified: !verificationMustReset && current.facebookPageVerified,
    autoPublishEnabled: verificationMustReset ? false : current.autoPublishEnabled
  });
}

export function setThingsYouDidntKnowFacebookVerification({ verified = false, pageName = '' } = {}) {
  const settings = getThingsYouDidntKnowSettings();
  return writeSettings({ ...settings, facebookPageVerified: verified === true,
    facebookPageName: verified === true ? String(pageName || '').trim().slice(0, 160) : ''
  });
}

export function thingsYouDidntKnowFacebookTokenSaved() {
  try { return fs.existsSync(TOKEN_PATH) && fs.readFileSync(TOKEN_PATH, 'utf8').trim().length > 20; }
  catch { return false; }
}

export function clearThingsYouDidntKnowFacebookToken() {
  fs.rmSync(TOKEN_PATH, { force: true });
  return true;
}
