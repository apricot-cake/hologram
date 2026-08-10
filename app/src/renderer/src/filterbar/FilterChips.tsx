// 有効な絞り込みのチップ（再設計 §3-2 / P2③ タスク2）＝「述語」を目に見えるようにしたもの。
// 有効なファセット1つにつきチップ1つ（Linear 式の 1ファセット1チップ）＝先頭にカテゴリの
// アイコン、任意でモードの語（すべて/どれか/〜以外）、値の一覧、末尾にそのファセットまるごと
// を消す ✕。チップの本体をクリックするとそのファセットの編集画面が開き直す＝「絞り込みを
// 追加」の流れが使うのと全く同じ ValueEditor / FormEditor が、チップに紐づいた Popover の
// 中に出る。これは退役した query-chips コンポーネントのクラスタのピルを置き換えたもの
// （改訂4のクラスタの枠＋すべて/どれかのセグメント＋値ごとの ✕）。すべて/どれかと除外は
// 今や編集画面の中にある。
// 自由入力の語（検索ボックスで確定した葉）だけは例外＝語1つにつきチップ1つ、✕ のみで編集
// 画面は無い（P2④）。
//
// データ: orchestrator.activeFilters() が有効なクエリの木からチップを導く。コンポーネントは
// ストアの postQueryTree/posterQueryTree のキー（木を変えるたびに書かれる）を購読して計算し
// 直す。クリックに対する編集画面は、チップの `cat` を手がかりに filterCategories() から引く
// （「絞り込みを追加」のメニューと同じく、その都度読み直す）。
import { Bookmark, X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { type ActiveFilter, activeFilters, type FilterCat, filterCategories, saveCurrentSearch } from '../services/orchestrator.ts';
import { store, subscribeKey } from '../services/store.ts';
import { CatIcon } from './index.tsx';
import { promptName } from '../prompt/Prompt.tsx';
import { FormEditor } from './FormEditor.tsx';
import { InlineFilterInput } from './InlineFilterInput.tsx';
import { ValueEditor } from './ValueEditor.tsx';
import { t } from '../_shared/i18n.ts';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// browseMode と2本のクエリの木をまとめて1つ購読する。スナップショットは有効なモードの木
// （変更と変更の間は参照が安定＝store.set は実際に変わったときだけ差し替える）なので、
// useSyncExternalStore は木の編集とモード切替で再描画し、有効でないモードの木への編集は
// 無視する。
const TREE_KEYS = ['browseMode', 'postQueryTree', 'posterQueryTree'] as const;
const subActive = (cb: () => void) => {
  const unsubs = TREE_KEYS.map((k) => subscribeKey(k, cb));
  return () => {
    for (const u of unsubs) u();
  };
};
const getActive = () => {
  const s = store.getState();
  return s.browseMode === 'posters' ? s.posterQueryTree : s.postQueryTree;
};

// チップの中に出すモードの語＝除外なら「〜以外」、AND のクラスタなら「すべて」、値が2つ
// 以上の OR のクラスタなら「どれか」。肯定の値が1つだけなら語は要らない（「タグ: 猫」）。
function modeWord(f: ActiveFilter): string {
  if (f.mode === 'exclude') return t('fbModeExclude');
  if (f.mode === 'and') return t('qbOptAll');
  if (f.mode === 'or' && f.values.length > 1) return t('qbOptAny');
  return '';
}

function Chip({ f }: { f: ActiveFilter }) {
  const [open, setOpen] = useState(false);
  // 開くたびに編集画面のカテゴリを引き直す（開くたびに件数・語彙・モードが変わる）＝
  // 「絞り込みを追加」のメニューと同じ作り。null はそのファセットに編集画面が無いこと＝
  // 出ているチップで起きるはずはないが、クリックを落とさず何もしないで済ませられる。
  const [cat, setCat] = useState<FilterCat | null>(null);
  const handleOpen = (o: boolean) => {
    // 編集画面のカテゴリが無い（自由入力の語のチップ。P2④）→ 空のポップオーバーを
    // 開かず、クリックは何もしないままにする。そのチップの操作は ✕ だけ。
    if (o && !filterCategories().some((c) => c.cat === f.cat)) return;
    setOpen(o);
    if (o) setCat(filterCategories().find((c) => c.cat === f.cat) ?? null);
  };
  const word = modeWord(f);
  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <span data-slot="filter-chip" className={f.mode === 'exclude' ? 'inline-flex h-7 items-center rounded-md border border-dashed border-border bg-background pr-0.5 pl-1.5 text-sm' : 'inline-flex h-7 items-center rounded-md border border-border bg-background pr-0.5 pl-1.5 text-sm'}>
        <PopoverTrigger render={<button type="button" className="flex min-w-0 items-center gap-1" />}>
          <CatIcon cat={f.type} />
          {word ? <span className="shrink-0 text-xs text-muted-foreground">{word}</span> : null}
          <span className="min-w-0 truncate">{f.values.join('・')}</span>
        </PopoverTrigger>
        <button type="button" className="ml-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground" aria-label={t('qfDelete')} onClick={() => f.remove()}>
          <X className="size-3.5" />
        </button>
      </span>
      <PopoverContent align="start" sideOffset={6} collisionPadding={8} className="w-max max-w-[min(520px,calc(100vw-24px))] p-0">
        {cat ? (
          cat.editor === 'values' ? (
            <ValueEditor
              cat={cat}
              onManage={(fn) => {
                setOpen(false);
                fn();
              }}
            />
          ) : (
            <FormEditor cat={cat} onClose={() => setOpen(false)} />
          )
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// 「検索を保存」（#40）＝チップの行の末尾に置く操作で、位置は Linear の "save view" と同じ。
// チップと一緒に出入りする＝チップが無ければ保存するものも無いので、行ごと（このボタンも）
// 出ない。投稿側だけ＝保存する検索は投稿のクエリだから。
function SaveSearchButton() {
  // 成功のトーストは出さない＝新しい行がサイドバーに現れるし、再設計の憲章が「目に見える
  // 変化は告知する変化ではない」と言っている。
  const onClick = () => promptName(t('saveSearchPrompt'), '', (name) => saveCurrentSearch(name));
  return (
    <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-muted-foreground text-sm hover:bg-accent hover:text-accent-foreground" onClick={onClick}>
      <Bookmark className="size-3.5" />
      {t('saveSearch')}
    </button>
  );
}

export function FilterChips() {
  // 有効なクエリの木（またはブラウズモード）が変わるたびに再描画する。そのうえで
  // activeFilters() が生きている木からチップを導き直す。この呼び出しの目的は購読そのもので、
  // スナップショットを直に読んではいない。activeFilters は orchestrator.ts の起動時の IIFE
  // が代入するので、最初の描画は防いでおく（起動前はどのみち木が空なので [] が正しい）。
  useSyncExternalStore(subActive, getActive);
  const chips = activeFilters ? activeFilters() : [];
  // チップが0個＝描くものが無い（#674）。かつては帯を載せたままにして「＋絞り込みを追加」
  // の誘導で空の状態を埋めていたが、それは「絞り込みを追加」ボタンの仕事と重なっていた。
  // 他の3つの入口（AddFilterButton・検索ボックスの候補・Ctrl+K）が既に一から絞り込みを
  // 始める道を覆っているので、有効な絞り込みが無ければ帯自身に出すものは残らない＝空の
  // 40px の行として残さず外す。受け入れたトレードオフは、最初のチップが出たときにグリッド
  // が下へずれること。Issue の決定どおり、それを和らげるトランジションは付けない。
  if (chips.length === 0) return null;
  const posters = store.getState().browseMode === 'posters';
  return (
    <div data-slot="filter-chips" className="flex flex-wrap items-center gap-1.5 py-1.5">
      {chips.map((f, i) => (
        // key に値（と添字＝確定した語の重複は許される）を入れる＝自由入力のチップは語
        // ごとに1つで cat と mode が同じになるうえ、語を編集したらチップを載せ直して、
        // 値の並びがチップの同一性であり続けるようにしなければならない。
        <Chip key={f.cat + ':' + f.mode + ':' + i + ':' + f.values.join(' ')} f={f} />
      ))}
      <InlineFilterInput posters={posters} />
      {/* 投稿側だけ＝保存する検索は投稿のクエリ。 */}
      {!posters && <SaveSearchButton />}
    </div>
  );
}
