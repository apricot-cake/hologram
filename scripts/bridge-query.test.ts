// ブリッジの保存済みインデックス＝タイムラインの「保存済み」バッジの読み出し経路（#54）。
// 答えを組み立てる3つの情報源（アプリの bridge-saved-index.json スナップショット・
// それより新しい loose inbox エンベロープ・ブリッジ自身のジャーナル、#5 St6 / #299 で
// .index.json＋sidecar 直読みから置き換え）と、レンダラーと共有する URL 表記の正規化、
// 長生きするポートの答えを最新に保つキャッシュ無効化までを見る。
//
// このスイートは順番に状態を積む（前の節の書き込みが次の節の前提になる）ので、
// テストの宣言順に意味がある。

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { buildEnvelope } from '../native-host/inbox.mts';
import { normalizePostRecord } from '../native-host/post-record.mts';
import { postKeyOf } from '../native-host/post-key.mts';

let saveFolder: string;
let configDir: string;
let handleQuery: any;
let noteSaved: any;
let _resetSavedIndex: any;

const ask = (...urls: unknown[]) => handleQuery({ type: 'query', urls }).results;
// 応答は投稿ごとに {id, media}（#334）。captureId だけを見たい節はこちらで読む。
const askId = (url: string) => ask(url)[url]?.id ?? null;
// その投稿の保存済みの絵＝ライブラリが記録した URL の並び（位置が media 行の seq）。
const askMedia = (url: string) => ask(url)[url]?.media ?? null;

// ブリッジが書くのと同じ形の inbox エンベロープ（native-host/inbox.mts の
// writeInboxEvent 相当）。eventId（先頭の epoch）が scanRecentInbox の読む
// 保存時刻になる。
function writeInboxEnvelope(id: string, url: string, media: Array<{ url: string; file: string }> = []) {
  const record = normalizePostRecord({ captureId: id, url, image: `${id}.jpg`, media });
  const envelope = buildEnvelope(record);
  const dir = path.join(saveFolder, '.hologram-inbox', 'new');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(envelope), 'utf8');
}

// アプリ側のスナップショット（configDir/bridge-saved-index.json、lib-saved-index.ts
// が DB から再構築するのと同じ postKey -> captureId 形）。mtime は明示的に置く＝
// インデックスの陳腐化判定は全てこの時刻との比較なので、ファイルシステムの時計と
// 競争させずテスト側が持つ。
function writeSavedIndex(records: Array<{ captureId: string; url: string; media?: Array<string | null> }>, mtimeMs: number) {
  const entries: Record<string, { id: string; media: Array<string | null> }> = {};
  for (const rec of records) {
    const key = postKeyOf(rec.url);
    if (key) entries[key] = { id: rec.captureId, media: rec.media || [] };
  }
  fs.mkdirSync(configDir, { recursive: true });
  const p = path.join(configDir, 'bridge-saved-index.json');
  fs.writeFileSync(p, JSON.stringify({ format: 'hologram-bridge-saved-index', version: 2, generatedAt: new Date(mtimeMs).toISOString(), entries }), 'utf8');
  fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
}

const SNAP_MS = 1_700_000_000_000;

