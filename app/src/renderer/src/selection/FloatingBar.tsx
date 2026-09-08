import type { ReactNode } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FolderPlus, Group, ListChecks, Tag, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { t } from '../_shared/i18n.ts';
import { hologramImageTabSource, isActive as imageViewIsActive } from '../services/image-tab.ts';
import { postIdKey } from '../services/records.ts';
import { isAllSelected, selectedGroups } from '../services/selection.ts';
import { store, subscribeKey } from '../services/store.ts';
import { selectionClear, selectionDelete, selectionFolder, selectionGroup, selectionSelectAll, selectionTag } from '../services/orchestrator.ts';

// 下に浮かぶ選択バー（redesign §3-4 / P2⑥）＝カプセルを下中央に
// 留め、投稿カードが2枚以上選ばれている間だけ出す。旧い上部の #selectionBar を置き換えた
// もので、コンテナと data-act の委譲ディスパッチャは無くなり、各ボタンは orchestrator が
// export した選択の操作を直に呼ぶ（onClick → 関数）。モデルは hologramStore から自分で導く
// ＝count/allSelected/groupDisabled は 'selectedSet' と 'postGroups' からそのまま出す
// （services/selection.ts の isAllSelected/selectedGroups を再利用）。退役した SelectionBar
// コンポーネントが使っていたのと同じ導出。
//
// どの操作もアイコンと文字のラベルを見せる（旧い品揃え＝すべて選択／タグ／フォルダ／
// グループ化／削除／解除）。ラベルは使える幅に応じて変わる＝余裕があれば完全な言い回し
// （「タグを追加」）、バーが押し縮められたとき（狭いウィンドウ、開いたインスペクタ、広げた
// サイドバー）は短い形（「タグ」）。裸のアイコンへ潰れるのではなく、読めるまま残す。解除
// （✕）だけがアイコンだけのボタン（万国共通だから）。読み上げ名は常に完全な言い回し。
//
// レイアウト: SidebarInset の内容の列（AppShell）の中で描くので、絶対配置の下中央は右の詳細
// パネルを避けたままになる＝#243 以降、インスペクタはどのウィンドウ幅でも必ず inset を狭める
// flex の兄弟になっている。これで旧い場所取りの分岐は退役した（インスペクタはかつて 1280px 未満
// で固定のオーバーレイへ外れ、バーはその分 320px を空けておく必要があった）。
//
// だから完全／短縮のラベルの切り替えは、もうウィンドウのブレークポイントを一切見ていない。
// 完全な言い回しが収まるかをバー自身の箱に訊く（ResizeObserver）。見た目の振る舞いは同じだが、
// 代わりの目安ではなく実際の空きで動く＝サイドバーが畳まれたときもインスペクタが開いたときも
// 正しいままになる。どちらもビューポートは動かさない。
//
// 選択は投稿グリッドにしか存在しない（投稿者カードは掘り下げる操作で、複数選択はしない）
// ので、このバーは投稿者ビューでも隠す＝モードを切り替えたあとに古いカプセルが取り残される
// ことを無くす。ストアの 'browseMode' キーは起動時には未設定（undefined）＝本当に投稿⇄投稿者
// を切り替えたときにだけ書かれる。だから判定はシェル自身の作法（App の ShellClasses /
// LeftSidebar）に倣う＝posters だけが明示の値で、それ以外（起動時の未設定も含む）は posts。
//
// 動き: 要素は載せたままで、CSS のトランジション1本で表示と非表示の間をスライドしながら
// フェードする（両方向とも。退出のための presence ライブラリは使わない・redesign §3-10a）。
// ラッパーは pointer-events-none なのでグリッドを覆うことはなく、クリックを取るのはカプセル
// 自身だけ。

// 完全なラベルを出すのにカプセルが要る幅（実測 638px）に、ラッパー自身の左右のパディングを
// 足したもの。これを下回ると短い形を使う。
const FULL_LABEL_MIN_W = 670;

