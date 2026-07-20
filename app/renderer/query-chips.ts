// The shared facet-chip query builder (改訂④) —
// extracted from viewer.js's inline createQueryBuilder (P4-B スライス⑦ event半分).
// One instance per bar (posts / posters). Owns the tree state, the cluster
// view-model derivation, the mutation helpers, AND (since this slice) the
// qbNodeMap + click/contextmenu DISPATCH — the query-chips island (React) now
// derives its display purely by reading a cached model + calling dispatch(),
// instead of viewer.js pushing a model into the island and delegating raw DOM
// events. viewer.js still owns orchestration around a change (ctx.onChange,
// openLeafEditor popovers, onClearSearch) — only the tree/model/event-routing
// domain itself moved.
//
// ctx: { container, storeKey?, barEl?, predOf, labelOf, glyphOf, t,
//        getSearchVal?, onClearSearch?, onChange, openLeafEditor?,
//        editableLeafTypes?, singleValueTypes?, noDupTypes?, multiValueTypes?,
//        standaloneTypes? }  (barEl = the bar's static container: reveal +
//        --activebar-h measure; the reset/empty/count chrome is the activebar island)
import { emptyTree, hasLeafValue, removeCondsMatching as removeCondsMatchingQ, buildShadow, canonicalizeFacet, facetViewOf, facetAdd, cleanupTree, sameLeaf, detachNode, treeParentMap, facetSetNeg, evalNode } from './query.ts';
import { open as menuOpen } from './menu.ts';
import { set as storeSet } from './store.ts';

const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// ── per-container cached model + subscribers (the island's useSyncExternalStore
// reads through getModel/subscribe; dispatch routes a click/contextmenu action
// back to the owning instance). Keyed by container.id ('queryChips' /
// 'posterQueryChips'), so both bars share this one registry. ──
const models = new Map<string, any>();
const dispatchers = new Map<string, (action: any) => void>();
type Channel = { get: () => any; subscribe: (cb: () => void) => () => void; notify: () => void };
const channels = new Map<string, Channel>();
function channel(id: string): Channel {
  let c = channels.get(id);
  if (!c) {
    const subs = new Set<() => void>();
    c = {
      get: () => models.get(id) ?? null,
      subscribe: (cb) => {
        subs.add(cb);
        return () => subs.delete(cb);
      },
      notify: () => {
        for (const cb of [...subs]) {
          try {
            cb();
          } catch (_e) {
            /* ignore */
          }
        }
      },
    };
    channels.set(id, c);
  }
  return c;
}
function pushModel(id: string, model: any) {
  models.set(id, model);
  channel(id).notify();
}

// Local shape for the ctx contract documented in the file-top comment (the
// exported HologramQueryChipsIsland.create(ctx: any) stays loose — the islands
// project doesn't see HologramQueryLeaf/HologramQueryGroup — so this is typed only
// for this module's own body).
interface QbCtx {
  container: HTMLElement;
  storeKey?: string;
  barEl?: HTMLElement | null;
  predOf: (f: HologramQueryLeaf) => (item: any) => boolean;
  labelOf: (f: HologramQueryLeaf) => string;
  glyphOf: (type: string) => string;
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  getSearchVal?: () => string;
  onClearSearch?: () => void;
  onChange: () => void;
  openLeafEditor?: (node: HologramQueryLeaf) => void;
  editableLeafTypes?: string[];
  singleValueTypes?: string[];
  noDupTypes?: string[];
  multiValueTypes?: string[];
  standaloneTypes?: string[];
  isEditingLeaf?: (leaf: HologramQueryLeaf) => boolean;
  textInTree?: boolean;
  onLeafMutated?: (node: HologramQueryLeaf) => void;
}

