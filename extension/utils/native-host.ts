export const RELEASE_NATIVE_HOST = 'com.hologram.host';
export const DEV_NATIVE_HOST = 'com.hologram.host.dev';
export const NATIVE_HOST_PROFILE_KEY = 'nativeHost.profile.v1';
export const DEVELOPMENT_NATIVE_HOST_PROFILE = 'development';

// 同じリリースビルドを日常用と開発用の Chrome プロファイルで共有する。
// 違うのはプロファイル自身の chrome.storage.local に置く役割だけである。
// 開発用プロファイルは scripts/open-dev-profile.cts が CDP の
// Extensions.setStorageItems で development を設定し、直後に同じ unpacked
// 拡張機能を読み込み直す。日常用プロファイルにはキーを置かず、常に実ライブラリ
// の host を使う。
//
// storage.local は非同期なので、接続する瞬間に解決する。Service Worker の
// イベント登録自体は同期のままになり、起動直後のイベントを失わない。
export function nativeHostForProfile(profile: unknown): string {
  return profile === DEVELOPMENT_NATIVE_HOST_PROFILE ? DEV_NATIVE_HOST : RELEASE_NATIVE_HOST;
}

export function getNativeHost(): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return Promise.resolve(RELEASE_NATIVE_HOST);
  return new Promise((resolve) => {
    chrome.storage.local.get(NATIVE_HOST_PROFILE_KEY, (stored) => {
      if (chrome.runtime.lastError) {
        resolve(RELEASE_NATIVE_HOST);
        return;
      }
      resolve(nativeHostForProfile(stored?.[NATIVE_HOST_PROFILE_KEY]));
    });
  });
}
