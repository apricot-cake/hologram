// チップ帯のインライン入力（#148）＝「タイプ→種別候補→チップ化」の3つ目の面。
//
// 帯の末尾の「＋」を押すとその場に1行の入力欄が開き、打った文字に当たった候補
// （タグ／投稿者／フォルダ）と、常設最下段の逃げ道「本文を検索: 「…」」が下にポップする。
// 選ぶとチップが1つ増えて入力欄は閉じ、「＋」に戻る＝帯は1行のまま。チップが1つも
// 無いときは「＋」でなく「＋ 絞り込みを追加」の案内を兼ねた入口になる（旧 qbEmptyHint
// の役目をこの1要素が引き継ぐ＝案内と入口が別の場所にあると、読んだ場所からは始められない）。
//
// 候補は services/command-registry.ts の queryEntries から引く＝検索ボックスのサジェスト・
// コマンドパレットと**同じ1つのエンジン**（ADR 0016）。この面が自分で決めるのは
// ①どのセクションを何件見せるか ②確定したときの動作、の2つだけで、候補の生成・並び・
// 種別ラベルは持たない。
//
// 確定は entry.filter → orchestrator の addFilterToCurrentView（＝いま見ているビューの
// addFilter）。検索ボックスの pick を通さないのは、あちらが「打った文字は絞り込みを
// 探すためのもの」として入力欄を空にし打ちかけの本文語を捨てるため——チップ帯の入力は
// 本文検索の欄ではないので、その巻き添えを起こしてはいけない。filter を持たない候補
// （フォルダへのジャンプ）はエントリ自身の perform() に倒れる。
//
// 器は SearchBox と同じ Base UI Autocomplete（入力欄＋ポータルのポップアップ）。パレットの
// `inline` モードでないのは、あちらが窓いっぱいに一覧を敷く面で、こちらは1行の入力欄の
// 下にドロップダウンを出す面だから。
import { Autocomplete } from '@base-ui/react/autocomplete';
import { Folder, Plus, Search, Tag, User } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent } from 'react';
import { t } from '../_shared/i18n.ts';
import { type CommandSection, type QueryOptions, queryEntries } from '../services/command-registry.ts';
import { addFilterToCurrentView } from '../services/orchestrator.ts';

// この面の顔ぶれ。件数は検索ボックスと同じ考え方（入力欄直下のドロップダウンは縦に
// 伸ばせない＝当たった分を全部出すパレットの作法はここでは採れない）。投稿者ビューには
// 投稿者という候補種別が無い（投稿者そのものが行）ので tag / folder だけになる。
const POST_SECTIONS: QueryOptions = { sections: ['tag', 'user', 'folder'], limit: { tag: 6, user: 4, folder: 4 } };
const POSTER_SECTIONS: QueryOptions = { sections: ['tag', 'folder'], limit: { tag: 6, folder: 4 } };

// 「本文を検索」は registry の候補ではなく、この面の既定動作を行にしたもの＝母集合に
// 当たらない語でも必ず1つは選べる逃げ道。投稿者ビューには本文が無い（poster の述語に
// text 型が無い）ので出さない。
type RowSection = CommandSection | 'text';

interface Row {
  id: string;
  section: RowSection;
  title: string;
  hint?: string;
  commit(): void;
}

const ROW_ICON: Partial<Record<RowSection, ComponentType<{ className?: string }>>> = { tag: Tag, user: User, folder: Folder, text: Search };
// 行頭の種別語。1つのポップに複数の種別が混ざるので、アイコンだけだと「タグの猫」と
// 「投稿者の猫」が読み分けられない（Issue の例そのまま＝「タグ: 抱きしめ」）。
const ROW_LABEL: Partial<Record<RowSection, string>> = { tag: 'paletteSecTag', user: 'paletteSecUser', folder: 'paletteSecFolder' };

