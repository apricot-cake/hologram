// Left navigation sidebar — the "place" axis of the new IA (redesign §3-1).
// Nav-only: it answers "where am I looking" (library posts / posters), never
// "how is it filtered" (that is the toolbar's filter bar). Built on shadcn's
// Sidebar (collapsible=icon) — the calm, content-first nav of Claude Desktop /
// Linear, not the old facet-row wall.
//
// P1 scope: the two browse destinations + the footer (settings gear + mirror
// status rail). The フォルダ hierarchy tree and 保存した検索 groups (§3-1) land
// in a follow-up (P1-3 continuation) once the collection-facet apply path is
// wired — they are intentionally absent here, not forgotten.
import { LayoutGrid, Settings, Users } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { MirrorStatus } from '../mirror/MirrorStatus.tsx';
import { t } from '../_shared/i18n.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from '../../renderer/store.ts';
import { open as openSettings } from '../../renderer/settings.ts';

// browseMode is the single source of truth for the active destination. Writing
// the store IS the interface — orchestrator.ts subscribes and runs the heavy
// switch (handleBrowseModeStoreChange → setBrowseMode); the store.set idempotent
// guard means no echo loop. Same contract the old BrowseToggle island used.
const subBrowse = (cb: () => void) => storeSubscribe('browseMode', cb);
const getBrowse = (): string => (storeGet('browseMode') as string) || 'posts';

export function LeftSidebar() {
  const mode = useSyncExternalStore(subBrowse, getBrowse);
  const isPosters = mode === 'posters';
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
        {/* TODO(P1-3): フォルダ階層ツリー（#41）＋保存した検索（#40）グループ。
            collection-facet の置換適用 path を通してから足す。 */}
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
