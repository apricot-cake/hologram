import { PostRecordInputSchema } from '../../../native-host/post-schemas.mts';
import { PostFlagsSchema } from '../shared/data-schemas.ts';
import { PortableClassifiedTagVocabulary } from '../shared/tag-classification.ts';
import { exportTagClassification, importClassifiedTagVocabulary } from './lib-tag-classification.ts';

import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fromFdPromise as openZipFdForRead, openPromise as openZipForRead } from 'yauzl';
import type { Entry as ZipEntry, ZipFile as ZipReader } from 'yauzl';
import { ZipFile } from 'yazl';
import type Database from 'better-sqlite3';
import { commitFileAtomic } from './lib-atomic.ts';
import { fillCardDims } from './lib-card-dims.ts';
import { fillMediaDims } from './lib-media-dims.ts';
import { parseJsonLoose } from './lib-json.ts';
import { postCapturedVia, postsFromDb } from './lib-db-query.ts';
import { createDbWriter } from './lib-db-write.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';

// config.json はマシンごとに違い（パス、拡張機能の id）、そもそも configDir に居る。#5 より前の
// ライブラリには、古い写しがフォルダに残っていることがある。
const EXPORT_SKIP = new Set(['config.json', 'tabs.json']);
const ORG_MERGE = ['folders.json', 'tag-groups.json', 'classified-tags.json', 'ungrouped.json', 'manual-groups.json', 'poster-favorites.json', 'poster-folders.json', 'poster-tags.json', 'poster-profiles.json'];

function isVolatile(name) {
  return /\.tmp(-|$)/i.test(name) || /\.bak$/i.test(name);
}

// --- zip 爆弾・際限のない展開への防ぎ -------------------------------------
// `hologram-export.zip` はマシン間で受け渡すものなので、悪意のある・壊れたものが、ギガバイトに
// 展開される小さな圧縮 payload を宣言し（zip 爆弾）、取り込みの時にメモリを食い尽くす (DoS) 形が
// ありうる。展開する前に、エントリの数・展開後の合計バイト数・エントリ1つの展開後の大きさに
// 上限を掛ける。使うのは ZIP の中央ディレクトリが宣言している大きさ（読むのが安く、展開が要ら
// ない）。エントリ単位の上限は流し込みの最中にも掛け直すので、嘘をついた中央ディレクトリの
// ヘッダはすり抜けられない。
//
// 大きさは実際のライブラリ（今のところ約7,600キャプチャ。1件がスクリーンショット＋サイド
// カー＋0〜N個の元のメディア＋アバターなので、エントリは数万、元のメディアは数 GB）に対して、
// 育つ余地をたっぷり取って決めた＝ここで断るのは明らかに異常な入力だけで、正当な完全書き出しを
// 断ることは決してない。
const MAX_ZIP_ENTRIES = 200000; // 約2.5万キャプチャ × 1件あたり数ファイル、に余裕を足したもの
const MAX_ZIP_ENTRY_BYTES = 1024 * 1024 * 1024; // 1 GiB。これほど大きなスクリーンショット・サイドカー・メディアは1つも無い
const MAX_ZIP_TOTAL_BYTES = 64 * 1024 * 1024 * 1024; // 書庫全体で展開後 64 GiB
// 整理の層の JSON（下の ORG_MERGE）には、はるかに小さい専用の枠を与える (#382)。
// MAX_ZIP_ENTRY_BYTES は数 GB のメディアを収めるためにあるが、folders.json や tag-groups.json
// などは設定の形をしていて、正当にそこへ近づくことは決してない。1 GiB のメディアの上限に相乗り
// させていると、細工したエントリが、汎用の防ぎが働くより前にメインプロセスの中で数百 MB の
// 文字列と解析済み JSON へ展開されうる。
const MAX_ZIP_ORG_BYTES = 16 * 1024 * 1024; // 16 MiB
// 投稿サイドカーも JSON.parse の前に文字列としてメインプロセスのメモリへ載る。画像・動画向けの
// 1 GiB 枠を共用すると、小さな圧縮ファイルから数百 MiB を展開できてしまうため、整理 JSON と
// 同じ、通常の投稿レコードには十分な専用枠を宣言値と実際の読み取り量の両方へ掛ける。
const MAX_ZIP_CAPTURE_JSON_BYTES = 16 * 1024 * 1024; // 16 MiB
// pixiv のうごイラの書庫 (#119 St3) は第三者のファイルで、再生側はそれを1フレームずつ展開する
// (#506)。だから数 GB のメディアの上限に相乗りさせず、フレーム単位の枠を与える＝フレームは
// 静止画1枚を対象とする。これと対になる書庫
// 単位の合計は意図して持たない＝再生側が書庫を丸ごと抱えることは決してなく、取得の段が自分の
// 大きさの上限を超えたものをすでに断っている。
const MAX_UGOIRA_FRAME_BYTES = 64 * 1024 * 1024; // 64 MiB
// うごイラは中央ディレクトリだけを索引にして ZipFile（= fd）を短時間共有する。展開済みフレーム
// はここへ置かない。書庫数と索引エントリ総数の両方を縛り、巨大な正常入力が複数来ても
// Entry オブジェクトと fd が際限なく残らないようにする。
const MAX_UGOIRA_OPEN_ARCHIVES = 4;
const MAX_UGOIRA_INDEXED_ENTRIES = MAX_ZIP_ENTRIES;
const UGOIRA_INDEX_IDLE_MS = 30_000;
class ZipLimitError extends Error {}
// yauzl は uncompressedSize を中央ディレクトリから直に読む（ZIP64 の追加欄があればそこから幅を
// 広げる）ので、これはどんな大きさの書庫でも宣言された大きさになる。形の壊れた値と欠けた値は
// 0と数える＝ここで嘘をついたエントリを実際に縛るのは、下の流し込み時の上限。
function entryUncompressedSize(entry: ZipEntry) {
  const n = entry?.uncompressedSize;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// 宣言された大きさを事前に足し上げ、展開前に件数とサイズの上限を確認する。
//
// エントリの数は中央ディレクトリの終端レコードから来る。yauzl は open() の時点でそれを読み終えて
// いる＝20万エントリの爆弾は、中央ディレクトリのレコードを1つも読まずに断られるし、そのあと
// yauzl はちょうどその数のエントリを渡す（辿りながら数え直しても、それだけで上限に届くことは
// ありえない）。
function declaredSizeTally(zipfile: ZipReader) {
  if (zipfile.entryCount > MAX_ZIP_ENTRIES) throw new ZipLimitError('archive declares ' + zipfile.entryCount + ' entries (> cap ' + MAX_ZIP_ENTRIES + ')');
  let totalBytes = 0;
  // ディレクトリでないエントリごとに、列挙の順で1回呼ぶ。宣言された大きさを返すので、呼び出し
  // 元はその上に自分のより厳しい枠を掛けられる。
  return (relPath: string, entry: ZipEntry) => {
    const size = entryUncompressedSize(entry);
    if (size > MAX_ZIP_ENTRY_BYTES) throw new ZipLimitError('entry "' + relPath + '" declares ' + size + ' bytes (> per-entry cap ' + MAX_ZIP_ENTRY_BYTES + ')');
    totalBytes += size;
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) throw new ZipLimitError('archive declares > ' + MAX_ZIP_TOTAL_BYTES + ' total uncompressed bytes');
    return size;
  };
}

