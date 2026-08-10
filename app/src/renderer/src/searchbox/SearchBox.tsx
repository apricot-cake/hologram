// ツールバーの検索の欄＝入力欄とサジェストのポップアップは Base UI Autocomplete が持つ
// （P2④＝react-aria の ComboBox は退役し、それと一緒に react-aria-components の最後の利用者も
// 消えた）。値の出どころは hologramStore の 'searchQuery'＝打てばストアへ押し込まれ、プログラム
// からの書き込み（リセット、タブと履歴の復元）は制御された入力欄へ戻ってくる。`/` の
// ショートカットのためのフォーカスは、searchbox ブリッジに登録したコールバック＝#searchBox の
// id の取り決めは無い（#153 の一切許さない方針＝境界をまたぐ getElementById は使わない）。
//
// サジェストのデータはコマンドレジストリから来る（#28）。この箱は1つの候補エンジンに対する
// 3つの面のうちの1つ（他はコマンドパレットと #148 のチップ帯のインライン入力）なので、行も
// その順序もセクションのラベルも queryEntries() が言うとおりになる。面ごとに違うのは、どの
// セクションをいくつ見せるかと、確定したとき何が起きるかだけ＝ここでは、コマンドパレットの
// ジャンプ項目が走らせるのと同じ「今のタブへ AND で足す」選択になる。項目が自分の perform()
// を持って回っているから。何も強調されていない素の Enter は今までどおり、自由入力のテキストを
// クエリ木の葉として確定する。これはこの面自身の既定で、ブリッジ側に残してある。
import { Autocomplete } from '@base-ui/react/autocomplete';
import { Tag, User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ComponentType, KeyboardEvent } from 'react';
import { type CommandEntry, type CommandSection, type QueryOptions, queryEntries } from '../services/command-registry.ts';
import { handlers as sbHandlers, registerFocus } from '../services/searchbox.ts';
import { store, subscribeKey } from '../services/store.ts';

// この面の顔ぶれはタグと投稿者だけ（コマンドパレットはこれに操作・タブ・フォルダを足す）。
// 件数は旧い buildSuggest が使っていたもの＝その場で絞り込む入力欄の下のドロップダウンに
// 入るのはひと握りで、1ページ分ではない。
const SUGGEST: QueryOptions = { sections: ['tag', 'user'], limit: { tag: 6, user: 4 } };

const SUG_ICON: Partial<Record<CommandSection, ComponentType<{ className?: string }>>> = { tag: Tag, user: User };
const handlers = () => sbHandlers() || null;

export function SearchBox({ placeholder }: { placeholder?: string }) {
  const subscribe = useCallback((cb: () => void) => subscribeKey('searchQuery', cb), []);
  const value = useSyncExternalStore(subscribe, () => store.getState().searchQuery);
  // 素の Enter のための強調の追跡。項目が強調されているときは Base UI がそれを確定する
  // （Item の onClick が発火する）ので、onKeyDown が自由入力を確定してよいのは何も強調されて
  // いないときだけ。追跡は onItemHighlighted で行う＝DOM を嗅ぎ回る（旧い
  // aria-activedescendant への問い合わせ）のではなく状態で持つ。
  const highlightedRef = useRef<CommandEntry | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // `/` は検索ボックスにフォーカスする。ショートカットのハンドラは orchestrator にあり
  // （GlobalShortcuts への登録）、ブリッジの focusSearchBox() を呼ぶ。それがここで登録した
  // コールバックを走らせる。Ctrl+K は今はコマンドパレットのもの（#28）＝この欄の右端に
  // AppToolbar が描くバッジが、その分担を教えている。
  useEffect(
    () =>
      registerFocus(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      }),
    [],
  );

  // サジェストは値から同期的に導く（レジストリの供給側は速い純粋な走査。重い方の入力の
  // 副作用＝グリッドの絞り込み直しは search-box-builder でデバウンスしたまま）。setState では
  // なく導出にしておくとポップアップが歩調を合わせる＝値を空にする経路はどれもコレクションを
  // 空にし、ポップアップは data-empty で自分から隠れる。
  const items = useMemo<CommandEntry[]>(() => {
    const q = value.trim();
    if (!q) return [];
    return queryEntries(q, SUGGEST).flatMap((group) => group.items);
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // IME の変換中の Enter は変換の確定であって、検索の確定ではない。Base UI 自身は
    // which=229 で自分の Enter の処理を止めているが、このハンドラは Base UI より先に走るので、
    // ここでも確かめる必要がある（#28 で追加）。
    if (e.nativeEvent.isComposing) return;
    // 項目が強調されていれば Base UI がそれを確定する（→ Item の onClick）。素の Enter は
    // 自由入力の語をクエリ木の葉として確定する（search-editing の確定の経路＝箱も空にし、
    // ポップアップが閉じる）。
    if (highlightedRef.current) return;
    e.preventDefault();
    const h = handlers();
    if (h) h.onConfirmText();
  };

  return (
    <Autocomplete.Root
      // mode="none": レジストリが問い合わせに対して行を絞り込み済み＝Base UI がそれを絞り
      // 込み直したり、選択中の項目を入力欄へ書き込んだりしてはいけない。
      mode="none"
      items={items}
      value={value}
      onValueChange={(v, details) => {
        // 項目を押すと、その項目のラベルが入力欄へ反響する。選択そのものはストアを通して
        // 既に値を空にしているので、この反響は飲み込む。
        if (details.reason === 'item-press') return;
        store.setState({ searchQuery: v });
      }}
      onItemHighlighted={(it) => {
        highlightedRef.current = it;
      }}
      itemToStringValue={(entry: CommandEntry) => entry.title}
    >
      <Autocomplete.Input
        ref={inputRef}
        aria-label={placeholder}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        // 入力欄の作りは components/ui/input.tsx と同じ。pl-8 はツールバーが left-2.5 に
        // 重ねる虫眼鏡を、pr-16 は right-1.5 に重ねる Ctrl+K のバッジを避けるためのもの。
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pr-16 pl-8 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
      />
      <Autocomplete.Portal>
        {/* z-[13500]: @layer-legacy との同居が続く間、旧オーバーレイの z 尺より上に置く
            （shadcn のポータルの面がどれも使うのと同じ場所＝popover.tsx を参照）。 */}
        <Autocomplete.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="isolate z-[13500]">
          <Autocomplete.Popup className="w-(--anchor-width) max-h-(--available-height) origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 font-sans text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[empty]:hidden">
            <Autocomplete.List>
              {(entry: CommandEntry) => {
                const Icon = SUG_ICON[entry.section] || Tag;
                return (
                  // 項目自身の perform()＝コマンドパレットのジャンプ項目も同じクロージャを
                  // 走らせるので、選ぶことの意味はどちらの面でも同じになる。
                  <Autocomplete.Item key={entry.id} value={entry} onClick={() => entry.perform()} className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 select-none data-highlighted:bg-muted">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{entry.hint}</span>
                  </Autocomplete.Item>
                );
              }}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
