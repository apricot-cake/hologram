// コマンドパレット（#28）の島＝持っているのは外側の枠だけ。候補・並び・実行はすべて
// services/command-registry.ts にあり、このファイルは「窓・入力欄・候補一覧」を描くだけ。
//
// 既にある部品だけで組み立ててある（依存の追加は0）。shadcn の Dialog（＝Base UI の Dialog。
// 背景のクリックと Esc での消去、フォーカスの閉じ込め、閉じた時のフォーカスの戻し、
// スクロールの固定、さらに .wc-dim によるウィンドウ操作ボタンの減光まで＝
// data-slot='dialog-overlay' を見る既存の仕組みがそのまま働く）と、Base UI の Autocomplete の
// `inline` モード（自分のポップアップを持たずにその場で List を描く＝パレット自身の形その
// もの。ダイアログの中に入力欄と一覧が並ぶ）。
//
// cmdk は採らなかった（Radix への依存が a11y の層を二重にするし、内蔵の採点器もこちらの
// 一致の意味付けの隣に2つ目を作ってしまう）。自前のオーバーレイも採らなかった。
//
// #29（タブをまたぐ本文検索）は2つ目のオーバーレイではなく、同じ枠に乗る（Issue の設計:
// 「画面部品（窓/入力欄/候補一覧）は共用」＝窓・入力欄・一覧は共有し、違うのは候補の出所と
// 行の形だけ）。PaletteBody は `mode` を持つようになる＝'commands'（上の #28 のエンジンで、
// 変えていない）か 'fulltext'（services/fulltext.ts に対する、自前のデバウンス付きの非同期
// 検索）。入り口はパレット自身の足元の行か、Ctrl/Cmd+Shift+F（command-registry.ts の
// openFulltext()）。
import { Autocomplete } from '@base-ui/react/autocomplete';
import { AppWindow, FileSearch, Folder, History, Tag, Terminal, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '../_shared/i18n.ts';
import { type CommandEntry, type CommandGroup, type CommandSection, close, isOpen, openId, openMode, queryEntries, runEntry, subscribe } from '../services/command-registry.ts';
import { type FullTextMatch, fullTextBridge, runFullTextSearch } from '../services/fulltext.ts';

const SECTION_ICON: Record<CommandSection, ComponentType<{ className?: string }>> = {
  command: Terminal,
  tab: AppWindow,
  history: History,
  tag: Tag,
  user: User,
  folder: Folder,
};

const SECTION_LABEL: Record<CommandSection, string> = {
  command: 'paletteSecCommand',
  tab: 'paletteSecTab',
  history: 'paletteSecHistory',
  tag: 'paletteSecTag',
  user: 'paletteSecUser',
  folder: 'paletteSecFolder',
};

// #29: 本文検索の当たりがどの欄に一致したか。投稿者名の隣に出すラベルとして使う。タグや
// ハッシュタグの当たりが本文の当たりとして読まれてはいけない（設計が挙げた理由: そうしないと、
// タグやハッシュタグ経由で入ってきた一致が「本文で見つかった」と思っている読み手を驚かせる）。
const FIELD_LABEL: Record<FullTextMatch['field'], string> = {
  text: 'ftFieldText',
  title: 'ftFieldTitle',
  memo: 'ftFieldMemo',
  seriesTitle: 'ftFieldSeries',
  alt: 'ftFieldAlt',
  quoted: 'ftFieldQuoted',
  poll: 'ftFieldPoll',
  linkCard: 'ftFieldLinkCard',
  displayName: 'ftFieldAuthor',
  screenName: 'ftFieldAuthor',
  eagleName: 'ftFieldEagle',
  tag: 'ftFieldTag',
  hashtag: 'ftFieldHashtag',
};

const FULLTEXT_DEBOUNCE_MS = 150; // #29 設計:「150ms デバウンス」
const FULLTEXT_CAP = 50; // #29 設計: 上限50件＋「すべて表示」

const authorLabelOf = (p: HologramPost): string => p.displayName || p.screenName || t('cmdUnknownUser');
const thumbFileOf = (p: HologramPost): string | null => p.image || (Array.isArray(p.media) && p.media[0]?.file) || null;

function CommandsBody({ onEnterFulltext }: { onEnterFulltext: (seedQuery: string) => void }) {
  const [query, setQuery] = useState('');
  // 候補は値から同期的に導く（SearchBox と同じ理由＝間に setState を挟むと、一覧と入力欄が
  // 一瞬ずれる）。提供側は毎回母集団を読み直すので、パレットを開いている間にライブラリが
  // 変わっても、次のキー入力で追いつく。
  //
  // 件数に上限は置かない＝候補一覧についてのアプリ全体の作法に合わせる（「+ 絞り込み」の帯の
  // 一覧は上限無しでスクロールし、サイドバーのファセットの行は 100 で頭打ちにする）。一致した
  // ものはすべて見せ、利用者にはもっと打って絞るかスクロールしてもらう。検索ボックスの面だけが
  // タグ6件・投稿者4件という以前の上限を保つ。あそこでは入力欄の真下のドロップダウンで、縦に
  // 伸ばせないから。
  const groups = useMemo<CommandGroup[]>(() => queryEntries(query), [query]);

  return (
    // gap-0 / p-0 / 上寄せ: パレットは「入力欄＋一覧」の2段しかないので、ダイアログの既定の
    // 余白と縦の中央寄せ（候補が増えるたびに窓が上下へ伸びることになる）はこの形に合わない。
    <DialogContent className="top-[15%] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
      {/* Base UI の Dialog は Popup の中に Title を要求する（aria-labelledby が解決する先）。
          パレットは見出しを描く画面ではないので、sr-only で置く。 */}
      <DialogHeader className="sr-only">
        <DialogTitle>{t('paletteTitle')}</DialogTitle>
        <DialogDescription>{t('paletteDesc')}</DialogDescription>
      </DialogHeader>
      <Autocomplete.Root
        // inline と open: 自分のポップアップを使わず、その場で List を描く（Base UI の
        // 決まりに従い、open は無条件に渡す）。mode="none": 絞り込みは queryEntries が
        // 既に済ませてある＝Base UI にもう一度絞らせない（つまり一致の意味付けを二重に
        // しない）。
        inline
        open
        mode="none"
        items={groups}
        value={query}
        onValueChange={setQuery}
        // 先頭の項目を必ず強調する＝開いて、打って、Enter を押せば走る（VS Code や Linear
        // と同じ）。
        autoHighlight="always"
        itemToStringValue={(entry: CommandEntry) => entry.title}
      >
        <div className="border-b p-1">
          <Autocomplete.Input
            autoFocus
            aria-label={t('paletteTitle')}
            placeholder={t('palettePlaceholder')}
            // IME の変換中の Enter は、Base UI 自身の ComboboxInput が塞ぐ（Chromium は
            // 変換中の keydown を which=229 に回すので、Enter の処理に届く前に戻る）。実機で
            // 確認済み。境界線は入れ物の border-b が持つので、入力欄自身は border-0。
            className="h-8 w-full min-w-0 border-0 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </div>
        <Autocomplete.List className="max-h-80 overflow-y-auto overscroll-contain p-1">
          {(group: CommandGroup) => (
            <Autocomplete.Group key={group.section} items={group.items} className="pb-1 last:pb-0">
              <Autocomplete.GroupLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t(SECTION_LABEL[group.section])}</Autocomplete.GroupLabel>
              <Autocomplete.Collection>
                {(entry: CommandEntry) => {
                  const Icon = SECTION_ICON[entry.section];
                  return (
                    // 閉じてから実行する（この順である理由は runEntry のコメントを参照）。
                    <Autocomplete.Item key={entry.id} value={entry} onClick={() => runEntry(entry)} className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none data-highlighted:bg-muted">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                      {entry.hint && <span className="shrink-0 text-xs text-muted-foreground">{entry.hint}</span>}
                    </Autocomplete.Item>
                  );
                }}
              </Autocomplete.Collection>
            </Autocomplete.Group>
          )}
        </Autocomplete.List>
        {/* Empty は「一覧が空のときだけ子を描く」部品＝スクリーンリーダーのために DOM には
            残り続けるので、中身が無いときは箱そのものを潰す（余白だけが取り残されるのを
            止めるため）。操作の項目はクエリが空でもすべて一致するので、これが出るのは打った
            ものが本当に何にも一致しないときだけ。 */}
        <Autocomplete.Empty className="px-3 py-6 text-center text-sm text-muted-foreground empty:hidden">{t('paletteEmpty')}</Autocomplete.Empty>
      </Autocomplete.Root>
      {/* #29 が明示した入り口: 常設の足元の行で、一致の有無で出し入れしない（上の節とは
          違う）。意図して Autocomplete の木の外に置いてある＝これは採点される候補ではなく
          モードの切り替えなので、上の強調された行での Enter とぶつかることは決してない。
          マウスか Ctrl/Cmd+Shift+F で届く。 */}
      <button type="button" onClick={() => onEnterFulltext(query)} className="flex w-full shrink-0 items-center gap-2 border-t px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted">
        <FileSearch className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{query.trim() ? t('paletteFulltextEntryWithQuery', [query.trim()]) : t('paletteFulltextEntry')}</span>
        <span className="shrink-0 text-xs">Ctrl+Shift+F</span>
      </button>
    </DialogContent>
  );
}

