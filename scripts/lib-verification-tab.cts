const VERIFICATION_TAB_CAPABILITY_KEY = '__HOLOGRAM_VERIFICATION_TAB_CAPABILITY__';
const VERIFICATION_TAB_CAPABILITY = 'verification-host-routing-v1';

interface VerificationTabArguments {
  url: string;
  host: string;
  capabilityKey: string;
  capability: string;
}

// Playwright が Worker 内で実行するため、外側の変数・require を参照しない。
async function openVerificationTabInWorker({ url, host, capabilityKey, capability }: VerificationTabArguments): Promise<number> {
  const scope = globalThis as any;
  const chrome = scope.chrome;
  const requireCapability = () => {
    if (scope[capabilityKey] !== capability) throw new Error('開発用 Chrome の Hologram 拡張機能が検証タブの隔離に対応していません。拡張機能を再配備してください。');
  };
  requireCapability();
  if (!/^com\.hologram\.host\.verify\.[a-f0-9]{12}$/.test(host)) throw new Error('検証用の接続先が無効です。');
  if (!/^https:\/\/(?:x\.com|twitter\.com|bsky\.app|www\.pixiv\.net)\//.test(url)) throw new Error('検証する投稿の HTTPS URL を指定してください。');
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  if (!Number.isInteger(tab?.id) || tab.id < 0) throw new Error('検証用タブを作成できませんでした。');
  const key = `verification.tab.${tab.id}`;
  try {
    requireCapability();
    await chrome.storage.local.set({ [key]: host });
    const stored = await chrome.storage.local.get(key);
    if (stored[key] !== host) throw new Error('検証用の接続先を保存できませんでした。');
    requireCapability();
    await chrome.action.setBadgeText({ tabId: tab.id, text: 'TEST' });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#985800' });
    await chrome.action.setTitle({ tabId: tab.id, title: 'Hologram — 検証用ライブラリ' });
    requireCapability();
    await chrome.tabs.update(tab.id, { url });
    return tab.id;
  } catch (error) {
    // remove が失敗したタブには経路を残す。遷移が部分的に成功した場合も
    // 通常ライブラリへ切り替わらないよう、存続するタブの binding を消さない。
    try {
      await chrome.tabs.remove(tab.id);
      await chrome.storage.local.remove(key);
    } catch {}
    throw error;
  }
}

async function createVerificationTab(worker: { evaluate: (fn: typeof openVerificationTabInWorker, args: VerificationTabArguments) => Promise<number> } | undefined, url: string, host: string): Promise<number> {
  if (!worker) throw new Error('開発用 Chrome の Hologram 拡張機能を起動してください。');
  return worker.evaluate(openVerificationTabInWorker, { url, host, capabilityKey: VERIFICATION_TAB_CAPABILITY_KEY, capability: VERIFICATION_TAB_CAPABILITY });
}

module.exports = { createVerificationTab, openVerificationTabInWorker, VERIFICATION_TAB_CAPABILITY_KEY, VERIFICATION_TAB_CAPABILITY };
