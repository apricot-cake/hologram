import { generatedActionBadge } from './tokens.generated';

export const VERIFICATION_HOST = 'com.hologram.host.verify';
export const VERIFICATION_TAB_CAPABILITY = 'verification-host-routing-v1';
export const VERIFICATION_TAB_CAPABILITY_KEY = '__HOLOGRAM_VERIFICATION_TAB_CAPABILITY__';

// Worker ごとの登録完了の印。保存先そのものは storage.local に保持する。
export function setVerificationRoutingReady(ready: boolean) {
  const scope = globalThis as typeof globalThis & Record<string, unknown>;
  if (ready) scope[VERIFICATION_TAB_CAPABILITY_KEY] = VERIFICATION_TAB_CAPABILITY;
  else delete scope[VERIFICATION_TAB_CAPABILITY_KEY];
}

export const verificationKey = (tabId: number) => `verification.tab.${tabId}`;

// local に保持し、Service Worker や拡張機能の再読み込みでも接続先を失わない。
export async function verificationHost(tabId?: number): Promise<string | undefined> {
  if (tabId == null) return undefined;
  const key = verificationKey(tabId);
  const stored = await chrome.storage.local.get(key);
  if (!Object.hasOwn(stored, key)) return undefined;
  if (typeof stored[key] !== 'string' || !/^com\.hologram\.host\.verify\.[a-f0-9]{12}$/.test(stored[key])) throw new Error('検証用の接続先が無効です。検証タブを開き直してください。');
  return stored[key];
}

export async function showVerificationBadge(tabId: number) {
  if (!(await verificationHost(tabId))) return;
  await chrome.action.setBadgeText({ tabId, text: 'TEST' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: generatedActionBadge.verificationBackground });
  await chrome.action.setBadgeTextColor({ tabId, color: generatedActionBadge.verificationText });
  await chrome.action.setTitle({ tabId, title: 'Hologram — 検証用ライブラリ' });
}
