import type { MessageKey } from './translation.ts';
import { hologramIpc } from './ipc.ts';
import { t } from '../_shared/i18n.ts';

export interface ShortcutEntry {
  id: string;
  /**
   * 設定一覧向けの i18n キーであって、解決済みの文字列ではない――
   * ショートカットを登録するどのモジュールも自分のモジュールのトップレベルで
   * それを行う（tryRun() が最初の1回目の keydown に答えられるものを持てる
   * ように）が、それは initI18n() が解決するよりずっと前に走る
   * （root.tsx はマウントをそれにゲートしているのであって、モジュールの
   * 評価をゲートしているのではない）。ここで即座に解決してしまうと、title
   * は t() のフォールバック（生のキー）のまま永遠に固まってしまう――
   * 下の list()/findConflict() が代わりに遅延解決を行い、その時点では
   * 設定ページ（またはライブの衝突チェック）は常に起動が終わってからずっと
   * 後に走っている。
   */
  titleKey: MessageKey;
  /** 正準のコンボ文字列、例: "Ctrl+Z"、"Ctrl+Shift+F"、"P"、"Alt+ArrowLeft"。 */
  defaultCombo: string;
  /**
   * 元々のガードが e.shiftKey をまったく見ていなかった一握りのコマンド
   * （全選択／コピー／検索フォーカス／content-size の2ステップ／
   * タブを閉じる）に対して true――それらで Shift を同時に押しても常に
   * 通してきた。たいていは Shift がキーの生成するグリフを変えるだけか、
   * 一部のレイアウトでそれを入力するのに必要だから（Numpad+ と
   * Shift+=）で、そのコマンドにとって Shift が別の意味を持つからでは
   * ない。これらの id については、コンボは（上の defaultCombo も上書きも）
   * Shift を取り除いた状態で保存・比較され続けるので、キーを Shift 付きで
   * 押しても無しで押しても同じコンボになる。それ以外はすべて、Shift を
   * キーの組み合わせの一部として扱う（例: Ctrl+Shift+B）。
   */
  ignoreShift?: boolean;
  /** 元々のガード連鎖の残り（入力へのフォーカス、開いているオーバーレイ、「作用対象の UI があるか」）。 */
  canExecute(e: KeyboardEvent): boolean;
  /** 元々のアクション本体。 */
  perform(e: KeyboardEvent): void;
}

export interface ShortcutRow {
  id: string;
  title: string;
  defaultCombo: string;
  /** 上書きされていなければ既定値。 */
  currentCombo: string;
  isCustom: boolean;
}

const entries = new Map<string, ShortcutEntry>();
let overrides: Record<string, string> = {};
const subs = new Set<() => void>();

function notify(): void {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch {
      /* 握りつぶす */
    }
  }
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** 1つのコマンドを登録する。登録解除関数を返す（search-suggestions.ts の registerProvider と同じ慣習）。 */
export function registerShortcut(entry: ShortcutEntry): () => void {
  entries.set(entry.id, entry);
  return () => {
    if (entries.get(entry.id) === entry) entries.delete(entry.id);
  };
}

/** テスト用: すべての登録と上書きを落とす（製品コードから呼ばれることは無い）。 */
export function resetShortcuts(): void {
  entries.clear();
  overrides = {};
}

/**
 * `e` の対象がテキストフィールド（または contentEditable）である間は true
 * ――このアプリのすべてのグローバルショートカットが先頭に置く唯一の
 * ガード（ショートカットは、誰かが実際に入力しているキーを決して食っては
 * いけない）。以前はすべての handleShortcutXKey の先頭に一言一句同じ形で
 * 複製されていた。このモジュールが、それらのハンドラが共通して持って
 * いた他の部分を吸収するのに合わせて、ここに集約した（#246）。
 */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  return !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
}

// --- コンボのヘルパー ---------------------------------------------------------
// 修飾キーの順序を固定する（Ctrl、Shift、Alt、そしてキー）ことで、同じ
// キーの組み合わせが常に同じ文字列を生む――比較はフィールドごとのチェックでは
// なく、ただの文字列一致になる。
const ARROW_LABELS: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

/** e.key を正準化したもの: 文字は大文字小文字を畳む（Caps Lock がコード
 * 進行の identity を変えてはいけない）、テンキー／Shift 付きプラスの対は
 * '=' へ畳み込む（どちらも「サイズを上げるキー」を意味する＝
 * grid-density-builder.ts 参照）、space は読みやすいように綴りで書く。
 * それ以外（Tab、ArrowLeft、…）はすでに正準形。 */
export function normalizeKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key === '+') return '=';
  return key.length === 1 ? key.toLowerCase() : key;
}

function stripShift(combo: string): string {
  return combo.replace('Shift+', '');
}

export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  parts.push(normalizeKey(e.key));
  return parts.join('+');
}

/** US 配列での表示ラベル（#246 の設計: キー表記は常に US 配列で表示する。Obsidian に合わせている――Issue の設計根拠を参照）。 */
export function comboLabel(combo: string): string {
  const parts = combo.split('+');
  const key = parts.pop() as string;
  const keyLabel = ARROW_LABELS[key] || (key.length === 1 ? key.toUpperCase() : key);
  return [...parts, keyLabel].join('+');
}

