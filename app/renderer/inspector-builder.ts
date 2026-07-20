// Post-inspector (persistent right-column detail panel) builder — extracted from
// the old viewer.ts monolith. Mirrors post-grid-builder.ts / poster-grid-builder.ts:
// open/close chrome, the always-live inline tag editor (add/toggle/adopt-source-tag
// + the 同名キャラ homonym check), the group dissolve/regroup buttons shown in the
// panel, and the Esc/outside-click dismiss guards all move here. inspector.ts (the
// open/refresh/close/get/subscribe bridge to the React island) stays untouched —
// this module is one of its two consumers (Inspector.tsx is the other).
// inspectedKey/setInspectedKey stay viewer.ts-owned (many not-yet-extracted
// clusters — poster card clicks, undo, browse-mode switch — read/write it too;
// same "shared cross-cutting state stays at the call site, builder takes a
// getter/setter dep" shape as posterReturn in poster-grid-builder.ts).
import { userKey } from './query.ts';
import { formatCount, localeDate, localeDateTime } from './format.ts';
import { open as inspectorOpen, refresh as inspectorRefresh, close as inspectorClose } from './inspector.ts';
import { isOpen as panelIsOpen, setOpen as panelSetOpen, subscribe as panelSubscribe } from './inspector-panel.ts';
import { isWide as isWideLayout } from './layout-mode.ts';
import { open as tagPopOpen, refresh as tagPopRefresh, close as tagPopClose, get as tagPopGet } from './tag-pop.ts';
import { get as confirmGet } from './confirm.ts';
import { get as kindMenuGet } from './kind-menu.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { get as menuGet } from './menu.ts';
import { isAnySelectOpen } from './open-select-registry.ts';
import { postIdKey, postKeyOf, captureFile, persistManualGroups, persistUngrouped } from './records.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { sameTags, setTagKind as tagsSetTagKind } from './tags.ts';
import { updateTags as postsUpdateTags } from './posts.ts';
import { hologramIpc } from './ipc.ts';

export interface InspectorBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  fileSrc(file: string, w?: number): string;
  showToast(msg: unknown): void;
  showKindMenu(tag: string, x: number, y: number, onChange: () => void): void;
  buildUsers(): HologramUserAgg[];
  tagKindOf(tag: string): string | null | undefined;
  worksCooccurringWith(tag: string, exclude: Set<string>): Set<string>;
  jumpToPoster(post: HologramPost): void;
  // Peek this group in the quick-view lightbox (#143 未決事項3) — the inspector
  // preview thumbnail is one of its two entries (the other = Space on the card).
  openQuickView(g: HologramPostGroup): void;
  pushUndo(kind: string, records: HologramUndoRecord[]): void;
  inspectorTagPickerData(tags: string[], recordsForSource: any[], kind: string): any;
  getViewGroups(): HologramPostGroup[];
  getAllPosts(): HologramPost[];
  getPostById(id: string): HologramPost | undefined;
  getUngrouped(): Set<string>;
  getManualGroups(): string[][];
  markPostsMutated(): void;
  renderPosts(keepLimit?: boolean): void;
  keepCurrentVisible(): void;
  // inspectedKey stays a viewer.ts `let` (read/written outside this cluster too) —
  // this module only gets the accessor pair, same shape as posterReturn above.
  getInspectedKey(): string | null;
  setInspectedKey(key: string | null): void;
  getActiveTabId(): string | null;
  closeTab(id: string | null | undefined): void;
  // imageTabShowing is a viewer.ts `let` (image-tab.ts consumer) — a
  // getter since its value changes over the module's lifetime.
  imageTabShowing(): boolean;
}

