// Left navigation sidebar — the "place" axis of the new IA (redesign §3-1).
// Nav-only: it answers "where am I looking" (library posts / posters), never
// "how is it filtered" (that is the toolbar's filter bar). Built on shadcn's
// Sidebar (collapsible=icon) — the calm, content-first nav of Claude Desktop /
// Linear, not the old facet-row wall.
//
// P1 scope: the two browse destinations, the library folders (flat, click = apply
// the folder as a place filter), the Saved Searches group (#40) and the footer (settings
// gear + mirror rail). Still to come (P1-3 continuation): folder HIERARCHY +
// create/rename/delete (#41).
//
// #678: the default is now the collapsed labeled rail, not the expanded column. Its
// scope is deliberately the fixed destinations only (posts/posters/timeline/trash/
// command palette/settings — #183 added timeline as a 6th, still inside M3's
// 3-7 destination guideline) — the 3 user-grown groups below (library folders,
// saved searches, poster folders) carry `group-data-[collapsible=icon]:hidden`
// and show only when expanded. See docs/decisions/0018-labeled-navigation-rail-default.md
// for the design.
//
// #965: that scope is unchanged, but the rail now carries ONE fixed row per user-grown
// group whose flyout holds the list — #678 hid the groups without leaving a way to
// reach them, and composed with #259 (narrow windows retreat to the rail on their own)
// it meant the window's width could take a destination away. Windows draws it this way:
// WinUI's NavigationView keeps hierarchy in LeftCompact by moving the children into a
// flyout rather than dropping them.
import { ChevronRight, Folder, Folders, History, LayoutGrid, Plus, Rss, Search, Settings, Terminal, Trash2, Users } from 'lucide-react';
import type { DragEvent, MouseEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarRail, SidebarTrigger } from '@/components/ui/sidebar';
import type { PanelResize } from './use-panel-resize.ts';
import { BackupStatus } from '../backup/BackupStatus.tsx';
import { HistoryPanelBody } from '../history/HistoryPanel.tsx';
import { t } from '../_shared/i18n.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';
import { open as openSettings } from '../services/settings.ts';
import { open as openPalette } from '../services/command-registry.ts';
import { anchor as historyAnchor, close as closeHistory, isOpen as historyIsOpen, open as openHistory, subscribe as historySubscribe } from '../services/history-panel.ts';
import { all as folderAll, createFolder, placeFolder, isSavedSearch, load as folderLoad, onChange as folderOnChange, removeFolder, renameFolder, toast, updateFolder } from '../services/folders.ts';
import { open as confirmOpen } from '../services/confirm.ts';
import { cloneTree } from '../services/query.ts';
import { open as menuOpen } from '../services/menu.ts';
import { isHidden as panelsAreHidden, subscribe as panelsSubscribe } from '../services/panels.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { applyFolderFilter, applyPosterFolderFilter, applySavedSearch, browseTo, posterFolderStore, removePosterFolder, viewerReady } from '../services/orchestrator.ts';
import { getCount as trashCount, subscribe as trashSubscribe } from '../services/trash-view.ts';
import { get as getPostsData } from '../services/posts-data.ts';
import { pinItemOfPost } from '../services/pin-items.ts';
import { hologramIpc } from '../services/ipc.ts';
import type { PinItem } from '../../../main/ipc-payloads.ts';

// browseMode is the single source of truth for the active destination. Writing
// the store IS the interface — orchestrator.ts subscribes and runs the heavy
// switch (handleBrowseModeStoreChange → setBrowseMode); the store.set idempotent
// guard means no echo loop.
const subBrowse = (cb: () => void) => storeSubscribe('browseMode', cb);
const getBrowse = (): string => (storeGet('browseMode') as string) || 'posts';

// Library folders (folders.json). folders.ts owns the data + a mutation-notify
// channel (onChange); load() resolves once the file is read. React mounts before
// bootApp calls load(), so an initial list read can be empty — kick load() and
// re-read on both its resolve and any later mutation. (No unsubscribe from onChange,
// same as BackupStatus: this component never unmounts in the single-page app.)
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