// --- Zip Slip への防ぎ ------------------------------------------------------------
// 悪意のある ZIP は、遡る並び (..)、バックスラッシュの区切り（Windows ではパスの区切りで、
// スラッシュだけを見る検査には掛からない）、絶対パスやドライブレターの形をエントリ名に持ち
// うる。そうなると書き込みが保存フォルダの外に着地する。
//
// yauzl はエントリ名すべてに自前の validateFileName を掛け（まずバックスラッシュを '/' に
// 畳み、そのうえで絶対パス・ドライブレター・'..' のセグメントを断る）、そうしたエントリを
// 渡すのではなく書庫を丸ごと中止する＝下の読み手を使う限り、この3つの形のどれかを持つ書庫は
// 1バイトも書かれる前に閉じる方向で失敗する。それは外側の層であって、ここの規則の代わりでは
// ない。yauzl は 'library/sub/dir/x.jpg' のような入れ子のパスは平気で渡すが、本物の書き出しは
// 下の isSafeLibraryPath / isSafeTrashPath が認める固定の深さと名前だけに絞る。
//
// パスの各セグメントに使う規則。自分自身の basename であり、どちらの区切りも含まず、
// '.' でも '..' でもなく、絶対パスでもないこと。
function isSafeEntryName(name) {
  if (!name || name === '.' || name === '..') return false;
  if (/[\\/]/.test(name)) return false;
  if (path.isAbsolute(name)) return false;
  return name === path.basename(name);
}
// ライブラリ直下のメタデータ、2つの共有ストア '<store>/<basename>'、項目実体
// 'items/<captureId>/<basename>' だけを認める。各セグメントには同じ規則を掛ける。
function isSafeLibraryPath(name) {
  if (isSafeEntryName(name)) return true;
  const m = /^(avatars|emoji)\/(.+)$/.exec(name);
  if (m && isSafeEntryName(m[2])) return true;
  const item = /^(?:items|quoted-media)\/([^/]+)\/([^/]+)$/.exec(name);
  return !!(item && isSafeEntryName(item[1]) && isSafeEntryName(item[2]));
}
// .trash/<name> と .trash/<captureId>/<name> (#300/St7)。前者は復元用レコード、後者は
// ごみ箱へ移した項目フォルダーの実体。どちらも各セグメントは上の規則に従う。
function isSafeTrashPath(name) {
  if (isSafeEntryName(name)) return true;
  const item = /^([^/]+)\/([^/]+)$/.exec(name);
  return !!(item && isSafeEntryName(item[1]) && isSafeEntryName(item[2]));
}
// 念には念を入れた確認。解決した宛先は destFolder の中に留まらなければならない。今の読み手では
// 意図して到達しない＝外へ出られる名前は、すでに yauzl（1層目）か1セグメントの規則（2層目）が
// 断っているので、この行を発火させる回帰テストは書けない。それでも残しているのは、これが書き
// 込みの直前の最後の確認であり、読み手が名前の検証をやめたとしてもなお効く唯一のものだから。
// isSafeTrashPath の呼び出し元も同じ。
function isWithin(parentDir, target) {
  const p = path.resolve(parentDir);
  const t = path.resolve(target);
  return t === p || t.startsWith(p + path.sep);
}

// --- 整理の層の統合（和を取る） ---------------------------------------------
// {id, name, <members>} という並びの形（投稿者フォルダの items）のための、共有の id での和。
// 名前は最初に現れたものが勝ち（cur を inc より先に渡す＝今あるものが勝つ）、同じ id は
// メンバーを集合として和にする。
function unionById(curList, incList, memberKey) {
  const byId = new Map();
  for (const e of [...(curList || []), ...(incList || [])]) {
    if (!e || typeof e.id !== 'string') continue;
    const members = (e[memberKey] || []).map(String);
    const prev = byId.get(e.id);
    if (prev) for (const m of members) prev[memberKey].add(m);
    else byId.set(e.id, { id: e.id, name: String(e.name || e.id), [memberKey]: new Set(members) });
  }
  return [...byId.values()].map((e) => ({ id: e.id, name: e.name, [memberKey]: [...e[memberKey]] }));
}
// 投稿者フォルダ。素の { folders:[{id,name,items}] } の形。items は id で和を取り、名前は最初に
// 見たものが勝つ。（defaultId は投稿者側では旧来のもので使われていないが、害は無い。）
function mergePosterFolders(cur, inc) {
  const folders = unionById(cur.folders, inc.folders, 'items');
  const defaultId = folders.some((f) => f.id === cur.defaultId) ? cur.defaultId : folders.some((f) => f.id === inc.defaultId) ? inc.defaultId : null;
  return { folders, defaultId };
}
// ライブラリのフォルダの置き場 (folders.json)。items は id で和を取る。name/kind/created/tree は
// 今あるものが勝つ（cur を先に入れ、重なったときは items だけを和にする）。activeId は旧来の
// もので、今も生きているフォルダを指しているならローカルのままにする。
function mergeFolders(rawCur: unknown, rawInc: unknown) {
  const cur = FoldersSchema.parse(rawCur);
  const inc = FoldersSchema.parse(rawInc);
  const byId = new Map();
  const put = (c) => {
    if (byId.has(c.id)) {
      const e = byId.get(c.id);
      for (const it of c.items) e.items.add(it);
      return;
    }
    // parentId は name/kind と一緒に「今あるものが勝つ」で乗る (#41)。フォルダが自分の木の
    // どこに居るかは自分の並べ方であって、書き出した側のマシンの並べ方ではない。入って来た側に
    // しか存在しない親は、宙に浮いた id として着地し、読み手の修復がそれを根のフォルダに変える
    // ＝黙って移動したフォルダと違い、目に見えて直せる。
    const e = { ...c, items: new Set(c.items) };
    // 保存済み検索も（name/kind と同じく）「今あるものが勝つ」で乗るので、他のマシンの ZIP を
    // 取り込んでも、ここで編集した条件が上書きされることは決してない。
    if (c.kind === 'dynamic' && c.tree && typeof c.tree === 'object') e.tree = c.tree;
    byId.set(c.id, e);
  };
  for (const c of cur.folders) put(c);
  for (const c of inc.folders) put(c);
  const folders = [...byId.values()].map((c) => {
    const o: any = { id: c.id, name: c.name, kind: c.kind, created: c.created, parentId: c.parentId, items: [...c.items] };
    if (c.tree) o.tree = c.tree;
    return o;
  });
  const valid = new Set(folders.map((c) => c.id));
  const activeId = cur && valid.has(cur.activeId) ? cur.activeId : inc && valid.has(inc.activeId) ? inc.activeId : null;
  return { folders, activeId };
}
function mergeUngrouped(rawCur: unknown, rawInc: unknown) {
  const cur = UngroupedSchema.parse(rawCur);
  const inc = UngroupedSchema.parse(rawInc);
  return { keys: [...new Set([...cur.keys, ...inc.keys])] };
}
// タグ → 種別のマップ（語彙の帳面）。エントリの和を取り、ローカルですでに分類済みのタグでは
// 今のライブラリが勝つ（意図して付けた種別を、取り込みに上書きさせない）。
function mergeTagGroups(rawCur: unknown, rawInc: unknown) {
  const cur = TagGroupNamesSchema.parse(rawCur);
  const inc = TagGroupNamesSchema.parse(rawInc);
  const memberships = {};
  for (const [t, k] of Object.entries((inc && inc.memberships) || {})) if (k) memberships[String(t)] = String(k);
  for (const [t, k] of Object.entries((cur && cur.memberships) || {})) if (k) memberships[String(t)] = String(k);
  const labels = { ...((inc && inc.labels) || {}), ...((cur && cur.labels) || {}) };
  const out: any = { memberships };
  if (Object.keys(labels).length) out.labels = labels;
  return out;
}
// 手動の返信グループ。captureId の素の配列で、「captureId 1つにつきグループ1つ」の不変条件を
// 持つ。だから統合は集合の重複除去ではない＝[A,B] (cur) と [B,C] (inc) は [A,B,C] へ畳まれ
// なければならない。両方残すと B が2つのグループに居ることになり、下流のメンバー→グループの
// 引き当てが片方を勝手に選んでしまう。メンバーに対して union-find を掛け、出力は最初に見た
// メンバーとグループの順を保つ（cur を先に入れる＝ローカルの側が安定する）。
function mergeManualGroups(rawCur: unknown, rawInc: unknown) {
  const cur = ManualGroupsSchema.parse(rawCur);
  const inc = ManualGroupsSchema.parse(rawInc);
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const order: any[] = [];
  for (const g of [...cur.groups, ...inc.groups]) {
    if (g.length < 2) continue;
    const arr = g;
    for (const id of arr) {
      if (!parent.has(id)) {
        parent.set(id, id);
        order.push(id);
      }
    }
    for (let i = 1; i < arr.length; i++) {
      const ra = find(arr[0]);
      const rb = find(arr[i]);
      if (ra !== rb) parent.set(ra, rb);
    }
  }
  const byRoot = new Map();
  for (const id of order) {
    const r = find(id);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(id);
  }
  // 2未満になるのは [A,A] のような退化した入力のグループからだけ。落とす。
  return { groups: [...byRoot.values()].filter((g) => g.length >= 2) };
}
// 投稿者ごとのタグ。{ tags: { posterKey: [tag, …] } }。posterKey ごとにタグの並びの和を取るので、
// 取り込みが投稿者の既存のタグを落とすことは決してない。
function mergePosterTags(rawCur: unknown, rawInc: unknown) {
  const cur = PosterTagNamesSchema.parse(rawCur);
  const inc = PosterTagNamesSchema.parse(rawInc);
  const out = {};
  const add = (src) => {
    for (const [k, list] of Object.entries(src.tags) as [string, string[]][]) {
      const set = out[k] || (out[k] = new Set());
      for (const t of list) set.add(t);
    }
  };
  add(cur);
  add(inc);
  const tags = {};
  for (const [k, set] of Object.entries(out)) tags[k] = [...(set as any[])];
  return { tags };
}
// 投稿者プロフィールは posterKey ごとに現在値を1件だけ保持する。
// 同じ投稿者が両方にある場合は、既存ライブラリの現在値を採る。
function mergePosterProfiles(rawCur: unknown, rawInc: unknown) {
  const cur = PosterProfilesSchema.parse(rawCur);
  const inc = PosterProfilesSchema.parse(rawInc);
  const byKey = new Map();
  for (const source of [cur, inc]) {
    for (const profile of source.profiles) {
      if (byKey.has(profile.posterKey)) {
        const current = byKey.get(profile.posterKey);
        const names = new Map(current.names.map((name) => [JSON.stringify([name.field, name.value]), name]));
        for (const name of profile.names) {
          const key = JSON.stringify([name.field, name.value]);
          const old = names.get(key) as typeof name | undefined;
          names.set(key, old ? { ...old, firstObservedAt: old.firstObservedAt < name.firstObservedAt ? old.firstObservedAt : name.firstObservedAt, lastObservedAt: old.lastObservedAt > name.lastObservedAt ? old.lastObservedAt : name.lastObservedAt } : name);
        }
        current.names = [...names.values()];
        continue;
      }
      byKey.set(profile.posterKey, profile);
    }
  }
  return { profiles: [...byKey.values()] };
}

