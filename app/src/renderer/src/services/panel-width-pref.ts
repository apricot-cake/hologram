// インスペクタの列の幅（#30）＝ドラッグした幅が再起動をまたいで残る。
//
// 2段構え。config.json が持続する住処で（IPC 経由の setPref）、localStorage は同期の
// キャッシュ。そもそもこれを成り立たせているのがキャッシュだ＝幅は React の最初の描画の
// 最中に分かっていなければならず、IPC の往復は1拍後にしか答えられない。それでは既定の幅を
// 描いてから、起動直後に保存された幅へ飛ぶことになる。正本は config.json のまま＝load() が
// 1回だけキャッシュを突き合わせるので、アプリの外での編集がやはり勝つ。
//
// persist() に届くのは、完了した操作（pointerup、キー押下、ダブルクリックでのリセット）
// だけ。ドラッグの最中は何も届かない＝setPref は fsync を伴う不可分な書き込みで
// config.json に着くので、pointermove ごとに呼ぶとドラッグが止まる。
//
// #30 はこれを両側のパネルに入れた。サイドバー側の半分は、広がる列（#981）と一緒に無く
// なった＝レールの幅は固定なので、ドラッグが書く幅が無い。一般的な形はそのまま＝この
// モジュールがパネル固有のことを知っていたことは一度も無い。
import { hologramIpc } from './ipc.ts';

export type PanelKey = 'inspectorWidth';

const CACHE_KEY: Record<PanelKey, string> = {
  inspectorWidth: 'hologram-inspector-width',
};

// 絶対の上下限、px 単位。下限は、引き出し直さないと使えない細切れまで縮むのを防ぎ、パネルを
// 読める大きさに保つ。上限は、ウィンドウの最小幅 720px でもコンテンツの列を使える大きさに
// 保つ＝その上に clampWidth のビューポートの頭打ちがあり、小さいウィンドウで実際に効くのは
// そちら。
export const LIMITS: Record<PanelKey, { min: number; max: number }> = {
  inspectorWidth: { min: 260, max: 560 },
};

// パネルが取ってよいウィンドウの割合＝意図して半分未満にしてある。反対側でレールも自分の
// 取り分を取るからだ。
const VIEWPORT_CAP = 0.45;

/** px 単位へ丸め、絶対の上下限とビューポートの頭打ちの両方の内側へ収める。 */
export function clampWidth(key: PanelKey, px: number, viewportW: number): number {
  const { min, max } = LIMITS[key];
  // 頭打ちが `min` より下へ押し込むことはない。狭いウィンドウでは、何も無いところまで
  // 潰れたパネルより「読める」の下限の方が勝つし、どのみちパネルは畳める。
  const cap = Math.max(min, Math.min(max, Math.round(viewportW * VIEWPORT_CAP)));
  return Math.min(cap, Math.max(min, Math.round(px)));
}

function readCache(key: PanelKey): number | null {
  try {
    const v = localStorage.getItem(CACHE_KEY[key]);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeCache(key: PanelKey, px: number): void {
  try {
    localStorage.setItem(CACHE_KEY[key], String(px));
  } catch {
    /* 無視する */
  }
}

// 保存された幅。利用者がこのパネルを一度もドラッグしていなければ null（既定は呼び出し側が
// 持つ＝コンポーネント自身の幅のトークンから来るもので、ここのリテラルではない）。
// 設計として同期＝最初の描画でも安全。
export function cachedWidth(key: PanelKey): number | null {
  return readCache(key);
}

export function persistWidth(key: PanelKey, px: number): void {
  writeCache(key, px);
  try {
    hologramIpc.setPref(key, px);
  } catch {
    /* 無視する */
  }
}

// 起動時に1回だけ、キャッシュを config.json と突き合わせる。持続する値へ解決するか、
// 未設定・読めない時は null を返す＝その場合は、既に使っているキャッシュの推測がそのまま通る。
export async function loadWidth(key: PanelKey): Promise<number | null> {
  try {
    const prefs = hologramIpc.getPrefs ? await hologramIpc.getPrefs() : null;
    const px = prefs ? prefs[key] : null;
    if (typeof px !== 'number' || !Number.isFinite(px)) return null;
    writeCache(key, px);
    return px;
  } catch {
    return null;
  }
}
