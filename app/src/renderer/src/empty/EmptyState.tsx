import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { Images, Puzzle, SearchX, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { t } from '../_shared/i18n.ts';
import { importFromClipboard } from '../services/clipboard-intake.ts';
import { hologramIpc } from '../services/ipc.ts';
import { libraryEmptyVariant } from '../services/library-status.ts';
import { resetAllFilters, resetPosterFilters, runZipImport } from '../services/orchestrator.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';

// #71: the store submission does not exist yet (pre-release — see Issue #71's
// release-order note: this Issue ships last, after the extension is public).
// Replace with the real Chrome Web Store listing URL once it does; until then
// this points at the store's own home rather than a fabricated listing page.
const EXTENSION_STORE_URL = 'https://chrome.google.com/webstore/category/extensions'; // TODO(#71): real listing URL

// Empty-state placeholder for the two library grids: the "no posts yet" first-run
// message, the "no results" filtered-empty message, or the poster first-run message. It
// owns its own container and its own visibility — the shell used to mount it inside a
// static `#emptyState` div whose `hidden` two render pipelines wrote by hand (gone), while this
// component already knew from the store whether it had anything to say. Its buttons call
// the orchestrator directly, in place of the delegated click listener that matched them
// by element id (#153).
//
// The SHAPE is shadcn's Empty (P2⑫): icon plate, title, description, then the actions —
// the anatomy every empty state in the app now wears (the trash's, the inspector's, the
// image view's "post is gone"). It used to be a bare <div> of <p><strong> lines plus a
// button styled here and nowhere else, which is how three surfaces that all say "there
// is nothing here" ended up looking like three different products.
//
// BOTH variants (post and poster) are folded into self-derived selectors —
// hologramStore already carries everything needed reactively — instead of a viewer
// push. The old shared push bridge has no callers left anywhere and was deleted.
//
// The variant decision itself lives in services/library-status.ts, not here (#682):
// it gates on 'libraryLoaded' so a grid mid-load never reads as "confirmed empty" —
// see that module's header for why postGroups/posterGroups alone couldn't tell the
// two apart, and empty/LibraryLoading.tsx for what fills the gap while loading.
const subPostGroups = (cb: () => void) => storeSubscribe('postGroups', cb);
const getPostGroups = () => storeGet('postGroups') as any[] | null | undefined;
const subAllPostsCount = (cb: () => void) => storeSubscribe('allPostsCount', cb);
const getAllPostsCount = () => (storeGet('allPostsCount') as number | undefined) ?? 0;
const subPosterGroups = (cb: () => void) => storeSubscribe('posterGroups', cb);
const getPosterGroups = () => storeGet('posterGroups') as any[] | undefined; // never explicitly null — see library-status.ts
const subAllUsersCount = (cb: () => void) => storeSubscribe('allUsersCount', cb);
const getAllUsersCount = () => (storeGet('allUsersCount') as number | undefined) ?? 0;
const subSearchQuery = (cb: () => void) => storeSubscribe('searchQuery', cb);
const getSearchQuery = () => (storeGet('searchQuery') as string | undefined) ?? '';
const subMode = (cb: () => void) => storeSubscribe('browseMode', cb);
const getMode = () => (storeGet('browseMode') as string | undefined) ?? 'posts';
const subLibraryLoaded = (cb: () => void) => storeSubscribe('libraryLoaded', cb);
const getLibraryLoaded = () => !!storeGet('libraryLoaded');
// #71: seeded once at boot by App.tsx's LibraryStatusGate (get-extension-contact) —
// see library-status.ts's libraryEmptyVariant for how this splits firstRun in two.
const subExtensionContacted = (cb: () => void) => storeSubscribe('extensionContacted', cb);
const getExtensionContacted = () => !!storeGet('extensionContacted');

export function EmptyState() {
  const mode = useSyncExternalStore(subMode, getMode);
  const postGroups = useSyncExternalStore(subPostGroups, getPostGroups);
  const allPostsCount = useSyncExternalStore(subAllPostsCount, getAllPostsCount);
  const posterGroups = useSyncExternalStore(subPosterGroups, getPosterGroups);
  const allUsersCount = useSyncExternalStore(subAllUsersCount, getAllUsersCount);
  const query = useSyncExternalStore(subSearchQuery, getSearchQuery);
  const libraryLoaded = useSyncExternalStore(subLibraryLoaded, getLibraryLoaded);
  const extensionContacted = useSyncExternalStore(subExtensionContacted, getExtensionContacted);
  const variant = libraryEmptyVariant({ mode, libraryLoaded, postGroups, posterGroups, allPostsCount, allUsersCount, query, extensionContacted });
  if (!variant) return null;
  // #71: the extension has never talked to the host at all — install comes
  // before anything else this screen could say, so it pre-empts the ordinary
  // firstRun/posterFirstRun copy below for BOTH modes (the guide is about
  // installing the extension, not about posts vs. posters).
  if (variant === 'extensionGuide') {
    return (
      <Frame>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Puzzle />
          </EmptyMedia>
          <EmptyTitle>{t('extGuideTitle')}</EmptyTitle>
          <EmptyDescription>{t('extGuideDesc')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => hologramIpc.openExternal(EXTENSION_STORE_URL)}>
            {t('extGuideInstallBtn')}
          </Button>
        </EmptyContent>
      </Frame>
    );
  }
  // A filter or a search ate everything → the one honest next action is to undo it.
  // No made-up second button here: the grid is empty BECAUSE of a predicate the user
  // set, and "reset" is the whole of what can be done about it from this spot.
  if (variant === 'filtered') {
    return (
      <Frame>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX />
          </EmptyMedia>
          <EmptyTitle>{t('emptySearchTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptySearchDesc')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => (mode === 'posters' ? resetPosterFilters?.() : resetAllFilters?.())}>
            {t('emptyResetBtn')}
          </Button>
        </EmptyContent>
      </Frame>
    );
  }
  // First run, posts or posters: the library really is empty, so what belongs here is
  // "how do things get in". Three routes exist and all three are named — the extension
  // (Alt+S) in the description, because the app cannot press it, and the two the app CAN
  // perform as the buttons. Both were otherwise reachable only from the command palette.
  const poster = variant === 'posterFirstRun';
  return (
    <Frame>
      <EmptyHeader>
        <EmptyMedia variant="icon">{poster ? <Users /> : <Images />}</EmptyMedia>
        <EmptyTitle>{t(poster ? 'posterEmptyTitle' : 'emptyTitle')}</EmptyTitle>
        <EmptyDescription>
          {t(poster ? 'posterEmptyDesc' : 'emptyDesc')} {/* emptyCaptureHint carries <kbd> markup, so it's set as HTML (matches the old innerHTML). */}
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: i18n string with intentional <kbd> markup */}
          <span dangerouslySetInnerHTML={{ __html: t('emptyCaptureHint') }} />
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" onClick={() => runZipImport?.()}>
            {t('importZip')}
          </Button>
          <Button variant="outline" onClick={() => void importFromClipboard()}>
            {t('emptyImportClipboard')}
          </Button>
        </div>
      </EmptyContent>
    </Frame>
  );
}

// The grids' empty state is a block INSIDE the scrolling content column, not a panel
// filling it, so the Empty's own `flex-1` has nothing to stretch against — the height
// comes from the padding instead. (The inspector's and the image view's do fill their
// container, and use the component as-is.)
function Frame({ children }: { children: ReactNode }) {
  return (
    <Empty data-slot="empty-state" className="py-16">
      {children}
    </Empty>
  );
}
