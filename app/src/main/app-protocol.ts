'use strict';

// パッケージ済みレンダラーが配信される app:// スキーム（#7）。
//
// なぜ file:// ではないか。Electron のセキュリティチェックリストは明確
// （18.「file:// プロトコルの使用を避け、カスタムプロトコルの使用を優先する」）:
// file:// は、ブラウザなら与えない権限を Electron の中では持ってしまい、
// ローカルページはカスタムプロトコルから配信すべき。具体的には、file:// の
// ページは他の file:// アセットへの fetch アクセス、Service Worker、file:// の
// 子フレームへの無制限アクセスを得てしまう——`grantFileProtocolExtraPrivileges`
// というヒューズがそれで、app/package.json はパッケージ済みビルドで今これを
// 焼き切っている。レンダラーをこのスキームから配信することが、そのヒューズを
// 切っても生き延びられるようにしている。
//
// これはまた、#683 には持てなかった配信経路も作る: Response はヘッダーを
// 持てるので、レンダラーの CSP は <meta> タグではなくなる（renderer-csp.ts）。
//
// この形は、プロトコルのドキュメントにある Electron 自身の `app://bundle` の
// 例に従う: `standard` + `secure` + `supportFetchAPI` で登録、ホスト1つ、
// ハンドラ内でのディレクトリ脱出チェック。意図した逸脱が2つ:
//
//   - corsEnabled 「無し」。app://bundle と asset://img は別のオリジンで、
//     それこそが要点: CORS が無ければレンダラーはライブラリのバイト列を
//     直接読めず、IPC の許可リストが唯一の入り口であり続ける（ADR 0012）。
//   - net.fetch(pathToFileURL(...)) ではなく fs.readFile。ドキュメントの例は
//     net.fetch を使うが、その file:// パスが asar アーカイブを「透過して」
//     読めるかはそこに書かれておらず、パッケージ済みレンダラーは app.asar の
//     内側に住んでいる。Node の fs は Electron によってパッチされ asar の
//     中を見えるので、確実に動くのはこちら。

import { protocol, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEV_RENDERER_CSP, rendererSecurityHeaders } from './renderer-csp.ts';
import { APP_HOST, APP_SCHEME, mimeForBundleFile, resolveInRenderer } from './renderer-files.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** out/renderer——electron-vite のレンダラー出力、out/main の隣。 */
function rendererRoot(): string {
  return path.resolve(__dirname, '..', 'renderer');
}

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    // 別のホストに応答すると、誰も設計していない2つ目のオリジンを渡してしまう。
    if (url.hostname !== APP_HOST) return new Response('Not found', { status: 404 });
    const file = resolveInRenderer(rendererRoot(), url.pathname);
    if (!file) return new Response('Forbidden', { status: 403 });
    const type = mimeForBundleFile(file);
    if (!type) return new Response('Unsupported media type', { status: 415 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { ...rendererSecurityHeaders(), 'content-type': type } });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return new Response('Not found', { status: 404 });
      return new Response('Error', { status: 500 });
    }
  });
}

// 同じ配信のもう半分: `electron-vite dev` は Vite から http 経由でレンダラーを
// 配信するので、それらの応答は上のハンドラには一切届かない。代わりに開発用
// ポリシーをそこへ固定する——開発サーバーが本番より緩いポリシーで動いていると、
// 違反は本番でしか発見されなくなる。まさにそうやって #683 の style-src の
// 発見が見逃されかねなかった。開発オリジンに絞ってあるので、セッション内の
// 他の何にも触れず、パッケージ済みビルドでは決して呼ばれない（そこでは
// devOrigin が null——lib-window.ts）。
function installDevRendererCsp(devOrigin: string | null): void {
  if (!devOrigin) return;
  session.defaultSession.webRequest.onHeadersReceived({ urls: [`${devOrigin}/*`] }, (details, callback) => {
    const headers: Record<string, string | string[]> = { ...details.responseHeaders };
    // 大文字小文字を区別しない: Vite が既に別の綴りでこれを送っているかも
    // しれず、2つのポリシーが置き換わらずに交差してしまう。
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-security-policy') delete headers[key];
    }
    headers['content-security-policy'] = [DEV_RENDERER_CSP];
    callback({ responseHeaders: headers });
  });
}

export { installDevRendererCsp, registerAppProtocol, rendererRoot };
