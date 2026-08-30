'use strict';

// CDP を公開した開発用 Chrome プロファイルへ、日常用と同じ unpacked
// リリースビルドを読み込む。プロファイル固有の違いは storage.local の
// Native Host 選択だけで、ソースやバンドルは分けない。

const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { waitFor } = require('./lib-wait.cts');

const EXPECTED_EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const NATIVE_HOST_PROFILE_KEY = 'nativeHost.profile.v1';
const DEVELOPMENT_NATIVE_HOST_PROFILE = 'development';
const DEFAULT_CDP_URL = 'http://127.0.0.1:9223';

async function cdpVersion(cdpUrl = DEFAULT_CDP_URL): Promise<any> {
  const response = await fetch(new URL('/json/version', cdpUrl), {
    signal: AbortSignal.timeout(1000),
  });
  if (!response.ok) throw new Error(`CDP が HTTP ${response.status} を返しました`);
  const version = await response.json();
  if (typeof version?.webSocketDebuggerUrl !== 'string') throw new Error('CDP のブラウザ接続先がありません');
  return version;
}

async function cdpReady(cdpUrl = DEFAULT_CDP_URL): Promise<boolean> {
  try {
    await cdpVersion(cdpUrl);
    return true;
  } catch {
    return false;
  }
}

class CdpClient {
  ws: any;
  nextId = 1;
  pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();

  constructor(ws: any) {
    this.ws = ws;
    ws.on('message', (data: unknown) => {
      const message = JSON.parse(String(data));
      const item = typeof message.id === 'number' ? this.pending.get(message.id) : null;
      if (!item) return;
      this.pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(`${message.error.message || 'CDP error'} (${message.error.code ?? 'unknown'})`));
      else item.resolve(message.result);
    });
    ws.on('close', () => {
      for (const [, item] of this.pending) {
        clearTimeout(item.timer);
        item.reject(new Error('CDP 接続が閉じました'));
      }
      this.pending.clear();
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} が10秒以内に完了しませんでした`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

async function connectWebSocket(webSocketDebuggerUrl: string): Promise<CdpClient> {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return new CdpClient(ws);
}

async function connectBrowser(cdpUrl = DEFAULT_CDP_URL): Promise<CdpClient> {
  const version = await cdpVersion(cdpUrl);
  return connectWebSocket(version.webSocketDebuggerUrl);
}

async function connectExtensionWorker(extensionId: string, cdpUrl = DEFAULT_CDP_URL): Promise<CdpClient> {
  let worker: any = null;
  await waitFor(
    `拡張機能 ${extensionId} の Service Worker がCDPに現れること`,
    async () => {
      worker = null;
      const response = await fetch(new URL('/json/list', cdpUrl), { signal: AbortSignal.timeout(1000) });
      const targets = response.ok ? await response.json() : [];
      worker = Array.isArray(targets) ? targets.find((target) => target?.type === 'service_worker' && typeof target.url === 'string' && target.url.startsWith(`chrome-extension://${extensionId}/`) && typeof target.webSocketDebuggerUrl === 'string') : null;
      return worker;
    },
    { timeoutMs: 5000, pollMs: 100 },
  );
  return connectWebSocket(worker.webSocketDebuggerUrl);
}

async function configureDevelopmentExtension(extensionDir: string, cdpUrl = DEFAULT_CDP_URL): Promise<{ id: string; path: string }> {
  const absolute = path.resolve(extensionDir);
  if (!fs.existsSync(path.join(absolute, 'manifest.json'))) {
    throw new Error(`共有リリースビルドがありません: ${absolute}`);
  }

  const cdp = await connectBrowser(cdpUrl);
  try {
    const first = await cdp.send('Extensions.loadUnpacked', { path: absolute });
    if (first?.id !== EXPECTED_EXTENSION_ID) {
      throw new Error(`読み込んだ拡張機能 ID が違います: ${first?.id || 'unknown'}`);
    }

    const worker = await connectExtensionWorker(EXPECTED_EXTENSION_ID, cdpUrl);
    try {
      // Extensionsのstorage操作は、対象拡張機能のService Workerに接続した
      // CDPセッションからだけ許可される。
      await worker.send('Extensions.setStorageItems', {
        id: EXPECTED_EXTENSION_ID,
        storageArea: 'local',
        values: { [NATIVE_HOST_PROFILE_KEY]: DEVELOPMENT_NATIVE_HOST_PROFILE },
      });
    } finally {
      worker.close();
    }

    // storage.local を設定した後にもう一度読み込み、CDPによる拡張機能の再読み込みと
    // プロファイル設定の反映を1つの操作として完了させる。
    const second = await cdp.send('Extensions.loadUnpacked', { path: absolute });
    if (second?.id !== EXPECTED_EXTENSION_ID) throw new Error('開発用プロファイルで拡張機能を再読み込みできませんでした');

    const { extensions } = await cdp.send('Extensions.getExtensions');
    const verifyWorker = await connectExtensionWorker(EXPECTED_EXTENSION_ID, cdpUrl);
    let data: Record<string, unknown>;
    try {
      ({ data } = await verifyWorker.send('Extensions.getStorageItems', {
        id: EXPECTED_EXTENSION_ID,
        storageArea: 'local',
        keys: [NATIVE_HOST_PROFILE_KEY],
      }));
    } finally {
      verifyWorker.close();
    }
    const loaded = extensions?.find((extension: any) => extension.id === EXPECTED_EXTENSION_ID);
    if (!loaded?.enabled || path.resolve(loaded.path).toLowerCase() !== absolute.toLowerCase()) {
      throw new Error(`開発用プロファイルが共有リリースビルドを読み込んでいません: ${loaded?.path || 'not loaded'}`);
    }
    if (data?.[NATIVE_HOST_PROFILE_KEY] !== DEVELOPMENT_NATIVE_HOST_PROFILE) {
      throw new Error('開発用 Native Host のプロファイル設定を確認できませんでした');
    }
    return { id: EXPECTED_EXTENSION_ID, path: absolute };
  } finally {
    cdp.close();
  }
}

module.exports = {
  DEFAULT_CDP_URL,
  DEVELOPMENT_NATIVE_HOST_PROFILE,
  EXPECTED_EXTENSION_ID,
  NATIVE_HOST_PROFILE_KEY,
  cdpReady,
  configureDevelopmentExtension,
};
