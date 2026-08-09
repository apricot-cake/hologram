// ループバックのリダイレクトを待ち受ける側（app/src/main/lib-oauth-loopback.ts）。
//
// このソケットは、認可の最中に外部から届く唯一の口なので、攻撃側と同じ手順で動かす＝
// state が違う・state が無い・1つ目のあとに2つ目の応答が来る・既に埋まっているポートへの
// 要求。待受は模造せず本物を使う（実際に bind し、実際の HTTP を話す）＝見ている性質そのものが
// ソケットの振る舞いだから。

import http from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { startLoopbackListener } from '../app/src/main/lib-oauth-loopback';

const open: Array<{ close(): void }> = [];
afterEach(() => {
  for (const l of open.splice(0)) l.close();
});

async function start(port: number | null = null) {
  const listener = await startLoopbackListener(port);
  open.push(listener);
  return listener;
}

/** リダイレクトのあとにブラウザがするのと同じ形で、待受を叩く。 */
async function callback(port: number, query: Record<string, string>): Promise<number> {
  const url = new URL(`http://127.0.0.1:${port}/`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url);
  await res.text();
  return res.status;
}

describe('ループバック待受', () => {
  test('state が一致する応答から code を取り出す', async () => {
    const listener = await start();
    const waiting = listener.waitForCallback('state-1');
    expect(await callback(listener.port, { code: 'the-code', state: 'state-1' })).toBe(200);
    expect(await waiting).toEqual({ code: 'the-code', iss: null });
  });

  test('iss（RFC 9207）が付いていれば拾う', async () => {
    const listener = await start();
    const waiting = listener.waitForCallback('s');
    await callback(listener.port, { code: 'c', state: 's', iss: 'https://accounts.google.com' });
    expect((await waiting).iss).toBe('https://accounts.google.com');
  });

  test('state が違う応答は破棄され、待受は本物を待ち続ける', async () => {
    const listener = await start();
    const waiting = listener.waitForCallback('state-1');
    // 偽造したリダイレクトが、本物の認可を打ち切れてはいけない。
    expect(await callback(listener.port, { code: 'forged', state: 'state-2' })).toBe(400);
    expect(await callback(listener.port, { state: 'state-1' })).toBe(400); // code が無い
    expect(await callback(listener.port, { code: 'real', state: 'state-1' })).toBe(200);
    expect((await waiting).code).toBe('real');
  });

  test('error 応答（同意のキャンセル）は失敗として返る', async () => {
    const listener = await start();
    const waiting = listener.waitForCallback('s');
    // 応答が届くより前にアサーションを繋いでおく。棄却はサーバーの要求ハンドラの中で
    // 起きるので、あとからハンドラを足すと、未処理の棄却が1ティック残る。
    const rejects = expect(waiting).rejects.toThrow(/access_denied/);
    await callback(listener.port, { error: 'access_denied', error_description: 'user cancelled', state: 's' });
    await rejects;
  });

  test('応答を受けた時点で待受は閉じる（あとから届いても届かない）', async () => {
    const listener = await start();
    const waiting = listener.waitForCallback('s');
    await callback(listener.port, { code: 'c', state: 's' });
    await waiting;
    await expect(fetch(`http://127.0.0.1:${listener.port}/?code=x&state=s`)).rejects.toThrow();
  });

  test('閉じると待ちも終わる（タイムアウトまで宙に浮かない）', async () => {
    // 取り消しの経路。呼び出し側は finally で閉じるので、待っている側もその場で失敗
    // しなければいけない。そうしないと、誰も聞いていない数分後に棄却され、メイン
    // プロセスの未処理の棄却になる。
    const listener = await start();
    const waiting = listener.waitForCallback('s', 60_000);
    const rejects = expect(waiting).rejects.toThrow(/closed/);
    listener.close();
    await rejects;
  });

  test('待ちきれなければタイムアウトし、ポートを手放す', async () => {
    const listener = await start();
    await expect(listener.waitForCallback('s', 30)).rejects.toThrow(/timed out/);
    await expect(fetch(`http://127.0.0.1:${listener.port}/`)).rejects.toThrow();
  });

  test('固定ポートが埋まっていれば、そのポート名で失敗する', async () => {
    // Microsoft のリダイレクト URI はポートを1つ名指しするので、報告できる代替が無い＝
    // どのポートを空ければよいかを文言が言わなければいけない。
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen({ host: '127.0.0.1', port: 0 }, () => resolve()));
    const taken = (blocker.address() as { port: number }).port;
    try {
      await expect(startLoopbackListener(taken)).rejects.toThrow(new RegExp(`port ${taken} is already in use`));
    } finally {
      blocker.close();
    }
  });

  test('待受は 127.0.0.1 だけ（他のインターフェースには出ない）', async () => {
    const listener = await start();
    // IPv6 のループバック側では同じポートが空いていなければいけない＝そこには何も bind していない。
    const probe = http.createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen({ host: '::1', port: listener.port, ipv6Only: true }, () => resolve());
    }).catch((err: NodeJS.ErrnoException) => {
      // IPv6 をまったく持たないマシンは、この性質の失敗ではない。
      if (err.code !== 'EAFNOSUPPORT' && err.code !== 'EADDRNOTAVAIL') throw err;
    });
    probe.close();
  });
});
