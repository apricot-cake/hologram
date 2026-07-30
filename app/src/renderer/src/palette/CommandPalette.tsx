// コマンドパレット（#28）の島＝器だけを持つ。候補・並び・実行はすべて
// services/command-registry.ts 側にあり、ここは「窓・入力欄・候補一覧」を描くだけ。
//
// 部品は既にあるものだけで組んである（追加依存ゼロ）: shadcn Dialog（＝Base UI Dialog。
// 背景クリック / Esc の dismiss・フォーカストラップ・閉じたときのフォーカス復帰・
// スクロールロック、それに .wc-dim 経由でウィンドウ操作ボタンの減光まで、
// data-slot='dialog-overlay' を見ている既存の仕組みがそのまま効く）＋ Base UI
// Autocomplete の `inline` モード（自前のポップアップを持たずに List をその場に描く形＝
// ダイアログの中に入力欄と一覧を並べる、パレットそのものの形）。
//
// cmdk は不採用（Radix 依存で a11y スタックが二重化し、内蔵スコアラでマッチの意味論も
// 二重規格になる）。自前オーバーレイも不採用。
import { Autocomplete } from '@base-ui/react/autocomplete';
import { AppWindow, Folder, Tag, Terminal, User } from 'lucide-react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '../_shared/i18n.ts';
import { type CommandEntry, type CommandGroup, type CommandSection, close, isOpen, openId, queryEntries, runEntry, subscribe } from '../services/command-registry.ts';

const SECTION_ICON: Record<CommandSection, ComponentType<{ className?: string }>> = {
  command: Terminal,
  tab: AppWindow,
  tag: Tag,
  user: User,
  folder: Folder,
};

const SECTION_LABEL: Record<CommandSection, string> = {
  command: 'paletteSecCommand',
  tab: 'paletteSecTab',
  tag: 'paletteSecTag',
  user: 'paletteSecUser',
  folder: 'paletteSecFolder',
};

function PaletteBody() {
  const [query, setQuery] = useState('');
  // 候補は値から同期的に導出する（SearchBox と同じ理由＝setState を挟むと一覧と入力が
  // 一瞬ずれる）。provider はその場で母集合を読むので、パレットを開いている間に
  // ライブラリが変わっても次のキーストロークで追いつく。
  //
  // 件数の上限は掛けない＝アプリ内の候補一覧の作法に揃える（「+ フィルタ」バーの一覧は
  // 上限なしでスクロール、サイドバーのファセット行は100件）。当たった分は全部出して、
  // 足りなければ打ち足して絞る／スクロールする。検索ボックスの面だけは従来どおり
  // タグ6件・投稿者4件で、そちらは入力欄直下のドロップダウンで縦に伸ばせないため。
  const groups = useMemo<CommandGroup[]>(() => queryEntries(query), [query]);

  return (
    // gap-0 / p-0 / 上寄せ: パレットは「入力欄＋一覧」の2段だけで、ダイアログの余白と
    // 縦中央寄せ（＝候補が増えるたびに窓が上下に伸びる）はこの形に合わない。
    <DialogContent className="top-[15%] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
      {/* Base UI Dialog は Popup の中に Title を要求する（aria-labelledby の解決先）。
          パレットは見出しを描く面ではないので sr-only で置く。 */}
      <DialogHeader className="sr-only">
        <DialogTitle>{t('paletteTitle')}</DialogTitle>
        <DialogDescription>{t('paletteDesc')}</DialogDescription>
      </DialogHeader>
      <Autocomplete.Root
        // inline + open: 自前ポップアップを使わず、この場に List を描く（Base UI の
        // 定めどおり open を無条件に渡す）。mode="none": 絞り込みは queryEntries が
        // 済ませてある＝Base UI に再フィルタさせない（＝マッチ意味論が二重にならない）。
        inline
        open
        mode="none"
        items={groups}
        value={query}
        onValueChange={setQuery}
        // 先頭を常にハイライト＝開いて打って Enter で走る（VS Code / Linear と同じ）。
        autoHighlight="always"
        itemToStringValue={(entry: CommandEntry) => entry.title}
      >
        <div className="border-b p-1">
          <Autocomplete.Input
            autoFocus
            aria-label={t('paletteTitle')}
            placeholder={t('palettePlaceholder')}
            // IME 変換中の Enter は Base UI の ComboboxInput 側が弾く（変換中の
            // keydown は Chromium が which=229 で寄せてくるので、Enter の処理へ
            // 進む前に return する）。実機で確認済み。
            // border-0 は必須: 旧スタイルシート（index.html の @layer legacy）に
            // `input[type="text"]` の枠線＋:focus でアクセント色に変える規則があり、
            // Base UI の Input は type="text" を出す＝何も宣言しないとその枠線が
            // そのまま乗る（レイヤーの優劣ではなく「宣言が無い」ことが原因なので、
            // 打ち消すには自分で宣言する）。枠は入れ物側の border-b が担う。
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
                    // close してから perform する（順序の理由は runEntry のコメント）。
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
        {/* Empty は「一覧が空のときだけ children を描く」部品で、それ自体は読み上げの
            ために DOM へ残り続ける＝中身が無い間は箱ごと畳む（余白だけが残るのを防ぐ）。
            操作系は空クエリでも全件当たるので、ここが出るのは打った文字が本当に
            どこにも当たらないときだけ。 */}
        <Autocomplete.Empty className="px-3 py-6 text-center text-sm text-muted-foreground empty:hidden">{t('paletteEmpty')}</Autocomplete.Empty>
      </Autocomplete.Root>
    </DialogContent>
  );
}

export function PaletteHost() {
  const open = useSyncExternalStore(subscribe, isOpen);
  // openId をキーに: 閉じるアニメーション中に開き直しても、打ちかけのクエリを
  // 持ち越さずに開き直す（ConfirmHost / BulkTagDialogHost と同じ作法）。
  const seq = useSyncExternalStore(subscribe, openId);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close(); // Esc / 背景クリック
      }}
    >
      {/* 常にマウントしておく＝閉じるアニメーションは Base UI Dialog（Portal/Popup）が
          open を見て回すので、こちらで出し入れすると exit が消える。 */}
      <PaletteBody key={seq} />
    </Dialog>
  );
}
