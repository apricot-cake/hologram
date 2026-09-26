import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { AddFilterButton } from '../filterbar/index.tsx';
import { FilterChips } from '../filterbar/FilterChips.tsx';
import { InspectorToggle } from './InspectorToggle.tsx';
import { DisplayMenu, CardSizeControl } from './DisplayMenu.tsx';
import { SearchBox } from '../searchbox/SearchBox.tsx';
import { ViewerToolbar, ViewerEditActions } from '../image-tab/ViewerToolbar.tsx';
import * as editControls from '../services/image-edit-controls.ts';
import { TrashToolbar } from '../trash/TrashView.tsx';
import { t } from '../_shared/i18n.ts';
import { hologramImageTabSource, isActive as imageViewIsActive } from '../services/image-tab.ts';
import { store, subscribeKey } from '../services/store.ts';
import type { HologramStoreState } from '../services/store.ts';
import { navBack, navForward } from '../services/orchestrator.ts';

const subKey = (key: keyof HologramStoreState) => (cb: () => void) => subscribeKey(key, cb);
const subBack = subKey('navCanBack');
const getBack = (): boolean => store.getState().navCanBack;
const subForward = subKey('navCanForward');
const getForward = (): boolean => store.getState().navCanForward;
export function TabNavigation() {
  const canBack = useSyncExternalStore(subBack, getBack);
  const canForward = useSyncExternalStore(subForward, getForward);
  return (
    <div className="app-no-drag flex w-[72px] shrink-0 items-center justify-center">
      <Button variant="ghost" size="icon-sm" className="hover:!bg-[var(--active)]" aria-label="戻る" disabled={!canBack} onClick={() => navBack()}>
        <ChevronLeft />
      </Button>
      <Button variant="ghost" size="icon-sm" className="hover:!bg-[var(--active)]" aria-label="進む" disabled={!canForward} onClick={() => navForward()}>
        <ChevronRight />
      </Button>
    </div>
  );
}

export function AppToolbar() {
  const editing = useSyncExternalStore(editControls.subscribe, editControls.isEditing);
  const imageView = useSyncExternalStore(hologramImageTabSource.subscribe, imageViewIsActive);
  const mode = useSyncExternalStore(subKey('browseMode'), () => store.getState().browseMode);
  const isTrash = mode === 'trash';
  return (
    <div data-slot="page-toolbar" className="flex shrink-0 flex-col">
      <div className="flex h-11 min-w-0 items-center gap-1.5 px-3">
        <div inert={editing}>
          <TabNavigation />
        </div>
        {imageView && <ViewerToolbar />}
        {!imageView && <CardSizeControl />}
        {isTrash && !imageView && <TrashToolbar />}
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <div data-slot="toolbar-search" className={`flex min-w-0 justify-end ${imageView ? 'hidden' : ''}`}>
            <SearchBox placeholder={t(isTrash ? 'trashSearchPlaceholder' : 'searchPlaceholder')} />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!imageView && (
              <>
                <AddFilterButton />
                <DisplayMenu />
              </>
            )}
          </div>
          {imageView && <ViewerEditActions />}
          <InspectorToggle />
        </div>
      </div>
      <div className={`px-4 ${imageView ? 'hidden' : ''}`}>
        <FilterChips />
      </div>
    </div>
  );
}
