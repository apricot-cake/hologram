// 一括パネル表示（#245）――Ctrl+Shift+B はサイドバーとインスペクタを同時に
// 隠し、もう一度押すとちょうど表示していたその対だけが戻ってくる。ツール
// バーと絞り込みチップの行は残る: それらはグリッドを操作する手段なので、
// 隠してしまうと、操作できないビューと引き換えに広いビューを得ることに
// なってしまう（#245 の設計コメント）。
//
// 「Shift がキーの適用範囲を広げる」は Lightroom Classic の対応関係
// （Tab = サイドパネル、Shift+Tab = それら全部）。キー自体は借りていない
// ――Tab、バッククォート、Ctrl+\ がすべて却下された理由は #245 を参照――
// 借りたのはこの対の形だけ。
//
// この状態が何であるか: パネル自身の状態の変更ではなく「マスク」。それが
// オンの間、inspector-panel.ts の状態はそのままにしておかれ、シェルは
// 単に両方のパネルを閉じた状態で描く。それこそが復元の仕組みであり、
// どこにもスナップショットのオブジェクトが無い理由: 戻るべき対は今も
// パネル自身の状態の中に座っている。これはまた、マスク自体を config.json
// へ永続化できるようにもする――メモリだけに保持されたスナップショットは
// 再起動を生き延びられないので、それと組み合わせた永続化済みのマスクは、
// 戻ってきても何を覆っていたのか言えなくなってしまう。（サイドバーは
// #981 以来、保存すべき自分自身の状態を持たない: それはレールで、この
// マスクだけがそれを画面から取り除く。）
//
// これを成り立たせている不変条件: マスクがオンの間、パネル自身の状態には
// 何も書き込まれない。明示的な個別の操作――インスペクタのトグル、image
// タブを開くこと――はどれも、まず reveal() を呼んでから自分自身を適用
// する。これによりマスクが外れ、利用者の操作は見えているパネルに着地
// する。2つのパネルを隠しておいて、マスクの裏で黙って並べ替える、という
// のは #245 が却下した唯一の挙動（「隠れたままの間に内部状態が変わる挙動は
// 作らない」）で、それを各呼び出し場所ごとにではなく、他に呼べるものを
// 与えないことでここで却下している。
//
// #244 がインスペクタ独自のショートカットを持たせないと決めて以来、
// Ctrl+Shift+B はインスペクタへの唯一のキーボード経路でもある。
//
// 永続化は inspector-panel.ts / panel-width-pref.ts がすでに使っている
// 2階層の形: config.json が永続的な置き場（IPC 経由の setPref）で、
// localStorage は同期的なキャッシュ。シェルは React の「最初の」描画中に
// 答えを必要とするため――IPC の往復では1ティック後にしか答えられず、
// 起動直後に両方のパネルを描いてからすぐに消すことになってしまう。この
// 状態がコンポーネントではなくこのモジュールに住むのは inspector-panel.ts
// のそれと同じ理由: キーボードハンドラは App.tsx から登録され、コマンド
// パレットのエントリは services/ で組み立てられ、どちらも AppShell の
// 中へは手が届かない。
import { get as confirmGet } from './confirm.ts';
import { isOpen as paletteIsOpen } from './command-registry.ts';
import { hologramIpc } from './ipc.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { isTypingTarget, registerShortcut, tryRun } from './shortcut-registry.ts';

const KEY = 'hologram-panels-hidden';
const DEFAULT_HIDDEN = false;

function readCache(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? null : v === 'true';
  } catch {
    return null;
  }
}

function writeCache(hidden: boolean): void {
  try {
    localStorage.setItem(KEY, String(hidden));
  } catch {
    /* 握りつぶす */
  }
}

let hidden = readCache() ?? DEFAULT_HIDDEN;
// 最初の明示的なトグルで設定される。load() は起動から1ティック後に解決
// する。その時点ですでにキーに手を伸ばしていた利用者の選択が、整合処理に
// よって巻き戻されてはいけない――inspector-panel.ts の `chosen` がパネルに
// 対して防いでいるのと同じ競合。
let chosen = false;
const subs = new Set<() => void>();