// Poster folders (poster-folders.json, viewer-mode #6 remainder 1). The store itself lives in
// orchestrator.ts's posterGrid builder, assigned to the posterFolderStore export only
// once the boot IIFE gets there — this component can mount before that happens (React
// mounts in parallel with orchestrator.ts's async setup, see App.tsx), so the load +
// subscribe wiring waits on viewerReady first. Once assigned, the store is a stable
// singleton for the app's lifetime, same as folders.ts's own module-level store.
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

// The live post query, mirrored into the store by the query builder on every
// mutation — the same channel the activebar reads. A saved search is "applied"
// when the current tree equals the saved one; there is no separate applied-id
// state to keep in sync, so editing a chip simply stops the row from matching.
const subPostTree = (cb: () => void) => storeSubscribe('postQueryTree', cb);
const getPostTree = () => storeGet('postQueryTree') as HologramQueryGroup | undefined;
// Compare through the persistence clone so a tree that has been to disk and back
// compares equal to a freshly built one (the compile memos are the only difference).
const treeKey = (tree: HologramQueryGroup | null | undefined) => (tree?.children?.length ? JSON.stringify(cloneTree(tree)) : '');
// Which folders the live post query is filtered by. Read off the tree rather than
// remembered from the last click, so a folder applied from anywhere — this list, the
// command palette, an edit in the chip bar — lights the same row. Negated nodes are
// skipped: "not in 資料" is not a place you are in.
function activeFolderIds(tree: HologramQueryGroup | null | undefined): Set<string> {
  const out = new Set<string>();
  const walk = (n: HologramQueryNode) => {
    if (n.neg) return;
    if (n.kind === 'group') {
      for (const c of n.children) walk(c);
      return;
    }
    if (n.type === 'folder' && typeof n.value === 'string') out.add(n.value);
  };
  if (tree) walk(tree);
  return out;
}

