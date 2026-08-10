// #894＝メディアのダウンロードが失敗した理由が、できる範囲でという契約の下でも残ること。
//
// media-download.mts のダウンローダはどれも、失敗に対して null を返す。保存（あるいは
// 取り込み、埋め戻し）がそれ無しで先へ進むためだ。意図してそうしているのだが、以前は理由
// まで消していた＝HTTP 403 も、SSRF ガードが断ったアドレスも、対応しない content-type も、
// ソケットのリセットも、どれも同じ1つの null だった。#894 の Qiita のブックマーク保存が
// まったく診断できなかったのはこれが理由。今は失敗が診断のチャンネルへ理由を流す。
//
// ここで見るもの: 各失敗の経路が報告する理由（手を打てるだけの欄＝ステータス、
// content-type、DNS の答えを伴っていること）、戻り値が以前とまったく同じであること
//（契約には一切触っていない）、そして購読者が投げてもダウンロードを壊せないこと。

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const realFetch = global.fetch;

let dir: string;
let downloadMedia: any;
let saveStillImage: any;
let subscribeMediaFailures: any;
let createGuardedLookup: any;

// 走っているテストがその都度設定する。共有の fetch スタブ1つで全部をまかなうため。
let respond: (url: string) => Promise<Response> = async () => new Response('nope', { status: 404 });

// `run` が動いている間に流れた失敗を集める。
async function failuresOf<T>(run: () => Promise<T>): Promise<{ result: T; failures: any[] }> {
  const failures: any[] = [];
  const unsubscribe = subscribeMediaFailures((info: any) => failures.push(info));
  try {
    return { result: await run(), failures };
  } finally {
    unsubscribe();
  }
}

beforeAll(async () => {
  dir = path.join(process.env.HOLOGRAM_CONFIG_DIR as string, 'diag');
  fs.mkdirSync(dir, { recursive: true });
  global.fetch = ((url: unknown) => respond(String(url))) as typeof fetch;
  // media-download.mts は `module.exports` で公開していて、このプロジェクトのバンドラの
  // 解決ではその形を表せない（tsconfig.test.json の原因 (a)）。キャストしておくことで、
  // この一式は兄弟の media-download の一式2つが載っている隔離の一覧へ加わらず、型検査の
  // 対象に留まる。
  const mediaDownload = (await import('../native-host/media-download.mts')) as any;
  ({ downloadMedia, saveStillImage, subscribeMediaFailures, createGuardedLookup } = mediaDownload);
});

afterAll(() => {
  global.fetch = realFetch;
});

