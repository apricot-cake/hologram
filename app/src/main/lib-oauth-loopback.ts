'use strict';

// ループバックのリダイレクトのリスナー（#233、RFC 8252 §7.3）。
//
// デスクトップのアプリはクライアントシークレットを持てないので、認可コードは代わりにこのマシンの
// ソケットへ返ってくる。効く性質が3つあり、そのいずれも呼び出し元ではなくここで守る。
//
//   127.0.0.1 に束縛する   名前の `localhost` ではなく IP のリテラル。hosts の項目は名前を
//                          動かせるし、どちらの提供元も、登録すべきものとしてリテラルを
//                          記している（§8.3）。
//   認可が飛行中の間だけ開く   このポートへ何かが届き得る窓は、利用者が同意の画面で過ごす窓と
//                          等しく、最初に受け入れた応答・タイムアウト・取り消しのいずれかで
//                          閉じる。
//   state が一致すること   このリスナーを開いたときの `state` と違う応答は、待ちを終わらせずに
//                          捨てる（§8.9 / RFC 9700 §2.1）＝偽装したリダイレクトが、本物の方を
//                          取り消せてもいけない。
//
// #233 の 6/7 が求めていて、ここでは実現できないもの:
//   * Windows での SO_EXCLUSIVEADDRUSE。Node は setsockopt を公開していないし、libuv は Windows で
//     SO_REUSEADDR も SO_EXCLUSIVEADDRUSE も意図して設定しない（src/win/tcp.c いわく
//     SO_EXCLUSIVEADDRUSE は "does check all sockets, regardless of state"、つまり TIME_WAIT で
//     失敗してしまう）。ソケットのオプション1つのためにネイティブのアドオンを足すのは、それが
//     塞ぐ露出に見合わない取引なので、多層の守りは上の残り3つの性質＋PKCE＝乗っ取られたリスナー
//     へ届いたコードは、verifier 無しには交換できない。そして verifier はこのプロセスから出ない。
//   * [::1] でも待ち受けること。Microsoft は IPv6 のループバックをリダイレクトの URI として
//     そもそも対応していないし、Google のリダイレクトはこちらが組み立てる v4 のリテラルなので、
//     ブラウザにはほかに着く先が無い。2つ目のアドレスファミリは、使われないソケットになる。

import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** リスナーが諦めるまでに、利用者が同意の画面で使える時間。 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface LoopbackCallback {
  readonly code: string;
  /** 提供元が送ってきた場合の RFC 9207 の issuer。 */
  readonly iss: string | null;
}

export interface LoopbackListener {
  /** 実際に束縛したポート＝リダイレクトの URI はこれから組み立てる。 */
  readonly port: number;
  /** `state` を載せた応答が届いたら、コードとともに解決する。 */
  waitForCallback(state: string, timeoutMs?: number): Promise<LoopbackCallback>;
  /** 何度実行しても同じ。finally から呼んで安全。 */
  close(): void;
}

// ブラウザが着地するページ。自己完結させてあり（スタイルシートを取りに行くリダイレクト先は、
// 最悪の瞬間に別のどこかへリクエストを出すことになる）、UI なので日本語。
function page(title: string, body: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title><style>
body{font-family:system-ui,"Segoe UI",sans-serif;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f6f7f9;color:#1c1e21}
main{max-width:28rem;padding:2rem;text-align:center}
h1{font-size:1.25rem;margin:0 0 .75rem}p{margin:0;line-height:1.7;color:#4b5563}
</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

const PAGE_OK = page('接続しました', 'このタブを閉じて Hologram に戻ってください。');
const PAGE_DENIED = page('接続をキャンセルしました', 'Hologram に戻って、もう一度お試しください。');
const PAGE_STRAY = page('この応答は受け付けられません', 'Hologram が待っている認可の応答ではありません。このタブを閉じてください。');

function send(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    // ここのものはキャッシュされてはいけないし、別のページから届いてもいけない。配っている
    // URL が認可コードを載せているため。
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
  res.end(html);
}

/**
 * リスナーを束縛する。`port` は提供元が登録した固定のポート。一時的なポートでよければ null
 * （Google は突き合わせのときポートを見ないが、Microsoft は見る＝lib-oauth-providers.ts を
 * 参照）。
 */
async function startLoopbackListener(port: number | null): Promise<LoopbackListener> {
  const server = http.createServer();
  // 止まった接続が、流れの終わった後もポートを掴んでいてはいけない。
  server.keepAliveTimeout = 1000;

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      // 固定ポートの提供元は、そのポートが取られていても別のポートを代わりに使えない。登録済み
      // のリダイレクトの URI がこのポートを名指ししているため。"EADDRINUSE" が説明の全部として
      // 表に出るのに任せず、はっきりそう言う。
      if (err.code === 'EADDRINUSE' && port) reject(new Error(`loopback port ${port} is already in use`));
      else reject(err);
    };
    server.once('error', onError);
    server.listen({ host: '127.0.0.1', port: port ?? 0, exclusive: true }, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });

  const bound = (server.address() as AddressInfo).port;
  let settled = false;
  let closed = false;
  // 呼び出し元が待っている間だけ立てる。リスナーを閉じれば、数分後のタイムアウトに任せるのでは
  // なくその待ちが終わるように。呼び出し元は `finally` で閉じるし、それはまさに取り消された認可が
  // 通る経路。
  let cancelWait: ((err: Error) => void) | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    server.closeAllConnections?.();
    server.close();
    cancelWait?.(new Error('the authorization listener was closed'));
  };

  return {
    port: bound,
    waitForCallback(state, timeoutMs = DEFAULT_TIMEOUT_MS) {
      return new Promise<LoopbackCallback>((resolve, reject) => {
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
          // リスナーの仕事は最初に受け入れた応答で終わる。ソケットもそれと一緒に閉じ、アプリの
          // 寿命の間ぐずぐず残ったりしない。
          close();
        };
        const timer = setTimeout(() => finish(() => reject(new Error('timed out waiting for the authorization response'))), timeoutMs);
        cancelWait = (err) => finish(() => reject(err));

        server.on('request', (req, res) => {
          // コードは GET のクエリ文字列で届く。それ以外は提供元ではない。
          const url = new URL(req.url || '/', `http://127.0.0.1:${bound}`);
          const params = url.searchParams;
          const got = params.get('state');
          if (!got || got !== state) {
            // 捨てて、待ちは続ける。偽装した応答が、本物の認可を終わらせられてもいけない。
            send(res, 400, PAGE_STRAY);
            return;
          }
          const error = params.get('error');
          if (error) {
            const description = params.get('error_description');
            send(res, 200, PAGE_DENIED);
            finish(() => reject(new Error(description ? `${error}: ${description}` : error)));
            return;
          }
          const code = params.get('code');
          if (!code) {
            send(res, 400, PAGE_STRAY);
            return;
          }
          send(res, 200, PAGE_OK);
          finish(() => resolve({ code, iss: params.get('iss') }));
        });
      });
    },
    close,
  };
}

export { DEFAULT_TIMEOUT_MS, startLoopbackListener };