function notify(): void {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* 握りつぶす */
    }
  }
}

export function isHidden(): boolean {
  return hidden;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

// どの変更もここを通るので、pref と購読者が決してずれることはない。
// 何度実行しても同じ: 今の値を再設定しても no-op（React 経由のエコーは無い）。
export function setHidden(next: boolean): void {
  if (hidden === next) return;
  hidden = next;
  chosen = true;
  writeCache(next);
  try {
    hologramIpc.setPref('panelsHidden', next);
  } catch {
    /* 握りつぶす */
  }
  notify();
}

export function toggle(): void {
  setHidden(!hidden);
}

/**
 * 利用者が特定の1つのパネルに手を伸ばしたので、マスクを外す。その操作を
 * 適用する「前」にこれを呼ぶこと――パネル自身の状態は、それが見えている
 * 間しか書き込まれることが無く、それがこのマスクの覆う対を復元可能な
 * ままにしている（ファイル冒頭を参照）。何もマスクされていなければ
 * no-op なので、呼び出し場所は確認する必要が無い。
 */
export function reveal(): void {
  setHidden(false);
}

// 起動時に一度だけキャッシュを config.json と整合させる: config.json が
// 永続的な置き場なので、最初の描画が使ったキャッシュ済みの推測より優先し、
// アプリの外での編集が勝つ。pref が読めない、または null のときは沈黙
// する――null は利用者が一度もこのキーを使っていないことを意味し、「表示中」
// を意味しないので、キャッシュ済みの推測（または DEFAULT_HIDDEN）が
// そのまま立つ。
export async function load(): Promise<void> {
  try {
    const prefs = hologramIpc.getPrefs ? await hologramIpc.getPrefs() : null;
    const saved = prefs ? prefs.panelsHidden : null;
    if (chosen || typeof saved !== 'boolean' || saved === hidden) return;
    hidden = saved;
    writeCache(saved);
    notify();
  } catch {
    /* 握りつぶす */
  }
}

// Ctrl/Cmd+Shift+B。登録は他の文書レベルのショートカットと並んで
// GlobalShortcuts コンポーネント（app/App.tsx）にある。ガード＋アクションは
// ここに、それらが読む状態のすぐ隣に留まる。ガードの形はこのハウスの慣習
// （selection-builder.ts の Ctrl+A）: 入力中はキーに触れず、モーダルが
// 画面を占有している間も触れない――ダイアログの裏で広げるものは何も無い。
//
// #246: キーの組み合わせ自体（Ctrl+Shift+B）は今では登録簿にある。ここに残る
// のはガード（依然としてこのハウスの慣習――selection-builder.ts の
// Ctrl+A）とアクションだけ。Shift はかつて、これをサイドバー自身の
// Ctrl+B と見分けるものだった。#981 が拡張された列と共にそのキーを引退
// させたので、このキーの組み合わせにはもう、修飾キー無しの対になる相手がいない。
function canExecutePanelsToggle(e: KeyboardEvent): boolean {
  if (isTypingTarget(e)) return false;
  if (confirmGet() || lightboxIsOpen()) return false;
  if (settingsIsOpen()) return false;
  if (paletteIsOpen()) return false;
  return true;
}

// Shift はキーの組み合わせの本物の（ignoreShift ではない）一部のまま: それは
// グリフの修飾ではなく、ここでキーが「意味すること」そのもの（「これの
// 適用範囲を広げる」、Lightroom の Tab / Shift+Tab）。
registerShortcut({
  id: 'panels.toggle',
  titleKey: 'shortcutTogglePanels',
  defaultCombo: 'Ctrl+Shift+b',
  canExecute: canExecutePanelsToggle,
  perform: toggle,
});

export function handleShortcutPanelsKey(e: KeyboardEvent): void {
  tryRun('panels.toggle', e);
}