const MERGERS = {
  'folders.json': mergeFolders, // ライブラリのフォルダの置き場
  'tag-groups.json': mergeTagGroups,
  'ungrouped.json': mergeUngrouped,
  'manual-groups.json': mergeManualGroups,
  'poster-favorites.json': mergeUngrouped, // 同じ { keys } の形 → 和で統合
  'poster-folders.json': mergePosterFolders, // 素の { folders } の形 → id での和で統合
  'poster-tags.json': mergePosterTags, // { tags:{posterKey:[…]} } → キーごとの和
  'poster-profiles.json': mergePosterProfiles, // posterKey で和を取り、現在のライブラリ側を優先
};

// --- 組み立て ---------------------------------------------------------------------
// 保存フォルダの中で書き出せるファイルを列挙する。内部のもの・一時的なもの・ファイルでないもの
// を飛ばし、任意で名前の絞り込みも掛ける。2つの ZIP の組み立てが共有する。
async function collectFiles(srcFolder, nameFilter?) {
  let names: any[] = [];
  try {
    names = await fs.promises.readdir(srcFolder);
  } catch {
    names = [];
  }
  const out: any[] = [];
  for (const name of names) {
    if (EXPORT_SKIP.has(name) || isVolatile(name)) continue;
    if (nameFilter && !nameFilter(name)) continue;
    try {
      const st = await fs.promises.stat(path.join(srcFolder, name));
      if (st.isFile()) out.push(name);
    } catch {
      /* 読めないものは飛ばす */
    }
  }
  return out;
}

// items/<captureId>/<file> と .trash/<captureId>/<file> の二段だけを列挙する。任意の深さの
// ツリーをZIPへ取り込まず、保存構造として認めた形と書き出し側を一致させる。
async function collectItemFiles(srcFolder: string): Promise<string[]> {
  let itemKeys: string[] = [];
  try {
    itemKeys = await fs.promises.readdir(srcFolder);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const itemKey of itemKeys) {
    if (!isSafeEntryName(itemKey)) continue;
    let files: string[] = [];
    try {
      files = await fs.promises.readdir(path.join(srcFolder, itemKey));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!isSafeEntryName(file) || EXPORT_SKIP.has(file) || isVolatile(file)) continue;
      try {
        if ((await fs.promises.stat(path.join(srcFolder, itemKey, file))).isFile()) out.push(`${itemKey}/${file}`);
      } catch {
        /* 読めないものは飛ばす */
      }
    }
  }
  return out;
}

// 画像だけの ZIP。メディアのファイル (jpg/png/webp/gif と動画) だけを ZIP の直下に平らに置く＝
// サイドカーも整理の JSON も無く、ライブラリとして取り込み直せない。
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|mp4|webm|mov|m4v)$/i;

// --- 流し込みで ZIP を書く (yazl) ----------------------------------------------
// メモリを一定に抑えたまま、かつ ZIP64（巨大な書庫）に対応して、ZIP をディスクへ直接流し込む。
// yazl は addFile の元を、そのエントリを書くときに遅らせて読むので、数 GB のライブラリがメモリに
// 居座ることは決してない（山は約1エントリぶん）。これは書庫全体を1つの Buffer として実体化して
// いた JSZip の組み立てを置き換えたもの。あちらは数 GB を超えるとメモリ不足で落ちたし（約 7 GB の
// ライブラリで山 11.5 GiB を実測）、さらに悪いことに JSZip は ZIP64 を出せないので、4 GiB を
// 超える書庫は中央ディレクトリのオフセットが切り詰められ、壊れて開けない ZIP になった。
// メディアとサイドカーは無圧縮で入れる (compress:false)＝ライブラリはすでに圧縮済みのメディア
// なので、deflate を掛けても CPU を焼くだけで大きさはほぼ変わらない。
// onBytes（任意）は、出力ファイルへ書いた累計のバイト数を報告する＝yazl のストリームとファイルの
// 間に挟んだ Transform の取り出し口なので、パイプを乱さない。
function streamZipToFile(zip: ZipFile, outPath: string, onBytes?: (written: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outPath);
    zip.outputStream.on('error', reject);
    out.on('error', reject);
    out.on('close', () => resolve());
    if (onBytes) {
      let written = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          written += chunk.length;
          onBytes(written);
          cb(null, chunk);
        },
      });
      counter.on('error', reject);
      zip.outputStream.pipe(counter).pipe(out);
    } else {
      zip.outputStream.pipe(out);
    }
  });
}

function toSidecarJson(rec: any, capturedVia: string | null) {
  const { tagIds, ...rest } = rec;
  return { ...rest, capturedVia };
}

