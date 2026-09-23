import { ChevronRight, Folder, History, House, Plus, Settings, Trash2, Users } from 'lucide-react';
import type { DragEvent, MouseEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar';
import { LibrarySafetyStatus } from '../backup/LibrarySafetyStatus.tsx';
import { HistoryPanelBody } from '../history/HistoryPanel.tsx';
import { t } from '../_shared/i18n.ts';
import { store, subscribeKey, subscribeKeys } from '../services/store.ts';
import { open as openSettings } from '../services/settings.ts';
import { anchor as historyAnchor, close as closeHistory, isOpen as historyIsOpen, open as openHistory, subscribe as historySubscribe } from '../services/history-panel.ts';
import { all as folderAll, createFolder, placeFolder, isSavedSearch, load as folderLoad, onChange as folderOnChange, removeFolder, renameFolder } from '../services/folders.ts';
import { open as confirmOpen } from '../services/confirm.ts';
import { open as menuOpen } from '../services/menu.ts';
import { isHidden as panelsAreHidden, subscribe as panelsSubscribe } from '../services/panels.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { openFolder, browseTo } from '../services/orchestrator.ts';
import { getCount as trashCount, subscribe as trashSubscribe } from '../services/trash-view.ts';

// 今どこにいるかの正本は browseMode ただ1つ。ストアへ書くことがそのままインター
// フェースになる＝orchestrator.ts が購読して重い切り替えを走らせる
// （handleBrowseModeStoreChange → setBrowseMode）。store.set は何度実行しても同じなので、
// 反響の輪はできない。
const subBrowse = (cb: () => void) => subscribeKey('browseMode', cb);
const getBrowse = (): string => store.getState().browseMode;

// ライブラリのフォルダ（folders.json）。データと、書き換えを知らせる通り道（onChange）は
// folders.ts が持つ。load() はファイルを読み終えると解決する。React は bootApp が load()
// を呼ぶより先に載るので、最初の一覧の読み取りは空になりうる＝load() を蹴っておき、その
// 解決と、その後のどの書き換えでも読み直す。（onChange は解除しない。LibrarySafetyStatus と
// 同じで、単一ページのこのアプリではこのコンポーネントが外れることはない。）
function useFolders(): HologramFolder[] {
  const [list, setList] = useState<HologramFolder[]>(() => folderAll());
  useEffect(() => {
    const sync = () => setList(folderAll().slice());
    folderLoad().then(sync);
    folderOnChange(sync);
    sync();
  }, []);
  return list;
}

const subPostTree = (cb: () => void) => subscribeKeys(['postQueryTree', 'activeFolderId'], cb);
const getPostSidebarState = () => store.getState();
// 永続化用の複製を通して比べる。こうすると、ディスクへ行って帰ってきた木が、組み立てた
// ばかりの木と等しく比べられる（違いはコンパイルのメモだけ）。
// フォルダの木の行1つと、その部分木。行はどの深さでも同じ見た目（変わるのは字下げだけ）
// ＝ファイルツリーの文法であって、入れ子の行が一段小さく
// 静かな別種の行になる shadcn の1階層の見本ではない。開閉の三角は自分の当たり判定を持つ。
// 行そのものに既に意味があるから＝フォルダをクリックすればそこへ行き、開くのは三角だけ。
function FolderNode({ f, ctx }: { f: HologramFolder; ctx: FolderTreeCtx }) {
  const kids = ctx.kidsOf.get(f.id) || [];
  const isOpen = ctx.expanded.has(f.id);
  const hint = ctx.drop && ctx.drop.id === f.id ? ctx.drop.mode : null;
  // 行のどこにポインタがあるかがドロップの意味を決める: 真ん中の帯はこのフォルダの中へ
  // 入れ、両端は隣へ置く＝Explorer / Eagle / Finder はどれも木へのドラッグをこう読む。
  // 早い段階で断る（preventDefault を呼ばない）ことで、フォルダ自身の部分木に対しては
  // カーソル自体が「ここには置けない」と言う。ドロップを受け付けておいて黙って何もしない
  // のではなく。
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!ctx.dragId || !ctx.canDropOn(f.id)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const mode = y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'into';
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    ctx.setDrop({ id: f.id, mode });
  };
  return (
    <Collapsible render={<SidebarMenuItem />} open={isOpen} onOpenChange={(open) => ctx.setOpen(f.id, open)}>
      <div
        data-slot="folder-row"
        data-folder-id={f.id}
        className={`relative flex items-center rounded-md ${hint === 'into' ? 'bg-sidebar-accent ring-1 ring-sidebar-ring' : ''}`}
        draggable
        onDragStart={(e) => {
          ctx.setDrag(f.id);
          e.dataTransfer.effectAllowed = 'move';
          // id はコンポーネントの状態に乗って運ばれる。このテキストはドラッグのpayloadを
          // 明示して、ブラウザー既定のドラッグ処理に依存しないためだけに置いている。
          e.dataTransfer.setData('text/plain', f.id);
        }}
        onDragEnd={() => ctx.setDrag(null)}
        // ラベルだけでなく行全体に付ける: 三角も字下げも、今指している行の一部であり、
        // それらを右クリックしても同じメニューが開くべきだから。
        onContextMenu={(e) => ctx.menu(e, f)}
        onDragOver={onDragOver}
        onDrop={(e) => {
          e.preventDefault();
          if (ctx.drop) ctx.place(ctx.drop);
        }}
      >
        {hint === 'before' && <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 rounded-full bg-sidebar-ring" />}
        {hint === 'after' && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-sidebar-ring" />}
        {kids.length ? (
          <CollapsibleTrigger data-slot="folder-twisty" aria-label={t('foldToggleSubs')} className="flex size-5 shrink-0 items-center justify-center rounded-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
            <ChevronRight className={`size-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </CollapsibleTrigger>
        ) : (
          // 葉も三角の分の幅を保つので、ラベルが列の下まで揃う。
          <span className="size-5 shrink-0" />
        )}
        {/* ツールチップは付けない（#965）: この木が描かれるのはフライアウトの中だけで、
            そこでは既に名前が全部そのまま出ている＝ツールチップは目の前にあるものを
            綴り直すだけになる。 */}
        <SidebarMenuButton className="min-w-0 flex-1" isActive={ctx.activeIds.has(f.id)} onClick={() => ctx.apply(f.id)}>
          <Folder />
          <span className="truncate">{f.name}</span>
        </SidebarMenuButton>
      </div>
      {kids.length > 0 && (
        <CollapsibleContent>
          <SidebarMenuSub>
            {kids.map((k) => (
              <FolderNode key={k.id} f={k} ctx={ctx} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
function RailFlyoutRow({ icon, label, children }: { icon: ReactNode; label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <SidebarMenuButton>
              {icon}
              <span data-slot="menu-label">{label}</span>
            </SidebarMenuButton>
          }
        />
        {/* 上限を付けてスクロールさせる: フォルダの木には自然な高さが無く、フライアウトは
            ウィンドウの端に接していて、列の高さ全部を使って落ちていける。 */}
        <PopoverContent side="right" align="start" className="max-h-[min(70vh,32rem)] w-64 gap-0 overflow-y-auto p-1.5">
          {children(() => setOpen(false))}
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}
// 見出しはフォルダではないので、今のドロップ先として現れるには、どのフォルダも持ちえない
// id が要る。
const ROOT_DROP = '__folder_tree_root__';
interface DropTarget {
  id: string;
  mode: 'into' | 'before' | 'after';
}
interface FolderTreeCtx {
  kidsOf: Map<string | null, HologramFolder[]>;
  expanded: Set<string>;
  setOpen: (id: string, open: boolean) => void;
  menu: (e: MouseEvent, f: HologramFolder) => void;
  apply: (id: string) => void;
  dragId: string | null;
  setDrag: (id: string | null) => void;
  drop: DropTarget | null;
  setDrop: (t: DropTarget | null) => void;
  /** ドラッグしているフォルダ自身と、その下にあるものすべてに対して false＝そのドロップは存在しえない。 */
  canDropOn: (id: string) => boolean;
  place: (t: DropTarget) => void;
  /** 生きているクエリが絞り込みに使っているフォルダ＝今いる場所の行（#965）。 */
  activeIds: Set<string>;
}

export function LeftSidebar() {
  const mode = useSyncExternalStore(subBrowse, getBrowse);
  const historyOpen = useSyncExternalStore(historySubscribe, historyIsOpen);
  const isPosters = mode === 'posters';
  const isTrash = mode === 'trash';
  const trashN = useSyncExternalStore(trashSubscribe, trashCount);
  const panelsHidden = useSyncExternalStore(panelsSubscribe, panelsAreHidden);
  const allFolders = useFolders();
  const folders = allFolders.filter((f) => !isSavedSearch(f));
  const postSidebarState = useSyncExternalStore(subPostTree, getPostSidebarState);
  const activeFolderId = postSidebarState.activeFolderId;
  const kidsOf = useMemo(() => {
    const m = new Map<string | null, HologramFolder[]>();
    for (const f of folders) {
      const p = f.parentId || null;
      const arr = m.get(p);
      if (arr) arr.push(f);
      else m.set(p, [f]);
    }
    return m;
  }, [folders]);
  // どのフォルダが開いているかはこのセッション限りのもの（Eagle も忘れるし、誰も気にして
  // いない）。永続化すると、三角をクリックするたびに設定を書くことになる。
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const setOpen = (id: string, open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  const newFolder = (parentId: string | null) => {
    promptName(t('foldRenamePrompt'), '', (name) => {
      if (!createFolder(name, { parentId })) return;
      // 閉じた親の中に着地した新しいサブフォルダは、何も起きなかったように見える。
      // だから作ったら親を開く。
      if (parentId) setOpen(parentId, true);
    });
  };
  // 削除は部分木ごと持っていくので、件数をダイアログに出す:「このフォルダを削除」と
  // 「この9個のフォルダを削除」では、ためらうべき量が違う。
  const deleteFolder = (f: HologramFolder) => {
    const subs = (function count(id: string): number {
      return (kidsOf.get(id) || []).reduce((n, k) => n + 1 + count(k.id), 0);
    })(f.id);
    confirmOpen({
      message: t('foldDeleteConfirm', { name: f.name }),
      description: subs ? t('foldDeleteCascade', { count: subs }) : undefined,
      okLabel: t('foldDelete'),
      cancelLabel: t('confirmCancel'),
      onOk: () => removeFolder(f.id),
    });
  };
  const folderMenu = (e: MouseEvent, f: HologramFolder) => {
    e.preventDefault();
    const items = [{ label: t('foldNewSub'), act: 'new' }, { label: t('foldRename'), act: 'rename' }, { sep: true }, { label: t('foldDelete'), act: 'delete', danger: true }];
    menuOpen({ x: e.clientX, y: e.clientY, items }, (item) => {
      if (item.act === 'new') newFolder(f.id);
      else if (item.act === 'rename') promptName(t('foldRenamePrompt'), f.name, (name) => renameFolder(f.id, name));
      else if (item.act === 'delete') deleteFolder(f);
    });
  };
  // 木のドラッグ＆ドロップ。どのフォルダが動いていて、どこへ着地するかは、どちらもビューの
  // 状態＝ドロップまでは何も書かないので、途中でやめたドラッグは痕跡を残さない。
  const [dragId, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const forbidden = useMemo(() => {
    const out = new Set<string>();
    if (!dragId) return out;
    const walk = (id: string) => {
      out.add(id);
      for (const k of kidsOf.get(id) || []) walk(k.id);
    };
    walk(dragId);
    return out;
  }, [dragId, kidsOf]);
  const endDrag = () => {
    setDrag(null);
    setDrop(null);
  };
  // フライアウト自身の `apply` は、これに加えてパネルを閉じる動作を重ねる＝folderGroup を参照。
  const treeCtx: FolderTreeCtx = {
    kidsOf,
    expanded,
    setOpen,
    menu: folderMenu,
    activeIds: activeFolderId ? new Set([activeFolderId]) : new Set(),
    apply: (id) => {
      openFolder(id);
    },
    dragId,
    setDrag: (id) => {
      setDrag(id);
      if (!id) setDrop(null);
    },
    drop,
    setDrop,
    canDropOn: (id) => !!dragId && !forbidden.has(id),
    place: (t) => {
      placeFolder(dragId, t.id, t.mode);
      // 閉じた親の中へ落としたフォルダは見えなくなってしまう。だから開いて、ドロップの
      // 結果が見えるようにする。
      if (t.mode === 'into') setOpen(t.id, true);
      endDrag();
    },
  };
  // 利用者が育てる3つの群（#965）で、それぞれレールの行1本のフライアウトの中身になる。
  // これらはサイドバーの外へポータルで出るので、中の行は自分で幅いっぱいの形を描く＝
  // `group-data-[collapsible=icon]:*` の切り替えはそこまで届かない。

  // フォルダの木を、その場で編集する（#41 と確定した決定 D）: 群の見出しの + は根の
  // フォルダを作り、行のコンテキストメニューはサブフォルダを作る・改名する・削除する。
  // 開く管理モーダルは無い＝木がそのまま管理画面で、Finder / Eagle / Raindrop がやって
  // いるのと同じ形。空でも群は載せたままにするので、+ には必ず手が届く。
  const folderGroup = (close: () => void) => {
    const ctx: FolderTreeCtx = {
      ...treeCtx,
      apply: (id) => {
        openFolder(id);
        close();
      },
    };
    return (
      <SidebarGroup className="p-0">
        {/* 見出しは「どのフォルダにも入れない」のドロップ先も兼ねる: 木には根を意味する
            落とし場所が要るのに、もう1つの候補＝最後の行の下の空白は、狙って当てられる
            対象ではないから。 */}
        <SidebarGroupLabel
          className={dragId ? 'rounded-md ring-1 ring-transparent data-[drop=on]:bg-sidebar-accent data-[drop=on]:ring-sidebar-ring' : undefined}
          data-drop={drop && drop.id === ROOT_DROP ? 'on' : undefined}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDrop({ id: ROOT_DROP, mode: 'into' });
          }}
          onDrop={(e) => {
            e.preventDefault();
            placeFolder(dragId, null, 'into');
            endDrag();
          }}
        >
          {t('qfCatFolder')}
        </SidebarGroupLabel>
        <SidebarGroupAction aria-label={t('foldNew')} title={t('foldNew')} onClick={() => newFolder(null)}>
          <Plus />
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            {(kidsOf.get(null) || []).map((f) => (
              <FolderNode key={f.id} f={f} ctx={ctx} />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    // 形が2つあるのではなく、状態が2つ（#981）: レールか、あるいは #245 の一括の非表示の
    // 下で画面の外へ完全に退くか。#583 以降はどちらも即座に着地する。
    <Sidebar collapsible={panelsHidden ? 'offcanvas' : 'icon'} className="!border-r-0 [&_[data-slot=sidebar-inner]]:bg-[var(--tabbar-bg)]">
      <SidebarContent>
        <SidebarGroup className="pt-0 pb-3 group-data-[collapsible=icon]:px-2">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton isActive={!isPosters && !isTrash} onClick={() => browseTo('posts')}>
                  <House />
                  <span data-slot="menu-label">{t('browsePosts')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={isPosters} onClick={() => browseTo('posters')}>
                  <Users />
                  <span data-slot="menu-label">{t('browsePosters')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <RailFlyoutRow icon={<Folder />} label={t('qfCatFolder')}>
                {folderGroup}
              </RailFlyoutRow>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={isTrash} onClick={() => browseTo('trash')}>
                  <Trash2 />
                  <span data-slot="menu-label">{t('trashTitle')}</span>
                </SidebarMenuButton>
                {trashN > 0 && <SidebarMenuBadge>{trashN}</SidebarMenuBadge>}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Popover open={historyOpen} onOpenChange={(next) => (next ? openHistory() : closeHistory())}>
                  <PopoverTrigger
                    render={
                      <SidebarMenuButton>
                        <History />
                        <span data-slot="menu-label">{t('historyTitle')}</span>
                      </SidebarMenuButton>
                    }
                  />
                  <PopoverContent anchor={historyAnchor() ?? undefined} align="start" side="top" sideOffset={8} className="flex h-[min(70vh,28rem)] w-[360px] flex-col gap-2">
                    <HistoryPanelBody />
                  </PopoverContent>
                </Popover>
              </SidebarMenuItem>
              <LibrarySafetyStatus />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-2 py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => openSettings()}>
              <Settings />
              <span data-slot="menu-label">{t('tabSettings')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
