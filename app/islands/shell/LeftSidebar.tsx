// Left navigation sidebar — the "place" axis of the new IA (redesign §3-1).
// Nav-only: it answers "where am I looking" (library posts / posters), never
// "how is it filtered" (that is the toolbar's filter bar). Built on shadcn's
// Sidebar (collapsible=icon) — the calm, content-first nav of Claude Desktop /
// Linear, not the old facet-row wall.
//
// P1 scope: the two browse destinations, the library folders (flat, click = apply
// the folder as a place filter), the 保存した検索 group (#40) and the footer (settings
// gear + mirror rail). Still to come (P1-3 continuation): folder HIERARCHY +
// create/rename/delete (#41).
import { Folder, LayoutGrid, Search, Settings, Users } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, SidebarTrigger } from '@/components/ui/sidebar';
import type { PanelResize } from './use-panel-resize.ts';
import { MirrorStatus } from '../mirror/MirrorStatus.tsx';
import { t } from '../_shared/i18n.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from '../../renderer/store.ts';
import { open as openSettings } from '../../renderer/settings.ts';
import { all as folderAll, isSavedSearch, load as folderLoad, onChange as folderOnChange, removeFolder, renameFolder, toast, updateFolder } from '../../renderer/folders.ts';
import { cloneTree } from '../../renderer/query.ts';
import { open as menuOpen } from '../../renderer/menu.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { applyFolderFilter, applySavedSearch } from '../../renderer/orchestrator.ts';

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
// same as MirrorStatus: this island never unmounts in the single-page app.)
function useFolders(): CorpusFolder[] {
  const [list, setList] = useState<CorpusFolder[]>(() => folderAll());
  useEffect(() => {
    const sync = () => setList(folderAll().slice());
    folderLoad().then(sync);
    folderOnChange(sync);
    sync();
  }, []);
  return list;
}

// The live post query, mirrored into the store by the query builder on every
// mutation — the same channel the activebar reads. A saved search is "applied"
// when the current tree equals the saved one; there is no separate applied-id
// state to keep in sync, so editing a chip simply stops the row from matching.
const subPostTree = (cb: () => void) => storeSubscribe('postQueryTree', cb);
const getPostTree = () => storeGet('postQueryTree') as CorpusQueryGroup | undefined;
// Compare through the persistence clone so a tree that has been to disk and back
// compares equal to a freshly built one (the compile memos are the only difference).
const treeKey = (tree: CorpusQueryGroup | null | undefined) => (tree?.children?.length ? JSON.stringify(cloneTree(tree)) : '');

export function LeftSidebar({ resize }: { resize?: PanelResize }) {
  const mode = useSyncExternalStore(subBrowse, getBrowse);
  const isPosters = mode === 'posters';
  const allFolders = useFolders();
  const folders = allFolders.filter((f) => !isSavedSearch(f));
  const saved = allFolders.filter(isSavedSearch);
  const currentTree = useSyncExternalStore(subPostTree, getPostTree);
  const currentKey = treeKey(currentTree);
  // Saved searches are managed on their own row, not in the folder manager (which is
  // about folders: create, drag-reorder, put posts in). Re-saving the condition is the
  // one action here whose effect is invisible, so it is the one that says anything.
  const savedSearchMenu = (e: MouseEvent, f: CorpusFolder) => {
    e.preventDefault();
    // 条件を更新 is offered only when there IS a filter to capture — re-saving an empty
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
  // Clicking a post-side row while the poster grid is up would otherwise write a
  // query nobody can see — the destination switches with it.
  const toPosts = () => storeSet('browseMode', 'posts');
  return (
    <Sidebar collapsible="icon">
      {/* Titlebar-height drag strip (Obsidian-type shell, #154): the sidebar starts at
          the window top now, so its header row IS the left half of the titlebar — the
          collapse trigger sits here (moved out of the toolbar), the rest is grab space
          to move the window. No wordmark: chrome stays quiet. */}
      <SidebarHeader className="app-drag h-[var(--tabbar-h)] flex-row items-center justify-start px-1">
        <SidebarTrigger className="app-no-drag text-muted-foreground" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={!isPosters} tooltip={t('browsePosts')} onClick={() => storeSet('browseMode', 'posts')}>
                  <LayoutGrid />
                  <span>{t('browsePosts')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={isPosters} tooltip={t('browsePosters')} onClick={() => storeSet('browseMode', 'posters')}>
                  <Users />
                  <span>{t('browsePosters')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {folders.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>{t('qfCatFolder')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {folders.map((f) => (
                  <SidebarMenuItem key={f.id}>
                    {/* Click = apply this folder as a place filter on the post query
                        (redesign §3-1). Hierarchy + create/rename/delete come with #41. */}
                    <SidebarMenuButton
                      tooltip={f.name}
                      onClick={() => {
                        toPosts();
                        applyFolderFilter(f.id);
                      }}
                    >
                      <Folder />
                      <span>{f.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {/* 保存した検索 (#40) — its own group, never mixed in with the folders above:
            a folder is a place you put posts, a saved search is a question you re-ask.
            Click REPLACES the current query with the saved one, so every condition
            lands in the chip bar ready to be adjusted. No count badge: a saved search
            has no cheap size — counting one means scanning the whole library, and a
            badge on every row would do that on every render. */}
        {saved.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>{t('savedSearches')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {saved.map((f) => (
                  <SidebarMenuItem key={f.id}>
                    <SidebarMenuButton
                      tooltip={f.name}
                      isActive={!!currentKey && currentKey === treeKey(f.tree)}
                      onContextMenu={(e) => savedSearchMenu(e, f)}
                      onClick={() => {
                        toPosts();
                        applySavedSearch(f.id);
                      }}
                    >
                      <Search />
                      <span>{f.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* id="settingsBtn" is kept as a (b) contract: MirrorStatus refreshes
                its rail on this button's click (folders/backup may have changed).
                The id + the cross-boundary listener are retired together when the
                settings surface is reworked (redesign 未決事項G / P2⑩). */}
            <SidebarMenuButton id="settingsBtn" tooltip={t('tabSettings')} onClick={() => openSettings()}>
              <Settings />
              <span>{t('tabSettings')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {/* Backup / mirror status rail — renders its content into #mirrorStatus and
            writes the status class onto that host span (its own contract). */}
        <span id="mirrorStatus" className="mirror-status px-2 group-data-[collapsible=icon]:hidden">
          <MirrorStatus />
        </span>
      </SidebarFooter>
      {/* The column's drag edge (#30). Passed in rather than read from context: only
          the shell knows whether the sidebar is a column right now or a slide-over,
          and the handle exists only in the first case. */}
      {resize && <SidebarRail resize={resize} />}
    </Sidebar>
  );
}