beforeAll(async () => {
  configDir = process.env.HOLOGRAM_CONFIG_DIR as string;
  saveFolder = path.join(configDir, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(saveFolder, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  ({ handleQuery, noteSaved, _resetSavedIndex } = await import('../native-host/bridge.cts'));

  writeSavedIndex([{ captureId: '1700000000000-aa', url: 'https://x.com/someone/status/111' }], SNAP_MS);
  _resetSavedIndex();
});

describe('1. スナップショットが答える（持っている投稿だけ）', () => {
  test('ヒットしたら captureId を返す', () => {
    expect(askId('https://x.com/someone/status/111')).toBe('1700000000000-aa');
  });

  test('未保存の投稿は null', () => {
    expect(askId('https://x.com/someone/status/999')).toBeNull();
  });
});

// レンダラーと同じ規則の、ただ1つの実装
describe('2. URL の表記ゆれを正規化する', () => {
  test('twitter.com＋クエリ文字列でも同じ投稿', () => {
    const u = 'https://twitter.com/other_handle/status/111?s=20';
    expect(askId(u)).toBe('1700000000000-aa');
  });

  test('/photo/N のパーマリンクも同じ投稿', () => {
    const u = 'https://x.com/someone/status/111/photo/1';
    expect(askId(u)).toBe('1700000000000-aa');
  });

  test('プロフィール URL は投稿ではない', () => {
    expect(askId('https://x.com/someone')).toBeNull();
  });

  test('解釈できない URL は投稿ではない', () => {
    expect(askId('not a url')).toBeNull();
  });
});

// アプリを閉じている間に保存したもの。bridge-saved-index.json へ畳み込むには
// デスクトップアプリが動く必要があるが、バッジはそれを待ってはいけない。
describe('3. スナップショットより新しい loose inbox エンベロープ', () => {
  test('言語接頭辞つき URL でも見つかる', () => {
    writeInboxEnvelope(`${SNAP_MS + 5000}-bb`, 'https://www.pixiv.net/artworks/4242');
    _resetSavedIndex();

    expect(askId('https://www.pixiv.net/en/artworks/4242')).toBe(`${SNAP_MS + 5000}-bb`);
  });
});

// noteSaved は handleSave/handleSaveDragged が inbox エンベロープを書き終えた時に呼ぶもの
describe('4. ジャーナル＝このプロセスが保存した直後', () => {
  const url = 'https://bsky.app/profile/alice.test/post/3kzz';

  test('保存直後から即答できる（メモリ上の対応表）', () => {
    noteSaved(url, '1700000009999-cc');

    expect(askId(url)).toBe('1700000009999-cc');
  });

  test('再起動後も bridge-journal.jsonl 経由で同じ答えに届く', () => {
    _resetSavedIndex(); // 新しいプロセス（新しいポート）に相当

    expect(askId(url)).toBe('1700000009999-cc');
  });

  test('ジャーナルは configDir に書かれる', () => {
    expect(fs.existsSync(path.join(configDir, 'bridge-journal.jsonl'))).toBe(true);
  });
});

// ジャーナル行のタイムスタンプより後の mtime でスナップショットを書き直す＝その行は
// 冗長になる。それでも保存済みと答えられ、今度はスナップショット自身が根拠になる。
describe('5. スナップショットが追いついたジャーナル行は捨てられる', () => {
  test('追いついた後も保存済みと答える', () => {
    const url = 'https://bsky.app/profile/alice.test/post/3kzz';
    writeSavedIndex(
      [
        { captureId: '1700000000000-aa', url: 'https://x.com/someone/status/111' },
        { captureId: '1700000009999-cc', url },
      ],
      Date.now() + 60_000,
    );
    _resetSavedIndex();

    expect(askId(url)).toBe('1700000009999-cc');
  });
});

// ここでは _resetSavedIndex を呼ばない＝これは無効化の経路であって、冷えた状態からの
// 構築ではない（1つのポートがフィード1本ぶん生き続ける）
describe('6. キャッシュはスナップショットの mtime に追従する', () => {
  const url = 'https://misskey.io/notes/9newnote';

  test('アプリが書く前は未知', () => {
    expect(askId(url)).toBeNull();
  });

  test('スナップショットを書き直すとキャッシュが無効になる', () => {
    writeSavedIndex(
      [
        { captureId: '1700000000000-aa', url: 'https://x.com/someone/status/111' },
        { captureId: '1700000011111-dd', url },
      ],
      Date.now() + 120_000,
    );

    expect(askId(url)).toBe('1700000011111-dd');
  });
});

describe('7. バッチの上限と、混ざったゴミの扱い', () => {
  test('300 件で打ち切る', () => {
    const many = Array.from({ length: 400 }, (_, i) => `https://x.com/u/status/${900000 + i}`);
    expect(Object.keys(handleQuery({ type: 'query', urls: [...many, null, 42, ''] }).results)).toHaveLength(300);
  });

  test('空のバッチは拒否せず答える', () => {
    expect(Object.keys(handleQuery({ type: 'query', urls: [] }).results)).toHaveLength(0);
  });

  test('壊れたメッセージも throw せず答える', () => {
    expect(Object.keys(handleQuery({ type: 'query' }).results)).toHaveLength(0);
  });
});

describe('8. 保存フォルダ・スナップショットが無い', () => {
  // bridge-saved-index.json は configDir にあり saveFolder の実在に依存しない
  // （#299 の設計＝DB 由来の再構築可能スナップショットを configDir へ書く、
  // .index.json のような saveFolder 内スナップショットとの違い）ので、直前
  // までにアプリが書いた記録は saveFolder が消えても生き続ける。
  test('保存フォルダが消えていても throw せず答える', () => {
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: path.join(configDir, 'gone') }));
    _resetSavedIndex();

    expect(askId('https://x.com/someone/status/111')).toBe('1700000000000-aa');
  });

  test('スナップショット自体が無ければ throw せず「保存されていない」と答える', () => {
    fs.rmSync(path.join(configDir, 'bridge-saved-index.json'), { force: true });
    fs.rmSync(path.join(configDir, 'bridge-journal.jsonl'), { force: true });
    _resetSavedIndex();

    expect(askId('https://x.com/someone/status/111')).toBeNull();
  });
});