async function writeCompleteZip(sqlite: Database.Database, srcFolder: string, trashDir: string | null, outPath: string, opts: { includeTrash?: boolean } = {}, nowIso?: string, onProgress?: (written: number, total: number) => void) {
  const zip = new ZipFile();
  let fileCount = 0;
  let totalBytes = 0;
  const addFile = async (fullPath, entryName) => {
    try {
      totalBytes += (await fs.promises.stat(fullPath)).size;
    } catch {
      /* 大きさが分からない＝進捗がわずかに先走るだけ */
    }
    zip.addFile(fullPath, entryName, { compress: false });
    fileCount++;
  };
  const addJson = (value: unknown, entryName: string) => {
    const buf = Buffer.from(JSON.stringify(value, null, 2));
    totalBytes += buf.length;
    zip.addBuffer(buf, entryName);
    fileCount++;
  };

  // バイナリは素のディスクの写し。.json の絞り込みは念のためのもの＝#302 以降ライブラリの
  // フォルダは投稿ごとの JSON を1つも持たないが、移行前の残り物が、下で DB から作り直す
  // レコードを覆い隠してはいけない。
  for (const name of await collectFiles(srcFolder, (n) => !n.toLowerCase().endsWith('.json'))) await addFile(path.join(srcFolder, name), `library/${name}`);
  for (const name of await collectFiles(path.join(srcFolder, 'avatars'))) await addFile(path.join(srcFolder, 'avatars', name), `library/avatars/${name}`);
  // #290: 共有のカスタム絵文字の置き場。avatars/ と同じく、ディスクを正本として扱う。
  for (const name of await collectFiles(path.join(srcFolder, 'emoji'))) await addFile(path.join(srcFolder, 'emoji', name), `library/emoji/${name}`);
  for (const name of await collectItemFiles(path.join(srcFolder, 'items'))) await addFile(path.join(srcFolder, 'items', ...name.split('/')), `library/items/${name}`);
  for (const name of await collectItemFiles(path.join(srcFolder, 'quoted-media'))) await addFile(path.join(srcFolder, 'quoted-media', ...name.split('/')), `library/quoted-media/${name}`);

  // 投稿ごとのレコードを、サイドカーの形で DB から作り直したもの。
  const posts = await postsFromDb(sqlite);
  const captureIds = posts.map((p: any) => p.captureId);
  const capturedVia = postCapturedVia(sqlite, captureIds);
  for (const rec of posts) {
    addJson({ ...toSidecarJson(rec, capturedVia.get(rec.captureId) ?? null), tagClassification: exportTagClassification(sqlite, rec.captureId) }, `library/${rec.captureId}.json`);
  }

  // 整理の層。ipc-organize.ts と ipc-config.ts が生きた読み取り経路としてすでに使っているのと
  // 同じ getter を通して、DB から作り直す。
  const dbw = createDbWriter(sqlite);
  addJson(sqlite.prepare("SELECT t.name,t.category,w.name AS workName FROM tags t LEFT JOIN tags w ON w.id=t.workId WHERE t.category!='general'").all(), 'library/classified-tags.json');
  addJson(dbw.getFolders(), 'library/folders.json');
  // #810: id をキーにする IPC の読み取りではなく、名前に落とした射影を使う＝タグの id は
  // ライブラリの中だけのものなので、それを書庫へ書き込むと、他所で取り込まれたときに違うタグを
  // 指す（あるいはどのタグも指さない）。
  addJson(dbw.getTagGroupNames(), 'library/tag-groups.json');
  addJson(dbw.getUngrouped(), 'library/ungrouped.json');
  addJson(dbw.getManualGroups(), 'library/manual-groups.json');
  addJson(dbw.getPosterFolders(), 'library/poster-folders.json');
  addJson(dbw.getPosterTagNames(), 'library/poster-tags.json');
  const posterProfiles = dbw.getPosterProfiles();
  if (posterProfiles.profiles.length) addJson(posterProfiles, 'library/poster-profiles.json');
  const tabs = dbw.getTabs();
  if (tabs) addJson(tabs, 'library/tabs.json');
  // poster-favorites.json: 機能は退役し、裏付ける DB のテーブルも無い＝書き出しからは落とす。
  // （まだそれを持つ古い ZIP を取り込むために、ORG_MERGE と MERGERS には残してある。）

  // ゴミ箱は任意（既定では入れない）で、ファイルシステムだけのもの（ゴミ箱行きの投稿は DB に
  // 存在しない＝ipc-trash.ts の delete-post が行を完全に取り除く）。だからこれは library/ へ
  // 混ぜず、隣の接頭辞の下に置く素のディスクの写し。
  if (opts.includeTrash && trashDir) {
    for (const name of await collectFiles(trashDir)) await addFile(path.join(trashDir, name), `.trash/${name}`);
    for (const name of await collectItemFiles(trashDir)) await addFile(path.join(trashDir, ...name.split('/')), `.trash/${name}`);
  }

  const manifest = {
    app: 'Hologram',
    kind: 'complete',
    version: 2,
    source: 'db',
    includesTrash: !!opts.includeTrash,
    exportedAt: nowIso || new Date().toISOString(),
    fileCount,
  };
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), 'hologram-export.json');
  zip.end();
  await streamZipToFile(zip, outPath, onProgress ? (written) => onProgress(written, totalBytes) : undefined);
  return { fileCount };
}

// 画像だけ。メディアのファイルを ZIP の直下に平らに置く（サイドカーも整理の JSON も無い）。
// ライブラリとして取り込み直せない。取得時の原本も運ばない (#292 がこの書き出しを名指しで
// 挙げている)＝これは「誰かに絵を渡す」ための形で、原本はレコードのうち、受け手が受け取る
// はずでなかった第三者の断片を最も含みやすい部分だから。
async function writeImagesZip(srcFolder, outPath, onProgress?: (written: number, total: number) => void) {
  const zip = new ZipFile();
  let fileCount = 0;
  let totalBytes = 0;
  for (const name of await collectFiles(srcFolder, (n) => IMAGE_EXT.test(n))) {
    const fullPath = path.join(srcFolder, name);
    try {
      totalBytes += (await fs.promises.stat(fullPath)).size;
    } catch {
      /* 大きさが分からない */
    }
    zip.addFile(fullPath, name, { compress: false });
    fileCount++;
  }
  for (const store of ['items', 'quoted-media']) {
    for (const name of await collectItemFiles(path.join(srcFolder, store))) {
      if (!IMAGE_EXT.test(name)) continue;
      const fullPath = path.join(srcFolder, store, ...name.split('/'));
      try {
        totalBytes += (await fs.promises.stat(fullPath)).size;
      } catch {
        /* 大きさが分からない */
      }
      zip.addFile(fullPath, path.basename(name), { compress: false });
      fileCount++;
    }
  }
  zip.end();
  await streamZipToFile(zip, outPath, onProgress ? (written) => onProgress(written, totalBytes) : undefined);
  return { fileCount };
}

// 「書き出すものが在るか」を安く問い合わせる（readdir と stat だけで、ファイルは読まない）。
// 空のライブラリで保存ダイアログが開かないようにするため。
async function hasExportableFiles(srcFolder, imagesOnly) {
  if ((await collectFiles(srcFolder, imagesOnly ? (n) => IMAGE_EXT.test(n) : undefined)).length) return true;
  if (!imagesOnly && (await collectFiles(path.join(srcFolder, 'avatars'))).length) return true;
  if (!imagesOnly && (await collectFiles(path.join(srcFolder, 'emoji'))).length) return true;
  if ((await collectItemFiles(path.join(srcFolder, 'items'))).some((name) => !imagesOnly || IMAGE_EXT.test(name))) return true;
  if ((await collectItemFiles(path.join(srcFolder, 'quoted-media'))).some((name) => !imagesOnly || IMAGE_EXT.test(name))) return true;
  return false;
}

