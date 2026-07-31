// Command palette (#28) entry registration — the content side that goes into the registry.
// One of orchestrator.ts's decomposition slices, taking the same ctx-injection shape as the
// other *-builder.ts files (perform's actual body is registered as a dependency-injected
// closure after the app boots, per the design).
//
// This is also where "one engine, three surfaces" converge. The old buildSuggest (users.ts's
// suggestion generation for the search box) has been absorbed into this file's corpus
// provider — tag/poster candidates come from the same function for both the palette and the
// search box. The action on confirm is also shared with the searchbox bridge's onPick (=
// search-editing's pick wrapped with history coalescing), so the "AND-add to the current tab"
// behavior never drifts between surfaces.
import { type CommandEntry, registerCommands, registerProvider } from './command-registry.ts';
import { handlers as searchBoxHandlers } from './searchbox.ts';
import { setLayout, setPosterLayout } from './display.ts';
import { toggle as togglePanels } from './panels.ts';
import { open as openSettings } from './settings.ts';
import { hologramTabsSource } from './tabs.ts';

// deps = what the app supplies (the library's actual data, the folder list, tab operations,
// query reset/apply, the current mode, copy). settings / store / tabs / searchbox are real ES
// modules with no state, so they're imported directly. folders.ts is NOT imported directly,
// because it pulls in ipc/i18n — which would make this whole module unreadable without a stub
// (keeping it so the entry lineup can be verified standalone just by swapping deps).
export interface CommandDeps {
  t(key: string): string;
  allPosts(): HologramPost[];
  buildUsers(): HologramUserAgg[];
  listFolders(): HologramFolder[];
  folderPath(id: string): string;
  getBrowseMode(): string;
  addTab(): void;
  switchTab(id: string): void;
  resetAllFilters(): void;
  resetPosterFilters(): void;
  browseTo(mode: string): void;
  applyFolderFilter(id: string): void;
  /** The poster view's tag vocabulary (general tags + Work/Character). The count is the number of posters after the current narrowing. */
  posterTagRows(): { value: string; count: number }[];
  /** The poster view's folder list. */
  posterFolderRows(): { id: string; name: string }[];
  /** Add one condition to the poster view's query. */
  posterAddFilter(filter: { type: string; value: string; label?: string }): void;
}

