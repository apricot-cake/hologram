// searchbox のブリッジ: viewer.ts（検索データ＋ビジネスロジック）を
// searchbox の React コンポーネント（入力欄＋サジェストのポップアップを
// 持つ Base UI Autocomplete）へつなぐ。ハンドラは関数なので、シリアライズ
// 可能な hologramStore ではなくこの専用ブリッジに乗る――menu.ts /
// kind-menu.ts と同じ理由。コンポーネントは viewer.ts が起動を終える前に
// 読み込まれる（viewer はまず hologramI18n を待つ）ので、マウント時に
// キャッシュするのではなく、操作のたびに handlers() を遅延して pull する。
// 値自体はここを一切通らない――それは hologramStore の 'searchQuery'。
// 実体は本物の ES モジュール（named exports）。

let registered: HologramSearchBoxHandlers | null = null; // { getSuggestions(q), onPick(item), onConfirmText() }

// viewer.ts が自分のコールバックを登録する。
export function init(h: HologramSearchBoxHandlers): void {
  registered = h;
}

// コンポーネントは操作のたびにそれらを pull する。
export function handlers(): HologramSearchBoxHandlers | null {
  return registered;
}

// フォーカスは逆方向に流れる: コンポーネントはマウント時にフォーカス用
// コールバックを登録し、`/` ／Ctrl+K のショートカットハンドラ
// （search-box-builder）が focusSearchBox() を呼ぶ――旧来の
// getElementById('#searchBox') の id 契約（P2④、#153 のゼロ許容）を
// 置き換えている。アンマウント中のコンポーネントがきれいに切り離せる
// よう、登録解除関数を返す。
let focusFn: (() => void) | null = null;
export function registerFocus(fn: () => void): () => void {
  focusFn = fn;
  return () => {
    if (focusFn === fn) focusFn = null;
  };
}
export function focusSearchBox(): void {
  if (focusFn) focusFn();
}