// ZIP のエントリを1つディスクへ流し込み、展開した出力が maxBytes を超えたら中止する。エントリ
// 全体をメモリに溜めることは決してないので、中央ディレクトリで大きさを過少に宣言した爆弾も、
// バイト数の枠で止まる（上限まで展開の費用を払うだけで、そのあと途中のファイルは捨てる）。
// エントリではなく読み取りのストリームを受ける。yauzl がストリームを渡すのは Entry ではなく
// ZipFile からだし、上限をストリームの形に保つことが、回帰テストが素の Readable でこれを
// 動かせる理由でもある。
/** @returns {Promise<void>}＝resolve() が引数を取らないように型を付けている。 */
async function writeStreamCapped(src: Readable, tmpPath: string, maxBytes: number): Promise<void> {
  let written = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length;
      if (written > maxBytes) callback(new ZipLimitError('entry exceeds per-entry byte cap'));
      else callback(null, chunk);
    },
  });
  // ディスクの書き込みが追いつくまで展開を止める。dataイベントでwriteの戻り値を無視すると、
  // 上限内の1GiBエントリでも書き込み待ちのBufferが全体に比例して溜まってしまう。
  // pipelineは上限・読み取り・書き込みのどの失敗でも全ストリームを閉じてから戻る。
  await pipeline(src, cap, fs.createWriteStream(tmpPath));
}

// ZIP のエントリをメモリへ丸ごと読み、展開後の実バイト数が maxBytes を超えたら中止する (#382)。
// ディスクへ流し込む writeStreamCapped と違い、整理の層の JSON は上限を掛ければメモリに抱えて
// おける大きさ。ただし上限は、宣言された大きさではなく実際に読んだバイト数に対して掛けなければ
// ならない。そうでないと、嘘をついた中央ディレクトリのヘッダが、extractLibraryEntries の
// 宣言サイズの検査をすり抜けて上限超えのエントリを通してしまう。
function readStreamCapped(src: Readable, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    const fail = (err) => {
      if (aborted) return;
      aborted = true;
      try {
        src.destroy();
      } catch {
        /* 握り潰す */
      }
      reject(err);
    };
    src.on('data', (chunk) => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        fail(new ZipLimitError('entry exceeds byte cap'));
        return;
      }
      chunks.push(chunk);
    });
    src.on('error', fail);
    src.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
  });
}

async function extractLibraryEntries(zipfile: ZipReader) {
  const orgEntries: Record<string, ZipEntry> = {};
  const captureEntries: Array<{ name: string; entry: ZipEntry }> = [];
  const trashEntries: Array<{ name: string; entry: ZipEntry }> = [];
  let isComplete = false;
  // zip 爆弾の事前検査。全部、書庫が宣言している数に対して掛ける＝この周回では展開が一切
  // 起きないし、library/ のエントリだけでなく書庫全体を対象にする（爆弾はどこにでも隠れうる）。
  const tally = declaredSizeTally(zipfile);
  for await (const entry of zipfile.eachEntry()) {
    const relPath = entry.fileName;
    if (relPath.endsWith('/')) continue; // ディレクトリのエントリ（yauzl が持つ唯一の目印）
    const size = tally(relPath, entry);

    if (relPath === 'hologram-export.json') {
      isComplete = true;
      continue;
    }
    const libMatch = /^library\/(.+)$/.exec(relPath);
    if (libMatch) {
      isComplete = true; // 安全の絞り込みより前に立てる＝飛ばしたエントリも形式の判別には効く
      const name = libMatch[1];
      if (!isSafeLibraryPath(name)) continue; // Zip Slip: 区切り・遡り・絶対パスを断る（avatars/<name> と emoji/<name> は許す）
      if (EXPORT_SKIP.has(name)) continue;
      if (MERGERS[name] || name === 'classified-tags.json') {
        // 整理の JSON の枠 (#382) のうち、宣言された大きさに対する半分。上の汎用のエントリ
        // 単位の検査と同じく、展開が起きる前に断る。
        if (size > MAX_ZIP_ORG_BYTES) throw new ZipLimitError('organization entry "' + relPath + '" declares ' + size + ' bytes (> org cap ' + MAX_ZIP_ORG_BYTES + ')');
        orgEntries[name] = entry;
      } else {
        if (name.toLowerCase().endsWith('.json') && size > MAX_ZIP_CAPTURE_JSON_BYTES) {
          throw new ZipLimitError('capture JSON entry "' + relPath + '" declares ' + size + ' bytes (> JSON cap ' + MAX_ZIP_CAPTURE_JSON_BYTES + ')');
        }
        captureEntries.push({ name, entry });
      }
      continue;
    }
    const trashMatch = /^\.trash\/(.+)$/.exec(relPath);
    if (trashMatch) {
      const name = trashMatch[1];
      if (!isSafeTrashPath(name)) continue;
      if (isTrashRecord(name) && size > MAX_ZIP_CAPTURE_JSON_BYTES) {
        throw new ZipLimitError('trash JSON entry "' + relPath + '" declares ' + size + ' bytes (> JSON cap ' + MAX_ZIP_CAPTURE_JSON_BYTES + ')');
      }
      trashEntries.push({ name, entry });
    }
  }
  return { isComplete, orgEntries, captureEntries, trashEntries };
}

// エントリ単位のバイト数の上限を掛けた流し込みの書き込み。すでに在れば飛ばし（何度実行しても
// 同じ／既存を潰さない）、一時ファイルへ書いてから不可分に rename する。取り込みのバイナリと
// .trash/ の復元が共有する＝違うのは、どのディレクトリに着地するかだけ。
function isTrashRecord(name: string): boolean {
  return !name.includes('/') && name.toLowerCase().endsWith('.json');
}

async function writeCaptureFile(zipfile: ZipReader, entry: ZipEntry, destDir: string, name: string, importedTrashRecord = false): Promise<'imported' | 'skipped'> {
  const dest = path.join(destDir, name);
  try {
    if (!isWithin(destDir, dest)) return 'skipped'; // 念のための Zip Slip の防ぎ
    if (fs.existsSync(dest)) return 'skipped';
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    // エントリ単位のバイト数の上限を掛けた流し込みの書き込み。上の事前検査を宣言の嘘ですり
    // 抜けたエントリにも上限が効く。中止したとき、commitFileAtomic は再送出の前に途中の一時
    // ファイルを落とす。
    try {
      await commitFileAtomic(
        dest,
        async (tmp) => {
          if (importedTrashRecord) {
            const bytes = await readStreamCapped(await zipfile.openReadStreamPromise(entry), MAX_ZIP_CAPTURE_JSON_BYTES);
            const raw = parseJsonLoose(bytes.toString('utf8'));
            // ゴミ箱の復元用レコードにも置換指示を残さない。その他の情報は保持する。
            PostRecordInputSchema.parse(raw);
            PostFlagsSchema.parse(raw);
            await fs.promises.writeFile(tmp, JSON.stringify({ ...raw, replaces: null }), 'utf8');
          } else {
            await writeStreamCapped(await zipfile.openReadStreamPromise(entry), tmp, MAX_ZIP_ENTRY_BYTES);
          }
        },
        { tmpSuffix: '.tmp-import' },
      );
    } catch (e) {
      if (e instanceof ZipLimitError) return 'skipped';
      throw e;
    }
    return 'imported';
  } catch {
    return 'skipped';
  }
}

async function importCompleteZipToDb(sqlite: Database.Database, zipPath: string, destFolder: string) {
  // autoClose:false にして、下の列挙の周回のあともエントリを読めるままにする
  // (openReadStream に fd が要る)。閉じるのは finally。
  const zipfile = await openZipForRead(zipPath, { autoClose: false });
  try {
    return await importFromOpenZip(sqlite, zipfile, destFolder);
  } finally {
    try {
      zipfile.close();
    } catch {
      /* エラーの経路がすでに閉じている */
    }
  }
}

