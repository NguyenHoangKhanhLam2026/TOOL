import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA, PATHS } from '../config.mjs';
import { MOT_PHUT_VO_LE_DEFAULTS, normalizeMotPhutVoLeSettings } from './settings.mjs';

const STORE_DIR = path.join(DATA, 'mot-phut-vo-le');
const STORE_PATH = path.join(STORE_DIR, 'settings.json');

export function getMotPhutVoLeSettings() {
  try { return normalizeMotPhutVoLeSettings(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))); }
  catch { return normalizeMotPhutVoLeSettings(MOT_PHUT_VO_LE_DEFAULTS); }
}

export function saveMotPhutVoLeSettings(value = {}) {
  const current = getMotPhutVoLeSettings();
  const requested = normalizeMotPhutVoLeSettings(value);
  const samePage = requested.facebookPageId === current.facebookPageId;
  const settings = normalizeMotPhutVoLeSettings({
    ...requested,
    facebookPageName: samePage ? current.facebookPageName : '',
    facebookPageVerified: samePage && current.facebookPageVerified
  });
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const temp = `${STORE_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(temp, STORE_PATH);
  return settings;
}

export function resetMotPhutVoLeSettings() {
  try { fs.rmSync(motPhutVoLeFacebookTokenPath(), { force: true }); } catch { }
  return saveMotPhutVoLeSettings(MOT_PHUT_VO_LE_DEFAULTS);
}

const TOKEN_PATH = path.join(PATHS.private, 'mot-phut-vo-le', 'facebook-page-token.txt');

export function motPhutVoLeFacebookTokenPath() { return TOKEN_PATH; }

export function saveMotPhutVoLeFacebookPage({ pageId = '', accessToken = '' } = {}) {
  const normalizedId = String(pageId || '').trim();
  if (normalizedId && !/^\d{5,}$/.test(normalizedId)) throw new Error('Page ID phải gồm ít nhất 5 chữ số.');
  const token = String(accessToken || '').trim();
  if (token && token.length < 20) throw new Error('Page Access Token không hợp lệ.');
  if (token) {
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    const temp = `${TOKEN_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, token, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(temp, 0o600); } catch { }
    fs.renameSync(temp, TOKEN_PATH);
  }
  const current = getMotPhutVoLeSettings();
  const credentialsChanged = normalizedId !== current.facebookPageId || Boolean(token);
  const settings = normalizeMotPhutVoLeSettings({
    ...current,
    facebookPageId: normalizedId,
    facebookPageName: credentialsChanged ? '' : current.facebookPageName,
    facebookPageVerified: !credentialsChanged && current.facebookPageVerified
  });
  return writeSettings(settings);
}

export function setMotPhutVoLeFacebookPageVerification({ verified, pageName = '' } = {}) {
  const current = getMotPhutVoLeSettings();
  const settings = normalizeMotPhutVoLeSettings({
    ...current,
    facebookPageVerified: verified === true,
    facebookPageName: verified === true ? String(pageName || '').trim().slice(0, 160) : ''
  });
  return writeSettings(settings);
}

export function motPhutVoLeFacebookTokenSaved() {
  try { return fs.existsSync(TOKEN_PATH) && fs.readFileSync(TOKEN_PATH, 'utf8').trim().length > 20; }
  catch { return false; }
}

function writeSettings(settings) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const temp = `${STORE_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(temp, STORE_PATH);
  return settings;
}
