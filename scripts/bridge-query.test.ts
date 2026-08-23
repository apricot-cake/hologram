// ブリッジの保存済み索引＝タイムラインの「保存済み」の印の読み経路（#54）。答えを
// 組み立てる3つの出所（アプリが書く bridge-saved-index.json のスナップショット、それ
// より新しい loose な inbox エンベロープ、ブリッジ自身のジャーナル＝#5 St6 / #299 の
// .index.json とサイドカー直読みを置き換えたもの）と、レンダラーと共有する URL の表記
// 正規化、そして長生きするポートの答えを最新に保つキャッシュ無効化を対象にする。
//
// この一式は順番に状態を積み上げていく（各節の書き込みが次の節の前提になる）ので、
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
// 応答は投稿ごとに {id, media}（#334）。captureId だけが欲しい節はこれ経由で読む。
const askId = (url: string) => ask(url)[url]?.id ?? null;
// 投稿の保存済みの絵＝ライブラリが記録した URL の配列（並びは media 行の seq に対応）。
const askMedia = (url: string) => ask(url)[url]?.media ?? null;
const askTotal = (url: string) => ask(url)[url]?.total ?? null;

// ブリッジが書くのと同じ形の inbox エンベロープ（native-host/inbox.mts の
// writeInboxEvent と等価）。eventId（先頭の epoch）が、scanRecentInbox の読む保存時刻に
// なる。
function writeInboxEnvelope(id: string, url: string, media: Array<{ url: string; file: string }> = []) {
  const record = normalizePostRecord({ captureId: id, url, image: `${id}.jpg`, media });
  const envelope = buildEnvelope(record);
  const dir = path.join(saveFolder, '.hologram-inbox', 'new');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(envelope), 'utf8');
}

// アプリ側のスナップショット（configDir/bridge-saved-index.json。lib-saved-index.ts が
// DB から作り直すのと同じ postKey → captureId の形）。mtime は明示して入れる＝索引が
// 古いかどうかの判定はこの時刻との比較だけでできているので、ファイルシステムの時計と
// 競争させずテスト側が持つ。
function writeSavedIndex(records: Array<{ captureId: string; url: string; media?: Array<string | null>; total?: number | null }>, mtimeMs: number) {
  const entries: Record<string, { id: string; media: Array<string | null>; total?: number | null }> = {};
  for (const rec of records) {
    const key = postKeyOf(rec.url);
    if (key) entries[key] = { id: rec.captureId, media: rec.media || [], ...(rec.total == null ? {} : { total: rec.total }) };
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

  ({ handleQuery, noteSaved, _resetSavedIndex } = await import('../native-host/bridge.mts'));

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

// レンダラーと同じ規則の唯一の実装
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

// アプリを閉じている間に保存したもの。bridge-saved-index.json へ畳み込むにはデスクトップ
// アプリが動いている必要があるが、印はそれを待ってはいけない。
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
    _resetSavedIndex(); // 新しいプロセス（新しいポート）と等価

    expect(askId(url)).toBe('1700000009999-cc');
  });

  test('ジャーナルは configDir に書かれる', () => {
    expect(fs.existsSync(path.join(configDir, 'bridge-journal.jsonl'))).toBe(true);
  });
});

// ジャーナル行のタイムスタンプより後の mtime でスナップショットを書き直す＝その行は冗長に
// なる。それでも「保存済み」と答えるはず。今度はスナップショット自身を根拠にして。
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

// ここでは _resetSavedIndex を呼ばない＝これは無効化の経路であって、冷えた状態から組み
// 立てる話ではない（1つのポートは1つのフィードの寿命のあいだ生きたままになる）
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
  // bridge-saved-index.json は configDir にあり、saveFolder が存在するかどうかに依存
  // しない（#299 の設計＝ .index.json のような saveFolder 内のスナップショットと違い、
  // DB から作り直せるスナップショットを configDir へ書く）。だから直前にアプリが書いた
  // レコードは、saveFolder が消えても生き残る。
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

