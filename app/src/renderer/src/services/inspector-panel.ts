// インスペクタのパネルの開閉の状態（#243）＝パネルは利用者が開閉し、その選択は再起動を
// またいで残る。
//
// ここが設定だけでなく状態そのものを持つ理由（panel-width-pref.ts は永続化だけをして、状態は
// AppShell に持たせている）: インスペクタは2つの側から閉じられる。React はシェルの切り替えと
// パネル自身の × を駆動するが、inspector-builder.ts＝React を使わない素のレンダラーのコード＝
// も閉じる必要がある。両方が手を届かせられるモジュールレベルのストアがあれば、それが
// #postDetail.hidden を境界越しに突く行為にならずに済む。旧コードはそれをやっていた。
//
// 永続化は theme-api.ts / panel-width-pref.ts に倣う＝config.json が持続する住処で
// （IPC 経由の setPref）、localStorage は同期のキャッシュ。AppShell が React の最初の描画の
// 最中に答えを必要とするからで、IPC の往復は1拍後にしか答えられず、開いたパネルを描いてから
// 起動直後に閉じてしまう。
//
// 注意: 開くのは利用者の操作だけ。カードを選ぶとパネルの中身は埋まる（inspector.ts）が、
// 利用者が閉じたパネルを開き直すことは決してない＝Eagle も Lightroom も VS Code も、
// 引っ込めたパネルにはその礼儀を通す。パネルの中でしか意味を持たない操作（「タグを編集」、
// 画像ビューのインスペクタの切り替え）は選択ではないので、これは開く＝setOpen の呼び出し側を
// 参照。
//
// このモジュールは「今パネルが画面に出ているか」（isVisible）も持つ。これは isOpen とは
// 別の問いだ。保存された設定はパネルが出ているべきだと言うが、#245 の一括の非表示にも、
// 実際に出ているかについて言い分がある。かつてこの式は AppShell だけにあり、React の外の
// レンダラーのモジュールは、DOM から #postDetail.hidden を読んで同じ問いに答えていた
// （P2⑦ / #153: 境界越しに DOM を嗅がない）。今は両方がこの1つの写しを読む。
import { hologramIpc } from './ipc.ts';
import { isHidden as panelsAreHidden, subscribe as panelsSubscribe } from './panels.ts';

const KEY = 'hologram-inspector-open';
const DEFAULT_OPEN = true;

function readCache(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? null : v === 'true';
  } catch {
    return null;
  }
}

function writeCache(open: boolean): void {
  try {
    localStorage.setItem(KEY, String(open));
  } catch {
    /* 無視する */
  }
}

let open = readCache() ?? DEFAULT_OPEN;
// 最初の明示的な切り替えで立つ。load() は起動の1拍後に解決するので、その時点で既にパネルへ
// 手を伸ばしていた利用者の選択が、突き合わせによって引き戻されてはいけない＝AppShell の
// `toggled` の ref がサイドバーで防いでいるのと同じ競合。
let chosen = false;
const subs = new Set<() => void>();

function notify(): void {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* 無視する */
    }
  }
}

export function isOpen(): boolean {
  return open;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

// 明示的な開閉はすべてここを通るので、設定と購読側がずれることはない。何度実行しても同じ＝
// 今と同じ値を入れ直しても何もしない（React 側へ反響しない）。
export function setOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  chosen = true;
  writeCache(next);
  try {
    hologramIpc.setPref('inspectorOpen', next);
  } catch {
    /* 無視する */
  }
  notify();
}

export function toggle(): void {
  setOpen(!open);
}

// === 今画面に出ているか ===

// 追加の入力は1つ＝panels.ts の一括の非表示（#245）が、両側のパネルの考えに触れずに覆う。
//
// パネルはどの幅でも据え置きの列（#975）。#259 では 1280px 未満で選択に連動していた。中身の
// 無い浮いたパネルはビューに空いた穴だからだ。しかし決して浮かないパネルには、避けるべき
// その状態が無いし、空の列が出すのはプレースホルダ（#244）だ。そもそも見えるかどうかを選択から
// 導いていたことが、この形を幅に依存させていた。
export function isVisible(): boolean {
  return !panelsAreHidden() && open;
}

// React 向けの、複数へ広げる購読。どちらの入力でも答えが変わりうるので、isVisible() を使う側は
// 両方から聞く必要がある。React を使わない呼び出し側は、動く瞬間に isVisible() を尋ねるだけ
// なので、これは要らない。
export function subscribeVisible(cb: () => void): () => void {
  const offs = [subscribe(cb), panelsSubscribe(cb)];
  return () => {
    for (const off of offs) off();
  };
}

// 起動時に1回だけ、キャッシュを config.json と突き合わせる。config.json が持続する住処なので、
// 最初の描画が使ったキャッシュの推測より上位に来る＝アプリの外での編集が勝つ。設定が読めない
// 時や null の時は何もしない。null は「閉じている」ではなく、利用者が一度もパネルを切り替えて
// いないことを意味するので、キャッシュの推測（または DEFAULT_OPEN）がそのまま通る。
export async function load(): Promise<void> {
  try {
    const prefs = hologramIpc.getPrefs ? await hologramIpc.getPrefs() : null;
    const saved = prefs ? prefs.inspectorOpen : null;
    if (chosen || typeof saved !== 'boolean' || saved === open) return;
    open = saved;
    writeCache(saved);
    notify();
  } catch {
    /* 無視する */
  }
}