async function importFromOpenZip(sqlite: Database.Database, zipfile: ZipReader, destFolder: string) {
  const { isComplete, orgEntries, captureEntries, trashEntries } = await extractLibraryEntries(zipfile);
  if (!isComplete) return { ok: false as const, notComplete: true as const, imported: 0, skipped: 0 };
  try {
    await fs.promises.mkdir(destFolder, { recursive: true });
  } catch {
    /* 握り潰す */
  }
  let imported = 0,
    skipped = 0;

  const jsonCaptures = captureEntries.filter((c) => c.name.toLowerCase().endsWith('.json'));
  const binaryCaptures = captureEntries.filter((c) => !c.name.toLowerCase().endsWith('.json'));

  for (const c of binaryCaptures) {
    if ((await writeCaptureFile(zipfile, c.entry, destFolder, c.name)) === 'imported') imported++;
    else skipped++;
  }

  if (trashEntries.length) {
    const trashDest = path.join(destFolder, '.trash');
    try {
      await fs.promises.mkdir(trashDest, { recursive: true });
    } catch {
      /* 握り潰す */
    }
    for (const t of trashEntries) {
      if ((await writeCaptureFile(zipfile, t.entry, trashDest, t.name, isTrashRecord(t.name))) === 'imported') imported++;
      else skipped++;
    }
  }

  const parseEntry = async (entry: ZipEntry): Promise<any> => {
    const buf = await readStreamCapped(await zipfile.openReadStreamPromise(entry), MAX_ZIP_CAPTURE_JSON_BYTES);
    try {
      return parseJsonLoose(buf.toString('utf8'));
    } catch {
      return null;
    }
  };
  // 整理の層の JSON は、#382 のはるかに小さいバイト数の上限を通す。ここでの ZipLimitError は
  // 握り潰さない＝下のトランザクションの外へ抜けさせ、取り込み全体が形の壊れたものとして断ら
  // れるようにする。切り詰められた整理の状態を黙って統合してしまわないため。
  const parseOrgEntry = async (entry: ZipEntry): Promise<any> => {
    const buf = await readStreamCapped(await zipfile.openReadStreamPromise(entry), MAX_ZIP_ORG_BYTES);
    try {
      return parseJsonLoose(buf.toString('utf8'));
    } catch {
      return null;
    }
  };

  const stmts = preparePostStmts(sqlite);
  const resolveTagId = makeTagResolver(sqlite);
  const dbWriter = createDbWriter(sqlite);
  const existingIds = new Set((sqlite.prepare('SELECT captureId FROM posts').all() as Array<{ captureId: string }>).map((r) => r.captureId));

  sqlite.exec('BEGIN');
  try {
    if (orgEntries['classified-tags.json']) {
      const vocab = PortableClassifiedTagVocabulary.parse(await parseOrgEntry(orgEntries['classified-tags.json']));
      importClassifiedTagVocabulary(sqlite, vocab);
    }
    // 投稿は upsert ではなく、上のバイナリのキャプチャの書き込みと同じ「すでに在るものを決して
    // 潰さない」取り決め（すでに在れば飛ばす）＝取り込みが、すでに持っているものを黙って上書き
    // することは決してない。
    for (const c of jsonCaptures) {
      const raw = await parseEntry(c.entry);
      const rec = { ...PostRecordInputSchema.parse(raw), ...PostFlagsSchema.parse(raw) };
      if (existingIds.has(rec.captureId)) {
        skipped++;
        continue;
      }
      // 完全ZIPは投稿データとして取り込む。書庫の置換指示で既存投稿を削除しない。
      writePost(stmts, resolveTagId, fillMediaDims(destFolder, fillCardDims(destFolder, { ...rec, tags: rec.tagClassification?.generalTags ?? rec.tags, replaces: null })));
      dbWriter.restorePostFlags(rec.captureId, rec); // userKind/tagReviewed/localViewCount＝writePost はこれらを運ばない (lib-db-write.ts のモジュールのコメント)
      existingIds.add(rec.captureId);
      imported++;
    }

    // 整理の層。今の DB の状態を読む → 入って来た JSON と統合する（同じ純粋な MERGERS の
    // 関数）→ 書き戻す。
    if (orgEntries['folders.json']) {
      const inc = FoldersSchema.parse(await parseOrgEntry(orgEntries['folders.json']));
      dbWriter.setFolders(mergeFolders(dbWriter.getFolders(), inc));
    }
    if (orgEntries['ungrouped.json']) {
      const inc = UngroupedSchema.parse(await parseOrgEntry(orgEntries['ungrouped.json']));
      dbWriter.setUngrouped(mergeUngrouped(dbWriter.getUngrouped(), inc).keys);
    }
    if (orgEntries['manual-groups.json']) {
      const inc = ManualGroupsSchema.parse(await parseOrgEntry(orgEntries['manual-groups.json']));
      dbWriter.setManualGroups(mergeManualGroups(dbWriter.getManualGroups(), inc).groups);
    }
    if (orgEntries['poster-folders.json']) {
      const inc = PosterFoldersSchema.parse(await parseOrgEntry(orgEntries['poster-folders.json']));
      dbWriter.setPosterFolders(mergePosterFolders(dbWriter.getPosterFolders(), inc));
    }
    if (orgEntries['poster-tags.json']) {
      const inc = PosterTagNamesSchema.parse(await parseOrgEntry(orgEntries['poster-tags.json']));
      dbWriter.setPosterTags(mergePosterTags(dbWriter.getPosterTagNames(), inc));
    }
    if (orgEntries['poster-profiles.json']) {
      const inc = PosterProfilesSchema.parse(await parseOrgEntry(orgEntries['poster-profiles.json']));
      dbWriter.setPosterProfiles(mergePosterProfiles(dbWriter.getPosterProfiles(), inc));
    }
    if (orgEntries['tag-groups.json']) {
      const inc = TagGroupNamesSchema.parse(await parseOrgEntry(orgEntries['tag-groups.json']));
      const merged = mergeTagGroups(dbWriter.getTagGroupNames(), inc);
      // #810: 置き換えるのではなく埋める。mergeTagGroups がすでに衝突をローカル側の勝ちで
      // 決着させているので、下ではローカルのエントリはどれも何もしないのと同じになり、この
      // ライブラリが種別を持たない、入って来た名前だけが効く＝名前をキーにする統合からは見え
      // ない同名の実体も、書き込みで入れ直されずに今の種別を保つ、ということでもある。
      dbWriter.fillTagGroupsByName(merged.memberships, merged.labels ?? null);
    }
    // poster-favorites.json（古い書き出しから来る、MERGERS/ORG_MERGE の旧来のキー）。退役した
    // 機能を裏付ける DB のテーブルは無い＝在っても黙って落とす。

    // tabs.json は意図してここで取り込まない＝他の端末で開いていたタブを今のセッションへ復元
    // するのは、既定の振る舞いとして紛らわしい（計画の §2c）。書き出しに残してあるのは、
    // 完全性と調査のためだけ。

    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }

  return { ok: true as const, notComplete: false as const, imported, skipped };
}

// --- pixiv のうごイラの再生 (#506) ---------------------------------------------
// 再生側は、ライブラリが手を付けずに保存している書庫からフレームを取り出す必要があり、しかも
// 書庫をレンダラーへ渡さずにそれをやる必要がある＝書き出しと取り込みの経路がすでに従っている
// 規則 (ADR 0015)。この2つが、アプリで最後に残っていたレンダラー側の ZIP の読み手だった。
//
// 中央ディレクトリは最初の要求で一度だけ検査して索引にする。展開済みフレームは保持せず、要求
// された1枚だけを yauzl の openReadStream で読む。索引には小さな LRU と未使用時間の上限を設ける。
// ZipFile は索引走査または1枚の読み取りが終わるたびに閉じるので、Windows でも再生後の元ファイル
// の置換・削除を妨げない。
//
// フレームの名前はキャプチャのフレームの表から来るもので、書庫から来ることは決してない。そこ
// からパスを組み立てることも一切ない＝open の時点で yauzl の validateFileName をすでに通った
// エントリ名と突き合わせるだけなので、書庫外のパスを参照しない。

