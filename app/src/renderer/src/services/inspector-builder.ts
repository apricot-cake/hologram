// Post-inspector (persistent right-column detail panel) builder — extracted from
// the old viewer.ts monolith. Mirrors post-grid-builder.ts / poster-grid-builder.ts:
// open/close chrome, the always-live inline tag editor (add/toggle/adopt-source-tag
// + the same-name-character homonym check), the group dissolve/regroup buttons shown in the
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
import { isDocked as panelIsDocked, isOpen as panelIsOpen, isVisible as panelIsVisible, panelContains, setOpen as panelSetOpen, subscribe as panelSubscribe } from './inspector-panel.ts';
import { get as confirmGet, open as confirmOpen } from './confirm.ts';
import { get as kindMenuGet } from './kind-menu.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { get as menuGet } from './menu.ts';
import { isAnySelectOpen } from './open-select-registry.ts';
import { subscribe as subscribePostsData } from './posts-data.ts';
import { postIdKey, postKeyOf, captureFile, persistManualGroups, persistUngrouped, monoHue } from './records.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { sameTags, setTagKind as tagsSetTagKind } from './tags.ts';
import { applyTagWrite, updateTags as postsUpdateTags } from './posts.ts';
import { hologramIpc } from './ipc.ts';
import type { UndoChange } from './undo.ts';