// One row of the folder tree, plus its subtree. Rows look the same at every depth
// (only the indent changes) — the file-tree grammar of Explorer / Finder / Obsidian,
// not shadcn's one-level sample where the nested rows are a smaller, quieter kind of
// row. The twisty is its own hit area because the row itself already means something:
// clicking a folder goes there, and only the twisty opens it up.
function FolderNode({ f, ctx }: { f: HologramFolder; ctx: FolderTreeCtx }) {
  const kids = ctx.kidsOf.get(f.id) || [];
  const isOpen = ctx.expanded.has(f.id);
  const hint = ctx.drop && ctx.drop.id === f.id ? ctx.drop.mode : null;
  // Where in the row the pointer is decides what the drop means: the middle band
  // puts the folder INSIDE this one, the edges put it beside — Explorer / Eagle /
  // Finder all read a tree drag this way. Refusing early (no preventDefault) is
  // what makes the cursor itself say "not here" for a folder's own subtree,
  // instead of accepting the drop and quietly doing nothing.
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
          // Firefox refuses to start a drag without payload; the id travels in
          // component state, so the text is only there to make the drag legal.
          e.dataTransfer.setData('text/plain', f.id);
        }}
        onDragEnd={() => ctx.setDrag(null)}
        // On the whole row, not just the label: the twisty and the indent are part of
        // the row you are pointing at, and right-clicking them should open the same menu.
        onContextMenu={(e) => ctx.menu(e, f)}
        onDragOver={onDragOver}
        onDrop={(e) => {
          e.preventDefault();
          if (ctx.drop) ctx.place(ctx.drop);
        }}
      >
        {hint === 'before' && <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 rounded-full bg-sidebar-ring" />}
        {hint === 'after' && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-sidebar-ring" />}
        {/* Both the twisty and the leaf's placeholder go away in the icon rail: at
            48px there is only room for the folder icon itself, and 20px of indent
            pushed that icon past the rail's edge, where it was clipped into a
            sliver. Nothing is lost by hiding them — the subtree they expand is
            already hidden in this mode (SidebarMenuSub), so the twisty has
            nothing to reveal and the leaf has no label column to line up with. */}
        {kids.length ? (
          <CollapsibleTrigger data-slot="folder-twisty" aria-label={t('foldToggleSubs')} className="flex size-5 shrink-0 items-center justify-center rounded-sm text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
            <ChevronRight className={`size-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </CollapsibleTrigger>
        ) : (
          // A leaf keeps the twisty's width so labels line up down the column.
          <span className="size-5 shrink-0 group-data-[collapsible=icon]:hidden" />
        )}
        {/* flex-1 would beat the rail's size-8! sizing on its own (flex-basis wins
            over width in a flex row), so the grow is dropped in icon mode too. */}
        {/* No tooltip inside the flyout (#965): the sidebar is still `collapsed` while
            the flyout is open, so SidebarMenuButton would offer to spell out a name
            that is already right there in full. */}
        <SidebarMenuButton className="min-w-0 flex-1 group-data-[collapsible=icon]:flex-none" isActive={ctx.activeIds.has(f.id)} tooltip={ctx.inFlyout ? undefined : f.name} onClick={() => ctx.apply(f.id)}>
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
// One row of the FLAT poster-folder list (poster mode only, #6 remainder 1). Same row shell as
// FolderNode above (drag handle, context menu, click = apply) minus everything that only
// makes sense for a tree: no twisty, no kids, no "into" drop mode — a poster folder can
// only land before or after a sibling, never inside one (posterFolderStore never sets
// parentId). Click routes through applyPosterFolderFilter (posterQB), not
// applyFolderFilter (postQB) — the two query builders are separate instances.
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
  /** True for the copy inside the rail's flyout (#965) — see FolderNode's tooltip. */
  inFlyout: boolean;
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
        <SidebarMenuButton className="min-w-0 flex-1" tooltip={ctx.inFlyout ? undefined : f.name} onClick={() => ctx.apply(f.id)}>
          <Folder />
          <span className="truncate">{f.name}</span>
        </SidebarMenuButton>
      </div>
    </SidebarMenuItem>
  );
}
// One rail row that stands in for a whole user-grown group (#965): the row itself is a
// fixed destination (so #678's "the rail carries only fixed rows" still holds), and the
// list it stands for opens beside it as a flyout. The same Popover-off-a-sidebar-row
// shape the global history footer row (#145) has used since before the rail existed.
//
// `children` is a function of `close` because a flyout is dismissed by USING it: picking
// a folder is arriving somewhere, and the panel that got you there should get out of the
// way. Everything else inside (the twisty, +, the context menu) leaves it open.
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
        {/* Capped and scrollable: a folder tree has no natural height, and the flyout
            sits against the window edge with the whole column height to fall out of. */}
        <PopoverContent side="right" align="start" className="max-h-[min(70vh,32rem)] w-64 gap-0 overflow-y-auto p-1.5">
          {children(() => setOpen(false))}
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}
// The heading is not a folder, so it needs an id no folder can have to appear as
// the current drop target.
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
  /** False for the dragged folder itself and everything under it — those drops cannot exist. */
  canDropOn: (id: string) => boolean;
  place: (t: DropTarget) => void;
  /** Folders the live query is filtered by — the row for the place you are in (#965). */
  activeIds: Set<string>;
  /** True for the copy inside the rail's flyout (#965) — see FolderNode's tooltip. */
  inFlyout: boolean;
}

export function LeftSidebar({ resize }: { resize?: PanelResize }) {
  const mode = useSyncExternalStore(subBrowse, getBrowse);
  // #145: the history panel's open state lives in services/history-panel.ts (not
  // component state) so Ctrl+H and the palette's cmd:history can open it too —
  // this component only owns the Popover's Trigger/anchor.
  const historyOpen = useSyncExternalStore(historySubscribe, historyIsOpen);
  const isPosters = mode === 'posters';
  const isTrash = mode === 'trash';
  const isTimeline = mode === 'timeline';
  const trashN = useSyncExternalStore(trashSubscribe, trashCount);
  const panelsHidden = useSyncExternalStore(panelsSubscribe, panelsAreHidden);
  const allFolders = useFolders();
  const folders = allFolders.filter((f) => !isSavedSearch(f));
  const saved = allFolders.filter(isSavedSearch);
  const currentTree = useSyncExternalStore(subPostTree, getPostTree);
  const currentKey = treeKey(currentTree);
  // The tree, derived here rather than asked of the store: rendering reads one
  // snapshot of the folder list, so the shape on screen always matches the list it
  // was drawn from. Saved searches are excluded upstream — they carry no parent and
  // would otherwise surface as root folders.
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
  // Which folders are open is a this-session thing (Eagle forgets it too, and nobody
  // has minded); persisting it would mean a pref write on every twisty click.
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
      // A new subfolder that lands inside a closed parent looks like nothing
      // happened, so creating one opens the parent.
      if (parentId) setOpen(parentId, true);
    });
  };
  // Deleting takes the subtree with it, so the count goes in the dialog: "delete this
  // folder" and "delete these nine folders" deserve different amounts of hesitation.
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
  // #79 導線③: every capture in the folder becomes one pin tile (its own cover
  // image, same rule pin-items.ts uses everywhere else) and always opens a
  // FRESH pin window — unlike the card menu/toolbar entry points, "flowing a
  // whole folder in" is never meant to pile onto whatever pin window happens
  // to be active.
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
      // Saved searches (isSavedSearch) hold no items of their own (a live
      // query, not a post set), so there is nothing here to pin.
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
  // Tree drag-and-drop. Which folder is moving and where it would land are both
  // view state — nothing is written until the drop, so an abandoned drag leaves
  // no trace.
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
  // One ctx, two renders (#965): the flyout copy overrides `inFlyout` and folds closing
  // the panel into `apply` — see folderGroup below.
  const treeCtx: FolderTreeCtx = {
    kidsOf,
    expanded,
    setOpen,
    menu: folderMenu,
    activeIds: activeFolderIds(currentTree),
    inFlyout: false,
    apply: (id) => {
      applyFolderFilter(id);
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
      // A folder dropped into a closed parent would vanish from view; open it so the
      // drop shows its result.
      if (t.mode === 'into') setOpen(t.id, true);
      endDrag();
    },
  };
  // Saved searches are managed on their own row, not in the folder manager (which is
  // about folders: create, drag-reorder, put posts in). Re-saving the condition is the
  // one action here whose effect is invisible, so it is the one that says anything.
  const savedSearchMenu = (e: MouseEvent, f: HologramFolder) => {
    e.preventDefault();
    // "Update Condition" is offered only when there IS a filter to capture — re-saving an empty
    // query would quietly turn the saved search into "everything".
    const items = [...(currentKey ? [{ label: t('savedSearchUpdate'), act: 'update' }] : []), { label: t('foldRename'), act: 'rename' }, { sep: true }, { label: t('foldDelete'), act: 'delete', danger: true }];
    menuOpen({ x: e.clientX, y: e.clientY, items }, (item) => {
      if (item.act === 'update') {
        if (updateFolder(f.id, { tree: currentTree })) toast(t('savedSearchUpdated'));
      } else if (item.act === 'rename') {
        promptName(t('saveSearchPrompt'), f.name, (name) => renameFolder(f.id, name));
      } else if (item.act === 'delete') removeFolder(f.id);
    });
  };

  // Poster-mode folder group (#6 remainder 1): a flat sibling list backed by posterFolderStore
  // (poster-folders.json), visible only while browsing posters — unlike the library tree
  // above, which stays reachable from every mode so a click can jump there. There is no
  // manager modal to open any more: this list creates/renames/deletes/reorders directly,
  // the same "the sidebar IS the manager" grammar #41/finalized decision D already gave library folders.
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
    inFlyout: false,
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

  // The three user-grown groups, each written once and rendered twice (#965): in the
  // column, and inside its own rail flyout. Only two things differ between the two, and
  // both come in as arguments — the wrapper's own class, and the ctx's `inFlyout` /
  // closing `apply`. Nothing else needs a fork, because the flyout is portaled OUT of
  // the sidebar: the rows' `group-data-[collapsible=icon]:*` classes find no matching
  // ancestor there and draw their expanded form on their own.

  // The folder tree, edited in place (#41 / finalized decision D): + on the group heading makes a
  // root folder, the row's context menu makes a subfolder, renames or deletes.
  // There is no management modal to open — the tree IS the manager, the way
  // Finder / Eagle / Raindrop do it. The group stays mounted even when empty so
  // the + is always reachable.
  // group-data-[collapsible=icon]:hidden on this and the next two groups (poster
  // folders, saved searches): the rail's scope is the fixed destinations only
  // (#678) — user-grown lists show only when expanded, or in the flyout above.
  const folderGroup = (inFlyout: boolean, close?: () => void) => {
    const ctx: FolderTreeCtx = inFlyout
      ? {
          ...treeCtx,
          inFlyout: true,
          apply: (id) => {
            applyFolderFilter(id);
            close?.();
          },
        }
      : treeCtx;
    return (
      <SidebarGroup className={inFlyout ? 'p-0' : 'group-data-[collapsible=icon]:hidden'}>
        {/* The heading doubles as the drop target for "out of every folder": a tree
            needs somewhere to drop that means the root, and the only other place —
            empty space below the last row — is not a target you can aim at. */}
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

  // Poster-mode folders (#6 remainder 1) — only while browsing posters (unlike the library
  // tree above, which stays reachable from every mode): a flat list, edited in
  // place the same way — + on the heading creates, the row's context menu
  // renames/deletes, drag reorders. No management modal for these either now.
  // Own heading string (sbPosterFoldersSidebarTitle, distinct from the qf-pop
  // facet's sbPosterFoldersTitle): the two groups sit stacked right on top of
  // each other here, and both saying plain "folder" read as one group split
  // in two rather than two different things.
  const posterFolderGroup = (inFlyout: boolean, close?: () => void) => {
    const ctx: PosterFolderCtx = inFlyout
      ? {
          ...posterFolderCtx,
          inFlyout: true,
          apply: (id) => {
            applyPosterFolderFilter(id);
            close?.();
          },
        }
      : posterFolderCtx;
    return (
      <SidebarGroup className={inFlyout ? 'p-0' : 'group-data-[collapsible=icon]:hidden'}>
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

  // Saved Searches (#40) — its own group, never mixed in with the folders above:
  // a folder is a place you put posts, a saved search is a question you re-ask.
  // Click REPLACES the current query with the saved one, so every condition
  // lands in the chip bar ready to be adjusted. No count badge: a saved search
  // has no cheap size — counting one means scanning the whole library, and a
  // badge on every row would do that on every render.
  const savedSearchGroup = (inFlyout: boolean, close?: () => void) => (
    <SidebarGroup className={inFlyout ? 'p-0' : 'group-data-[collapsible=icon]:hidden'}>
      <SidebarGroupLabel>{t('savedSearches')}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {saved.map((f) => (
            <SidebarMenuItem key={f.id}>
              <SidebarMenuButton
                tooltip={inFlyout ? undefined : f.name}
                isActive={!!currentKey && currentKey === treeKey(f.tree)}
                onContextMenu={(e) => savedSearchMenu(e, f)}
                onClick={() => {
                  applySavedSearch(f.id);
                  close?.();
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
    // Ctrl+B collapses to the icon rail; Ctrl+Shift+B takes the rail too (#245) — half a
    // panel left standing is not what "use the grid wide" asks for. Same component either
    // way: shadcn's two collapse forms differ only in this attribute, and since #583 both
    // land instantly — so this key no longer overlaps two 200ms motions with each other.
    <Sidebar collapsible={panelsHidden ? 'offcanvas' : 'icon'}>
      {/* Titlebar-height drag strip (Obsidian-type shell, #154): the sidebar starts at
          the window top now, so its header row IS the left half of the titlebar — the
          collapse trigger sits here (moved out of the toolbar), the rest is grab space
          to move the window. No wordmark: chrome stays quiet. */}
      {/* No px override: the header keeps SidebarHeader's own p-2, which is the same 8px the
          groups and the footer below it use — so the trigger starts on the column's left edge
          like every nav row (#628, the sidebar-column axis). The px-1 that used to be here was
          the only 4 in the column and was what pulled the trigger 4px off that edge. */}
      <SidebarHeader className="app-drag h-[var(--tabbar-h)] flex-row items-center justify-start">
        {/* The tooltip is where Ctrl+B is learnable (#245): the shortcut carries no hint of
            itself, and the target users are not assumed to know editor key conventions. Its
            partner Ctrl+Shift+B is spelled out next to it in the Display popover, where the two
            can be read as the pair they are — a tooltip on one button is the wrong place to
            explain a key that acts on two panels. */}
        <Tooltip>
          <TooltipTrigger render={<SidebarTrigger className="app-no-drag text-muted-foreground" aria-label={t('toggleSidebar')} />} />
          <TooltipContent side="bottom" align="start">
            {t('toggleSidebar')}
            <span className="text-background/60">Ctrl+B</span>
          </TooltipContent>
        </Tooltip>
      </SidebarHeader>
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
              {/* Timeline (#183) — the SNS-feed reading mode: same post population,
                  pinned to post-date descending, no layout/sort controls of its own
                  (DisplayMenu.tsx's TimelineControls). Sits with posts/posters (the
                  other content destinations), above trash. */}
              <SidebarMenuItem>
                <SidebarMenuButton isActive={isTimeline} tooltip={t('browseTimeline')} onClick={() => browseTo('timeline')}>
                  <Rss />
                  <span data-slot="menu-label">{t('browseTimeline')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {/* The rail's stand-ins for the three groups below (#965). The rail's scope is
            unchanged — these are fixed rows, one per group, not the lists themselves —
            and each one's flyout holds the real thing. Placed above the groups so the
            rail reads in the same order the column does. */}
        <SidebarGroup className="hidden group-data-[collapsible=icon]:flex">
          <SidebarGroupContent>
            <SidebarMenu>
              <RailFlyoutRow icon={<Folder />} label={t('qfCatFolder')}>
                {(close) => folderGroup(true, close)}
              </RailFlyoutRow>
              {isPosters && (
                <RailFlyoutRow icon={<Folders />} label={t('sbPosterFoldersSidebarTitle')}>
                  {(close) => posterFolderGroup(true, close)}
                </RailFlyoutRow>
              )}
              {saved.length > 0 && (
                <RailFlyoutRow icon={<Search />} label={t('savedSearches')}>
                  {(close) => savedSearchGroup(true, close)}
                </RailFlyoutRow>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {folderGroup(false)}
        {isPosters && posterFolderGroup(false)}
        {saved.length > 0 && savedSearchGroup(false)}
        {/* Trash (#268) — a library destination, so it lives here in the nav rather
            than in the footer (which holds the app-level entries) or in Settings, where it
            used to be. Last and always present: digiKam puts the trash as the final
            entry of the album tree, Apple Photos keeps "Recently Deleted" in a
            Utilities group at the bottom, and neither hides it when it is empty —
            a row that disappears turns "where did my deleted post go" into a search.
            mt-auto pins it under whatever the folder / saved-search groups grew to.
            The badge is the count, shown only from 1 up: "0" is not information, and
            unlike a saved search this count is cheap (one directory read). */}
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
          {/* Command Palette (#28) — the first of two visible entry points (the other is
              the badge at the search box's right edge). The ⋮ menu proposal was rejected
              in #146, and it was decided that "#28's entry point will be added to the
              sidebar when implemented" — the reasoning being that apps with a left rail
              (VS Code's Manage gear / Obsidian's ribbon) put their app-wide entry points
              on the sidebar side. It sits in the same footer as Settings because both are
              entry points to the app itself, not to "what you're currently looking at."
              Even collapsed, it stays clickable with a tooltip. */}
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={`${t('paletteTitle')} (Ctrl+K)`} onClick={() => openPalette()}>
              <Terminal />
              <span data-slot="menu-label">{t('paletteTitle')}</span>
              {/* No room for the hint in the rail (~56px content width) — already
                  effectively invisible there before this change, now made explicit. */}
              <span className="ml-auto text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">Ctrl+K</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* Global history page (#145) — the sidebar footer row is the anchor the
              panel's Popover positions against; Ctrl+H and the palette's cmd:history
              (services/history-panel.ts) open the SAME controlled Popover from
              outside this component. Non-modal Base UI Popover is used as-is
              (its `modal` prop defaults to false — see popover.tsx): the design's
              stated requirement is that the grid stays scrollable and visible
              behind it, unlike Settings' Dialog. */}
          <SidebarMenuItem>
            <Popover open={historyOpen} onOpenChange={(next) => (next ? openHistory() : closeHistory())}>
              <PopoverTrigger
                render={
                  <SidebarMenuButton tooltip={`${t('historyTitle')} (Ctrl+H)`}>
                    <History />
                    <span data-slot="menu-label">{t('historyTitle')}</span>
                    <span className="ml-auto text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">Ctrl+H</span>
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
        {/* Backup / mirror status rail. It draws its own root (P3 #6) — this used to be a
            host <span> the component wrote a status class onto from a layout effect. */}
        <BackupStatus />
      </SidebarFooter>
      {/* The column's drag edge (#30). Passed in rather than read from context: only
          the shell knows whether the sidebar is a column right now or a slide-over,
          and the handle exists only in the first case. */}
      {resize && <SidebarRail resize={resize} />}
    </Sidebar>
  );
}
