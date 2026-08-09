import { Combobox } from '@base-ui/react/combobox';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { setSelectOpen } from '../services/open-select-registry.ts';
import { normalizeTagName } from '../../../../../native-host/tag-normalize.mts';
import { includesNormalized } from '../services/search.ts';

// 詳細パネルの中でその場でタグを編集する面（P2⑦）。編集はかつて ✎ / 🏷 ボタンに紐づいた
// ポップオーバーに置いていた（Issue #22）。今はカードを既に映しているパネルの一部で、
// タグ付けは入っていくモードではなく属性の編集になっている＝Linear や Notion が複数値の
// 属性に与えているのと同じ形。
//
// 入力欄とポップアップのリストボックスは Base UI Combobox が動かす（標準のコンボボックスの
// キーボード操作がそのまま手に入る＝同等品を自前で作らない）。この部品は自分の選択状態を
// 持たない＝チップはレコードのタグから描いていて、写しはその1つだけ。プリミティブの
// `multiple` 選択を意図して使っていない理由は onPick を参照。
//
// 絞り込みは組み込みのものではなく自前（`filter={null}`）。3つのグループの絞り込み方が
// 揃っていないため。共起によるサジェストは語彙ではなく文脈の手がかりなので、利用者が
// 入力を始めた時点で消える（入力するとは「知っているタグを見つけてくれ」であって
// 「もっと提案してくれ」ではない）。この規則はこのコンポーネントより前からある＝旧い
// ピッカー由来で、組み込みの絞り込みでは表現できない。
export interface TagPickItem {
  tag: string;
  kind?: string | null;
  title?: string;
  /** #86: この正規名のタグへ解決される別名の文字列＝項目自身の `tag` の文字列が一致しなくても、打ち込まれた別名でこの項目を出せるようにする。 */
  aliases?: string[];
  /** #86: 絞り込みが `tag` 自身ではなく `aliases` のどれかで一致したときに、クライアント側で（services/tags.ts からではなく）立てる＝「←ねこ」の注記。 */
  viaAlias?: string;
}
export interface TagPickGroup {
  name: string;
  items: TagPickItem[];
}
interface Group {
  value: string;
  items: TagPickItem[];
}

export interface TagFieldProps {
  tags: string[];
  vocabGroups?: TagPickGroup[] | null;
  coocGroups?: TagPickGroup[] | null;
  srcTags?: TagPickItem[] | null;
  /** #86: 別名 → 正規名。自由入力の Enter 経路のためのもの（services/tags.ts の inspectorTagPickerData）。 */
  aliasMap?: Record<string, string> | null;
  labels: Record<string, string>;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  onContextMenu: (tag: string, x: number, y: number) => void;
  /** 載せた時点でキャレットを欄に入れる＝カード／投稿者のコンテキストメニューの「タグを編集」。 */
  autoFocus?: boolean;
}