export function makeInspector(deps: InspectorBuilderDeps) {
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const closestOf = (e: Event, sel: string) => {
    const t = e.target as HTMLElement | null;
    return t instanceof Element ? (t.closest(sel) as HTMLElement | null) : null;
  };
  // Tag labels shared by the always-live inspector TagEditor (showDetail, below)
  // and the tag-pop opened straight from 🏷 (openTagPopForGroup) — same TagEditor
  // component, same strings either way.
  function tagLabels() {
    return {
      tagsLabel: deps.t('detailTags'),
      newTagPlaceholder: deps.t('tagNewName'),
      addBtn: deps.t('tagAddBtn'),
      noTags: deps.t('editNoTags'),
      noMatch: deps.t('tagPalNoMatch'),
      noVocab: deps.t('tagNoTags'),
      adoptSource: deps.t('editAdoptSource'),
    };
  }
  // === Inspector: the persistent right column ===
  //
  // Visibility belongs to the user now (#243), so it lives in the inspector-panel store
  // rather than in a `hidden` poke from here. Closing means asking the store; everything
  // that has to happen ALONGSIDE a visibility change is done by the subscriber below, so
  // the shell toggle and the panel's own × produce identical results.
  function closeDetail() {
    panelSetOpen(false);
  }

  // Narrow-width dismissal (#259) — NOT the same act as closing the panel. At narrow
  // widths the panel is an overlay that rides on the selection, so waving it away means
  // "nothing is inspected right now", not "I don't want this panel". Flipping the stored
  // preference here would make the next card click land on a closed panel, which is the
  // toggle-hunting the issue exists to remove.
  function dismissDetail() {
    inspectorClose();
    deps.setInspectedKey(null);
  }
  // Outside-click dismissal for the narrow overlay. Restored from the pre-#243 handler,
  // with one change: the width test asks layout-mode instead of carrying its own
  // `max-width` media query, so there is a single place the breakpoint lives.
  function handleOutsideClickDismissDetail(e: MouseEvent) {
    if (isWideLayout()) return; // wide = a docked column; nothing to dismiss
    const insp = byId('postDetail');
    if (insp.hidden) return;
    if (insp.contains(e.target as Node | null)) return;
    if (!closestOf(e, '#mode-post')) return; // sidebar/overlays: leave it open
    if (closestOf(e, '.post-card, .tag-btn')) return; // card click = swap to it; 🏷 = tag-pop for it
    if (closestOf(e, '.poster-card')) return; // poster click = swap the inspector to it (#143)
    e.preventDefault();
    e.stopPropagation();
    dismissDetail();
  }

  // A closed panel keeps no content: reopening starts from the placeholder (#244), and the
  // inspected-card ring can't outlive the panel that explains it. The size track needs no
  // poke here — the display popover computes it from the live grid width when it opens.
  panelSubscribe(() => {
    const open = panelIsOpen();
    if (!open) {
      inspectorClose();
      deps.setInspectedKey(null); // grid/poster cells clear their own ring reactively (hologramStore subscribe)
    }
    byId('postGrid').classList.toggle('insp-open', open);
  });
  function persistManual() {
    persistManualGroups(deps.getManualGroups());
  }
  // Opt a post key out of (or back into) auto-grouping — persisted in ungrouped.json.
  function setGroupKey(key: string, ungroup: boolean) {
    if (!key) return;
    deps.keepCurrentVisible(); // 複数画像のみ等のフィルタから外れても即消えしない
    const ungrouped = deps.getUngrouped();
    if (ungroup) ungrouped.add(key);
    else ungrouped.delete(key);
    persistUngrouped(ungrouped);
    closeDetail();
    deps.renderPosts(true);
    if (ungroup) deps.showToast(deps.t('ungroupDone'));
  }
  function ungroupManual(idx: number) {
    const manualGroups = deps.getManualGroups();
    if (!(idx >= 0 && idx < manualGroups.length)) return;
    deps.keepCurrentVisible();
    manualGroups.splice(idx, 1);
    persistManual();
    closeDetail();
    deps.renderPosts(true);
    deps.showToast(deps.t('ungroupDone'));
  }
  // --- Inspector tag mutations (Issue #22: editing lives in tag-pop now, not the
  // inspector) --- Source of truth = the records' real tags. Each change saves
  // immediately and refreshes the inspector's read-only tag row (not a full re-open,
  // so the image/meta don't flicker) plus, while a tag-pop is open for this same
  // card, that pop's own model (refreshTagViews, below).

  function refreshInspectorTagFields(g: HologramPostGroup | null | undefined) {
    if (!g) return;
    const tags = Array.isArray(g.rep.tags) ? g.rep.tags : [];
    const userSet = new Set(tags);
    const srcTagsView = (Array.isArray(g.rep.hashtags) ? g.rep.hashtags : []).filter((h: string) => !userSet.has(h));
    inspectorRefresh({ tags, srcTagsView });
  }

  // Apply a tag mutation to every record of the inspected group, persist immediately,
  // record undo, and refresh grid + inspector tag fields (NOT a full showDetail — so the
  // image/meta don't flicker and the input keeps focus).
  async function applyInspectorTagChange(g: HologramPostGroup | null | undefined, mutate: (prev: string[]) => string[] | null | undefined) {
    if (!g) return;
    const recs = g.records && g.records.length ? g.records : [g.rep];
    deps.keepCurrentVisible(); // removing a tag can un-match an active tag filter
    const undoRecords: HologramUndoRecord[] = [];
    for (const r of recs) {
      const prev = (r.tags || []).slice();
      const next = mutate(prev.slice());
      if (!next || sameTags(prev, next)) continue;
      try {
        await postsUpdateTags(r.image || r.video, next);
      } catch {
        /* keep going */
      }
      const rec = deps.getPostById(r.captureId); // O(1) lookup; allPosts shares the same record refs
      if (rec) rec.tags = next.slice();
      undoRecords.push({ captureId: r.captureId, image: r.image || r.video, prevTags: prev, newTags: next });
    }
    if (!undoRecords.length) return;
    deps.pushUndo('tags', undoRecords);
    deps.markPostsMutated();
    deps.renderPosts(true);
    const fresh = deps.getViewGroups().find((g2) => postIdKey(g2.rep) === deps.getInspectedKey());
    refreshTagViews(fresh);
  }

  // Push a mutated group's tags into whichever tag surfaces are showing it: the
  // inspector's read-only row (refreshInspectorTagFields) and — if tag-pop is
  // currently open for this SAME group (tagPopGet().forKey match; tag-pop.ts is a
  // singleton bridge poster-grid-builder.ts's own openTagPopForPoster also opens,
  // so the live model is the only thing both builders can agree is current) — that
  // pop's own model. Re-render in place (same openId), not a remount, so the pop's
  // input text/scroll survive.
  function refreshTagViews(fresh: HologramPostGroup | null | undefined) {
    if (!fresh) return;
    refreshInspectorTagFields(fresh);
    if (tagPopGet()?.forKey === postIdKey(fresh.rep)) {
      const tags = Array.isArray(fresh.rep.tags) ? fresh.rep.tags : [];
      tagPopRefresh({ tags, ...deps.inspectorTagPickerData(tags, fresh.records, 'post') });
    }
  }

  // Add (typed input / picker click) or toggle (picker click only) a tag on the
  // inspected group, then check for a 同名キャラ homonym ONLY when the tag was newly
  // added (matches the old setupInspectorTagEditor's addTyped / picker-pick handlers).
  async function addInspectorTag(g: HologramPostGroup, tag: string) {
    const fresh = () => deps.getViewGroups().find((gg) => postIdKey(gg.rep) === deps.getInspectedKey()) || g;
    const adding = !(fresh().rep.tags || []).includes(tag);
    await applyInspectorTagChange(fresh(), (prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    if (adding) await maybeDistinguishHomonym(fresh(), tag);
  }
  async function toggleInspectorTag(g: HologramPostGroup, tag: string) {
    const fresh = () => deps.getViewGroups().find((gg) => postIdKey(gg.rep) === deps.getInspectedKey()) || g;
    const adding = !(fresh().rep.tags || []).includes(tag);
    await applyInspectorTagChange(fresh(), (prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
    if (adding) await maybeDistinguishHomonym(fresh(), tag);
  }

  // When a キャラ tag joins a 作品-bearing card whose 作品 differs from every 作品
  // this character was seen with before, it's likely a same-name character from
  // another work. Offer the danbooru-style freeform distinction キャラ（作品）.
  // Deterministic + confirm-gated + silent until there's history (薄いうちは沈黙).
  async function maybeDistinguishHomonym(g: HologramPostGroup | null | undefined, addedTag: string) {
    if (!g || deps.tagKindOf(addedTag) !== 'character') return;
    const cardTags: string[] = g.rep && Array.isArray(g.rep.tags) ? g.rep.tags : [];
    const worksNow = cardTags.filter((t) => deps.tagKindOf(t) === 'work');
    if (!worksNow.length) return; // no 作品 context to distinguish by
    const exclude = new Set<string>((g.records || [g.rep]).map((r) => r && r.captureId).filter(Boolean));
    const past = deps.worksCooccurringWith(addedTag, exclude);
    if (!past.size) return; // no history → stay silent
    if (worksNow.some((w) => past.has(w))) return; // seen with one of these works → same character
    const work = worksNow[0];
    const distinguished = `${addedTag}（${work}）`;
    if (cardTags.includes(distinguished)) return;
    if (!window.confirm(deps.t('homonymConfirm', [addedTag, work]))) return;
    // The distinguished string stays a character (danbooru-style); record its 種別.
    if (!deps.tagKindOf(distinguished)) {
      await tagsSetTagKind(distinguished, 'character');
    }
    await applyInspectorTagChange(g, (prev) => prev.map((t) => (t === addedTag ? distinguished : t)));
    deps.showToast(deps.t('homonymDistinguished', [distinguished]));
  }

  function showDetail(g: HologramPostGroup) {
    if (!g) return;
    const p = g.rep;
    const eng: string[] = [];
    if (p.likes != null) eng.push('♡ ' + formatCount(p.likes));
    if (p.reposts != null) eng.push('⇄ ' + formatCount(p.reposts));
    if (p.replies != null) eng.push('🗨︎ ' + formatCount(p.replies));
    if (p.bookmarks != null) eng.push('🔖︎ ' + formatCount(p.bookmarks));
    if (p.views != null) eng.push('👁︎ ' + formatCount(p.views));
    // Source tags (pixiv / SNS hashtags) get their own row. User tags live in the
    // always-editable chips block (TagEditor) so they aren't repeated here. Source
    // tags already adopted into `tags` are hidden; the rest are clickable to adopt.
    const userTags = Array.isArray(p.tags) ? p.tags : [];
    const userSet = new Set(userTags);
    const srcTagsView = (Array.isArray(p.hashtags) ? p.hashtags : []).filter((h: string) => !userSet.has(h));
    // Poster row carries the locally-saved avatar (psimg://) when present, so the
    // inspector keeps its "label: value" rhythm while adding a face to the name.
    const avatarSrc = p.avatarFile ? deps.fileSrc(p.avatarFile) : null;
    // The poster exists in the poster view only for SNS posts (buildUsers skips url-less
    // migrations); when it does, the name+avatar links to it (双方向ナビ: posts ↔ posters).
    const jumpUser = p.url ? deps.buildUsers().find((u) => u.key === userKey(p)) : null;
    const heading = p.title || p.text || '';
    const thumbFile = g.files[0] || captureFile(p);
    // Reverse image search needs a PUBLIC image URL. media[].url keeps the
    // original CDN URL (pbs.twimg.com / cdn.bsky.app / instance media / pximg);
    // a screenshot-only post has none, so the search links are hidden then.
    // pixiv (i.pximg.net) is referer-gated so the fetcher may 403 — but pixiv
    // IS the source, so reverse search there is moot anyway.
    const srcImageUrl = (g.records.flatMap((r) => (Array.isArray(r.media) ? r.media : [])).find((m: { url?: string }) => m && m.url) || {}).url || '';
    // Can this card be (un)grouped? Manual groups get a dissolve link; auto groups
    // (same post URL with siblings) toggle via the persisted ungrouped set.
    const gkey = postKeyOf(p.url);
    const potential = gkey ? deps.getAllPosts().filter((q) => postKeyOf(q.url) === gkey).length : 0;
    const isManual = !!(g.key && String(g.key).indexOf('manual:') === 0);
    // ✂ also for reply-merged chains (records with DIFFERENT urls): opting the
    // rep's key out stops the self-reply merge at this parent, splitting the card.
    const groupBtn = isManual
      ? { icon: '🔗', label: deps.t('groupUngroupManual'), onClick: () => ungroupManual(Number.parseInt(String(g.key).split(':')[1], 10)) }
      : gkey && (potential > 1 || g.records.length > 1)
        ? deps.getUngrouped().has(gkey)
          ? { icon: '🔗', label: deps.t('groupRegroup'), onClick: () => setGroupKey(gkey, false) }
          : { icon: '✂', label: deps.t('groupUngroup'), onClick: () => setGroupKey(gkey, true) }
        : null;
    inspectorOpen({
      kind: 'post',
      heading,
      thumbSrc: thumbFile ? deps.fileSrc(thumbFile, 480) : null,
      onThumbClick: thumbFile ? () => deps.openQuickView(g) : null,
      platformLabel: (p.platform || '').toUpperCase(),
      avatarSrc,
      authorName: p.displayName || '',
      jumpable: !!jumpUser,
      screenNameLabel: p.screenName ? '@' + p.screenName : '',
      followersLabel: p.followers != null ? formatCount(p.followers) : '',
      joinedLabel: localeDate(p.authorCreatedAt),
      engagementLabel: eng.join('   '),
      postedLabel: localeDateTime(p.date),
      savedLabel: localeDateTime(p.capturedAt),
      updatedLabel: localeDateTime(p.updatedAt),
      imagesLabel: g.files.length > 1 ? deps.t('imagesCount', [g.files.length]) : '',
      imageOfLabel: p.imageIndex && p.imageCount ? deps.t('imageOf', [p.imageIndex, p.imageCount]) : '',
      tags: userTags,
      srcTagsView,
      groupBtn,
      labels: {
        platform: deps.t('detailPlatform'),
        author: deps.t('detailAuthor'),
        user: deps.t('detailUser'),
        followers: deps.t('detailFollowers'),
        joined: deps.t('detailJoined'),
        engagement: deps.t('detailEngagement'),
        posted: deps.t('detailPosted'),
        saved: deps.t('detailSaved'),
        updated: deps.t('detailUpdated'),
        images: deps.t('detailImages'),
        imageOf: deps.t('detailImageOf'),
        tags: deps.t('detailTags'),
        tagsEmpty: deps.t('tagsEmpty'),
        editTags: deps.t('tipEditTags'),
        sourceTags: deps.t('detailSourceTags'),
        viewPoster: deps.t('ctxViewPoster'),
        open: deps.t('detailOpen'),
        sauce: deps.t('detailSauce'),
        ascii: deps.t('detailAscii'),
      },
      onClose: closeDetail,
      onOpenExternal: p.url ? () => hologramIpc.openExternal(p.url) : null,
      onSauce: srcImageUrl ? () => hologramIpc.openExternal('https://saucenao.com/search.php?url=' + encodeURIComponent(srcImageUrl)) : null,
      onAscii: srcImageUrl ? () => hologramIpc.openExternal('https://ascii2d.net/search/url/' + encodeURIComponent(srcImageUrl)) : null,
      onPosterJump: jumpUser ? () => deps.jumpToPoster(p) : null,
      onTagContextMenu: (tag: string, x: number, y: number) => {
        deps.showKindMenu(tag, x, y, () => {
          const g2 = deps.getViewGroups().find((gg) => postIdKey(gg.rep) === deps.getInspectedKey());
          if (g2) refreshInspectorTagFields(g2);
        });
      },
      onEditTags: (anchorRect: HologramAnchorRect) => openTagPopForGroup(g, anchorRect),
    });
    // Selecting a card fills the panel; it does NOT open one the user has closed (#243).
    // The visibility-linked chrome (insp-open, the tile track) therefore isn't touched
    // here — it follows the panel store, not the content.
    //
    // Ring-mark the inspected card so swapping content stays traceable — the grid
    // cell derives its own ring reactively (hologramStore subscribe), so no manual
    // DOM classList reach-in / repaint() is needed here.
    deps.setInspectedKey(postIdKey(p));
  }

  // Tag picker pop (Issue #22) opened straight from a card's 🏷 — a lighter-weight
  // route to the SAME tag mutations as the always-live inspector editor (single =
  // immediate save + undo), without opening the full detail panel. Ring-marks the
  // card via setInspectedKey (same as showDetail) so addInspectorTag/
  // applyInspectorTagChange's "fresh" re-lookup keeps working unchanged, and so the
  // grid shows which card is being tag-edited.
  // Guarded by forKey (not called unconditionally): if a DIFFERENT open() already
  // superseded this one (poster-grid-builder.ts's openTagPopForPoster opens the
  // SAME singleton bridge), this dismiss is stale — do nothing, the new owner is
  // responsible for its own close.
  function dismissTagPopFor(key: string) {
    if (tagPopGet()?.forKey !== key) return;
    tagPopClose();
    // Only drop the ring if the full inspector isn't ALSO showing this card —
    // closing the pop shouldn't blank out an independently-open detail panel.
    if (!panelIsOpen()) deps.setInspectedKey(null);
  }
  function openTagPopForGroup(g: HologramPostGroup, anchorRect: HologramAnchorRect) {
    if (!g) return;
    const key = postIdKey(g.rep);
    if (tagPopGet()?.forKey === key) {
      dismissTagPopFor(key); // re-click the same card's 🏷 → close (ℹ button's toggle shape)
      return;
    }
    deps.setInspectedKey(key);
    const tags = Array.isArray(g.rep.tags) ? g.rep.tags : [];
    tagPopOpen({
      anchorRect,
      mode: 'single',
      forKey: key,
      tags,
      ...deps.inspectorTagPickerData(tags, g.records, 'post'),
      tagLabels: tagLabels(),
      onTagAdd: (tag: string) => addInspectorTag(g, tag),
      onTagRemove: (tag: string) => applyInspectorTagChange(g, (prev) => prev.filter((t) => t !== tag)),
      onTagToggle: (tag: string) => toggleInspectorTag(g, tag),
      onTagContextMenu: (tag: string, x: number, y: number) => {
        deps.showKindMenu(tag, x, y, () => {
          const g2 = deps.getViewGroups().find((gg) => postIdKey(gg.rep) === deps.getInspectedKey());
          refreshTagViews(g2);
        });
      },
      onDismiss: () => dismissTagPopFor(key),
    });
  }

  // Esc leaves the image-tab detail view (Eagle-style), and — since #259 — also waves away
  // the inspector while it is a narrow-width OVERLAY. It still does not touch the docked
  // column: #244 scoped Esc to transient surfaces (quick view / popovers / modals) because
  // a persistent panel is not something Esc dismisses in any product that has one, and
  // #143/#242 ruled Esc out as a way to clear the selection. Closing the column is the
  // toggle, the ×, or #245's bulk shortcut. What changed is that the panel now has a
  // transient form too, and in that form the rule it was exempted from applies.
  //
  // Still registered in CAPTURE phase (from the DetailDismiss component in
  // app/islands/app/App.tsx) so it can check what else is open BEFORE those handlers
  // dismiss themselves on the same press — the transient surfaces win this Esc, and only
  // once nothing is left does the detail view close.
  function handleEscDismissDetail(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (lightboxIsOpen()) return;
    if (settingsIsOpen()) return;
    if (!byId('ivFolderModal').hidden) return;
    if (confirmGet()) return;
    if (menuGet() || kindMenuGet()) return;
    if (tagPopGet()) return; // let an open tag-pop take the first Esc
    if (isAnySelectOpen()) return; // …and an open shadcn Select (display popover / filter editors), tracked by state not DOM
    if (deps.imageTabShowing()) {
      deps.closeTab(deps.getActiveTabId());
      return;
    }
    // Narrow overlay only (#259). Something laid OVER the grid is expected to answer Esc,
    // and the pre-#243 slide-over did. The docked column still does not: #143/#242 ruled
    // Esc out there, where it would dismiss nothing the user can see covering anything.
    if (!isWideLayout() && !byId('postDetail').hidden) dismissDetail();
  }

  return {
    closeDetail,
    showDetail,
    persistManual,
    openTagPopForGroup,
    handleEscDismissDetail,
    handleOutsideClickDismissDetail,
  };
}
