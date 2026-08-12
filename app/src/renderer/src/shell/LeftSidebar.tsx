// 左の移動用サイドバー＝新しい IA の「場所」の軸（再設計 §3-1）。
// 移動だけを扱う: 答えるのは「今どこを見ているか」（ライブラリの投稿／投稿者）で、
// 「どう絞り込まれているか」は決して扱わない（そちらはツールバーの絞り込みのバー）。
// shadcn の Sidebar（collapsible=icon）の上に組んである＝昔のファセットの行の壁では
// なく、落ち着いていて中身を先に見せる移動の面。
//
// P1 の範囲: 2つの閲覧先、ライブラリのフォルダ（平ら。クリックでそのフォルダを現在地として
// 開く）、保存した検索の群（#40）、そしてフッター（設定の歯車とミラーの
// レール）。これから（P1-3 の続き）: フォルダの階層と、作成・改名・削除（#41）。
//
// #678: 既定は展開した列ではなく、畳んだラベル付きのレールになった。その範囲は意図して
// 固定の行き先だけ（投稿／投稿者／タイムライン／ゴミ箱／コマンドパレット／設定＝#183 が
// タイムラインを6つ目として足したが、M3 の「行き先は3〜7」の指針の内側に収まっている）。
// 下にある利用者が育てる3つの群（ライブラリのフォルダ、保存した検索、投稿者フォルダ）は
// `group-data-[collapsible=icon]:hidden` を持ち、展開時にだけ現れる。設計は
// docs/decisions/0018-labeled-navigation-rail-default.md を参照。
//
// #965: その範囲は変わらないが、レールは利用者が育てる群ごとに固定の行を1本持つように
// なり、その行のフライアウトが一覧を抱える＝#678 は群を隠したものの、そこへ到達する道を
// 残さなかった。#259（狭いウィンドウは自分からレールへ退く）と重なると、ウィンドウの幅が
// 行き先を奪えることになっていた。Windows はこう描く: WinUI の NavigationView は
// LeftCompact でも、子を落とすのではなくフライアウトへ移して階層を保つ。
//
// #981: レールがサイドバーの唯一の形になった＝展開した列と、その切り替えと、その保存
// された状態と、そのドラッグでのリサイズは無くなった（docs/decisions/0027）。ここから
// 消えたのは2つ目の写し: 利用者が育てる3つの群は、一度書いて二度描画していた（列の中と、
// フライアウトの中）が、残ったのはフライアウトの描画だけ。2つの写しを選び分けていた
// group-data-[collapsible=icon] の切り替えも一緒に消えた＝フライアウトはサイドバーの
// 外へポータルで出るので、あのセレクタはそこでは元から一致しなかった。
import { ChevronRight, Folder, Folders, History, LayoutGrid, Plus, Rss, Search, Settings, Terminal, Trash2, Users } from 'lucide-react';
import type { DragEvent, MouseEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar';
import { BackupStatus } from '../backup/BackupStatus.tsx';
import { HistoryPanelBody } from '../history/HistoryPanel.tsx';
import { t } from '../_shared/i18n.ts';
import { store, subscribeKey, subscribeKeys } from '../services/store.ts';
import { open as openSettings } from '../services/settings.ts';
import { open as openPalette } from '../services/command-registry.ts';
import { anchor as historyAnchor, close as closeHistory, isOpen as historyIsOpen, open as openHistory, subscribe as historySubscribe } from '../services/history-panel.ts';
import { all as folderAll, createFolder, placeFolder, isSavedSearch, load as folderLoad, onChange as folderOnChange, removeFolder, renameFolder, toast, updateFolder } from '../services/folders.ts';
import { open as confirmOpen } from '../services/confirm.ts';
import { cloneTree } from '../services/query.ts';
import { open as menuOpen } from '../services/menu.ts';
import { isHidden as panelsAreHidden, subscribe as panelsSubscribe } from '../services/panels.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { openFolder, applyPosterFolderFilter, applySavedSearch, browseTo, posterFolderStore, removePosterFolder, viewerReady } from '../services/orchestrator.ts';
import { getCount as trashCount, subscribe as trashSubscribe } from '../services/trash-view.ts';
import { get as getPostsData } from '../services/posts-data.ts';
import { pinItemOfPost } from '../services/pin-items.ts';
import { hologramIpc } from '../services/ipc.ts';
import type { PinItem } from '../../../main/ipc-payloads.ts';

// 今どこにいるかの正本は browseMode ただ1つ。ストアへ書くことがそのままインター
// フェースになる＝orchestrator.ts が購読して重い切り替えを走らせる
// （handleBrowseModeStoreChange → setBrowseMode）。store.set は何度実行しても同じなので、
// 反響の輪はできない。
const subBrowse = (cb: () => void) => subscribeKey('browseMode', cb);
const getBrowse = (): string => store.getState().browseMode;

// ライブラリのフォルダ（folders.json）。データと、書き換えを知らせる通り道（onChange）は
// folders.ts が持つ。load() はファイルを読み終えると解決する。React は bootApp が load()
// を呼ぶより先に載るので、最初の一覧の読み取りは空になりうる＝load() を蹴っておき、その
// 解決と、その後のどの書き換えでも読み直す。（onChange は解除しない。BackupStatus と
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

// 投稿者フォルダ（poster-folders.json・viewer モード #6 の残り1）。ストア自体は
// orchestrator.ts の posterGrid の組み立てにあり、起動の IIFE がそこへ達して初めて
// posterFolderStore の export へ代入される。このコンポーネントはそれより前に載りうる
// （React は orchestrator.ts の非同期の準備と並行して載る。App.tsx を参照）ので、
// 読み込みと購読の配線はまず viewerReady を待つ。一度代入されれば、ストアはアプリが
// 生きている間ずっと安定した唯一の実体で、folders.ts 自身のモジュール直下のストアと
// 同じ扱いになる。
function usePosterFolders(): HologramFolder[] {
  const [list, setList] = useState<HologramFolder[]>([]);
  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | undefined;
    viewerReady.then(() => {
      if (!alive) return;
      const sync = () => setList(posterFolderStore.all().slice());
      posterFolderStore.load().then(sync);
      unsub = posterFolderStore.subscribe(sync);
      sync();
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, []);
  return list;
}

// 生きている投稿のクエリと現在地。保存した検索が「適用されている」とは、今の木が保存された木と
// 等しいこと。静的フォルダは別の現在地として持つので、クエリをチップから編集しても選択状態が
// 移動しない。
const subPostTree = (cb: () => void) => subscribeKeys(['postQueryTree', 'activeFolderId'], cb);
const getPostSidebarState = () => store.getState();
// 永続化用の複製を通して比べる。こうすると、ディスクへ行って帰ってきた木が、組み立てた
// ばかりの木と等しく比べられる（違いはコンパイルのメモだけ）。
const treeKey = (tree: HologramQueryGroup | null | undefined) => (tree?.children?.length ? JSON.stringify(cloneTree(tree)) : '');
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
          // Firefox は中身の無いドラッグを開始してくれない。id はコンポーネントの状態に
          // 乗って運ばれるので、このテキストはドラッグを成立させるためだけに置いている。
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
// 平らな投稿者フォルダの一覧の行1つ（投稿者モードのみ・#6 の残り1）。行の外枠は上の
// FolderNode と同じ（ドラッグの取っ手、コンテキストメニュー、クリックで適用）で、木に
// しか意味の無いものを全部落としてある: 三角も、子も、'into' のドロップも無い＝投稿者
// フォルダは兄弟の前か後ろにしか着地できず、中には決して入らない（posterFolderStore は
// parentId を一度も設定しない）。クリックは openFolder（現在地）ではなく
// applyPosterFolderFilter（posterQB）を通る＝2つのクエリの組み立ては別々の実体。
interface PosterFolderDropTarget {
  id: string;
  mode: 'before' | 'after';
}
interface PosterFolderCtx {
  dragId: string | null;
  setDrag: (id: string | null) => void;
  drop: PosterFolderDropTarget | null;
  setDrop: (t: PosterFolderDropTarget | null) => void;
  menu: (e: MouseEvent, f: HologramFolder) => void;
  apply: (id: string) => void;
  place: (t: PosterFolderDropTarget) => void;
}
function PosterFolderRow({ f, ctx }: { f: HologramFolder; ctx: PosterFolderCtx }) {
  const dragging = ctx.dragId === f.id;
  const hint = ctx.drop && ctx.drop.id === f.id ? ctx.drop.mode : null;
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!ctx.dragId || ctx.dragId === f.id) return;
    const r = e.currentTarget.getBoundingClientRect();
    const mode = (e.clientY - r.top) / r.height < 0.5 ? 'before' : 'after';
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    ctx.setDrop({ id: f.id, mode });
  };
  return (
    <SidebarMenuItem>
      <div
        data-slot="poster-folder-row"
        data-folder-id={f.id}
        className={`relative flex items-center rounded-md ${dragging ? 'opacity-45' : ''}`}
        draggable
        onDragStart={(e) => {
          ctx.setDrag(f.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', f.id);
        }}
        onDragEnd={() => ctx.setDrag(null)}
        onContextMenu={(e) => ctx.menu(e, f)}
        onDragOver={onDragOver}
        onDrop={(e) => {
          e.preventDefault();
          if (ctx.drop) ctx.place(ctx.drop);
        }}
      >
        {hint === 'before' && <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 rounded-full bg-sidebar-ring" />}
        {hint === 'after' && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-sidebar-ring" />}
        <SidebarMenuButton className="min-w-0 flex-1" onClick={() => ctx.apply(f.id)}>
          <Folder />
          <span className="truncate">{f.name}</span>
        </SidebarMenuButton>
      </div>
    </SidebarMenuItem>
  );
}
// 利用者が育てる群まるごとの代わりを務める、レールの行1つ（#965）: 行そのものは固定の
// 行き先なので、#678 の「レールが持つのは固定の行だけ」は今も成り立つ。行が代表している
// 一覧は、その隣にフライアウトとして開く。全体の履歴のフッターの行（#145）がレールの
// できる前から使ってきた、サイドバーの行から Popover を出す形と同じもの。
//
// `children` が `close` を受け取る関数になっているのは、フライアウトが「使うことで」
// 閉じるものだから: フォルダを選ぶのはどこかへ着くことであり、そこへ連れて行ったパネル
// は道を空けるべき。中の他のもの（三角、+、コンテキストメニュー）は開いたままにする。
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
  // #145: 履歴のパネルが開いているかどうかは、コンポーネントの状態ではなく
  // services/history-panel.ts にある＝Ctrl+H とパレットの cmd:history からも開ける
  // ようにするため。このコンポーネントが持つのは Popover の Trigger と anchor だけ。
  const historyOpen = useSyncExternalStore(historySubscribe, historyIsOpen);
  const isPosters = mode === 'posters';
  const isTrash = mode === 'trash';
  const isTimeline = mode === 'timeline';
  const trashN = useSyncExternalStore(trashSubscribe, trashCount);
  const panelsHidden = useSyncExternalStore(panelsSubscribe, panelsAreHidden);
  const allFolders = useFolders();
  const folders = allFolders.filter((f) => !isSavedSearch(f));
  const saved = allFolders.filter(isSavedSearch);
  const postSidebarState = useSyncExternalStore(subPostTree, getPostSidebarState);
  const currentTree = postSidebarState.postQueryTree;
  const activeFolderId = postSidebarState.activeFolderId;
  const currentKey = treeKey(currentTree);
  // 木はストアに尋ねるのではなくここで導く: 描画はフォルダの一覧のスナップショット1つを
  // 読むので、画面に出る形は必ず、それを描いた元の一覧と一致する。保存した検索は手前で
  // 除いてある＝親を持たないので、そのままだと根のフォルダとして浮かび上がってしまう。
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
      message: t('foldDeleteConfirm', [f.name]),
      description: subs ? t('foldDeleteCascade', [subs]) : undefined,
      okLabel: t('foldDelete'),
      cancelLabel: t('confirmCancel'),
      onOk: () => removeFolder(f.id),
    });
  };
  // #79 導線③: フォルダの中のキャプチャ1件ずつがピンのタイル1枚になり（表紙の画像は
  // pin-items.ts が他でも使っているのと同じ規則）、必ず新しいピンのウィンドウで開く＝
  // カードのメニューやツールバーの入口と違い、「フォルダをまるごと流し込む」は、たまたま
  // アクティブなピンのウィンドウに積み増すつもりのものではない。
  const pinOpenFolder = (f: HologramFolder) => {
    if (!f.items.length) return;
    const byId = new Map(getPostsData().map((p) => [p.captureId, p]));
    const pins = f.items
      .map((cid) => byId.get(cid))
      .filter((p): p is HologramPost => !!p)
      .map(pinItemOfPost)
      .filter((it): it is PinItem => !!it);
    if (pins.length) hologramIpc.pinSend(pins, { newWindow: true });
  };
  const folderMenu = (e: MouseEvent, f: HologramFolder) => {
    e.preventDefault();
    const items = [
      { label: t('foldNewSub'), act: 'new' },
      { label: t('foldRename'), act: 'rename' },
      // 保存した検索（isSavedSearch）は自分の items を持たない（投稿の集合ではなく、
      // 生きたクエリ）ので、ここにピンで開けるものは無い。
      ...(!isSavedSearch(f) ? [{ label: t('foldPinOpen'), act: 'pinOpen' }] : []),
      { sep: true },
      { label: t('foldDelete'), act: 'delete', danger: true },
    ];
    menuOpen({ x: e.clientX, y: e.clientY, items }, (item) => {
      if (item.act === 'new') newFolder(f.id);
      else if (item.act === 'rename') promptName(t('foldRenamePrompt'), f.name, (name) => renameFolder(f.id, name));
      else if (item.act === 'pinOpen') pinOpenFolder(f);
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
  // 保存した検索は自分の行で管理する。フォルダの管理画面ではない（あちらはフォルダの話＝
  // 作る、ドラッグで並べ替える、投稿を入れる）。条件を保存し直す操作は、ここで唯一その
  // 結果が目に見えないものなので、唯一何か言葉を返す操作でもある。
  const savedSearchMenu = (e: MouseEvent, f: HologramFolder) => {
    e.preventDefault();
    // 「条件を今の絞り込みで更新」は、取り込む絞り込みが実際にあるときだけ出す＝空の
    // クエリで保存し直すと、保存した検索が黙って「すべて」に変わってしまう。
    const items = [...(currentKey ? [{ label: t('savedSearchUpdate'), act: 'update' }] : []), { label: t('foldRename'), act: 'rename' }, { sep: true }, { label: t('foldDelete'), act: 'delete', danger: true }];
    menuOpen({ x: e.clientX, y: e.clientY, items }, (item) => {
      if (item.act === 'update') {
        if (updateFolder(f.id, { tree: currentTree })) toast(t('savedSearchUpdated'));
      } else if (item.act === 'rename') {
        promptName(t('saveSearchPrompt'), f.name, (name) => renameFolder(f.id, name));
      } else if (item.act === 'delete') removeFolder(f.id);
    });
  };

  // 投稿者モードのフォルダの群（#6 の残り1）: posterFolderStore（poster-folders.json）を
  // 裏に持つ平らな兄弟の一覧で、投稿者を見ている間だけ現れる＝上のライブラリの木とは
  // 違う（あちらはどのモードからも届いて、クリックでそこへ跳べる）。開く管理モーダルは
  // もう無い: この一覧が直接、作成・改名・削除・並べ替えをする。#41 と確定した決定 D が
  // ライブラリのフォルダに与えたのと同じ「サイドバーがそのまま管理画面」という文法。
  const posterFolders = usePosterFolders();
  const [pfDragId, setPfDrag] = useState<string | null>(null);
  const [pfDrop, setPfDrop] = useState<PosterFolderDropTarget | null>(null);
  const newPosterFolder = () => {
    promptName(t('posterFolderRenamePrompt'), '', (name) => posterFolderStore.create(name));
  };
  const deletePosterFolderRow = (f: HologramFolder) => {
    confirmOpen({
      message: t('posterFolderDeleteConfirm', [f.name]),
      okLabel: t('foldDelete'),
      cancelLabel: t('confirmCancel'),
      onOk: () => removePosterFolder(f.id),
    });
  };
  const posterFolderMenu = (e: MouseEvent, f: HologramFolder) => {
    e.preventDefault();
    const items = [{ label: t('foldRename'), act: 'rename' }, { sep: true }, { label: t('foldDelete'), act: 'delete', danger: true }];
    menuOpen({ x: e.clientX, y: e.clientY, items }, (item) => {
      if (item.act === 'rename') promptName(t('posterFolderRenamePrompt'), f.name, (name) => posterFolderStore.rename(f.id, name));
      else if (item.act === 'delete') deletePosterFolderRow(f);
    });
  };
  const posterFolderCtx: PosterFolderCtx = {
    dragId: pfDragId,
    setDrag: (id) => {
      setPfDrag(id);
      if (!id) setPfDrop(null);
    },
    drop: pfDrop,
    setDrop: setPfDrop,
    menu: posterFolderMenu,
    apply: (id) => applyPosterFolderFilter(id),
    place: (t) => {
      posterFolderStore.move(pfDragId, t.id, t.mode === 'before');
      setPfDrag(null);
      setPfDrop(null);
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

  // 投稿者モードのフォルダ（#6 の残り1）＝投稿者を見ている間だけ（上のライブラリの木は
  // どのモードからも届くのと違う）: 平らな一覧で、同じようにその場で編集する＝見出しの +
  // で作り、行のコンテキストメニューで改名・削除し、ドラッグで並べ替える。こちらにも
  // 管理モーダルはもう無い。見出しの文字列は自前のもの（sbPosterFoldersSidebarTitle。
  // qf-pop のファセットの sbPosterFoldersTitle とは別）: この2つの群はここで真上と真下に
  // 積み重なるので、どちらもただ「フォルダ」と言うと、別々の2つではなく1つの群を2つに
  // 割ったように読めてしまう。
  const posterFolderGroup = (close: () => void) => {
    const ctx: PosterFolderCtx = {
      ...posterFolderCtx,
      apply: (id) => {
        applyPosterFolderFilter(id);
        close();
      },
    };
    return (
      <SidebarGroup className="p-0">
        <SidebarGroupLabel>{t('sbPosterFoldersSidebarTitle')}</SidebarGroupLabel>
        <SidebarGroupAction aria-label={t('foldNew')} title={t('foldNew')} onClick={newPosterFolder}>
          <Plus />
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            {posterFolders.map((f) => (
              <PosterFolderRow key={f.id} f={f} ctx={ctx} />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  // 保存した検索（#40）＝自分の群を持ち、上のフォルダとは決して混ぜない: フォルダは投稿を
  // 入れる場所で、保存した検索は問い直す問い。クリックは今のクエリを保存したものへ
  // 置き換えるので、条件はどれもチップのバーへ着地して、そのまま調整できる。件数の印は
  // 付けない: 保存した検索には安く求まる大きさが無く、1つ数えるにはライブラリ全体を
  // 走査することになる。全部の行に印を付ければ、描画のたびにそれをやることになる。
  const savedSearchGroup = (close: () => void) => (
    <SidebarGroup className="p-0">
      <SidebarGroupLabel>{t('savedSearches')}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {saved.map((f) => (
            <SidebarMenuItem key={f.id}>
              <SidebarMenuButton
                isActive={!!currentKey && currentKey === treeKey(f.tree)}
                onContextMenu={(e) => savedSearchMenu(e, f)}
                onClick={() => {
                  applySavedSearch(f.id);
                  close();
                }}
              >
                <Search />
                <span className="truncate">{f.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    // 形が2つあるのではなく、状態が2つ（#981）: レールか、あるいは #245 の一括の非表示の
    // 下で画面の外へ完全に退くか。#583 以降はどちらも即座に着地する。
    <Sidebar collapsible={panelsHidden ? 'offcanvas' : 'icon'}>
      {/* タイトルバーの高さのドラッグ用の帯: サイドバーは
          ウィンドウの上端から始まるので、そのヘッダーの行がそのままタイトルバーの左半分に
          なる。#981 が切り替えを取り去るまでは畳むためのトリガーを抱えていた。今やって
          いるのは、当時から並行してやっていたこと＝移動の面の上にウィンドウを掴める場所を
          与えること。ワードマークは置かない: 装飾は静かなままにする。この高さが、継ぎ目を
          またいで最初の移動の行をタブの帯と水平に保つ（#628）。 */}
      <SidebarHeader className="app-drag h-[var(--tabbar-h)] flex-row items-center justify-start" />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={!isPosters && !isTrash && !isTimeline} tooltip={t('browsePosts')} onClick={() => browseTo('posts')}>
                  <LayoutGrid />
                  <span data-slot="menu-label">{t('browsePosts')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={isPosters} tooltip={t('browsePosters')} onClick={() => browseTo('posters')}>
                  <Users />
                  <span data-slot="menu-label">{t('browsePosters')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {/* タイムライン（#183）＝SNS のフィードとして読むモード: 投稿の母集団は同じ
                  で、投稿日の降順に固定され、自前のレイアウト・並び順の操作は持たない
                  （DisplayMenu.tsx の TimelineControls）。投稿・投稿者（他の中身の行き先）
                  と並べ、ゴミ箱の上に置く。 */}
              <SidebarMenuItem>
                <SidebarMenuButton isActive={isTimeline} tooltip={t('browseTimeline')} onClick={() => browseTo('timeline')}>
                  <Rss />
                  <span data-slot="menu-label">{t('browseTimeline')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {/* 利用者が育てる3つの群に対する、レールの代役（#965）: 群ごとに1本の固定の行で、
            そのフライアウトが一覧そのものを抱える。レールの範囲は今も固定の行き先だけ
            （#678）＝一覧を開く行も、その1つ。 */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <RailFlyoutRow icon={<Folder />} label={t('qfCatFolder')}>
                {folderGroup}
              </RailFlyoutRow>
              {isPosters && (
                <RailFlyoutRow icon={<Folders />} label={t('sbPosterFoldersSidebarTitle')}>
                  {posterFolderGroup}
                </RailFlyoutRow>
              )}
              {saved.length > 0 && (
                <RailFlyoutRow icon={<Search />} label={t('savedSearches')}>
                  {savedSearchGroup}
                </RailFlyoutRow>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {/* ゴミ箱（#268）＝ライブラリの行き先なので、フッター（アプリ全体の入口を抱える）
            でも、以前あった設定の中でもなく、この移動の面に置く。最後に、そして常に出す:
            digiKam はゴミ箱をアルバムの木の最後の項目に置き、Apple Photos は
            "Recently Deleted" を一番下のユーティリティの群に置く。どちらも空のときに
            隠したりしない＝消える行は「削除した投稿はどこへ行った」を探し物に変えてしまう。
            mt-auto で、フォルダや保存した検索の群がどこまで伸びてもその下に留める。
            印は件数で、1件以上のときだけ出す:「0」は情報ではないし、保存した検索と違って
            この件数は安い（ディレクトリを1つ読むだけ）。 */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={isTrash} tooltip={t('trashTitle')} onClick={() => browseTo('trash')}>
                  <Trash2 />
                  <span data-slot="menu-label">{t('trashTitle')}</span>
                </SidebarMenuButton>
                {trashN > 0 && <SidebarMenuBadge>{trashN}</SidebarMenuBadge>}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {/* コマンドパレット（#28）＝目に見える2つの入口のうちの1つ目（もう1つは検索
              ボックスの右端の印）。⋮ メニューの案は #146 で退けられ、「#28 の入口は実装
              時にサイドバーへ足す」と決まった。理由は、左にレールを持つアプリでは全体の入口を
              サイドバー側に置くから。設定と同じフッターに座っているのは、どちらも「今見ているもの」では
              なくアプリ自体への入口だから。畳んだ状態でも、ツールチップ付きで押せるまま
              にする。 */}
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={`${t('paletteTitle')} (Ctrl+K)`} onClick={() => openPalette()}>
              <Terminal />
              <span data-slot="menu-label">{t('paletteTitle')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* 全体の履歴のページ（#145）＝サイドバーのフッターのこの行が、パネルの Popover
              が位置を合わせる anchor になる。Ctrl+H とパレットの cmd:history
              （services/history-panel.ts）は、このコンポーネントの外から同じ制御下の
              Popover を開く。モーダルでない Base UI の Popover をそのまま使っている
              （`modal` の既定値は false。popover.tsx を参照）: 設計が挙げている要件が、
              設定の Dialog とは違って、背後のグリッドがスクロールできて見えたままである
              こと、だから。 */}
          <SidebarMenuItem>
            <Popover open={historyOpen} onOpenChange={(next) => (next ? openHistory() : closeHistory())}>
              <PopoverTrigger
                render={
                  <SidebarMenuButton tooltip={`${t('historyTitle')} (Ctrl+H)`}>
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
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={t('tabSettings')} onClick={() => openSettings()}>
              <Settings />
              <span data-slot="menu-label">{t('tabSettings')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {/* バックアップとミラーの状態。自分の根を自分で描く（P3 #6）＝以前はホストの
            <span> で、コンポーネントがレイアウトの effect から状態のクラスを書き込んで
            いた。 */}
        <BackupStatus />
      </SidebarFooter>
    </Sidebar>
  );
}