export function makeCommands(deps: CommandDeps): void {
  const { t } = deps;

  // --- Action-type entries (fixed entries) ---------------------------------------------------
  // Entries whose destination changes with mode don't get added/removed — the branching
  // happens on the perform side instead — so an item with the same name never appears or
  // disappears depending on the current mode (never "I searched and it wasn't there").
  const commands: CommandEntry[] = [
    { id: 'cmd:settings', section: 'command', title: t('cmdOpenSettings'), perform: () => openSettings() },
    { id: 'cmd:new-tab', section: 'command', title: t('cmdNewTab'), hint: 'Ctrl+T', perform: () => deps.addTab() },
    {
      id: 'cmd:clear-filters',
      section: 'command',
      title: t('cmdClearFilters'),
      perform: () => (deps.getBrowseMode() === 'posters' ? deps.resetPosterFilters() : deps.resetAllFilters()),
    },
    {
      id: 'cmd:view-grid',
      section: 'command',
      title: t('cmdViewGrid'),
      // Moves only the layout axis — doesn't touch the Square thumbnails / Show info switches
      // (the #618/#630 orthogonal-key split. The palette is not a surface that remembers display state).
      perform: () => (deps.getBrowseMode() === 'posters' ? setPosterLayout(false) : setLayout(false)),
    },
    {
      id: 'cmd:view-list',
      section: 'command',
      title: t('cmdViewList'),
      perform: () => (deps.getBrowseMode() === 'posters' ? setPosterLayout(true) : setLayout(true)),
    },
    // Bulk-visibility toggle (#245). The name states the action, not the state — the palette
    // row is never rewritten to match the state at the moment it opened (a row that swaps
    // between "Hide" and "Restore" can't be found by searching for it).
    { id: 'cmd:toggle-panels', section: 'command', title: t('cmdTogglePanels'), hint: 'Ctrl+Shift+B', perform: () => togglePanels() },
    { id: 'cmd:browse-posts', section: 'command', title: t('cmdBrowsePosts'), perform: () => deps.browseTo('posts') },
    { id: 'cmd:browse-posters', section: 'command', title: t('cmdBrowsePosters'), perform: () => deps.browseTo('posters') },
    // Trash is one more destination too (#268) — same treatment as the two lines above: a
    // destination permanently in the sidebar also appears in the palette.
    { id: 'cmd:browse-trash', section: 'command', title: t('cmdBrowseTrash'), perform: () => deps.browseTo('trash') },
  ];
  registerCommands('commands', commands);

  // --- Tab switching ---------------------------------------------------------------
  // The display name is taken from the same computation as the tab band itself (tabs.ts's
  // derived title) — so the name shown in the palette never disagrees with the name shown
  // on the band. The current tab is not listed (switchTab returns immediately for it — it
  // would be a row that does nothing when pressed).
  registerProvider({
    id: 'tabs',
    entries: () => {
      const model = hologramTabsSource.get();
      if (!model) return [];
      return model.tabs
        .filter((tab) => !tab.active)
        .map((tab) => ({
          id: `tab:${tab.id}`,
          section: 'tab' as const,
          title: tab.title,
          perform: () => deps.switchTab(tab.id),
        }));
    },
  });

  // --- Jump candidates (tags / posters / folders) -----------------------------------
  // The old buildSuggest's contents live here. Not enumerated on an empty query — tags and
  // posters run into the thousands, and no surface lists them all the instant it opens
  // (narrowing is entirely queryEntries's job, so this only has to return the base population).
  //
  // The action on confirm is the same onPick as the search box's suggestions (AND-add to the
  // current tab). The bridge is pulled lazily so this provider's registration doesn't have to
  // guarantee orchestrator's init has already finished (the same existing convention as the
  // searchbox bridge).
  const pick = (kind: string, value: string, label: string) => {
    searchBoxHandlers()?.onPick({ kind, value, label });
  };
  // The vocabulary belongs to whichever view is showing: post tags/posters while looking at
  // posts, poster tags/folders while looking at posters (#148). Even the same "tag" label
  // draws from a different vocabulary and a different query tree, so mixing them produces a
  // candidate that does nothing when pressed (a row that edits the post-side query from the
  // poster view). Splitting this into two providers switched by mode is what keeps the
  // section lineup and ordering running through one queryEntries (rather than growing a
  // separate candidate generator per surface).
  const posters = () => deps.getBrowseMode() === 'posters';
  registerProvider({
    id: 'corpus',
    entries: (query) => {
      if (!query.trim() || posters()) return [];
      const out: CommandEntry[] = [];
      const counts = new Map<string, number>();
      for (const p of deps.allPosts()) if (p.url) for (const tag of p.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
      for (const [tag, count] of counts) {
        out.push({ id: `tag:${tag}`, section: 'tag', title: tag, hint: String(count), weight: count, filter: { type: 'tag', value: tag }, perform: () => pick('tag', tag, tag) });
      }
      for (const u of deps.buildUsers()) {
        const label = u.displayName || u.screenName || t('cmdUnknownUser');
        out.push({
          id: `user:${u.key}`,
          section: 'user',
          title: label,
          keywords: u.screenName || undefined,
          hint: String(u.count),
          weight: u.count,
          filter: { type: 'user', value: u.key, label },
          perform: () => pick('user', u.key, label),
        });
      }
      for (const f of deps.listFolders()) {
        // Nested folders can share a name, so the path display ("parent / child") is used as
        // the name. No filter is attached, because a folder is a "place" — a destination — and
        // confirming it is not a plain add-a-condition but one bundled act of "switch to the
        // post view and replace the existing folder condition" (applyFolderFilter owns all of that).
        out.push({ id: `folder:${f.id}`, section: 'folder', title: deps.folderPath(f.id) || f.name, keywords: f.name, perform: () => deps.applyFolderFilter(f.id) });
      }
      return out;
    },
  });
  registerProvider({
    id: 'poster-corpus',
    entries: (query) => {
      if (!query.trim() || !posters()) return [];
      const out: CommandEntry[] = [];
      for (const row of deps.posterTagRows()) {
        out.push({ id: `poster-tag:${row.value}`, section: 'tag', title: row.value, hint: String(row.count), weight: row.count, filter: { type: 'tag', value: row.value }, perform: () => deps.posterAddFilter({ type: 'tag', value: row.value }) });
      }
      for (const f of deps.posterFolderRows()) {
        // A poster-view folder is posterQB's single-choice facet (replaces the existing one) —
        // unlike the post side's "switch to a place", you stay right here and just one condition
        // swaps, so it does carry a filter.
        out.push({ id: `poster-folder:${f.id}`, section: 'folder', title: f.name, filter: { type: 'folder', value: f.id }, perform: () => deps.posterAddFilter({ type: 'folder', value: f.id }) });
      }
      return out;
    },
  });
}