// #29: 本文検索の面。クエリと結果の状態を自分で持つ＝一致を見る走査は queryEntries を
// 通さず、ライブラリ全体に対して走る（services/fulltext.ts の matchPost で、タブの中の
// 手早い検索が使うのと同じ照合器）。しかも非同期（bm25 の順位のために IPC を1往復する）
// なので、上の CommandsBody が使う同期のエンジンには乗れない。
function FulltextBody({ seedQuery, onBack }: { seedQuery: string; onBack: () => void }) {
  const [ftQuery, setFtQuery] = useState(seedQuery);
  const [hits, setHits] = useState<FullTextMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [showAll, setShowAll] = useState(false);
  // 素早く打ち消された古いキー入力の、遅れて届いた応答が新しい方の後に着地するのを防ぐ＝
  // 反映するのは常に最新の要求の結果だけ。
  const seqRef = useRef(0);

  useEffect(() => {
    const bridge = fullTextBridge();
    const q = ftQuery.trim();
    if (!q || !bridge) {
      setHits([]);
      setTotal(0);
      return;
    }
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      runFullTextSearch(q, bridge.allPosts(), showAll ? Number.POSITIVE_INFINITY : FULLTEXT_CAP).then((res) => {
        if (seqRef.current !== seq) return;
        setHits(res.hits);
        setTotal(res.total);
      });
    }, FULLTEXT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [ftQuery, showAll]);

  function jumpTo(hit: FullTextMatch) {
    close();
    fullTextBridge()?.openResult(ftQuery, hit.post.captureId);
  }

  const bridge = fullTextBridge();

  return (
    <DialogContent className="top-[15%] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
      <DialogHeader className="sr-only">
        <DialogTitle>{t('paletteFulltextTitle')}</DialogTitle>
        <DialogDescription>{t('paletteFulltextDesc')}</DialogDescription>
      </DialogHeader>
      <Autocomplete.Root inline open mode="none" items={hits} value={ftQuery} onValueChange={setFtQuery} autoHighlight="always" itemToStringValue={(hit: FullTextMatch) => hit.post.captureId}>
        <div className="flex items-center gap-1 border-b p-1">
          {/* コマンドのエンジンへ戻る＝空の状態での Backspace はつないでいない（クエリの
              編集とぶつかる）。素のボタンが、いちばん驚きの少ない手掛かりになる。 */}
          <button type="button" onClick={() => onBack()} aria-label={t('paletteFulltextBack')} className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted">
            <FileSearch className="size-4" />
          </button>
          <Autocomplete.Input autoFocus aria-label={t('paletteFulltextTitle')} placeholder={t('paletteFulltextPlaceholder')} className="h-8 w-full min-w-0 border-0 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground md:text-sm" />
        </div>
        <Autocomplete.List className="max-h-80 overflow-y-auto overscroll-contain p-1">
          {(hit: FullTextMatch) => {
            const file = thumbFileOf(hit.post);
            return (
              <Autocomplete.Item key={hit.post.captureId} value={hit} onClick={() => jumpTo(hit)} className="flex cursor-default items-start gap-2 rounded-sm px-2 py-1.5 text-sm select-none data-highlighted:bg-muted">
                {file && bridge ? <img src={bridge.fileSrc(file, 64)} alt="" className="mt-0.5 size-8 shrink-0 rounded object-cover" /> : <div className="mt-0.5 size-8 shrink-0 rounded bg-muted" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <span className="truncate font-medium text-foreground">{authorLabelOf(hit.post)}</span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">{t(FIELD_LABEL[hit.field])}</span>
                  </div>
                  <div className="truncate">
                    {hit.matchStart >= 0 ? (
                      <>
                        {hit.snippetText.slice(0, hit.matchStart)}
                        <mark className="rounded-none bg-transparent px-0 font-semibold text-foreground">{hit.snippetText.slice(hit.matchStart, hit.matchEnd)}</mark>
                        {hit.snippetText.slice(hit.matchEnd)}
                      </>
                    ) : (
                      hit.snippetText
                    )}
                  </div>
                </div>
              </Autocomplete.Item>
            );
          }}
        </Autocomplete.List>
        <Autocomplete.Empty className="px-3 py-6 text-center text-sm text-muted-foreground empty:hidden">{t('paletteFulltextEmpty')}</Autocomplete.Empty>
      </Autocomplete.Root>
      {total > hits.length && (
        <button type="button" onClick={() => setShowAll(true)} className="w-full shrink-0 border-t px-3 py-2 text-center text-xs text-muted-foreground hover:bg-muted">
          {t('paletteFulltextShowAll', [total])}
        </button>
      )}
    </DialogContent>
  );
}

function PaletteBody({ initialMode }: { initialMode: 'commands' | 'fulltext' }) {
  const [mode, setMode] = useState(initialMode);
  const [ftSeed, setFtSeed] = useState('');
  if (mode === 'fulltext') return <FulltextBody seedQuery={ftSeed} onBack={() => setMode('commands')} />;
  return (
    <CommandsBody
      onEnterFulltext={(seedQuery) => {
        setFtSeed(seedQuery);
        setMode('fulltext');
      }}
    />
  );
}

export function PaletteHost() {
  const open = useSyncExternalStore(subscribe, isOpen);
  // openId を key にする。閉じるアニメーションの最中に開き直しても、打ちかけのクエリを
  // 持ち越さずに開き直る（ConfirmHost や BulkTagDialogHost と同じ作法）。initialMode は
  // 描画のたびに読み直されるが、ある key にとって効くのは載せる時だけ＝openMode() と
  // open_ と openSeq は open()/openFulltext() の中で同期的に揃って設定されるので、これが
  // 描画し直される頃には既に一致している。
  const seq = useSyncExternalStore(subscribe, openId);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close(); // Esc か背景のクリック
      }}
    >
      {/* 常に載せたままにする＝閉じるアニメーションは Base UI の Dialog（Portal/Popup）が
          `open` を見て動かしているので、ここで載せ外しすると出ていくアニメーションが消える。 */}
      <PaletteBody key={seq} initialMode={openMode()} />
    </Dialog>
  );
}