function ownCombo(entry: ShortcutEntry): string {
  return overrides[entry.id] ?? entry.defaultCombo;
}

/** `combo`（実際に押されたもの、Shift を含む）は今 `entry` に属しているか？ */
function comboBelongsTo(entry: ShortcutEntry, combo: string): boolean {
  return entry.ignoreShift ? stripShift(combo) === ownCombo(entry) : combo === ownCombo(entry);
}

// --- 設定ページの読み書き -----------------------------------------------------
export function list(): ShortcutRow[] {
  return [...entries.values()].map((e) => ({
    id: e.id,
    title: t(e.titleKey),
    defaultCombo: e.defaultCombo,
    currentCombo: ownCombo(e),
    isCustom: e.id in overrides,
  }));
}

/** 今 `id` に割り当てられているキーの組み合わせ（その上書き、または既定値）。`id` が未登録なら null。 */
export function currentCombo(id: string): string | null {
  const e = entries.get(id);
  return e ? ownCombo(e) : null;
}

/** すでに `combo` に座っている「他の」コマンド（あれば。自分の id は除く）。Shift を無視する id も dispatch が調べるのと同じやり方でチェックするので、これから行う上書きがそれらと黙って衝突することもない。 */
export function findConflict(combo: string, excludeId?: string): { id: string; title: string } | null {
  for (const e of entries.values()) {
    if (e.id === excludeId) continue;
    if (comboBelongsTo(e, combo)) return { id: e.id, title: t(e.titleKey) };
  }
  return null;
}

export type SetComboResult = { ok: true } | { ok: false; conflict: { id: string; title: string } };

/** `combo`（comboFromEvent 経由で実際の keydown から捕えたもの）を `id` に
 * 割り当てる。すでに別のコマンドがそのキーの組み合わせに応えるなら拒否し、
 * ――それが誰かを報告する（#246 の受け入れ基準:
 * 「衝突先のコマンド名とともに警告が出る」）。永続化は通常の setPref の
 * 往復を通す。 */
export function setCustomCombo(id: string, combo: string): SetComboResult {
  const entry = entries.get(id);
  if (!entry) return { ok: false, conflict: { id: '', title: '' } };
  const stored = entry.ignoreShift ? stripShift(combo) : combo;
  const conflict = findConflict(stored, id);
  if (conflict) return { ok: false, conflict };
  overrides = { ...overrides, [id]: stored };
  persist();
  notify();
  return { ok: true };
}

export function resetToDefault(id: string): void {
  if (!(id in overrides)) return;
  const next = { ...overrides };
  delete next[id];
  overrides = next;
  persist();
  notify();
}

function persist(): void {
  try {
    hologramIpc.setPref('shortcutOverrides', overrides);
  } catch {
    /* 握りつぶす */
  }
}

/** 起動時に一度だけ config.json と整合させる――panels.ts の load() と同じ
 * 形から localStorage の層を引いたもの: あちらと違い、React の最初の描画
 * より前に答えが要るものは何も無い（再割り当てが問題になるのは、次に
 * 実際にキーが押されたときだけ）。 */
export async function load(): Promise<void> {
  try {
    const prefs = hologramIpc.getPrefs ? await hologramIpc.getPrefs() : null;
    const saved = prefs ? prefs.shortcutOverrides : null;
    if (saved && typeof saved === 'object') {
      overrides = { ...saved };
      notify();
    }
  } catch {
    /* 握りつぶす */
  }
}

/**
 * どの持ち主モジュールの handleShortcutXKey も、以前キーをハードコード
 * していた id ごとにこれを呼ぶ、ディスパッチのプリミティブ。`e` が `id`
 * によって claim された瞬間に true を返す（実際に実行されたかどうかに
 * 関わらず――canExecute()===false でも claim したことになる。これにより、
 * 複数の id を順番にチェックする呼び出し側が、同じ物理キーで別の id に
 * フォールスルーしない＝元の「関数ごとに1キー」という形と一致する）。
 * `e` がそもそもこの id のキーの組み合わせでないときは false を返し、呼び出し側は
 * 次の id を試しに進む（undo-builder.ts の undo/redo の対を参照）。
 */
export function tryRun(id: string, e: KeyboardEvent): boolean {
  const entry = entries.get(id);
  if (!entry) return false;
  if (!comboBelongsTo(entry, comboFromEvent(e))) return false;
  // 依存する UI が今そこに無い登録済みコマンド（例: ズーム可能なスライドが
  // マウントされていないときの Ctrl+0）は false に解決し、それ以上は何も
  // しない――throw も preventDefault も無く（#246 の受け入れ基準）、キーは
  // ブラウザ／OS がそれに対して他にすることへとそのまま流れる。元のガード
  // 連鎖が早期リターンしていたのと同じ。
  if (entry.canExecute(e)) {
    e.preventDefault();
    entry.perform(e);
  }
  return true;
}