// #334: 印の問いは投稿ごとではなく絵ごと＝「この絵が既にライブラリにあるか」。複数枚の
// 投稿のうち1枚だけが保存済みなのはよくあることなので、応答はその投稿のレコードが持つ
// 絵の粒度まで答えられなければならない。
describe('9. 保存済みの絵を投稿ごとに答える', () => {
  const url = 'https://x.com/multi/status/1234';
  const A = 'https://pbs.twimg.com/media/AAA?format=jpg&name=orig';
  const B = 'https://pbs.twimg.com/media/BBB?format=jpg&name=orig';

  beforeAll(() => {
    // 8 節が saveFolder を消したままにしたので戻す（inbox を読むのに要る）
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));
  });

  test('スナップショットが持つ絵をそのまま返す', () => {
    // スナップショットを「今より前」に置く＝後に続く noteSaved のジャーナル行が
    //「もうスナップショットへ畳み込み済み」として捨てられないようにする（5 節の規則）。
    writeSavedIndex([{ captureId: '1700000020000-e1', url, media: [A], total: 3 }], Date.now() - 60_000);
    _resetSavedIndex();

    expect(askId(url)).toBe('1700000020000-e1');
    expect(askMedia(url)).toEqual([A]);
    expect(askTotal(url)).toBe(3);
  });

  // 2枚目の絵を保存すると別のレコードになる（1つ目に追記されない）ので、投稿の絵は
  // レコードをまたいで散らばる。片方しか読まないと、既に保存済みの絵に保存ボタンが出る。
  test('同じ投稿の2つ目のレコードの絵が合流する', () => {
    noteSaved(url, '1700000021000-e2', [{ url: B, file: 'x.jpg' }], 3);

    expect(askMedia(url)).toEqual([A, B]);
    expect(askTotal(url)).toBe(3);
  });

  test('同じ絵を2度保存しても並びは増えない', () => {
    noteSaved(url, '1700000022000-e3', [{ url: A, file: 'y.jpg' }]);

    expect(askMedia(url)).toEqual([A, B]);
  });

  test('再構築後も（ジャーナル経由で）同じ答えに届く', () => {
    _resetSavedIndex();

    expect(askMedia(url)).toEqual([A, B]);
    expect(askTotal(url)).toBe(3);
  });

  test('アプリを閉じている間に保存した投稿は inbox エンベロープが絵を運ぶ', () => {
    const other = 'https://x.com/multi/status/5678';
    writeInboxEnvelope(`${Date.now() + 240_000}-e4`, other, [{ url: B, file: 'z.jpg' }]);
    _resetSavedIndex();

    expect(askMedia(other)).toEqual([B]);
  });

  // 絵が分からないこと（テキストのみの投稿、ダウンロードが全部失敗した取り込み、#334
  // より前に書かれたスナップショット）は「絵が1枚も保存されていない」とは違う。空の一覧
  // ＝「保存済み、粒度は不明」であり、呼び出し側は投稿まるごととして扱えばよい。
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

// #158: 実ファイルがゴミ箱に残っている投稿の告知。保存済みの答えとは別のマップで返る＝
// results の側は null のまま（印を光らせてはいけない）で、trashed の側に載せて運ぶ。
// ここまでの節が書いたスナップショットには trashed フィールドが無く、その状態が
//「#158 より前のアプリ」を再現している（最初のテストがそれを固定する）。
describe('10. ゴミ箱の告知', () => {
  const TRASHED = 'https://x.com/gone/status/501';
  const LIVE_AND_TRASHED = 'https://x.com/both/status/502';
  const askTrashed = (url: string) => handleQuery({ type: 'query', urls: [url] }).trashed?.[url] ?? null;

  // 明示して書く＝スナップショットに trashed マップを足す。キャッシュを確実に無効化する
  // ため、mtime は他の節と同じ方法で未来に置く。
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

  // ライブラリに生きているレコードがあれば、それが答え。アプリ側のビルダーも同じ規則で
  // trashed から落とす。ただしブリッジ側には、スナップショットが決して知りえない出所
  //（ジャーナルと loose inbox の追いつき）がある。ここでも同じ規則をかけないと取りこぼす。
  test('保存済みが勝つ＝同じ投稿が両方に載っていても trashed には出さない', () => {
    const key = postKeyOf(LIVE_AND_TRASHED) as string;
    writeIndexWithTrash({ [key]: { id: 'cap-live', media: [] } }, { [key]: { id: 'cap-old', deletedAt: '2026-07-01T09:00:00Z' } }, 480_000);

    expect(askId(LIVE_AND_TRASHED)).toBe('cap-live');
    expect(askTrashed(LIVE_AND_TRASHED)).toBeNull();
  });

  // ジャーナル経由（アプリを閉じている間にブリッジ自身が保存した）＝スナップショットの
  // trashed エントリはその保存を知らない。後から保存済みの答えが加われば、告知は消える。
  test('スナップショット後にブリッジが保存した投稿の告知も消える', () => {
    const url = 'https://x.com/resaved/status/503';
    writeIndexWithTrash({}, { [postKeyOf(url) as string]: { id: 'cap-old', deletedAt: '2026-07-01T09:00:00Z' } }, 540_000);
    expect(askTrashed(url)).toEqual({ id: 'cap-old', deletedAt: '2026-07-01T09:00:00Z' });

    noteSaved(url, '1700000030000-f1', []);

    expect(askId(url)).toBe('1700000030000-f1');
    expect(askTrashed(url)).toBeNull();
  });

  // スナップショットはこのプロセスが書いたものではない＝壊れた値がそのまま応答へ抜けると、
  // 日付を描く拡張機能の側が落ちる。読むときに型の検証を通す。
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