export function TagField({ tags, vocabGroups, coocGroups, srcTags, aliasMap, labels, onAdd, onRemove, onContextMenu, autoFocus }: TagFieldProps) {
  const [query, setQuery] = useState('');
  const highlightedRef = useRef<string | undefined>(undefined);
  // ポップアップは詳細パネルの上に載るので、Esc はポップアップを閉じてそこで止まらなければ
  // ならない。詳細パネル自身の Esc ハンドラ（inspector-builder）は、パネルを閉じる前にこの
  // レジストリへ問い合わせる。登録しないと、最初の Esc がタグのポップアップを開いたまま
  // パネルごと閉じてしまう。
  const popupId = useRef(Symbol('inspector-tag-field'));
  // 「タグを編集」の経路では、キャレットを欄へ着地させる必要がある。React の autoFocus が
  // Combobox.Input を通って <input> まで届くことに頼らず、ノード自身へフォーカスする＝その
  // ref はプリミティブが持っていて、prop を転送するかどうかはプリミティブの都合であり、
  // このコンポーネントが当てにしてよいものではない。ラッパーから引いて探すのも同じ理由。
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    boxRef.current?.querySelector<HTMLInputElement>('[data-slot="tag-input"]')?.focus();
  }, [autoFocus]);
  useEffect(() => {
    const id = popupId.current;
    return () => setSelectOpen(id, false); // 開いたまま外れたときに幽霊を残してはいけない
  }, []);

  const groups = useMemo<Group[]>(() => {
    const q = query.trim();
    const matches = (t: string) => includesNormalized(t, q);
    const out: Group[] = [];
    // 文脈の手がかりは、欄に手が付いていない間だけ出す＝上の注記を参照。
    if (!q) for (const g of coocGroups || []) if (g.items.length) out.push({ value: g.name, items: g.items });
    const src = (srcTags || []).filter((it) => matches(it.tag));
    if (src.length) out.push({ value: labels.adoptSource, items: src });
    // #86: 問い合わせがその項目の別名のどれかに当たったときも一致とする（正規名の
    // 文字列だけではない）。当たったものは正規名の下に出す（viaAlias は注記を足す
    // だけ）＝別名を別に選べる行として出すことは一切しないので、選べば必ず正規名の
    // 文字列が足される（設計:「確定するチップは正規名」）。
    for (const g of vocabGroups || []) {
      const items: TagPickItem[] = [];
      for (const it of g.items) {
        if (matches(it.tag)) {
          items.push(it);
          continue;
        }
        const viaAlias = (it.aliases || []).find((a) => matches(a));
        if (viaAlias) items.push({ ...it, viaAlias });
      }
      if (items.length) out.push({ value: g.name, items });
    }
    return out;
  }, [query, vocabGroups, coocGroups, srcTags, labels.adoptSource]);

  // 行を選ぶとそのタグが入り／切りに切り替わる。旧いピッカーと同じ。コンボボックスは
  // 自分の選択状態を一切持たない（`value={null}`）＝レコードのタグが唯一の写しで、下の
  // チップはそこから描いている。以前の版はコンボボックス自身の `multiple` 選択を使い、
  // チップもプリミティブに供給させていた。非同期の書き換えのあとに2つの写しがずれ、
  // × を1回押しただけでタグが2つ外れた。
  const onPick = (picked: string | null) => {
    if (picked == null) return;
    if (tags.includes(picked)) onRemove(picked);
    else onAdd(picked);
    setQuery('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    if (highlightedRef.current) return; // 代わりに Base UI が強調中の項目を確定する
    // NFKC ＋ trim（#197）＝既にあるタグの字体違い（全角か半角か、余分な空白）を打ち込んで
    // も、語彙を枝分かれさせず同じタグとして保存させる。DB 層だけでなくここでも正規化して
    // おくことで、inspector-builder.ts / poster-grid-builder.ts の `tags.includes(picked)`
    // による重複判定も同じ土俵で比較できる。
    const typed = normalizeTagName(query);
    if (!typed) return;
    e.preventDefault();
    // #86: 打ち込まれた別名は、タグになる前に正規名へ吸い寄せる＝
    //「別名のままチップ化するのは不採用」（設計が自ら却下した案）。ここで何にも一致しない
    // 自由入力は今までどおり onAdd(typed) へ素通りする。この仕組みが入る前と同じ。
    onAdd((aliasMap && aliasMap[typed]) || typed);
    setQuery('');
  };

  return (
    <Combobox.Root
      items={groups}
      filter={null}
      value={null}
      onValueChange={onPick}
      inputValue={query}
      onInputValueChange={(v) => setQuery(v)}
      onOpenChange={(open) => setSelectOpen(popupId.current, open)}
      onItemHighlighted={(it) => {
        highlightedRef.current = it as string | undefined;
      }}
    >
      {/* 素の div ではなく Combobox.InputGroup を使う。これ自身がコンボボックスのアンカーと
          して登録されるので、サジェストのポップアップが欄の全体に揃う。その左にある素の
          input に揃えると、チップが1つ増えるたびに右へずれて狭くなっていた。チップを抱えた
          箱にポップアップを揃えるのは Base UI が既定で解決する先（inputGroupElement ??
          inputElement）でもあり、MUI Autocomplete（popper を inputRoot に揃え、幅も同期）や
          Ant Design Select（popupMatchSelectWidth）とも一致する。箱のパディングを押しても
          入力欄にフォーカスが入るようになる効果もある。
          チップまわりの残りの部品（Combobox.Chips/Chip/ChipRemove）は使わないままにする。
          ChipRemove はプリミティブ自身の選択状態へ書き込むが、それはこのコンポーネントが
          意図して持たない2つめの写しだから＝onPick を参照。 */}
      <Combobox.InputGroup ref={boxRef} className="flex w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
        {tags.map((tag) => (
          <span
            key={tag}
            data-slot="tag-chip"
            data-tag={tag}
            className="inline-flex h-5 items-center gap-1 rounded-4xl bg-secondary px-2 text-xs font-medium text-secondary-foreground"
            // InputGroup のどこを押しても入力欄にフォーカスが入り、サジェストが開く
            // （Base UI 自身の振る舞いであり、箱をクリックしたときに欲しいものでもある）。
            // 右クリックはその「押す」ではない＝狙いはこのチップの種別メニューで、素通り
            // させるとサジェストの一覧がそのメニューの後ろで開きっぱなしになっていた。
            // ここで真似できる前例は Base UI には無い＝上流のチップにはコンテキスト
            // メニューが無いので、Base UI の Chip はボタンの防ぎを持っていない。
            onMouseDown={(e) => {
              if (e.button !== 0) e.stopPropagation();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu(tag, e.clientX, e.clientY);
            }}
          >
            {tag}
            <button type="button" className="-mr-0.5 cursor-pointer rounded-full text-muted-foreground hover:text-foreground" aria-label={labels.removeTag} onClick={() => onRemove(tag)}>
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <Combobox.Input data-slot="tag-input" placeholder={tags.length ? '' : labels.newTagPlaceholder} onKeyDown={onKeyDown} className="h-5 min-w-16 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
      </Combobox.InputGroup>
      <Combobox.Portal>
        {/* z-[13500]: @layer-legacy との同居が続く間、旧オーバーレイの z 尺より上に置く。 */}
        <Combobox.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="isolate z-[13500]">
          <Combobox.Popup className="max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 font-sans text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground">{query ? labels.noMatch : labels.noVocab}</Combobox.Empty>
            <Combobox.List>
              {(group: Group) => (
                <Combobox.Group key={group.value} items={group.items} className="mb-1 last:mb-0">
                  <Combobox.GroupLabel className="px-2 py-1 text-[11px] text-muted-foreground">{group.value}</Combobox.GroupLabel>
                  {group.items.map((it) => (
                    <Combobox.Item
                      key={it.tag}
                      value={it.tag}
                      className="flex cursor-default items-center gap-1.5 rounded-sm px-2 py-1 text-xs select-none data-highlighted:bg-muted"
                      // ここに onClick は置かない。項目を押すことが選択値を変える操作で、
                      // それは onValueChange として届く。押下をここでも扱うと、書き換えが
                      // 2回当たってしまう。
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onContextMenu(it.tag, e.clientX, e.clientY);
                      }}
                    >
                      {it.kind ? <span className={'tag-pal-kind tk-' + it.kind} /> : null}
                      <span className="min-w-0 flex-1 truncate" title={it.title}>
                        {it.tag}
                        {it.viaAlias && <span className="text-muted-foreground"> (←{it.viaAlias})</span>}
                      </span>
                    </Combobox.Item>
                  ))}
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