// #334: バッジの問いは投稿単位ではなく画像単位＝「この絵はもうライブラリに在るか」。
// 複数枚投稿の1枚だけを保存した状態が普通に起こるので、応答はその投稿のレコードが
// 持っている絵まで答えられなければならない。
describe('9. 保存済みの絵を投稿ごとに答える', () => {
  const url = 'https://x.com/multi/status/1234';
  const A = 'https://pbs.twimg.com/media/AAA?format=jpg&name=orig';
  const B = 'https://pbs.twimg.com/media/BBB?format=jpg&name=orig';

  beforeAll(() => {
    // 8 で saveFolder を消した状態のままなので戻す（inbox の読み出しが要る）
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));
  });

  test('スナップショットが持つ絵をそのまま返す', () => {
    // スナップショットは「今より前」に置く＝この後の noteSaved のジャーナル行が
    // 「スナップショットに畳み込み済み」として捨てられないようにする（節5の規則）。
    writeSavedIndex([{ captureId: '1700000020000-e1', url, media: [A] }], Date.now() - 60_000);
    _resetSavedIndex();

    expect(askId(url)).toBe('1700000020000-e1');
    expect(askMedia(url)).toEqual([A]);
  });

  // 2枚目の保存は別レコードになる（1件目を書き足すのではない）ので、投稿の絵は
  // レコードをまたいで散らばる。片方だけ読むと、保存済みの絵に保存ボタンが出る。
  test('同じ投稿の2つ目のレコードの絵が合流する', () => {
    noteSaved(url, '1700000021000-e2', [{ url: B, file: 'x.jpg' }]);

    expect(askMedia(url)).toEqual([A, B]);
  });

  test('同じ絵を2度保存しても並びは増えない', () => {
    noteSaved(url, '1700000022000-e3', [{ url: A, file: 'y.jpg' }]);

    expect(askMedia(url)).toEqual([A, B]);
  });

  test('再構築後も（ジャーナル経由で）同じ答えに届く', () => {
    _resetSavedIndex();

    expect(askMedia(url)).toEqual([A, B]);
  });

  test('アプリを閉じている間に保存した投稿は inbox エンベロープが絵を運ぶ', () => {
    const other = 'https://x.com/multi/status/5678';
    writeInboxEnvelope(`${Date.now() + 240_000}-e4`, other, [{ url: B, file: 'z.jpg' }]);
    _resetSavedIndex();

    expect(askMedia(other)).toEqual([B]);
  });

  // 絵が分からないこと（テキストのみの投稿・ダウンロードが全て失敗した取り込み・
  // #334 より前に書かれたスナップショット）は「絵が保存されていない」ではない。
  // 空の一覧＝「保存済み・粒度は不明」で、問う側は投稿まるごととして扱う。
  test('絵を持たないレコードは空の一覧（未保存ではない）', () => {
    const textOnly = 'https://x.com/plain/status/77';
    writeSavedIndex([{ captureId: '1700000023000-e5', url: textOnly }], Date.now() + 300_000);
    _resetSavedIndex();

    expect(askId(textOnly)).toBe('1700000023000-e5');
    expect(askMedia(textOnly)).toEqual([]);
  });

  test('v1 のスナップショット（captureId だけの文字列）も読める', () => {
    const legacy = 'https://x.com/legacy/status/88';
    const key = postKeyOf(legacy) as string;
    const p = path.join(configDir, 'bridge-saved-index.json');
    const mtime = new Date(Date.now() + 360_000);
    fs.writeFileSync(p, JSON.stringify({ format: 'hologram-bridge-saved-index', version: 1, generatedAt: mtime.toISOString(), entries: { [key]: '1700000024000-e6' } }), 'utf8');
    fs.utimesSync(p, mtime, mtime);
    _resetSavedIndex();

    expect(askId(legacy)).toBe('1700000024000-e6');
    expect(askMedia(legacy)).toEqual([]);
  });
});

