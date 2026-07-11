// Post-inspector (persistent right-column detail panel) builder — extracted from
// viewer.ts as the viewer.ts decomposition's V7 slice (see memory
// corpus-react-purity-execution-map, Wave21/V7 "インスペクター"). Mirrors
// post-grid-builder.ts (V5) / poster-grid-builder.ts (V6): open/close chrome,
// the always-live inline tag editor (add/toggle/adopt-source-tag + the 同名キャラ
// homonym check), the group dissolve/regroup buttons shown in the panel, and the
// Esc/outside-click dismiss guards all move here. inspector.ts (Wave3, the
// open/refresh/close/get/subscribe bridge to the React island) stays untouched —
// this module is one of its two consumers (Inspector.tsx is the other).
// inspectedKey/setInspectedKey stay viewer.ts-owned (many not-yet-extracted
// clusters — poster card clicks, undo, browse-mode switch — read/write it too;
// same "shared cross-cutting state stays at the call site, builder takes a
// getter/setter dep" shape as posterReturn in poster-grid-builder.ts).
import { userKey } from './query.ts';
import { formatCount, localeDate, localeDateTime } from './format.ts';
import { open as inspectorOpen, refresh as inspectorRefresh, close as inspectorClose } from './inspector.ts';
import { postIdKey, postKeyOf, captureFile, persistManualGroups, persistUngrouped } from './records.ts';
import { sameTags, setTagKind as tagsSetTagKind } from './tags.ts';
import { updateTags as postsUpdateTags } from './posts.ts';
import { get as filterPopoverGet } from './filter-popover.ts';
import { corpusIpc } from './ipc.ts';

export interface InspectorBuilderDeps {
  MSG: { [k: string]: any };
  fileSrc(file: string, w?: number): string;
  showToast(msg: unknown): void;
  showKindMenu(tag: string, x: number, y: number, onChange: () => void): void;
  buildUsers(): CorpusUserAgg[];
  tagKindOf(tag: string): string | null | undefined;
  worksCooccurringWith(tag: string, exclude: Set<string>): Set<string>;
  jumpToPoster(post: CorpusPost): void;
  pushUndo(kind: string, records: CorpusUndoRecord[]): void;
  inspectorTagPickerData(tags: string[], recordsForSource: any[], kind: string): any;
  getViewGroups(): CorpusPostGroup[];
  getAllPosts(): CorpusPost[];
  getPostById(id: string): CorpusPost | undefined;
  getUngrouped(): Set<string>;
  getManualGroups(): string[][];
  markPostsMutated(): void;
  renderPosts(keepLimit?: boolean): void;
  keepCurrentVisible(): void;
  // inspectedKey stays a viewer.ts `let` (read/written outside this cluster too) —
  // this module only gets the accessor pair, same shape as posterReturn above.
  getInspectedKey(): string | null;
  setInspectedKey(key: string | null): void;
  refreshTileSlider(): void;
  getActiveTabId(): string | null;
  closeTab(id: string | null | undefined): void;
  // imageTabShowing is a viewer.ts `let` (image-tab.ts consumer, V13/Wave27) — a
  // getter since its value changes over the module's lifetime.
  imageTabShowing(): boolean;
}