type UgoiraFileIdentity = { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };
type UgoiraArchiveIndex = {
  zipPath: string;
  identity: UgoiraFileIdentity;
  entries: Map<string, ZipEntry>;
  entryCount: number;
  idleTimer: NodeJS.Timeout | null;
  leases: number;
  cached: boolean;
};

const ugoiraIndexes = new Map<string, UgoiraArchiveIndex>();
const ugoiraIndexLoads = new Map<string, Promise<UgoiraArchiveIndex>>();
let ugoiraIndexedEntryCount = 0;
let ugoiraResidentArchiveCount = 0;
let ugoiraResidentEntryCount = 0;
let ugoiraPeakResidentArchiveCount = 0;
let ugoiraPeakResidentEntryCount = 0;
let ugoiraEntryVisits = 0;
let ugoiraOpenHandles = 0;
let ugoiraPeakOpenHandles = 0;
const ugoiraHandleWaiters: Array<() => void> = [];
const ugoiraResidentWaiters: Array<() => void> = [];
let ugoiraBeforeReadHandleSlotForTest: (() => Promise<void>) | null = null;

function identityOf(stat: fs.Stats): UgoiraFileIdentity {
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function sameIdentity(a: UgoiraFileIdentity, b: UgoiraFileIdentity) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

async function withUgoiraHandleSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (ugoiraOpenHandles >= MAX_UGOIRA_OPEN_ARCHIVES) await new Promise<void>((resolve) => ugoiraHandleWaiters.push(resolve));
  else ugoiraOpenHandles++;
  ugoiraPeakOpenHandles = Math.max(ugoiraPeakOpenHandles, ugoiraOpenHandles);
  try {
    return await fn();
  } finally {
    const next = ugoiraHandleWaiters.shift();
    if (next) next();
    else ugoiraOpenHandles--;
  }
}

function closeZipReader(zipfile: ZipReader): Promise<void> {
  if (!zipfile.isOpen) return Promise.resolve();
  return new Promise((resolve, reject) => {
    zipfile.once('close', resolve);
    zipfile.once('error', reject);
    zipfile.close();
  });
}

function discardUgoiraIndex(index: UgoiraArchiveIndex) {
  if (ugoiraIndexes.get(index.zipPath) === index) {
    ugoiraIndexes.delete(index.zipPath);
    ugoiraIndexedEntryCount -= index.entryCount;
    index.cached = false;
  }
  if (index.idleTimer) clearTimeout(index.idleTimer);
  index.idleTimer = null;
  releaseUgoiraResidence(index);
}

function touchUgoiraIndex(index: UgoiraArchiveIndex) {
  if (ugoiraIndexes.get(index.zipPath) !== index || !index.cached) return;
  if (index.idleTimer) clearTimeout(index.idleTimer);
  ugoiraIndexes.delete(index.zipPath);
  ugoiraIndexes.set(index.zipPath, index); // Map の挿入順を LRU として使う
  index.idleTimer = setTimeout(() => discardUgoiraIndex(index), UGOIRA_INDEX_IDLE_MS);
  index.idleTimer.unref();
}

function evictUgoiraIndexesForResidence(incomingEntries: number) {
  while (ugoiraIndexes.size && (ugoiraResidentArchiveCount >= MAX_UGOIRA_OPEN_ARCHIVES || ugoiraResidentEntryCount + incomingEntries > MAX_UGOIRA_INDEXED_ENTRIES)) {
    const oldest = ugoiraIndexes.values().next().value as UgoiraArchiveIndex | undefined;
    if (!oldest) break;
    discardUgoiraIndex(oldest);
  }
}

async function reserveUgoiraResidence(entryCount: number) {
  if (entryCount > MAX_UGOIRA_INDEXED_ENTRIES) throw new ZipLimitError('archive declares ' + entryCount + ' entries (> cap ' + MAX_UGOIRA_INDEXED_ENTRIES + ')');
  for (;;) {
    evictUgoiraIndexesForResidence(entryCount);
    if (ugoiraResidentArchiveCount < MAX_UGOIRA_OPEN_ARCHIVES && ugoiraResidentEntryCount + entryCount <= MAX_UGOIRA_INDEXED_ENTRIES) {
      ugoiraResidentArchiveCount++;
      ugoiraResidentEntryCount += entryCount;
      ugoiraPeakResidentArchiveCount = Math.max(ugoiraPeakResidentArchiveCount, ugoiraResidentArchiveCount);
      ugoiraPeakResidentEntryCount = Math.max(ugoiraPeakResidentEntryCount, ugoiraResidentEntryCount);
      return;
    }
    await new Promise<void>((resolve) => ugoiraResidentWaiters.push(resolve));
  }
}

function releaseUgoiraResidence(index: UgoiraArchiveIndex) {
  if (index.cached || index.leases > 0) return;
  ugoiraResidentArchiveCount--;
  ugoiraResidentEntryCount -= index.entryCount;
  for (const wake of ugoiraResidentWaiters.splice(0)) wake();
}

function leaseUgoiraIndex(index: UgoiraArchiveIndex) {
  index.leases++;
  let released = false;
  return {
    index,
    release() {
      if (released) return;
      released = true;
      index.leases--;
      releaseUgoiraResidence(index);
    },
  };
}

async function buildUgoiraIndex(zipPath: string): Promise<UgoiraArchiveIndex> {
  let reservedEntryCount = 0;
  let reserved = false;
  let built: Pick<UgoiraArchiveIndex, 'identity' | 'entries' | 'entryCount'>;
  try {
    // yauzl.open が EOCD を読み終えた時点で entryCount は確定している。ここでは中央ディレクトリを
    // 列挙せず、件数と同一性だけを有限量読んで FD を閉じる。resident 枠の待機中に FD 枠を握ると、
    // lease を持って FD 枠を待つ read と循環するため、容量予約は必ずこの close より後で行う。
    const probe = await withUgoiraHandleSlot(async () => {
      const before = identityOf(await fs.promises.stat(zipPath));
      const zipfile = await openZipForRead(zipPath, { autoClose: false });
      try {
        declaredSizeTally(zipfile);
        const after = identityOf(await fs.promises.stat(zipPath));
        if (!sameIdentity(before, after)) throw new Error('ugoira archive changed while probing');
        return { identity: after, entryCount: zipfile.entryCount };
      } finally {
        await closeZipReader(zipfile);
      }
    });
    await reserveUgoiraResidence(probe.entryCount);
    reserved = true;
    reservedEntryCount = probe.entryCount;

    built = await withUgoiraHandleSlot(async () => {
      const before = identityOf(await fs.promises.stat(zipPath));
      if (!sameIdentity(probe.identity, before)) throw new Error('ugoira archive changed before indexing');
      const zipfile = await openZipForRead(zipPath, { autoClose: false });
      try {
        const tally = declaredSizeTally(zipfile);
        if (zipfile.entryCount !== probe.entryCount) throw new Error('ugoira archive changed before indexing');
        const entries = new Map<string, ZipEntry>();
        for await (const entry of zipfile.eachEntry()) {
          ugoiraEntryVisits++;
          if (entry.fileName.endsWith('/')) continue;
          tally(entry.fileName, entry);
          entries.set(entry.fileName, entry);
        }
        const after = identityOf(await fs.promises.stat(zipPath));
        if (!sameIdentity(before, after)) throw new Error('ugoira archive changed while indexing');
        return { identity: after, entries, entryCount: zipfile.entryCount };
      } finally {
        await closeZipReader(zipfile);
      }
    });
  } catch (err) {
    if (reserved) {
      ugoiraResidentArchiveCount--;
      ugoiraResidentEntryCount -= reservedEntryCount;
      for (const wake of ugoiraResidentWaiters.splice(0)) wake();
    }
    throw err;
  }
  const index: UgoiraArchiveIndex = { zipPath, ...built, idleTimer: null, leases: 0, cached: true };
  ugoiraIndexes.set(zipPath, index);
  ugoiraIndexedEntryCount += index.entryCount;
  touchUgoiraIndex(index);
  return index;
}

