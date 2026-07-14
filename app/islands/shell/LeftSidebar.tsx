// Left navigation sidebar — the "place" axis of the new IA (redesign §3-1).
// Nav-only: it answers "where am I looking" (library posts / posters), never
// "how is it filtered" (that is the toolbar's filter bar). Built on shadcn's
// Sidebar (collapsible=icon) — the calm, content-first nav of Claude Desktop /
// Linear, not the old facet-row wall.
//
// P1 scope: the two browse destinations, the library folders (flat, click = apply
// the folder as a place filter), and the footer (settings gear + mirror rail). Still
// to come (P1-3 continuation): folder HIERARCHY + create/rename/delete (#41), the
// 保存した検索 group (#40) — both blocked on the #42 'collection'→'folder' rename.
import { Folder, LayoutGrid, Settings, Users } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { MirrorStatus } from '../mirror/MirrorStatus.tsx';
import { t } from '../_shared/i18n.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from '../../renderer/store.ts';
import { open as openSettings } from '../../renderer/settings.ts';
import { all as folderAll, load as folderLoad, onChange as folderOnChange } from '../../renderer/folders.ts';
import { applyFolderFilter } from '../../renderer/orchestrator.ts';

// browseMode is the single source of truth for the active destination. Writing
// the store IS the interface — orchestrator.ts subscribes and runs the heavy
// switch (handleBrowseModeStoreChange → setBrowseMode); the store.set idempotent
// guard means no echo loop. Same contract the old BrowseToggle island used.
const subBrowse = (cb: () => void) => storeSubscribe('browseMode', cb);
const getBrowse = (): string => (storeGet('browseMode') as string) || 'posts';

// Library folders (collections.json). folders.ts owns the data + a mutation-notify
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

export function LeftSidebar() {
  const mode = useSyncExternalStore(subBrowse, getBrowse);
  const isPosters = mode === 'posters';
  const folders = useFolders();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex h-8 items-center gap-2 px-2 font-heading text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">Corpus</div>
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
                    <SidebarMenuButton tooltip={f.name} onClick={() => applyFolderFilter(f.id)}>
                      <Folder />
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
                settings surface is reworked (redesign 要決G / P2⑩). */}
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
    </Sidebar>
  );
}