export function makeInspector(deps: InspectorBuilderDeps) {
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const closestOf = (e: Event, sel: string) => {
    const t = e.target as HTMLElement | null;
    return t instanceof Element ? (t.closest(sel) as HTMLElement | null) : null;
  };

  // === Inspector (ℹ on a card): persistent right column / slide-over ===
  function closeDetail() {
    byId('postDetail').hidden = true;
    inspectorClose();
    deps.setInspectedKey(null); // grid/poster cells clear their own ring reactively (corpusStore subscribe)
    byId('postGrid').classList.remove('insp-open');
    deps.refreshTileSlider(); // the grid width grew back — re-derive the track
  }
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
    if (ungroup) deps.showToast(deps.MSG.ungroupDone);
  }
  function ungroupManual(idx: number) {
    const manualGroups = deps.getManualGroups();
    if (!(idx >= 0 && idx < manualGroups.length)) return;
    deps.keepCurrentVisible();
    manualGroups.splice(idx, 1);
    persistManual();
    closeDetail();
    deps.renderPosts(true);
    deps.showToast(deps.MSG.ungroupDone);
  }
  // --- Inspector inline tag editor (always available while the inspector is open) ---
  // Source of truth = the records' real tags. Each change saves immediately (mirrors
  // adoptSourceTag) and refreshes only the tag fields of the inspector.ts model (not
  // a full re-open) — the React tag editor keeps its own input text/focus and scroll
  // across a refresh (same openId). The chips + picker live in the panel itself — tag
  // editing is per-card here, no mode to enter (matches the poster inspector).

  function refreshInspectorTagFields(g: CorpusPostGroup | null | undefined) {
    if (!g) return;
    const tags = Array.isArray(g.rep.tags) ? g.rep.tags : [];
    const userSet = new Set(tags);
    const srcTagsView = (Array.isArray(g.rep.hashtags) ? g.rep.hashtags : []).filter((h: string) => !userSet.has(h));
    inspectorRefresh({ tags, srcTagsView, ...deps.inspectorTagPickerData(tags, g.records, 'post') });
  }

  // Apply a tag mutation to every record of the inspected group, persist immediately,
  // record undo, and refresh grid + inspector tag fields (NOT a full showDetail — so the
  // image/meta don't flicker and the input keeps focus).
  async function applyInspectorTagChange(g: CorpusPostGroup | null | undefined, mutate: (prev: string[]) => string[] | null | undefined) {
    if (!g) return;
    const recs = g.records && g.records.length ? g.records : [g.rep];
    deps.keepCurrentVisible(); // removing a tag can un-match an active tag filter
    const undoRecords: CorpusUndoRecord[] = [];
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
    if (fresh) refreshInspectorTagFields(fresh);
  }

  // Add (typed input / picker click) or toggle (picker click only) a tag on the
  // inspected group, then check for a 同名キャラ homonym ONLY when the tag was newly
  // added (matches the old setupInspectorTagEditor's addTyped / picker-pick handlers).
  async function addInspectorTag(g: CorpusPostGroup, tag: string) {
    const fresh = () => deps.getViewGroups().find((gg) => postIdKey(gg.rep) === deps.getInspectedKey()) || g;
    const adding = !(fresh().rep.tags || []).includes(tag);
    await applyInspectorTagChange(fresh(), (prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    if (adding) await maybeDistinguishHomonym(fresh(), tag);
  }
  async function toggleInspectorTag(g: CorpusPostGroup, tag: string) {
    const fresh = () => deps.getViewGroups().find((gg) => postIdKey(gg.rep) === deps.getInspectedKey()) || g;
    const adding = !(fresh().rep.tags || []).includes(tag);
    await applyInspectorTagChange(fresh(), (prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
    if (adding) await maybeDistinguishHomonym(fresh(), tag);
  }

  // When a キャラ tag joins a 作品-bearing card whose 作品 differs from every 作品
  // this character was seen with before, it's likely a same-name character from
  // another work. Offer the danbooru-style freeform distinction キャラ（作品）.
  // Deterministic + confirm-gated + silent until there's history (薄いうちは沈黙).
  async function maybeDistinguishHomonym(g: CorpusPostGroup | null | undefined, addedTag: string) {
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
    if (!window.confirm(deps.MSG.homonymConfirm(addedTag, work))) return;
    // The distinguished string stays a character (danbooru-style); record its 種別.
    if (!deps.tagKindOf(distinguished)) {
      await tagsSetTagKind(distinguished, 'character');
    }
    await applyInspectorTagChange(g, (prev) => prev.map((t) => (t === addedTag ? distinguished : t)));
    deps.showToast(deps.MSG.homonymDistinguished(distinguished));
  }

  function showDetail(g: CorpusPostGroup) {
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
      ? { icon: '🔗', label: deps.MSG.groupUngroupManual, onClick: () => ungroupManual(Number.parseInt(String(g.key).split(':')[1], 10)) }
      : gkey && (potential > 1 || g.records.length > 1)
        ? deps.getUngrouped().has(gkey)
          ? { icon: '🔗', label: deps.MSG.groupRegroup, onClick: () => setGroupKey(gkey, false) }
          : { icon: '✂', label: deps.MSG.groupUngroup, onClick: () => setGroupKey(gkey, true) }
        : null;
    inspectorOpen({
      kind: 'post',
      heading,
      thumbSrc: thumbFile ? deps.fileSrc(thumbFile, 480) : null,
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
      imagesLabel: g.files.length > 1 ? deps.MSG.imagesCount(g.files.length) : '',
      imageOfLabel: p.imageIndex && p.imageCount ? deps.MSG.imageOf(p.imageIndex, p.imageCount) : '',
      tags: userTags,
      srcTagsView,
      groupBtn,
      ...deps.inspectorTagPickerData(userTags, g.records, 'post'),
      labels: {
        platform: deps.MSG.detailPlatform,
        author: deps.MSG.detailAuthor,
        user: deps.MSG.detailUser,
        followers: deps.MSG.detailFollowers,
        joined: deps.MSG.detailJoined,
        engagement: deps.MSG.detailEngagement,
        posted: deps.MSG.detailPosted,
        saved: deps.MSG.detailSaved,
        updated: deps.MSG.detailUpdated,
        images: deps.MSG.detailImages,
        imageOf: deps.MSG.detailImageOf,
        sourceTags: deps.MSG.detailSourceTags,
        tipAdoptTag: deps.MSG.tipAdoptTag,
        viewPoster: deps.MSG.ctxViewPoster,
        open: deps.MSG.detailOpen,
        sauce: deps.MSG.detailSauce,
        ascii: deps.MSG.detailAscii,
      },
      tagLabels: {
        tagsLabel: deps.MSG.detailTags,
        newTagPlaceholder: deps.MSG.tagNewName,
        addBtn: deps.MSG.tagAddBtn,
        noTags: deps.MSG.editNoTags,
        noMatch: deps.MSG.tagPalNoMatch,
        noVocab: deps.MSG.tagNoTags,
        adoptSource: deps.MSG.editAdoptSource,
      },
      onClose: closeDetail,
      onOpenExternal: p.url ? () => corpusIpc.openExternal(p.url) : null,
      onSauce: srcImageUrl ? () => corpusIpc.openExternal('https://saucenao.com/search.php?url=' + encodeURIComponent(srcImageUrl)) : null,
      onAscii: srcImageUrl ? () => corpusIpc.openExternal('https://ascii2d.net/search/url/' + encodeURIComponent(srcImageUrl)) : null,
      onPosterJump: jumpUser ? () => deps.jumpToPoster(p) : null,
      onAdoptSourceTag: (tag: string) => adoptSourceTag(g, tag),
      onTagAdd: (tag: string) => addInspectorTag(g, tag),
      onTagRemove: (tag: string) => applyInspectorTagChange(g, (prev) => prev.filter((t) => t !== tag)),
      onTagToggle: (tag: string) => toggleInspectorTag(g, tag),
      onTagContextMenu: (tag: string, x: number, y: number) => {
        deps.showKindMenu(tag, x, y, () => {
          const g2 = deps.getViewGroups().find((gg) => postIdKey(gg.rep) === deps.getInspectedKey());
          if (g2) refreshInspectorTagFields(g2);
        });
      },
    });
    byId('postDetail').hidden = false;
    // While open, a card click swaps the panel (not zoom) → plain pointer.
    byId('postGrid').classList.add('insp-open');
    // Ring-mark the inspected card so swapping content stays traceable — the grid
    // cell derives its own ring reactively (corpusStore subscribe), so no manual
    // DOM classList reach-in / repaint() is needed here.
    deps.setInspectedKey(postIdKey(p));
    deps.refreshTileSlider(); // inline column narrows the grid — re-derive the track
  }

  // Promote a source tag (pixiv / SNS hashtag) into a user tag on every record of
  // the inspected group. Persisted + undoable, mirroring the edit overlay's save.
  async function adoptSourceTag(g: CorpusPostGroup, tag: string) {
    if (!tag) return;
    const recs = g.records && g.records.length ? g.records : [g.rep];
    const undoRecords: CorpusUndoRecord[] = [];
    for (const r of recs) {
      const prev = (r.tags || []).slice();
      if (prev.includes(tag)) continue;
      const newTags = [...prev, tag];
      try {
        await postsUpdateTags(r.image || r.video, newTags);
      } catch {
        /* keep going */
      }
      const rec = deps.getPostById(r.captureId); // O(1) lookup; allPosts shares the same record refs
      if (rec) rec.tags = newTags.slice();
      undoRecords.push({ captureId: r.captureId, image: r.image || r.video, prevTags: prev, newTags });
    }
    if (!undoRecords.length) return; // all records already had it
    deps.pushUndo('tags', undoRecords);
    deps.markPostsMutated();
    deps.renderPosts(true);
    const fresh = deps.getViewGroups().find((g2) => postIdKey(g2.rep) === deps.getInspectedKey());
    if (fresh) showDetail(fresh);
    deps.showToast(deps.MSG.tagAdopted(tag));
  }
  // Esc closes the inspector — registered in CAPTURE phase so it can check
  // what else is open BEFORE those handlers dismiss themselves on the same
  // press (lightbox/popovers/modals win the first Esc, the panel the next).
  // Registration lives in the DetailDismiss component (app/islands/app/App.tsx);
  // this stays the handler + guard logic (viewer keeps the orchestration).
  function handleEscDismissDetail(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    const inImageTab = deps.imageTabShowing();
    if (byId('postDetail').hidden && !inImageTab) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (window.corpusLightbox && window.corpusLightbox.isOpen()) return;
    if (window.corpusSettings && window.corpusSettings.isOpen()) return;
    if (!byId('ivFolderModal').hidden) return;
    if (document.querySelector('.confirm-overlay.show')) return;
    if (document.querySelector('.fold-menu.show')) return;
    if (filterPopoverGet()) return;
    if (inImageTab) {
      deps.closeTab(deps.getActiveTabId()); // Esc leaves the detail view (Eagle-style) — the inspector is part of it
      return;
    }
    closeDetail();
  }
  // Slide-over mode (narrow window): the panel covers the grid, so it acts
  // like a scrim-less drawer — ANY click outside it inside the content area
  // (cards and grid included) dismisses it, and the click is consumed so the
  // card doesn't also react on the same press. ℹ buttons stay live as the
  // explicit "show this one instead" entry. Inline mode (wide) keeps clicks:
  // cards swap the content there since the panel covers nothing. Also
  // registered from DetailDismiss, in CAPTURE phase like the Esc handler above.
  function handleOutsideClickDismissDetail(e: MouseEvent) {
    const insp = byId('postDetail');
    if (insp.hidden) return;
    if (!matchMedia('(max-width: 1279px)').matches) return;
    if (insp.contains(e.target as Node | null)) return;
    if (!closestOf(e, '#mode-post')) return; // sidebar/overlays: leave it open
    if (closestOf(e, '.info-btn, .tag-btn')) return; // ℹ/🏷 = swap to that card
    if (closestOf(e, '.poster-card')) return; // poster click = go to that poster's posts
    e.preventDefault();
    e.stopPropagation();
    closeDetail();
  }

  return {
    closeDetail,
    showDetail,
    persistManual,
    handleEscDismissDetail,
    handleOutsideClickDismissDetail,
  };
}