export function createQueryBuilder(ctx: QbCtx) {
  let tree = emptyTree();
  let qbNodeMap = new Map<string, any>(); // data-nid → tree node (rebuilt each render)
  let shadow: any[] = []; // last computed flat (deduped) leaf shadow
  const chips = ctx.container;
  const nodeById = (id: string) => qbNodeMap.get(id) || null;
  const editableLeafTypes = ctx.editableLeafTypes || [];
  const singleValueTypes = ctx.singleValueTypes || [];
  const noDupTypes = ctx.noDupTypes || [];
  // Facet schema: which types may hold 2+ values with an すべて/どれか choice
  // (multi-value attributes), and which stay standalone chips. Every other
  // type clusters as a silent どれか — the schema answers the operator
  // question, so the UI never has to ask.
  const facetOpts = { multiValueTypes: ctx.multiValueTypes || [], standaloneTypes: ctx.standaloneTypes || [] };

  // --- Tree mutation domain lives in query.ts (imported above, 9th extraction slice); the
  // bindings below close over THIS instance's tree.
  const qHasValue = (type: string, value: unknown) => hasLeafValue(tree, type, value);
  const removeCondsMatching = (pred: (c: HologramQueryLeaf) => boolean) => removeCondsMatchingQ(tree, pred);
  // Rebuild the flat (deduped) leaf shadow that `.shadow()` exposes below.
  // Also mirror the tree into hologramStore under ctx.storeKey, a fresh deep
  // clone each time (tree is mutated in-place by the query.ts calls below, so a
  // same-reference push would never pass the store's identity-equality
  // guard — same issue as the selectedSet slice, same fix). This is THE
  // single choke point for "the tree changed" (every mutation path —
  // addFilter/removeNode/dispatch's opt/neg toggles, plus setTree/resetTree
  // — calls syncShadow), so one push here covers all of them.
  const syncShadow = () => {
    shadow = buildShadow(tree);
    if (ctx.storeKey) storeSet(ctx.storeKey, JSON.parse(JSON.stringify(tree)));
  };
  // One canonical refresh after any tree mutation: rebuild the shadow, then let
  // the view re-render (which itself re-renders this bar via render()).
  const refresh = () => {
    syncShadow();
    ctx.onChange();
  };

  // Read-only text for a NON-facet tree (persisted 改訂③ nesting the ④ UI
  // cannot edit): honest parenthesised form; the existing リセット button is
  // the rebuild path.
  function summaryOf(node: HologramQueryNode, isRoot: boolean): string {
    if (node.kind === 'cond') return (node.neg ? '≠' : '') + ctx.labelOf(node);
    const inner = node.children.map((c) => summaryOf(c, false)).join(node.op === 'or' ? ` ${ctx.t('qcJoinOr')} ` : ` ${ctx.t('qcJoinAnd')} `);
    return isRoot ? inner : `${node.neg ? '≠' : ''}(${inner})`;
  }

  // --- Render: recompute the tree as attribute clusters (facet chips), cache
  // the model, and notify the island's subscribers. The island (React) reads
  // the cached model + qbNodeMap-backed dispatch(); no DOM delegation lives
  // here anymore. ---
  function render() {
    const container = chips;
    const prevLabels = new Set(Array.from(container.querySelectorAll('.qb-val-label')).map((el) => ((el as Element).textContent as string).trim()));
    const bar = ctx.barEl || null;
    const searchVal = ctx.getSearchVal ? (ctx.getSearchVal() || '').trim() : '';
    // ビルダは常時表示（空でもバーは出す＝リセット/ⓘ の置き場）。
    if (bar) bar.style.display = '';
    // The bar is a full-width top bar; the floating sidebar offsets its sticky top
    // by this height. Measure after layout, and only when the bar is actually shown.
    if (bar)
      requestAnimationFrame(() => {
        const h = bar.offsetHeight;
        if (h) document.documentElement.style.setProperty('--activebar-h', h + 'px');
      });
    const hasQuery = tree.children.length > 0;
    // The リセット button + empty-bar hint visibility is the activebar island now (from
    // buildActivebarModel, pushed by renderPosts/renderPosters after this render). This
    // render only owns the bar reveal + --activebar-h measurement above (side effects on
    // viewer's static container) and the chips model below.
    // Re-assert the canonical facet shape before reading it (mutations keep it,
    // but a freshly loaded compatible tree may still carry bare 2+-value runs;
    // the すべて/どれか toggle needs real group nodes to write to).
    const isFacet = canonicalizeFacet(tree, facetOpts);
    const view = isFacet ? facetViewOf(tree, facetOpts) : null;
    // Rebuild qbNodeMap (data-nid → node) in the same pre-order the model
    // carries, so dispatch()'s nodeById() keeps resolving. The island only
    // RENDERS this model and calls dispatch(); this module keeps the ids,
    // the state, and the event routing.
    qbNodeMap = new Map();
    let idc = 0;
    const nid = (node: HologramQueryNode) => {
      const id = 'n' + idc++;
      qbNodeMap.set(id, node);
      return id;
    };
    const animate = !prefersReducedMotion();
    const itemModel = (leaf: HologramQueryLeaf) => {
      const label = ctx.labelOf(leaf);
      // chip-new entrance: flag leaves whose label wasn't on the bar last render
      // (skip the live-updating editing chip — it would flicker per keystroke).
      const isNew = animate && !(ctx.isEditingLeaf && ctx.isEditingLeaf(leaf)) && !prevLabels.has(label);
      return { id: nid(leaf), label, isNew, editable: editableLeafTypes.includes(leaf.type), glyph: ctx.glyphOf(leaf.type), typeCls: 'qc-' + leaf.type };
    };
    const clusters: any[] = [];
    let excl: any = null;
    let summary: any = null;
    if (view) {
      for (const cl of view.clusters) {
        // The cluster's group node (2+ values) is what the toggle writes to.
        const grpNode = cl.leaves.length > 1 ? tree.children.find((c) => c.kind === 'group' && c.children.includes(cl.leaves[0])) : null;
        clusters.push({
          id: grpNode ? nid(grpNode) : null,
          typeCls: 'qc-' + cl.type,
          glyph: ctx.glyphOf(cl.type),
          items: cl.leaves.map(itemModel),
          // The one remaining operator surface: multi-value clusters with 2+
          // values. Single-value types stay a silent どれか (schema-forced).
          op: grpNode && facetOpts.multiValueTypes.includes(cl.type) ? cl.op : null,
        });
      }
      for (const l of view.singles) clusters.push({ id: null, typeCls: 'qc-' + l.type, glyph: ctx.glyphOf(l.type), items: [itemModel(l)], op: null });
      if (view.excl.length) excl = { label: ctx.t('qbExclLabel'), items: view.excl.map(itemModel) };
    } else {
      summary = { text: summaryOf(tree, true), tip: ctx.t('qbSummaryTip') };
    }
    // Posts fold the search term into the tree as a real 'text' leaf (textInTree),
    // so suppress the echo chip there. Posters still echo their box term.
    const model = {
      searchSeg: searchVal && !ctx.textInTree ? { glyph: ctx.glyphOf('search'), text: searchVal } : null,
      searchJoin: hasQuery,
      joinAndWord: ctx.t('qcJoinAnd'),
      clusters,
      excl,
      summary,
      delTitle: ctx.t('qfDelete'),
      optAll: ctx.t('qbOptAll'),
      optAny: ctx.t('qbOptAny'),
      optAllTip: ctx.t('qbOptAllTip'),
      optAnyTip: ctx.t('qbOptAnyTip'),
    };
    pushModel(container.id, model);
  }

  // Sidebar entry points add a condition into its attribute cluster (改訂④):
  // the newcomer joins its type's group, or pairs with the existing bare leaf
  // (structure is DERIVED — the user never builds it). On a non-facet tree
  // (persisted 改訂③ nesting) it lands at the top level (AND) instead.
  function addFilter(filter: { type: string; [k: string]: any }): HologramQueryLeaf | null {
    // Single-valued types (択一): a new one replaces the existing anywhere.
    if (singleValueTypes.includes(filter.type)) removeCondsMatching((c) => c.type === filter.type);
    // Prevent exact duplicates (anywhere in the tree), except for multi types.
    else if (!noDupTypes.includes(filter.type) && qHasValue(filter.type, filter.value)) return null;
    const node = Object.assign({ kind: 'cond' as const }, filter);
    if (facetViewOf(tree, facetOpts)) facetAdd(tree, node, facetOpts);
    else tree.children.push(node);
    cleanupTree(tree);
    refresh();
    return node; // callers binding to the new leaf (e.g. the editing text leaf) need it
  }
  // Remove the condition(s) matching the shadow filter at `index` (sidebar toggle
  // handlers findIndex into the shadow). Bar-pill removal targets a node by id.
  function removeFilter(index: number) {
    const f = shadow[index];
    if (!f) return;
    removeCondsMatching((c) => sameLeaf(c, f));
    refresh();
  }
  function removeNode(node: HologramQueryLeaf) {
    if (ctx.onLeafMutated) ctx.onLeafMutated(node); // let the view reconcile (e.g. unbind the editing text leaf)
    detachNode(node, treeParentMap(tree));
    cleanupTree(tree);
    refresh();
  }

  // Right-click a value → 「除外へ移す／含む条件に戻す」＋削除 (fold-menu 様式,
  // right-click = the menu of actions per DESIGN). React-owned glass menu
  // (menu.ts); one bridge serves BOTH builder instances.
  function showQbMenu(node: HologramQueryLeaf, x: number, y: number) {
    const NEG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>';
    const DEL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
    const items = [{ label: node.neg ? ctx.t('qbMenuInclude') : ctx.t('qbMenuExclude'), act: 'neg', icon: NEG }, { sep: true }, { label: ctx.t('qfDelete'), act: 'del', icon: DEL, danger: true }];
    menuOpen({ items, x, y }, (item) => {
      if (item.act === 'neg') {
        if (ctx.onLeafMutated) ctx.onLeafMutated(node); // an editing text leaf moving to 除く is confirmed
        facetSetNeg(tree, node, !node.neg, facetOpts);
        refresh();
      } else if (item.act === 'del') {
        removeNode(node);
      }
    });
  }

  // Bar interaction, routed from the island's onClick/onContextMenu handlers
  // (no DOM delegation — React owns the elements directly now). Mirrors the
  // former delegated click/contextmenu listeners 1:1: すべて/どれか segment,
  // delete a value (✕), clear the search echo, open a leaf editor (date/
  // engagement), or open the exclude/delete context menu.
  function dispatch(action: { act: string; nid: string; op?: 'and' | 'or'; x: number; y: number }) {
    switch (action.act) {
      case 'opt': {
        const n = nodeById(action.nid);
        // Segment semantics: clicking a side SELECTS it (the active side is inert).
        if (n && n.kind === 'group' && n.op !== action.op) {
          n.op = action.op;
          refresh();
        }
        break;
      }
      case 'del': {
        const n = nodeById(action.nid);
        if (n) removeNode(n);
        break;
      }
      case 'clearSearch':
        if (ctx.onClearSearch) ctx.onClearSearch();
        break;
      case 'edit': {
        // 編集可能な葉（日付・反応）は左クリックで編集ポップへ。それ以外は何もしない。
        const n = nodeById(action.nid);
        if (n && n.kind === 'cond' && editableLeafTypes.includes(n.type) && ctx.openLeafEditor) ctx.openLeafEditor(n);
        break;
      }
      case 'menu': {
        const n = nodeById(action.nid);
        if (n && n.kind === 'cond') showQbMenu(n, action.x, action.y);
        break;
      }
    }
  }
  if (chips) dispatchers.set(chips.id, dispatch);

  return {
    getTree: () => tree,
    // Replace the tree (clone + self-heal singleton groups + recompute shadow).
    // Facet-compatible persisted trees normalize into the canonical shape;
    // anything else stays intact and renders as the read-only summary.
    setTree: (t: HologramQueryGroup | null | undefined) => {
      tree = t ? JSON.parse(JSON.stringify(t)) : emptyTree();
      cleanupTree(tree);
      canonicalizeFacet(tree, facetOpts);
      syncShadow();
    },
    resetTree: () => {
      tree = emptyTree();
      // Every tree mutation must resync the flat shadow (the invariant refresh()
      // documents). resetTree was the lone mutator that skipped it, leaving the
      // shadow — and its consumers (.shadow() readers → sidebar row badges) —
      // stale until the next mutation. Post-side callers were masked by a
      // following afterQueryChange()→refresh(); the poster reset (renderPosters, no
      // refresh) exposed it as row badges that stayed lit after リセット.
      syncShadow();
    },
    addFilter,
    removeFilter,
    removeNode,
    removeByLeaf: (type: string, value: unknown) => {
      if (removeCondsMatching((c) => c.type === type && c.value === value)) refresh();
    },
    removeByType: (type: string) => {
      if (removeCondsMatching((c) => c.type === type)) refresh();
    },
    removeCondsMatching,
    qHasValue,
    render,
    refresh,
    syncShadow,
    eval: (item: unknown) => evalNode(tree, item, ctx.predOf),
    hasQuery: () => tree.children.length > 0,
    shadow: () => shadow,
    dispatch,
  };
}

export function getModel(id: string) {
  return channel(id).get();
}
export function subscribe(id: string, cb: () => void) {
  return channel(id).subscribe(cb);
}
export function dispatch(id: string, action: any) {
  return dispatchers.get(id)?.(action);
}