describe('失敗の理由が残る', () => {
  test('HTTP エラーはステータスごと残る', async () => {
    respond = async () => new Response('forbidden', { status: 403 });
    const { result, failures } = await failuresOf(() => saveStillImage('https://cdn.test/a.png', undefined, dir, 'diag-403'));

    expect(result).toBe(null); // できる範囲でという契約は変わらない
    expect(failures).toEqual([expect.objectContaining({ reason: 'http-status', status: 403, url: 'https://cdn.test/a.png', stem: 'diag-403' })]);
  });

  test('受け付けない content-type は型名ごと残る（本文を読む前に断ったことも分かる）', async () => {
    respond = async () => new Response('<html>error page</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    const { result, failures } = await failuresOf(() => saveStillImage('https://cdn.test/b.png', undefined, dir, 'diag-ct'));

    expect(result).toBe(null);
    expect(failures).toEqual([expect.objectContaining({ reason: 'content-type', contentType: 'text/html', status: 200 })]);
  });

  test('SSRF ガードが断った URL は断った跳び先ごと残る', async () => {
    respond = async () => new Response('', { status: 302, headers: { location: 'https://127.0.0.1/secret.png' } });
    const { result, failures } = await failuresOf(() => saveStillImage('https://cdn.test/c.png', undefined, dir, 'diag-ssrf'));

    expect(result).toBe(null);
    expect(failures).toEqual([expect.objectContaining({ reason: 'url-refused', url: 'https://cdn.test/c.png', hop: 'https://127.0.0.1/secret.png' })]);
  });

  test('終わらないリダイレクト連鎖は http-status と区別される', async () => {
    let n = 0;
    respond = async () => new Response('', { status: 302, headers: { location: `https://cdn.test/hop-${n++}.png` } });
    const { failures } = await failuresOf(() => saveStillImage('https://cdn.test/d.png', undefined, dir, 'diag-loop'));

    expect(failures).toEqual([expect.objectContaining({ reason: 'too-many-redirects', status: 302 })]);
  });

  test('ネットワーク失敗は cause の連鎖まで文字列で残る（"fetch failed" だけでは何も分からない）', async () => {
    respond = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND cdn.test'), { code: 'ENOTFOUND' }) });
    };
    const { result, failures } = await failuresOf(() => saveStillImage('https://cdn.test/e.png', undefined, dir, 'diag-net'));

    expect(result).toBe(null);
    expect(failures[0]).toMatchObject({ reason: 'threw' });
    expect(failures[0].error).toContain('TypeError: fetch failed');
    expect(failures[0].error).toContain('ENOTFOUND');
  });

  test('本文が空なら empty-body（capped でも broken でもないことが分かる）', async () => {
    respond = async () => new Response(new Uint8Array(0), { status: 200, headers: { 'content-type': 'image/png' } });
    const { failures } = await failuresOf(() => saveStillImage('https://cdn.test/f.png', undefined, dir, 'diag-empty'));

    expect(failures).toEqual([expect.objectContaining({ reason: 'empty-body' })]);
  });

  test('中身が対応形式でない octet-stream は嗅いだ結果ごと残る', async () => {
    respond = async () => new Response(Buffer.from('%PDF-1.7 not an image at all'), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    const { failures } = await failuresOf(() => saveStillImage('https://cdn.test/g.png', undefined, dir, 'diag-sniff'));

    expect(failures).toEqual([expect.objectContaining({ reason: 'sniff-unsupported', contentType: 'application/octet-stream', sniffed: null })]);
  });

  test('https でない URL は1本も飛ばさずに残る', async () => {
    const { failures } = await failuresOf(() => saveStillImage('http://cdn.test/h.png', undefined, dir, 'diag-scheme'));

    expect(failures).toEqual([expect.objectContaining({ reason: 'not-https', url: 'http://cdn.test/h.png' })]);
  });
});

// ガードは fetch のコネクタの内側で断るので、上流には不透明な失敗しか見えない＝実際に
// 見えたアドレスだけが、「CDN が private なアドレスを答えた」のか「名前が死んでいる」のかを
// 切り分けられる（#894 で最有力だった仮説）。
describe('DNS ガードの判断が残る', () => {
  const answers = (addresses: string[]) => (_host: string, _opts: unknown, cb: (e: unknown, a?: unknown) => void) =>
    cb(
      null,
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );

  test('private を含む解決結果は、見えた全アドレスごと残る', async () => {
    const lookup = createGuardedLookup(answers(['151.101.90.208', '10.0.0.5']));
    const { failures } = await failuresOf(
      () =>
        new Promise<unknown>((resolve) => {
          lookup('cdn.test', {}, (err: unknown) => resolve(err));
        }),
    );

    expect(failures).toEqual([expect.objectContaining({ reason: 'dns-refused', host: 'cdn.test', addresses: ['151.101.90.208', '10.0.0.5'] })]);
  });

  test('解決そのものの失敗は dns-failed（ガードの拒否と混ざらない）', async () => {
    const lookup = createGuardedLookup((_h: string, _o: unknown, cb: (e: unknown) => void) => cb(Object.assign(new Error('queryA ESERVFAIL'), { code: 'ESERVFAIL' })));
    const { failures } = await failuresOf(
      () =>
        new Promise<unknown>((resolve) => {
          lookup('cdn.test', {}, (err: unknown) => resolve(err));
        }),
    );

    expect(failures[0]).toMatchObject({ reason: 'dns-failed', host: 'cdn.test' });
    expect(failures[0].error).toContain('ESERVFAIL');
  });

  test('全部 public なら何も報告しない（成功は静か）', async () => {
    const lookup = createGuardedLookup(answers(['151.101.90.208']));
    const { failures } = await failuresOf(
      () =>
        new Promise<unknown>((resolve) => {
          lookup('cdn.test', {}, (err: unknown, addrs: unknown) => resolve(err || addrs));
        }),
    );

    expect(failures).toEqual([]);
  });
});

describe('診断は保存を壊さない', () => {
  test('購読者が投げても保存は成功する', async () => {
    respond = async () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    const unsubscribe = subscribeMediaFailures(() => {
      throw new Error('subscriber blew up');
    });
    try {
      const saved = await downloadMedia([{ url: 'https://cdn.test/ok.png', alt: null }], dir, 'diag-alive');
      expect(saved).toHaveLength(1);
      expect(fs.existsSync(path.join(dir, saved[0].file))).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  test('購読者が投げても失敗の戻り値は null のまま', async () => {
    respond = async () => new Response('nope', { status: 500 });
    const unsubscribe = subscribeMediaFailures(() => {
      throw new Error('subscriber blew up');
    });
    try {
      expect(await saveStillImage('https://cdn.test/i.png', undefined, dir, 'diag-throwing')).toBe(null);
    } finally {
      unsubscribe();
    }
  });

  test('購読者がいなければ何も起きない（既定の呼び出し元は費用ゼロ）', async () => {
    respond = async () => new Response('nope', { status: 500 });
    expect(await saveStillImage('https://cdn.test/j.png', undefined, dir, 'diag-nosub')).toBe(null);
  });
});
