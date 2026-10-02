import { Combobox } from '@base-ui/react/combobox';
import { isComposing } from '../../_shared/composition.ts';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { setSelectOpen } from '../../services/open-select-registry.ts';
import { quoteFamily } from '../../services/ui-font-api.ts';
import { t } from '../../_shared/i18n.ts';

// インターフェースフォントの選択欄（設定 →「外観」、#137）。ここでも Base UI の Combobox
// を使う（inspector/TagField.tsx がこのコードベースでの型をすでに作っている）。ただし複数
// タグではなく単一値で、確定した設定値がそのまま combobox 自身の選択値になる。入力欄の
// 実時間のテキストは別のクエリで、呼び出し側がキー入力ごとにプレビューする＝settings/ipc.ts
// の uiFont.preview/commit の分け方を参照。
//
// 項目一覧は window.queryLocalFonts()（Local Font Access API）から取り、最初に開いた時に
// 遅延で読み込む。Electron 43 は許可のプロンプトなしでこれを許可する（CDP のサンドボックス
// で確認した。window.queryLocalFonts() がダイアログなしで実際にインストール済みの 359
// ファミリを解決した）。ただし API 自体はウェブプラットフォームの任意の機能なので、これが
// 無いビルドや OS（typeof window.queryLocalFonts !== 'function'）では項目一覧が空になる。
// その場合も欄はただの自由入力として動き続ける。これは Issue の設計が明示的に許している
// 退避先。
export function FontCombobox({ value, onPreview, onCommit }: { value: string; onPreview: (v: string) => void; onCommit: (v: string) => void }) {
  const [query, setQuery] = useState(value);
  const [items, setItems] = useState<string[] | null>(null); // null = まだ問い合わせていない
  const highlightedRef = useRef<string | null>(null);
  const popupId = useRef(Symbol('ui-font-combobox'));

  // 確定値がこちらの知らないところで変わった時に合わせ直す（ui-font-api.ts の起動時に走る
  // config.json との突き合わせや、将来の外部からの setter）＝「外観」のテーマ Select が
  // getPrefs() の解決後に合わせ直すのと同じ形。
  useEffect(() => {
    setQuery(value);
  }, [value]);
  useEffect(() => {
    const id = popupId.current;
    return () => setSelectOpen(id, false);
  }, []);

  const loadItems = () => {
    if (items !== null) return; // 問い合わせ済み（または未対応と分かっている）
    if (typeof window.queryLocalFonts !== 'function') {
      setItems([]);
      return;
    }
    window
      .queryLocalFonts()
      .then((fonts) => {
        const families = Array.from(new Set(fonts.map((f) => f.family))).sort((a, b) => a.localeCompare(b));
        setItems(families);
      })
      .catch(() => setItems([])); // 許可されなかった、またはこの OS で未実装＝自由入力は動き続ける
  };

  const commit = (v: string) => {
    const cleaned = v.trim();
    setQuery(cleaned);
    onCommit(cleaned);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e.nativeEvent)) return;
    if (e.key === 'Escape') {
      // 編集中の内容を取り消す。最後に確定したフォントをその場で戻し、ポップアップにも
      // Escape を食わせない（ポップアップは自分で閉じる。ここでやるのはプレビューを
      // 戻すことだけ＝確定していないフォントをアプリ全体が着たままにしない）。
      setQuery(value);
      onPreview(value);
      return;
    }
    if (e.key !== 'Enter') return;
    if (highlightedRef.current) return; // 代わりに Base UI が強調中の項目を確定する
    e.preventDefault();
    commit(query);
  };

  return (
    <Combobox.Root
      items={items || []}
      value={value || null}
      onValueChange={(picked) => {
        // null はクリアボタンとコードからのリセットの両方を指す。どちらにしても
        // 「既定のフォントスタックに戻す」という意味になる。
        const v = picked ?? '';
        setQuery(v);
        onPreview(v);
        onCommit(v);
      }}
      inputValue={query}
      onInputValueChange={(v) => {
        setQuery(v);
        onPreview(v.trim());
      }}
      onOpenChange={(open) => {
        setSelectOpen(popupId.current, open);
        if (open) loadItems();
      }}
      onItemHighlighted={(it) => {
        highlightedRef.current = (it as string | undefined) ?? null;
      }}
    >
      <Combobox.InputGroup className="flex w-56 items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
        <Combobox.Input placeholder={t('uiFontPlaceholder')} onKeyDown={onKeyDown} onBlur={() => commit(query)} className="h-5 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
        {query ? (
          <Combobox.Clear aria-label={t('uiFontClear')} className="cursor-pointer rounded-full text-muted-foreground hover:text-foreground">
            ×
          </Combobox.Clear>
        ) : null}
      </Combobox.InputGroup>
      <Combobox.Portal>
        {/* z-[13500]: 旧オーバーレイと共存させるための枠で、components/ui/select.tsx と同じ。 */}
        <Combobox.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="isolate z-[13500]">
          <Combobox.Popup className="max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 font-sans text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground">{t('uiFontNoMatch')}</Combobox.Empty>
            <Combobox.List>
              {(family: string) => (
                <Combobox.Item key={family} value={family} className="flex cursor-default items-center rounded-sm px-2 py-1 text-xs select-none data-highlighted:bg-muted" style={{ fontFamily: quoteFamily(family) }}>
                  {family}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
