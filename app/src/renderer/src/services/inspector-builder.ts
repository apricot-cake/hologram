// Post-inspector (persistent right-column detail panel) builder — extracted from
// the old viewer.ts monolith. Mirrors post-grid-builder.ts / poster-grid-builder.ts:
// open/close chrome, the always-live inline tag editor (add/toggle/adopt-source-tag
// + the 同名キャラ homonym check), the group dissolve/regroup buttons shown in the
// panel, and the Esc/outside-click dismiss guards all move here. inspector.ts (the
// open/refresh/close/get/subscribe bridge to the React component) stays untouched —
// this module is one of its two consumers (Inspector.tsx is the other).
// inspectedKey/setInspectedKey stay viewer.ts-owned (many not-yet-extracted
// clusters — poster card clicks, undo, browse-mode switch — read/write it too;
// same "shared cross-cutting state stays at the call site, builder takes a
// getter/setter dep" shape as posterReturn in poster-grid-builder.ts).
import { hostOf, userKey } from './query.ts';
import { posterProfileUrl } from './profile-url.ts';
import { formatCount, localeDate, localeDateTime } from './format.ts';
import { open as inspectorOpen, refresh as inspectorRefresh, close as inspectorClose } from './inspector.ts';
import { isOpen as panelIsOpen, isVisible as panelIsVisible, panelContains, setOpen as panelSetOpen, subscribe as panelSubscribe } from './inspector-panel.ts';
import { isWide as isWideLayout } from './layout-mode.ts';
import { get as confirmGet, open as confirmOpen } from './confirm.ts';
import { get as kindMenuGet } from './kind-menu.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { get as menuGet } from './menu.ts';
import { isAnySelectOpen } from './open-select-registry.ts';
import { subscribe as subscribePostsData } from './posts-data.ts';
import { postIdKey, postKeyOf, captureFile, persistManualGroups, persistUngrouped } from './records.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { sameTags, setTagKind as tagsSetTagKind } from './tags.ts';
import { updateTags as postsUpdateTags } from './posts.ts';
import { hologramIpc } from './ipc.ts';
import type { UndoChange } from './undo.ts';

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
  pushUndo(changes: readonly UndoChange[]): (() => void) | null;
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
  const closestOf = (e: Event, sel: string) => {
    const t = e.target as HTMLElement | null;
    return t instanceof Element ? (t.closest(sel) as HTMLElement | null) : null;
  };
  // Strings for the inspector's inline tag field (showDetail, below).
  function tagLabels() {
    return {
      tagsLabel: deps.t('detailTags'),
      newTagPlaceholder: deps.t('tagNewName'),
      addBtn: deps.t('tagAddBtn'),
      noTags: deps.t('editNoTags'),
      noMatch: deps.t('tagPalNoMatch'),
      noVocab: deps.t('tagNoTags'),
      adoptSource: deps.t('editAdoptSource'),
      removeTag: deps.t('tagRemove'),
    };
  }
  // === Inspector: the persistent right column ===
  //
  // Visibility belongs to the user now (#243), so it lives in the inspector-panel store
  // rather than in a `hidden` poke from here. Closing means asking the store; everything
  // that has to happen ALONGSIDE a visibility change is done by the subscriber below, so
  // the shell toggle and the panel's own × produce identical results.
  //
  // This is the STORED preference — "I don't want this panel", surviving restarts. Only
  // two things may say that: the shell toggle, and the × of a DOCKED column, where there
  // is no other way to get the column off the screen.
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

  // === The inspected subject has to keep existing (#633) ===
  //
  // The panel's content is a SNAPSHOT: showDetail() reads a group once and pushes a
  // finished model through inspector.ts. The library underneath it is live, so a subject
  // that stops existing left the panel answering for a record that is gone — with its
  // inline tag editor still writing to it. The image view made that visible because its
  // stage IS live (services/image-tab.ts resolves the group against the library on every
  // notify): the picture fell to「ライブラリにありません」while the column beside it kept
  // showing the post.
  //
  // ONE place asks the question, for every way a subject can vanish — the same move #617
  // made for "is the panel on screen" (isVisible) and #619 for "is the image view showing"
  // (isActive). Before this, each delete path had to remember on its own: the card menu's
  // delete did, the floating bar's bulk delete did not, and neither did the library wipe,
  // the ZIP import's 置換, or anything else that can drop a record. Deletion is not the
  // interesting event — DISAPPEARANCE is, and posts-data.ts is where the library announces
  // it (markPostsMutated is the single choke point every mutation already goes through).
  //
  // What it lands on is dismissDetail(), not a new "this post was deleted" panel state:
  // the inspector is defined as the detail OF a selection (#143/#244), so with the subject
  // gone there is no selection, and the placeholder that already means that is the honest
  // answer. A second「削除されました」empty state would also say what the stage is already
  // saying, one column over.
  function inspectedSubjectExists(key: string): boolean {
    // Poster keys are the roll-up's own (poster-grid-builder stamps 'poster:' + u.key);
    // a poster exists exactly as long as one of its posts does, which is what buildUsers
    // recomputes (cached behind the library generation, so this costs nothing extra on a
    // notify that already invalidated it).
    if (key.indexOf('poster:') === 0) {
      const uk = key.slice('poster:'.length);
      return deps.buildUsers().some((u) => u.key === uk);
    }
    // postIdKey IS the captureId for every stored record, so the map lookup answers in
    // O(1); the scan is only reached for the url|capturedAt fallback key, and for a
    // record that really has gone (once per deletion, alongside the array rebuild).
    if (deps.getPostById(key)) return true;
    return deps.getAllPosts().some((p) => postIdKey(p) === key);
  }
  subscribePostsData(() => {
    const key = deps.getInspectedKey();
    if (key == null || inspectedSubjectExists(key)) return;
    dismissDetail();
  });

  // The panel's own × takes whichever meaning its CURRENT form gives it. Docked, × is the
  // only way off the screen, so it stores the preference. As an overlay it sits beside Esc
  // and the outside-click, which both already dismiss without storing anything — and the ×
  // is the most obvious of the three, so having it alone disable the panel for good was
  // exactly the trap dismissDetail's comment describes. Reported from use (2026-07-27):
  // after one × on a narrow window, clicking cards stopped opening the inspector at all
  // and only the tab-band toggle brought it back.
  function closeOrDismissDetail() {
    if (isWideLayout()) closeDetail();
    else dismissDetail();
  }
  // Outside-click dismissal for the narrow overlay. Restored from the pre-#243 handler,
  // with one change: the width test asks layout-mode instead of carrying its own
  // `max-width` media query, so there is a single place the breakpoint lives.
  //
  // This is NOT the background-click path of #242 — that one lives in the grid's own
  // press recognizer (_shared/VirtualGrid.tsx), because only the recognizer knows
  // whether a press became a drag, and it calls dismissDetail() at BOTH widths. The two
  // overlap on a plain narrow background click and dismissDetail() is idempotent, so the
  // result is the same either way. They deliberately part on the presses #242 excludes
  // (a held Ctrl/Shift, a finished marquee): those still dismiss the narrow OVERLAY,
  // which rides on nothing but "is something covering the grid" — waving an overlay away
  // is not a selection act, and the docked column at wide width has nothing to wave away.
  function handleOutsideClickDismissDetail(e: MouseEvent) {
    if (isWideLayout()) return; // wide = a docked column; nothing to dismiss
    if (!panelIsVisible()) return;
    if (panelContains(e.target)) return;
    if (!closestOf(e, '#mode-post')) return; // sidebar/overlays: leave it open
    if (closestOf(e, '[data-slot="post-card"], [data-slot="poster-card"]')) return; // a cell click = swap the inspector to it (#143)
    e.preventDefault();
    e.stopPropagation();
    dismissDetail();
  }

  // A closed panel keeps no content: reopening starts from the placeholder (#244), and the
  // inspected-card ring can't outlive the panel that explains it. The size track needs no
  // poke here — the display popover computes it from the live grid width when it opens.
  //
  // The visibility-linked grid chrome used to be toggled from here too, as a classList
  // reach-in on #postGrid; the shell renders it as a data attribute now (P2⑦ / #153 ④),
  // so this subscriber is left with only the state it owns.
  panelSubscribe(() => {
    if (panelIsOpen()) return;
    inspectorClose();
    deps.setInspectedKey(null); // grid/poster cells clear their own ring reactively (hologramStore subscribe)
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
    dismissDetail(); // the inspected group stops existing here; that is not 'panel off'
    deps.renderPosts(true);
    if (ungroup) deps.showToast(deps.t('ungroupDone'));
  }
  function ungroupManual(idx: number) {
    const manualGroups = deps.getManualGroups();
    if (!(idx >= 0 && idx < manualGroups.length)) return;
    deps.keepCurrentVisible();
    manualGroups.splice(idx, 1);
    persistManual();
    dismissDetail(); // as above — regrouping loses the subject, not the panel
    deps.renderPosts(true);
    deps.showToast(deps.t('ungroupDone'));
  }
  // --- Inspector tag mutations (P2⑦: editing is the panel's own inline field) ---
  // Source of truth = the records' real tags. Each change saves immediately and
  // refreshes only the panel's tag fields (not a full re-open, so the image/meta
  // don't flicker and the field keeps focus).

  function refreshInspectorTagFields(g: HologramPostGroup | null | undefined) {
    if (!g) return;
    const tags = Array.isArray(g.rep.tags) ? g.rep.tags : [];
    const userSet = new Set(tags);
    const srcTagsView = (Array.isArray(g.rep.hashtags) ? g.rep.hashtags : []).filter((h: string) => !userSet.has(h));
    // The picker data is derived from the current tags (co-occurrence tiers, which
    // source tags are still un-adopted), so it has to travel with them — a refresh
    // that moved only `tags` would leave the suggestions describing the previous state.
    inspectorRefresh({ tags, srcTagsView, ...deps.inspectorTagPickerData(tags, g.records, 'post') });
  }

  // Apply a tag mutation to every record of the inspected group, persist immediately,
  // record undo, and refresh grid + inspector tag fields (NOT a full showDetail — so the
  // image/meta don't flicker and the input keeps focus).
  async function applyInspectorTagChange(g: HologramPostGroup | null | undefined, mutate: (prev: string[]) => string[] | null | undefined) {
    if (!g) return;
    const recs = g.records && g.records.length ? g.records : [g.rep];
    deps.keepCurrentVisible(); // removing a tag can un-match an active tag filter
    const changes: UndoChange[] = [];
    for (const r of recs) {
      const prev: string[] = (r.tags || []).slice();
      const next = mutate(prev.slice());
      if (!next || sameTags(prev, next)) continue;
      try {
        await postsUpdateTags(r.image || r.video, next);
      } catch {
        /* keep going */
      }
      const rec = deps.getPostById(r.captureId); // O(1) lookup; allPosts shares the same record refs
      if (rec) rec.tags = next.slice();
      // The recorded change is the difference, not the two lists (#235).
      changes.push({
        kind: 'post-tags',
        target: r.captureId,
        image: r.image || r.video,
        added: next.filter((tag) => !prev.includes(tag)),
        removed: prev.filter((tag) => !next.includes(tag)),
      });
    }
    if (!changes.length) return;
    deps.pushUndo(changes);
    deps.markPostsMutated();
    deps.renderPosts(true);
    const fresh = deps.getViewGroups().find((g2) => postIdKey(g2.rep) === deps.getInspectedKey());
    refreshInspectorTagFields(fresh);
  }

  // Every tag mutation has to start from the CURRENT group, not the one captured
  // when the panel was opened: renderPosts rebuilds the view groups after each
  // change, so a captured group's records go stale as soon as one edit lands. A
  // second edit computed from stale tags writes the wrong set — removing a tag
  // from a card that had gained one in between would drop both, because the stale
  // `prev` never had the newer tag in it.
  const freshGroup = (g: HologramPostGroup) => deps.getViewGroups().find((gg) => postIdKey(gg.rep) === deps.getInspectedKey()) || g;

  // Add (typed input / picker click) or toggle (picker click only) a tag on the
  // inspected group, then check for a 同名キャラ homonym ONLY when the tag was newly
  // added (only a new tag can be a homonym of a character already in the vocabulary).
  async function addInspectorTag(g: HologramPostGroup, tag: string) {
    const adding = !(freshGroup(g).rep.tags || []).includes(tag);
    await applyInspectorTagChange(freshGroup(g), (prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    if (adding) maybeDistinguishHomonym(freshGroup(g), tag);
  }
  async function removeInspectorTag(g: HologramPostGroup, tag: string) {
    await applyInspectorTagChange(freshGroup(g), (prev) => prev.filter((t) => t !== tag));
  }

  // When a キャラ tag joins a 作品-bearing card whose 作品 differs from every 作品
  // this character was seen with before, it's likely a same-name character from
  // another work. Offer the danbooru-style freeform distinction キャラ（作品）.
  // Deterministic + confirm-gated + silent until there's history (薄いうちは沈黙).
  function maybeDistinguishHomonym(g: HologramPostGroup | null | undefined, addedTag: string) {
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
    // The shared AlertDialog (confirm.ts), not window.confirm — the native one is a
    // BLOCKING call, which is why this used to read as a straight `if`. The rename is
    // the dialog's onOk continuation instead; nothing downstream waits on it (the one
    // caller, the inspector's onTagAdd, doesn't await either). Not destructive — it
    // renames a tag you just typed — so the OK button keeps the default variant.
    confirmOpen({
      message: deps.t('homonymConfirm', [addedTag, work]),
      okLabel: deps.t('promptOk'),
      cancelLabel: deps.t('confirmCancel'),
      okDestructive: false,
      onOk: async () => {
        // The distinguished string stays a character (danbooru-style); record its 種別.
        if (!deps.tagKindOf(distinguished)) {
          await tagsSetTagKind(distinguished, 'character');
        }
        await applyInspectorTagChange(g, (prev) => prev.map((t) => (t === addedTag ? distinguished : t)));
        deps.showToast(deps.t('homonymDistinguished', [distinguished]));
      },
    });
  }

  // opts.focusTags: open the panel with the caret already in the tag field. It is
  // the card context menu's タグを編集 route — the replacement for the card's 🏷
  // button, which used to open a popover of its own (P2⑦). A plain card click must
  // never take focus, so this is per-open rather than a property of the panel.
  //
  // It is also the one route here that OPENS a closed panel, and the exception proves
  // #243's rule rather than breaking it: selecting a card is not a request for the panel,
  // but invoking a command that only exists inside it is. Without this, タグを編集 on a
  // closed panel silently did nothing — it filled a surface the user could not see. Eagle
  // and Lightroom reveal their inspector for the same reason.
  function showDetail(g: HologramPostGroup, opts?: { focusTags?: boolean }) {
    if (!g) return;
    if (opts && opts.focusTags) panelSetOpen(true);
    const p = g.rep;
    const eng: string[] = [];
    if (p.likes != null) eng.push('♡ ' + formatCount(p.likes));
    if (p.reposts != null) eng.push('⇄ ' + formatCount(p.reposts));
    if (p.replies != null) eng.push('🗨︎ ' + formatCount(p.replies));
    if (p.bookmarks != null) eng.push('🔖︎ ' + formatCount(p.bookmarks));
    if (p.views != null) eng.push('👁︎ ' + formatCount(p.views));
    // Source tags (pixiv / SNS hashtags) get their own row. User tags live in the
    // panel's inline tag field so they aren't repeated here. Source
    // tags already adopted into `tags` are hidden; the rest are clickable to adopt.
    const userTags = Array.isArray(p.tags) ? p.tags : [];
    const userSet = new Set(userTags);
    const srcTagsView = (Array.isArray(p.hashtags) ? p.hashtags : []).filter((h: string) => !userSet.has(h));
    // Poster row carries the locally-saved avatar (asset://) when present, so the
    // inspector keeps its "label: value" rhythm while adding a face to the name.
    const avatarSrc = p.avatarFile ? deps.fileSrc(p.avatarFile) : null;
    // The poster exists in the poster view only for SNS posts (buildUsers skips url-less
    // migrations); when it does, the name+avatar links to it (双方向ナビ: posts ↔ posters).
    const jumpUser = p.url ? deps.buildUsers().find((u) => u.key === userKey(p)) : null;
    // Same platform → instance rule buildUsers uses for HologramUserAgg.instance
    // (services/users.ts): only misskey/mastodon posts carry an arbitrary instance
    // host, taken from the post's own captured URL.
    const posterInstance = p.platform === 'misskey' || p.platform === 'mastodon' ? hostOf(p.url) : null;
    const posterProfileHref = posterProfileUrl({ platform: p.platform, screenName: p.screenName, instance: posterInstance });
    // #676: the heading is a NAME (title), not a body — a title-less SNS post shows
    // no heading at all rather than borrowing the post text (the 投稿者 row directly
    // below already carries identity, so there is nothing to fall back to). The body
    // gets its own section (bodyText, below) instead of masquerading as a heading.
    const heading = p.title || '';
    const bodyText = (p.text || '').trim();
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
      focusTags: !!(opts && opts.focusTags),
      heading,
      bodyText,
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
      // Inline tag editing (P2⑦): the picker's own data rides in the inspector model.
      ...deps.inspectorTagPickerData(userTags, g.records, 'post'),
      tagLabels: tagLabels(),
      onTagAdd: (tag: string) => addInspectorTag(g, tag),
      onTagRemove: (tag: string) => removeInspectorTag(g, tag),
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
        text: deps.t('detailText'),
        tags: deps.t('detailTags'),
        tagsEmpty: deps.t('tagsEmpty'),
        editTags: deps.t('tipEditTags'),
        sourceTags: deps.t('detailSourceTags'),
        viewPoster: deps.t('ctxViewPoster'),
        open: deps.t('detailOpen'),
        openProfile: deps.t('detailOpenProfile'),
        sauce: deps.t('detailSauce'),
        ascii: deps.t('detailAscii'),
      },
      onClose: closeOrDismissDetail,
      onOpenExternal: p.url ? () => hologramIpc.openExternal(p.url) : null,
      onOpenProfile: posterProfileHref ? () => hologramIpc.openExternal(posterProfileHref) : null,
      onSauce: srcImageUrl ? () => hologramIpc.openExternal('https://saucenao.com/search.php?url=' + encodeURIComponent(srcImageUrl)) : null,
      onAscii: srcImageUrl ? () => hologramIpc.openExternal('https://ascii2d.net/search/url/' + encodeURIComponent(srcImageUrl)) : null,
      onPosterJump: jumpUser ? () => deps.jumpToPoster(p) : null,
      onTagContextMenu: (tag: string, x: number, y: number) => {
        deps.showKindMenu(tag, x, y, () => {
          const g2 = deps.getViewGroups().find((gg) => postIdKey(gg.rep) === deps.getInspectedKey());
          if (g2) refreshInspectorTagFields(g2);
        });
      },
    });
    // Selecting a card fills the panel; it does NOT open one the user has closed (#243).
    // The visibility-linked chrome (data-insp-open, the tile track) therefore isn't touched
    // here — it follows the panel store, not the content.
    //
    // Ring-mark the inspected card so swapping content stays traceable — the grid
    // cell derives its own ring reactively (hologramStore subscribe), so no manual
    // DOM classList reach-in / repaint() is needed here.
    deps.setInspectedKey(postIdKey(p));
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
  // app/App.tsx) so it can check what else is open BEFORE those handlers
  // dismiss themselves on the same press — the transient surfaces win this Esc, and only
  // once nothing is left does the detail view close.
  function handleEscDismissDetail(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (lightboxIsOpen()) return;
    if (settingsIsOpen()) return;
    if (confirmGet()) return;
    if (menuGet() || kindMenuGet()) return;
    if (isAnySelectOpen()) return; // …and an open shadcn Select (display popover / filter editors), tracked by state not DOM
    if (deps.imageTabShowing()) {
      deps.closeTab(deps.getActiveTabId());
      return;
    }
    // Narrow overlay only (#259). Something laid OVER the grid is expected to answer Esc,
    // and the pre-#243 slide-over did. The docked column still does not: #143/#242 ruled
    // Esc out there, where it would dismiss nothing the user can see covering anything.
    if (!isWideLayout() && panelIsVisible()) dismissDetail();
  }

  return {
    closeDetail,
    dismissDetail,
    closeOrDismissDetail,
    showDetail,
    persistManual,
    handleEscDismissDetail,
    handleOutsideClickDismissDetail,
  };
}