async function acquireUgoiraIndex(zipPath: string) {
  const current = ugoiraIndexes.get(zipPath);
  if (current) {
    const identity = identityOf(await fs.promises.stat(zipPath));
    if (ugoiraIndexes.get(zipPath) !== current || !current.cached) return acquireUgoiraIndex(zipPath);
    if (sameIdentity(current.identity, identity)) {
      touchUgoiraIndex(current);
      return leaseUgoiraIndex(current);
    }
    discardUgoiraIndex(current);
  }
  let loading = ugoiraIndexLoads.get(zipPath);
  if (!loading) {
    loading = buildUgoiraIndex(zipPath);
    ugoiraIndexLoads.set(zipPath, loading);
    void loading.finally(() => ugoiraIndexLoads.delete(zipPath)).catch(() => {});
  }
  const index = await loading;
  // 最初の待ち手が lease を取ってから resident 待ちを起こす。公開直後に起こすと、この acquire
  // 自身が再開する前に索引を evict され、同じ中央ディレクトリを作り直してしまう。
  if (ugoiraIndexes.get(zipPath) !== index && index.leases === 0) return acquireUgoiraIndex(zipPath);
  if (index.cached) touchUgoiraIndex(index);
  const lease = leaseUgoiraIndex(index);
  for (const wake of ugoiraResidentWaiters.splice(0)) wake();
  return lease;
}

function openFdForRead(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => fs.open(filePath, 'r', (err, fd) => (err ? reject(err) : resolve(fd))));
}

function fstatFd(fd: number): Promise<fs.Stats> {
  return new Promise((resolve, reject) => fs.fstat(fd, (err, stat) => (err ? reject(err) : resolve(stat))));
}

function closeFd(fd: number): Promise<void> {
  return new Promise((resolve, reject) => fs.close(fd, (err) => (err ? reject(err) : resolve())));
}

// フレームの表が求める名前が全部、書庫の中に在るときだけ true。全部か無しかで答えるのが要
// ＝一部だけ一致するということは、表と書庫がもう同じアニメーションを記述していないという
// こと。黙って並びの変わったアニメーションは、ポスターより悪い (#474)。
async function ugoiraFramesPresent(zipPath: string, names: string[]): Promise<boolean> {
  if (!Array.isArray(names) || !names.length) return false;
  const lease = await acquireUgoiraIndex(zipPath);
  try {
    return names.every((name) => lease.index.entries.has(name));
  } finally {
    lease.release();
  }
}

// フレーム1枚のバイト列。書庫にそのエントリが無ければ null。このモジュールが展開する他の
// エントリと同じく、上限を二重に掛ける＝宣言された大きさは1バイトも読む前に断り、ストリームも
// 同じ上限で切るので、嘘をついた中央ディレクトリは何も得しない。
async function readUgoiraFrame(zipPath: string, name: string): Promise<Buffer | null> {
  if (!name) return null;
  const lease = await acquireUgoiraIndex(zipPath);
  const index = lease.index;
  try {
    const found = index.entries.get(name);
    if (!found) return null;
    const declared = entryUncompressedSize(found);
    if (declared > MAX_UGOIRA_FRAME_BYTES) throw new ZipLimitError('ugoira frame "' + name + '" declares ' + declared + ' bytes (> frame cap ' + MAX_UGOIRA_FRAME_BYTES + ')');
    if (ugoiraBeforeReadHandleSlotForTest) await ugoiraBeforeReadHandleSlotForTest();
    return await withUgoiraHandleSlot(async () => {
      const fd = await openFdForRead(zipPath);
      let zipfile: ZipReader | null = null;
      try {
        if (!sameIdentity(index.identity, identityOf(await fstatFd(fd)))) throw new Error('ugoira archive changed before reading');
        zipfile = await openZipFdForRead(fd, { autoClose: false });
        const bytes = await readStreamCapped(await zipfile.openReadStreamPromise(found), MAX_UGOIRA_FRAME_BYTES);
        if (!sameIdentity(index.identity, identityOf(await fstatFd(fd))) || !sameIdentity(index.identity, identityOf(await fs.promises.stat(zipPath)))) {
          throw new Error('ugoira archive changed while reading');
        }
        return bytes;
      } catch (err) {
        // ファイル変更、局所ヘッダや圧縮データの破損、読み取りエラーのどれでも、同じ Entry を
        // 次の要求へ使い回さない。FD の解放は下の finally が先に完了させる。
        discardUgoiraIndex(index);
        throw err;
      } finally {
        if (zipfile) await closeZipReader(zipfile);
        else await closeFd(fd);
      }
    });
  } finally {
    lease.release();
  }
}

// 回帰テストと診断用。実データや Entry は外へ出さず、中央ディレクトリの走査量だけを公開する。
function ugoiraArchiveIndexStats() {
  return {
    cachedArchives: ugoiraIndexes.size,
    indexedEntries: ugoiraIndexedEntryCount,
    residentArchives: ugoiraResidentArchiveCount,
    residentEntries: ugoiraResidentEntryCount,
    peakResidentArchives: ugoiraPeakResidentArchiveCount,
    peakResidentEntries: ugoiraPeakResidentEntryCount,
    residentWaiters: ugoiraResidentWaiters.length,
    entryVisits: ugoiraEntryVisits,
    openHandles: ugoiraOpenHandles,
    peakOpenHandles: ugoiraPeakOpenHandles,
  };
}

function setUgoiraBeforeReadHandleSlotForTest(hook: (() => Promise<void>) | null) {
  ugoiraBeforeReadHandleSlotForTest = hook;
}

function clearUgoiraArchiveIndexes() {
  for (const index of [...ugoiraIndexes.values()]) discardUgoiraIndex(index);
  ugoiraEntryVisits = 0;
  ugoiraPeakOpenHandles = ugoiraOpenHandles;
  ugoiraPeakResidentArchiveCount = ugoiraResidentArchiveCount;
  ugoiraPeakResidentEntryCount = ugoiraResidentEntryCount;
}

export {
  EXPORT_SKIP,
  ORG_MERGE,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_TOTAL_BYTES,
  MAX_ZIP_ORG_BYTES,
  MAX_ZIP_CAPTURE_JSON_BYTES,
  MAX_UGOIRA_FRAME_BYTES,
  MAX_UGOIRA_OPEN_ARCHIVES,
  MAX_UGOIRA_INDEXED_ENTRIES,
  ZipLimitError,
  writeStreamCapped,
  readStreamCapped,
  writeCompleteZip,
  writeImagesZip,
  hasExportableFiles,
  importCompleteZipToDb,
  ugoiraFramesPresent,
  readUgoiraFrame,
  ugoiraArchiveIndexStats,
  clearUgoiraArchiveIndexes,
  setUgoiraBeforeReadHandleSlotForTest,
  mergeFolders,
  mergePosterFolders,
  mergeTagGroups,
  mergeUngrouped,
  mergeManualGroups,
  mergePosterTags,
  mergePosterProfiles,
  toSidecarJson,
};
import { FoldersSchema, UngroupedSchema, ManualGroupsSchema, PosterFoldersSchema, PosterTagNamesSchema, PosterProfilesSchema, TagGroupNamesSchema } from '../shared/data-schemas.ts';