export function InlineFilterInput({ hasChips, posters }: { hasChips: boolean; posters: boolean }) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 候補は値から同期的に導出する（SearchBox / パレットと同じ理由＝setState を挟むと
  // 一覧と入力が1フレームずれる）。この面はライブ絞り込みをしない（打っている間は
  // 何も適用しない）ので、デバウンスも要らない。
  const rows = useMemo<Row[]>(() => {
    const q = query.trim();
    if (!q) return [];
    const out: Row[] = queryEntries(q, posters ? POSTER_SECTIONS : POST_SECTIONS).flatMap((group) =>
      group.items.map((entry) => ({
        id: entry.id,
        section: entry.section,
        title: entry.title,
        hint: entry.hint,
        commit: () => (entry.filter ? addFilterToCurrentView(entry.filter) : entry.perform()),
      })),
    );
    if (!posters) out.push({ id: `text:${q}`, section: 'text', title: t('fbInlineText', [q]), commit: () => addFilterToCurrentView({ type: 'text', value: q }) });
    return out;
  }, [query, posters]);

  const close = () => {
    setQuery('');
    setEditing(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // IME 変換中の Enter / Esc は変換の操作であってこの面の操作ではない。Enter は Base UI 側も
    // which=229 で弾いているが、この handler はそれより先に走るので両方で見る（#28 と同じ罠）。
    if (e.nativeEvent.isComposing) return;
    // Esc は候補ポップだけでなく入力欄ごと閉じて「＋」へ戻す（候補が1件も無いときは
    // ポップが開いていない＝Base UI の dismiss が走らないので、ここが唯一の出口になる）。
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  if (!editing)
    return (
      <button
        type="button"
        data-slot="filter-add-inline"
        // チップがあるときはアイコンだけの「＋」（帯の末尾に置く小さな追加口）、
        // 無いときは文言つき＝そこが「絞り込みはここから」の案内も兼ねる。どちらも枠は
        // 持たない＝この帯の破線枠は「〜以外」チップの印なので、追加口が同じ顔をすると
        // 除外条件が1つ立っているように読める（隣の 検索を保存 と同じ ghost に揃える）。
        className={hasChips ? 'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground' : 'inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-muted-foreground text-sm hover:bg-accent hover:text-accent-foreground'}
        aria-label={t('fbAddFilter')}
        title={hasChips ? t('fbAddFilter') : undefined}
        onClick={() => setEditing(true)}
      >
        <Plus className="size-3.5" />
        {hasChips ? null : <span>{t('fbAddFilter')}</span>}
      </button>
    );

  return (
    <Autocomplete.Root
      // mode="none": 絞り込みは queryEntries が済ませてある＝Base UI に再フィルタさせない
      // （マッチの意味論が二重にならない）。autoHighlight: 打った直後の Enter で先頭が
      // 走る（パレットと同じ）＝「本文を検索」が常に居るので Enter が空振りしない。
      mode="none"
      autoHighlight
      items={rows}
      value={query}
      onValueChange={(v, details) => {
        // 選んだ項目のラベルが入力欄へ echo される。この面は確定と同時に閉じるので拾わない。
        if (details.reason === 'item-press') return;
        setQuery(v);
      }}
      onOpenChange={(open, details) => {
        // 外側クリック・フォーカス外れ・Esc は入力欄ごと畳む（開けっ放しの空欄を帯に
        // 残さない）。判定は Base UI に任せる＝ポップアップはポータルの外に居るので、
        // 自前の blur 判定だと候補クリックとレースする。
        if (open) return;
        if (details.reason === 'outside-press' || details.reason === 'focus-out' || details.reason === 'escape-key') close();
      }}
      itemToStringValue={(row: Row) => row.title}
    >
      <Autocomplete.Input
        ref={inputRef}
        autoFocus
        aria-label={t('fbAddFilter')}
        placeholder={t('fbAddFilterPh')}
        onKeyDown={onKeyDown}
        // border-0 は必須（パレットと同じ理由）＝旧スタイルシートの `input[type="text"]`
        // 規則が Base UI の Input に乗る。枠はこの入れ物側が持つ。
        className="h-7 w-44 min-w-0 rounded-md border border-input bg-background px-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
      />
      <Autocomplete.Portal>
        {/* z-[13500]: レガシー z 目盛りの上（shadcn のポータル面が共通で使う段）。 */}
        <Autocomplete.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="isolate z-[13500]">
          <Autocomplete.Popup className="max-h-(--available-height) w-72 max-w-[calc(100vw-24px)] origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 font-sans text-popover-foreground text-sm shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[empty]:hidden data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
            <Autocomplete.List>
              {(row: Row) => {
                const Icon = ROW_ICON[row.section] || Tag;
                const label = ROW_LABEL[row.section];
                return (
                  <Autocomplete.Item
                    key={row.id}
                    value={row}
                    onClick={() => {
                      row.commit();
                      close();
                    }}
                    className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 data-highlighted:bg-muted"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    {label ? <span className="shrink-0 text-muted-foreground text-xs">{t(label)}</span> : null}
                    <span className="min-w-0 flex-1 truncate">{row.title}</span>
                    {row.hint ? <span className="shrink-0 text-muted-foreground text-xs">{row.hint}</span> : null}
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