// #158: ゴミ箱に現物が残っている投稿の告知。保存済みの答えとは別のマップで返る＝
// results 側は null のまま（バッジを点けてはいけない）で、trashed 側に載る。
// ここまでの節が書いてきたスナップショットには trashed が無く、その状態が
// 「#158 より前のアプリ」の再現になっている（最初のテストがそれを押さえる）。
describe('10. ゴミ箱の告知', () => {
  const TRASHED = 'https://x.com/gone/status/501';
  const LIVE_AND_TRASHED = 'https://x.com/both/status/502';
  const askTrashed = (url: string) => handleQuery({ type: 'query', urls: [url] }).trashed?.[url] ?? null;

  // 明示的に書く＝スナップショットに trashed マップを足す。mtime は他の節と同じ方式で
  // 未来に置き、キャッシュを確実に無効化する。
  function writeIndexWithTrash(entries: Record<string, unknown>, trashed: Record<string, unknown>, offsetMs: number) {
    const p = path.join(configDir, 'bridge-saved-index.json');
    const mtime = new Date(Date.now() + offsetMs);
    fs.writeFileSync(p, JSON.stringify({ format: 'hologram-bridge-saved-index', version: 4, generatedAt: mtime.toISOString(), entries, trashed }), 'utf8');
    fs.utimesSync(p, mtime, mtime);
    _resetSavedIndex();
  }

  test('trashed マップを持たないスナップショットは「ゴミ箱に何も無い」と読む', () => {
    expect(handleQuery({ type: 'query', urls: ['https://x.com/legacy/status/88'] }).trashed).toEqual({});
  });

  test('ゴミ箱の投稿は results が null・trashed に削除日つきで載る', () => {
    writeIndexWithTrash({}, { [postKeyOf(TRASHED) as string]: { id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' } }, 420_000);

    expect(askId(TRASHED)).toBeNull();
    expect(askTrashed(TRASHED)).toEqual({ id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' });
  });

  // ライブラリに生きているレコードがあるなら、それが答え。アプリ側のビルダも同じ規則で
  // trashed から落とすが、ブリッジ側には**スナップショットが知りえない情報源**（ジャーナルと
  // loose inbox の後追い）があるので、ここでも効かせないと取りこぼす。
  test('保存済みが勝つ＝同じ投稿が両方に載っていても trashed には出さない', () => {
    const key = postKeyOf(LIVE_AND_TRASHED) as string;
    writeIndexWithTrash({ [key]: { id: 'cap-live', media: [] } }, { [key]: { id: 'cap-old', deletedAt: '2026-07-01T09:00:00Z' } }, 480_000);

    expect(askId(LIVE_AND_TRASHED)).toBe('cap-live');
    expect(askTrashed(LIVE_AND_TRASHED)).toBeNull();
  });

  // ジャーナル経由（アプリが閉じている間にブリッジ自身が保存した）＝スナップショットの
  // trashed はその保存を知らない。保存済みの答えが後から足されても告知は消える。
  test('スナップショット後にブリッジが保存した投稿の告知も消える', () => {
    const url = 'https://x.com/resaved/status/503';
    writeIndexWithTrash({}, { [postKeyOf(url) as string]: { id: 'cap-old', deletedAt: '2026-07-01T09:00:00Z' } }, 540_000);
    expect(askTrashed(url)).toEqual({ id: 'cap-old', deletedAt: '2026-07-01T09:00:00Z' });

    noteSaved(url, '1700000030000-f1', []);

    expect(askId(url)).toBe('1700000030000-f1');
    expect(askTrashed(url)).toBeNull();
  });

  // スナップショットはこのプロセスが書いたものではない＝壊れた値がそのまま応答に乗ると、
  // 日付を描く拡張側で落ちる。読む時に型を通す。
  test('壊れたゴミ箱エントリは型を通してから載る', () => {
    const bad = 'https://x.com/bad/status/504';
    const worse = 'https://x.com/worse/status/505';
    writeIndexWithTrash(
      {},
      {
        [postKeyOf(bad) as string]: { id: 42, deletedAt: { nope: true } },
        [postKeyOf(worse) as string]: 'not an object',
      },
      600_000,
    );

    expect(askTrashed(bad)).toEqual({ id: '', deletedAt: null });
    expect(askTrashed(worse)).toBeNull();
  });

  test('空のバッチ・壊れたメッセージでも trashed は空で返る', () => {
    expect(handleQuery({ type: 'query', urls: [] }).trashed).toEqual({});
    expect(handleQuery({ type: 'query' }).trashed).toEqual({});
  });
});