const subSelectedSet = (cb: () => void) => subscribeKey('selectedSet', cb);
const getSelectedSet = () => store.getState().selectedSet;
const subPostGroups = (cb: () => void) => subscribeKey('postGroups', cb);
const getPostGroups = () => store.getState().postGroups;
const subBrowseMode = (cb: () => void) => subscribeKey('browseMode', cb);
const getBrowseMode = () => store.getState().browseMode;
// バー自身の箱に、完全なラベルがまだ収まるか。ビューポートではなく要素を見ていることが、
// インスペクタが開いたときやサイドバーが畳まれたときにも正しく効く理由＝どちらもウィンドウの
// 大きさを変えずに、ここで使える余地だけを変える。
function useFitsFullLabels(ref: React.RefObject<HTMLDivElement | null>): boolean {
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number') setFits(w >= FULL_LABEL_MIN_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return fits;
}

// カプセルのボタン1つ＝アイコンと見えるラベル。見える `label` が短縮されているときも、
// 読み上げ名は `title`（完全な言い回し）の方になる。
function Action({ label, title, danger, disabled, onClick, children }: { label: string; title: string; danger?: boolean; disabled?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return (
    <Button size="sm" variant="ghost" disabled={disabled} aria-label={title} onClick={onClick} className={cn('rounded-full', danger && 'text-destructive hover:bg-destructive/10 hover:text-destructive')}>
      {children}
      {label}
    </Button>
  );
}

export function FloatingBar() {
  const selectedSet = useSyncExternalStore(subSelectedSet, getSelectedSet);
  const postGroups = useSyncExternalStore(subPostGroups, getPostGroups);
  const mode = useSyncExternalStore(subBrowseMode, getBrowseMode);
  const wrapRef = useRef<HTMLDivElement>(null);
  const showFull = useFitsFullLabels(wrapRef);
  // 画像ビュー（#656）: この舞台には、一括操作がどのカードに当たるのかを見せる手段が無い
  // （Lightroom のルーペと違ってフィルムストリップが無い）ので、そこではバーを画面の外へ
  // 出さなければならない＝下にあるグリッドの選択はそのまま保たれ（このコンポーネントは
  // 触らない）、戻ってくればバーもまた出る。AppToolbar が自分の内容と舞台の入れ替えに読む
  // のと同じ購読済みの述語（image-tab.ts の isActive()＝「画像ビューが出ているか」への
  // #619 の唯一の答え）。
  const imageView = useSyncExternalStore(hologramImageTabSource.subscribe, imageViewIsActive);

  const count = selectedSet ? selectedSet.size : 0;
  // ……そしてゴミ箱でも隠す（#268）。ゴミ箱は自前の選択と自前の2つの動詞を持つ。このバーの
  // タグ／フォルダ／グループ化はどれもライブラリへの書き込みで、それはまさに、削除した投稿が
  // 復元されるまで受け付けてはならないもの。
  const shown = count >= 2 && mode !== 'posters' && mode !== 'trash' && !imageView;
  const groups = postGroups || [];
  const allSelected = isAllSelected(groups, postIdKey);
  // 手動のグループ化には、選択されたカード（グループ）が2つ以上要る。
  const groupDisabled = selectedGroups(groups, postIdKey).length < 2;
  return (
    <div
      ref={wrapRef}
      data-slot="selection-bar"
      aria-hidden={!shown}
      className={cn('pointer-events-none absolute inset-x-0 bottom-6 z-50 flex justify-center px-4 transition-[opacity,transform] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)]', shown ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0')}
    >
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border bg-popover p-1 text-popover-foreground shadow-lg">
        <span className="px-2 text-sm font-medium tabular-nums whitespace-nowrap">{t('selectedCount', { count: count })}</span>
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <Action label={allSelected ? t('deselectAll') : t('selectAll')} title={allSelected ? t('deselectAll') : t('selectAll')} onClick={() => selectionSelectAll()}>
          <ListChecks />
        </Action>
        <Action label={showFull ? t('tagSelected') : t('selTag')} title={t('tagSelected')} onClick={() => selectionTag()}>
          <Tag />
        </Action>
        <Action label={showFull ? t('folderSelected') : t('selFolder')} title={t('folderSelected')} onClick={(e) => selectionFolder(e.currentTarget)}>
          <FolderPlus />
        </Action>
        <Action label={t('groupSelected')} title={t('groupSelected')} disabled={groupDisabled} onClick={() => selectionGroup()}>
          <Group />
        </Action>
        <Action label={showFull ? t('deleteSelected') : t('selDelete')} title={t('deleteSelected')} danger onClick={() => selectionDelete()}>
          <Trash2 />
        </Action>
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label={t('cancelSelect')} onClick={() => selectionClear()}>
          <X />
        </Button>
      </div>
    </div>
  );
}