export interface InspectorBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  fileSrc(file: string, w?: number): string;
  showToast(msg: unknown): void;
  showKindMenu(tag: string, x: number, y: number, onChange: () => void, entityId?: number | null): void;
  buildUsers(): HologramUserAgg[];
  // #23 St1 (name-merging): folds a posterKey onto its group's canonical
  // (primary) key — identity when the poster isn't merged. buildUsers() rows
  // are already keyed by primary, so any raw userKey(p) has to go through this
  // before comparing against u.key.
  resolve(key: string): string;
  // #810: by entity where the record names one, by name where the tag is still
  // just a string the user typed (see maybeDistinguishHomonym).
  tagKindOf(tagId: number | null | undefined): string | null | undefined;
  tagKindOfName(tag: string): string | null | undefined;
  worksCooccurringWith(tag: string, exclude: Set<string>): Set<string>;
  jumpToPoster(post: HologramPost): void;
  // Peek this group in the quick-view lightbox (#143 pending item 3) — the inspector
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
  // #180: quoted/reply-to card click-through — "navigate to the saved
  // independent record" is implemented as the SAME drill-in idiom
  // jumpToPoster/openPosterPosts already use (postQBResetTree + a single
  // addFilter), not a new nav mechanism. Reusing the query tree's own
  // 'text' leaf (which already matches a pasted permalink by postKeyOf — see
  // query.ts's urlHit) means the resulting view + a fresh showDetail also ride
  // the EXISTING push-on-render nav-history hookup (tabs-builder.ts's
  // syncTitleAndPersist), so back/forward (#144) works with no new code there.
  postQBResetTree(): void;
  addFilter(filter: { type: string; [k: string]: any }): void;
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
  // notify): the picture fell to "not in the library" while the column beside it kept
  // showing the post.
  //
  // ONE place asks the question, for every way a subject can vanish — the same move #617
  // made for "is the panel on screen" (isVisible) and #619 for "is the image view showing"
  // (isActive). Before this, each delete path had to remember on its own: the card menu's
  // delete did, the floating bar's bulk delete did not, and neither did the library wipe,
  // the ZIP import's Replace (duplicate mode), or anything else that can drop a record. Deletion is not the
  // interesting event — DISAPPEARANCE is, and posts-data.ts is where the library announces
  // it (markPostsMutated is the single choke point every mutation already goes through).
  //
  // What it lands on is dismissDetail(), not a new "this post was deleted" panel state:
  // the inspector is defined as the detail OF a selection (#143/#244), so with the subject
  // gone there is no selection, and the placeholder that already means that is the honest
  // answer. A second "Deleted" empty state would also say what the stage is already
  // saying, one column over.
  function inspectedSubjectExists(key: string): boolean {
    // Poster keys are the roll-up's own (poster-grid-builder stamps 'poster:' + u.key);
    // a poster exists exactly as long as one of its posts does, which is what buildUsers
    // recomputes (cached behind the library generation, so this costs nothing extra on a
    // notify that already invalidated it).
    if (key.indexOf('poster:') === 0) {
      // #23 St1: the stored key was the primary AT THE TIME the inspector opened —
      // a later setPrimary()/unlink() on that group can leave it pointing at a
      // now-non-primary member, which resolve() still finds.
      const uk = deps.resolve(key.slice('poster:'.length));
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
    if (panelIsDocked()) closeDetail();
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
    if (panelIsDocked()) return; // wide, or the image view at any width — a docked column, nothing to dismiss
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
    deps.keepCurrentVisible(); // doesn't vanish immediately even if it drops out of a filter like "Multiple images only"
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
      let res: Awaited<ReturnType<typeof postsUpdateTags>> | null = null;
      try {
        res = await postsUpdateTags(r.image || r.video || r.file, next);
      } catch {
        /* keep going */
      }
      const rec = deps.getPostById(r.captureId); // O(1) lookup; allPosts shares the same record refs
      if (rec) applyTagWrite(rec, next, res);
      // The recorded change is the difference, not the two lists (#235).
      changes.push({
        kind: 'post-tags',
        target: r.captureId,
        image: r.image || r.video || r.file,
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

  // #36: the inspector's memo textarea (blur/debounce commit — MemoSection in
  // Inspector.tsx owns the timing, this just applies one already-settled value).
  // Group-wide like a tag edit, not per-record: a group is the same content
  // shown once (duplicates/siblings), so a note about it applies to all of them,
  // the same reach applyInspectorTagChange already has. No undo entry (unlike
  // tags) — the design decision on #36 doesn't call for one, and there is no
  // natural "diff" for free text the way added/removed tag names have.
  async function applyInspectorMemo(g: HologramPostGroup | null | undefined, memo: string) {
    if (!g) return;
    const recs = g.records && g.records.length ? g.records : [g.rep];
    let changed = false;
    for (const r of recs) {
      if ((r.memo || '') === memo) continue;
      changed = true;
      try {
        await postsUpdateTags(r.image || r.video || r.file, r.tags || [], { memo });
      } catch {
        /* keep going — same best-effort contract as applyInspectorTagChange */
      }
      const rec = deps.getPostById(r.captureId);
      if (rec) rec.memo = memo;
    }
    if (!changed) return;
    deps.markPostsMutated();
    deps.renderPosts(true); // a memo edit can change what an active free-text search matches
  }

  // Every tag mutation has to start from the CURRENT group, not the one captured
  // when the panel was opened: renderPosts rebuilds the view groups after each
  // change, so a captured group's records go stale as soon as one edit lands. A
  // second edit computed from stale tags writes the wrong set — removing a tag
  // from a card that had gained one in between would drop both, because the stale
  // `prev` never had the newer tag in it.
  const freshGroup = (g: HologramPostGroup) => deps.getViewGroups().find((gg) => postIdKey(gg.rep) === deps.getInspectedKey()) || g;

  // Add (typed input / picker click) or toggle (picker click only) a tag on the
  // inspected group, then check for a same-name-character homonym ONLY when the tag was newly
  // added (only a new tag can be a homonym of a character already in the vocabulary).
  async function addInspectorTag(g: HologramPostGroup, tag: string) {
    const adding = !(freshGroup(g).rep.tags || []).includes(tag);
    await applyInspectorTagChange(freshGroup(g), (prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    if (adding) maybeDistinguishHomonym(freshGroup(g), tag);
  }
  async function removeInspectorTag(g: HologramPostGroup, tag: string) {
    await applyInspectorTagChange(freshGroup(g), (prev) => prev.filter((t) => t !== tag));
  }

  // When a Character tag joins a Work-bearing card whose Work differs from every Work
  // this character was seen with before, it's likely a same-name character from
  // another work. Offer the danbooru-style freeform distinction Character (Work).
  // Deterministic + confirm-gated + silent until there's history (stay silent while it's thin).
  function maybeDistinguishHomonym(g: HologramPostGroup | null | undefined, addedTag: string) {
    // Name space (#810): every tag here is a string the user typed into the tag
    // field, and the one this ends up writing does not exist yet at all.
    if (!g || deps.tagKindOfName(addedTag) !== 'character') return;
    const cardTags: string[] = g.rep && Array.isArray(g.rep.tags) ? g.rep.tags : [];
    const worksNow = cardTags.filter((t) => deps.tagKindOfName(t) === 'work');
    if (!worksNow.length) return; // no Work context to distinguish by
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
        // Rename FIRST, classify second (#810). A Kind is written to a tags row
        // id, and the distinguished name has no row until this write creates one
        // — the old order set the kind through a name-keyed map that created the
        // tag as a side effect, which the entity-keyed store cannot do. The write
        // hands the ids back onto the record (services/posts.ts's applyTagWrite),
        // so the new entity is nameable immediately afterwards.
        await applyInspectorTagChange(g, (prev) => prev.map((t) => (t === addedTag ? distinguished : t)));
        const fresh = freshGroup(g);
        const i = (fresh.rep.tags || []).indexOf(distinguished);
        const tagId = i >= 0 ? fresh.rep.tagIds?.[i] : undefined;
        // The distinguished string stays a character (danbooru-style); record its Kind.
        if (tagId != null && !deps.tagKindOf(tagId)) await tagsSetTagKind(tagId, 'character');
        deps.showToast(deps.t('homonymDistinguished', [distinguished]));
      },
    });
  }

  // #180: quoted/renoted or (Misskey-only) replied-to post, rendered as an
  // embedded card built straight from the saved sidecar sub-record (never a
  // live fetch — v1 stays metadata-only). Two independent slots rather than
  // one 'the quoted card', since a post can both quote something and (on
  // Misskey) carry a reply-to at once.
  function quotedCardOf(sub: any, kind: 'quote' | 'reply'): HologramQuotedCardModel | null {
    if (!sub) return null;
    const displayName = sub.displayName || sub.screenName || '';
    const media = Array.isArray(sub.media) ? sub.media : [];
    const url: string | null = sub.url || null;
    // Same-post identity: is this permalink ALSO saved as its own independent
    // record? (2026-07-27 design comment on #180) — postKeyOf is the one
    // URL→identity normalization every duplicate-detection path in the app
    // already shares (records.ts), so a quote and its independently-saved
    // target agree with the grid's own grouping about what counts as "the same post".
    const key = url ? postKeyOf(url) : null;
    const savedRec = key ? deps.getAllPosts().find((q) => postKeyOf(q.url) === key) : undefined;
    return {
      kind,
      label: kind === 'reply' ? deps.t('quotedCardReply') : deps.t('quotedCardQuote'),
      displayName,
      screenNameLabel: sub.screenName ? '@' + sub.screenName : '',
      // #290/#181's line, reaffirmed for quotes by the 2026-07-27 design comment on
      // #180: library viewing never reads a remote URL, so the sub-record's own
      // avatar URL (sub.avatar) is never used as a src — the monogram fallback
      // (Avatar, _shared/PostCard.tsx) is the only avatar a quoted/replied-to
      // author ever gets.
      avatarSrc: null,
      monogram: displayName ? displayName[0].toUpperCase() : '?',
      monoHue: monoHue(sub.userId ? String(sub.userId) : sub.screenName || displayName || 'quoted'),
      dateLabel: localeDateTime(sub.date),
      cw: sub.cw || '',
      text: sub.text || '',
      mediaCountLabel: media.length ? deps.t('imagesCount', [media.length]) : '',
      onOpen: url ? () => jumpToQuotedPost(savedRec, url) : undefined,
    };
  }

  // #179: the post's poll, as the inspector shows it. Read-only by design --
  // the choices are results, never controls (see PollCard.tsx).
  //
  // The percentage denominator is the number of PEOPLE where the platform says
  // it (Mastodon's votersCount) and the number of VOTES otherwise: on a
  // multiple-choice poll those differ, and dividing by total votes would make
  // the bars sum to 100% while telling nobody what share of voters picked each
  // choice. Mastodon's own client draws it the same way.
  //
  // Every choice with a null tally (Mastodon hides results until the viewer
  // votes; we never vote) yields no number and no bar, rather than a 0 that
  // would read as "nobody picked this".
  function pollCardOf(poll: any): HologramPollCardModel | null {
    const choices = poll && Array.isArray(poll.choices) ? poll.choices.filter((c: any) => c && typeof c.text === 'string') : [];
    if (!choices.length) return null;
    const counted = choices.filter((c: any) => typeof c.votes === 'number');
    const totalVotes = counted.reduce((s: number, c: any) => s + c.votes, 0);
    const denom = typeof poll.votersCount === 'number' && poll.votersCount > 0 ? poll.votersCount : totalVotes;
    const meta: string[] = [];
    if (poll.multiple) meta.push(deps.t('pollMultiple'));
    if (counted.length) meta.push(deps.t('pollVotes', [formatCount(totalVotes)]));
    else meta.push(deps.t('pollResultsHidden'));
    if (typeof poll.votersCount === 'number') meta.push(deps.t('pollVoters', [formatCount(poll.votersCount)]));
    const deadline = localeDateTime(poll.expiresAt);
    if (deadline) meta.push(deps.t('pollDeadline', [deadline]));
    return {
      label: deps.t('pollCardLabel'),
      choices: choices.map((c: any) => {
        const votes: number | null = typeof c.votes === 'number' ? c.votes : null;
        const percent = votes != null && denom > 0 ? Math.round((votes / denom) * 1000) / 10 : null;
        return {
          text: c.text,
          votesLabel: votes != null ? deps.t('pollVotes', [formatCount(votes)]) : '',
          percentLabel: percent != null ? `${percent}%` : '',
          percent,
        };
      }),
      metaLabel: meta.join('  ・  '),
    };
  }

  // #181: the post's OGP preview card, when it has one. thumbSrc reads the
  // downloaded file through the same asset:// helper the post's own thumbnail
  // uses (deps.fileSrc) — never the card's original remote URL (#181 scope:
  // the thumbnail is downloaded at save time, same "no live network fetch on
  // display" rule #180's quoted-post card follows). onOpen always goes
  // through the existing https-only open-external route: unlike a
  // quoted/renoted post (#180's jumpToQuotedPost), a link card never points
  // at another SAVED record to navigate to in-app — it names an external
  // page this library has no independent entry for.
  function linkCardOf(card: any): HologramLinkCardModel | null {
    if (!card || !card.url) return null;
    return {
      label: deps.t('linkCardLabel'),
      title: card.title || card.url,
      description: card.description || '',
      domainLabel: hostOf(card.url) || '',
      thumbSrc: card.thumbnailFile ? deps.fileSrc(card.thumbnailFile) : null,
      onOpen: () => hologramIpc.openExternal(card.url),
    };
  }

  // Click-through (2026-07-27 design comment on #180): an independently-saved
  // copy navigates in-app; nothing saved opens the sub-record's own URL
  // externally (the existing https-only open-external route). The in-app
  // route is the SAME drill-in idiom jumpToPoster/openPosterPosts already use
  // (reset the tree, add ONE filter) — see the deps interface comment for why
  // that also gets #144's back/forward for free, with no new nav-history code.
  function jumpToQuotedPost(rec: HologramPost | undefined, url: string) {
    if (!rec) {
      hologramIpc.openExternal(url);
      return;
    }
    deps.postQBResetTree();
    deps.addFilter({ type: 'text', value: rec.url || url });
    const g = deps.getViewGroups().find((gg) => postIdKey(gg.rep) === postIdKey(rec));
    if (g) showDetail(g);
  }

  // opts.focusTags: open the panel with the caret already in the tag field. It is
  // the card context menu's "Edit tags" route — the replacement for the card's 🏷
  // button, which used to open a popover of its own (P2⑦). A plain card click must
  // never take focus, so this is per-open rather than a property of the panel.
  //
  // It is also the one route here that OPENS a closed panel, and the exception proves
  // #243's rule rather than breaking it: selecting a card is not a request for the panel,
  // but invoking a command that only exists inside it is. Without this, "Edit tags" on a
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
    // migrations); when it does, the name+avatar links to it (bidirectional nav: posts ↔ posters).
    // #23 St1: userKey(p) is the post's own RAW key; buildUsers() rows are
    // keyed by the group's primary, so a merged poster's post only finds its
    // (folded) row through resolve().
    const jumpUser = p.url ? deps.buildUsers().find((u) => u.key === deps.resolve(userKey(p))) : null;
    // Same platform → instance rule buildUsers uses for HologramUserAgg.instance
    // (services/users.ts): only misskey/mastodon posts carry an arbitrary instance
    // host, taken from the post's own captured URL.
    const posterInstance = p.platform === 'misskey' || p.platform === 'mastodon' ? hostOf(p.url) : null;
    const posterProfileHref = posterProfileUrl({ platform: p.platform, screenName: p.screenName, instance: posterInstance });
    // #676: the heading is a NAME (title), not a body — a title-less SNS post shows
    // no heading at all rather than borrowing the post text (the Poster row directly
    // below already carries identity, so there is nothing to fall back to). The body
    // gets its own section (bodyText, below) instead of masquerading as a heading.
    const heading = p.title || '';
    const bodyText = (p.text || '').trim();
    // #180: rendered directly under the post's own bodyText (Inspector.tsx) —
    // the same nesting a quoted-tweet/renote card sits in on the source platforms.
    const quotedCards = [quotedCardOf(p.quotedPost, 'quote'), quotedCardOf(p.replyToPost, 'reply')].filter((c): c is HologramQuotedCardModel => !!c);
    // #179: rendered right after those, still directly under the post's own
    // text — the post text IS the poll's question on every platform that has
    // polls, so nothing may come between them.
    const pollCard = pollCardOf(p.poll);
    // #181: rendered alongside quotedCards/pollCard, directly under the
    // post's own text — the same slot a link-share embed occupies on the
    // source platforms (mutually exclusive with a quote/poll in practice, but
    // not enforced here).
    const linkCard = linkCardOf(p.linkCard);
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
      quotedCards,
      pollCard: pollCard || undefined,
      linkCard: linkCard || undefined,
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
      // pixiv series membership (#188). seriesTitle/seriesOrder are independent
      // fields in the model (not composed into one sentence here) so a series
      // whose order somehow came back null still shows its name.
      seriesLabel: p.seriesTitle || '',
      seriesOrderLabel: p.seriesOrder != null ? String(p.seriesOrder) : '',
      tags: userTags,
      srcTagsView,
      // Inline tag editing (P2⑦): the picker's own data rides in the inspector model.
      ...deps.inspectorTagPickerData(userTags, g.records, 'post'),
      tagLabels: tagLabels(),
      onTagAdd: (tag: string) => addInspectorTag(g, tag),
      onTagRemove: (tag: string) => removeInspectorTag(g, tag),
      // #36: free-text memo, editable in place like the tags above (MemoSection
      // in Inspector.tsx). Absent from card face by design (#36 decision comment).
      memo: p.memo || '',
      onMemoChange: (text: string) => applyInspectorMemo(g, text),
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
        series: deps.t('detailSeries'),
        seriesOrder: deps.t('detailSeriesOrder'),
        tags: deps.t('detailTags'),
        tagsEmpty: deps.t('tagsEmpty'),
        editTags: deps.t('tipEditTags'),
        memo: deps.t('detailMemo'),
        memoPlaceholder: deps.t('memoPlaceholder'),
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
        // #810: this card's own tags/tagIds are parallel, so the chip names its
        // ENTITY exactly — no name lookup, and no chance of classifying the other
        // tag that happens to share the string.
        const i = (p.tags || []).indexOf(tag);
        const tagId = i >= 0 ? p.tagIds?.[i] : undefined;
        deps.showKindMenu(
          tag,
          x,
          y,
          () => {
            const g2 = deps.getViewGroups().find((gg) => postIdKey(gg.rep) === deps.getInspectedKey());
            if (g2) refreshInspectorTagFields(g2);
          },
          tagId ?? null,
        );
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
    if (!panelIsDocked() && panelIsVisible()) dismissDetail();
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
