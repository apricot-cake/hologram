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

// ブリッジが書くのと同じ形の inbox エンベロープ（native-host/inbox.mts の
// writeInboxEvent 相当）。eventId（先頭の epoch）が scanRecentInbox の読む
// 保存時刻になる。
function writeInboxEnvelope(id: string, url: string) {
  const record = normalizePostRecord({ captureId: id, url, image: `${id}.jpg` });
  const envelope = buildEnvelope(record);
  const dir = path.join(saveFolder, '.hologram-inbox', 'new');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(envelope), 'utf8');
}

// アプリ側のスナップショット（configDir/bridge-saved-index.json、lib-saved-index.ts
// が DB から再構築するのと同じ postKey -> captureId 形）。mtime は明示的に置く＝
// インデックスの陳腐化判定は全てこの時刻との比較なので、ファイルシステムの時計と
// 競争させずテスト側が持つ。
function writeSavedIndex(records: Array<{ captureId: string; url: string }>, mtimeMs: number) {
  const entries: Record<string, string> = {};
  for (const rec of records) {
    const key = postKeyOf(rec.url);
    if (key) entries[key] = rec.captureId;
  }
  fs.mkdirSync(configDir, { recursive: true });
  const p = path.join(configDir, 'bridge-saved-index.json');
  fs.writeFileSync(p, JSON.stringify({ format: 'hologram-bridge-saved-index', version: 1, generatedAt: new Date(mtimeMs).toISOString(), entries }), 'utf8');
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
    expect(ask('https://x.com/someone/status/111')['https://x.com/someone/status/111']).toBe('1700000000000-aa');
  });

  test('未保存の投稿は null', () => {
    expect(ask('https://x.com/someone/status/999')['https://x.com/someone/status/999']).toBeNull();
  });
});

// レンダラーと同じ規則の、ただ1つの実装
describe('2. URL の表記ゆれを正規化する', () => {
  test('twitter.com＋クエリ文字列でも同じ投稿', () => {
    const u = 'https://twitter.com/other_handle/status/111?s=20';
    expect(ask(u)[u]).toBe('1700000000000-aa');
  });

  test('/photo/N のパーマリンクも同じ投稿', () => {
    const u = 'https://x.com/someone/status/111/photo/1';
    expect(ask(u)[u]).toBe('1700000000000-aa');
  });

  test('プロフィール URL は投稿ではない', () => {
    expect(ask('https://x.com/someone')['https://x.com/someone']).toBeNull();
  });

  test('解釈できない URL は投稿ではない', () => {
    expect(ask('not a url')['not a url']).toBeNull();
  });
});

// アプリを閉じている間に保存したもの。bridge-saved-index.json へ畳み込むには
// デスクトップアプリが動く必要があるが、バッジはそれを待ってはいけない。
describe('3. スナップショットより新しい loose inbox エンベロープ', () => {
  test('言語接頭辞つき URL でも見つかる', () => {
    writeInboxEnvelope(`${SNAP_MS + 5000}-bb`, 'https://www.pixiv.net/artworks/4242');
    _resetSavedIndex();

    expect(ask('https://www.pixiv.net/en/artworks/4242')['https://www.pixiv.net/en/artworks/4242']).toBe(`${SNAP_MS + 5000}-bb`);
  });
});

// noteSaved は handleSave/handleSaveDragged が inbox エンベロープを書き終えた時に呼ぶもの
describe('4. ジャーナル＝このプロセスが保存した直後', () => {
  const url = 'https://bsky.app/profile/alice.test/post/3kzz';

  test('保存直後から即答できる（メモリ上の対応表）', () => {
    noteSaved(url, '1700000009999-cc');

    expect(ask(url)[url]).toBe('1700000009999-cc');
  });

  test('再起動後も bridge-journal.jsonl 経由で同じ答えに届く', () => {
    _resetSavedIndex(); // 新しいプロセス（新しいポート）に相当

    expect(ask(url)[url]).toBe('1700000009999-cc');
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

    expect(ask(url)[url]).toBe('1700000009999-cc');
  });
});

// ここでは _resetSavedIndex を呼ばない＝これは無効化の経路であって、冷えた状態からの
// 構築ではない（1つのポートがフィード1本ぶん生き続ける）
describe('6. キャッシュはスナップショットの mtime に追従する', () => {
  const url = 'https://misskey.io/notes/9newnote';

  test('アプリが書く前は未知', () => {
    expect(ask(url)[url]).toBeNull();
  });

  test('スナップショットを書き直すとキャッシュが無効になる', () => {
    writeSavedIndex(
      [
        { captureId: '1700000000000-aa', url: 'https://x.com/someone/status/111' },
        { captureId: '1700000011111-dd', url },
      ],
      Date.now() + 120_000,
    );

    expect(ask(url)[url]).toBe('1700000011111-dd');
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

    expect(ask('https://x.com/someone/status/111')['https://x.com/someone/status/111']).toBe('1700000000000-aa');
  });

  test('スナップショット自体が無ければ throw せず「保存されていない」と答える', () => {
    fs.rmSync(path.join(configDir, 'bridge-saved-index.json'), { force: true });
    fs.rmSync(path.join(configDir, 'bridge-journal.jsonl'), { force: true });
    _resetSavedIndex();

    expect(ask('https://x.com/someone/status/111')['https://x.com/someone/status/111']).toBeNull();
  });
});
