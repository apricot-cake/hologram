// Query engine — the boolean condition-tree core of Hologram filtering
// (改訂③), extracted 1:1 from viewer.js as the
// first "pure logic → service" slice of the viewer decomposition (最終形B).
// A real ES module (named exports) — imported directly by its consumers
// (viewer.ts / query-chips.ts / sidebar.ts / tabs.ts) via a relative path;
// touches no DOM. Runtime couplings (collections / fuzzy matcher) are
// INJECTED via makePostPredOf(deps), so this file can be exercised standalone
// (scripts/test-query-unit.cts loads it via a dynamic import()).

// --- Condition-tree machinery. The tree is ALWAYS a root group (op 'and' by
// default); leaves are {kind:'cond', type, value, …}, groups carry children
// and an optional neg. Shared by BOTH query builders (posts / posters). ---
/** @returns {HologramQueryGroup} */
export function emptyTree() {
  return { kind: 'group', op: 'and', neg: false, children: [] } as HologramQueryGroup;
}
export function treeLeaves(n: HologramQueryNode | null | undefined, out?: HologramQueryLeaf[]): HologramQueryLeaf[] {
  out = out || [];
  if (!n) return out;
  if (n.kind === 'cond') out.push(n);
  else (n.children || []).forEach((c) => treeLeaves(c, out));
  return out;
}
export function opposite(op: string): 'and' | 'or' {
  return op === 'and' ? 'or' : 'and';
}
// Deep-clone a query tree for persistence, dropping transient memo fields
// (_compiled…). Every persisted tree — tab snapshots and saved searches alike —
// goes through this, so a JSON round-trip never resurrects a stale memo.
export const cloneTree = (tree: HologramQueryNode) => JSON.parse(JSON.stringify(tree, (k, v) => (k[0] === '_' ? undefined : v)));
// Migration only: rebuild a tree from an old persisted faceted state (f + typeOps).
export function facetTreeFrom(f: ReadonlyArray<{ type: string; [k: string]: any }>, ops?: Record<string, string> | null): HologramQueryGroup {
  const root = emptyTree();
  const NO_OP = new Set(['date', 'engagement']);
  const byType = new Map<string, { type: string; [k: string]: any }[]>();
  for (const x of f) {
    let list = byType.get(x.type);
    if (!list) {
      list = [];
      byType.set(x.type, list);
    }
    list.push(x);
  }
  for (const [type, list] of byType) {
    const leaves: HologramQueryLeaf[] = list.map((x) => Object.assign({ kind: 'cond' as const }, x));
    if (NO_OP.has(type)) {
      root.children.push(...leaves);
      continue;
    }
    const op = (ops || {})[type] || 'or';
    root.children.push({ kind: 'group', op: op === 'and' ? 'and' : 'or', neg: op === 'not', children: leaves } as HologramQueryGroup);
  }
  return root;
}
// Recursive evaluation of a query tree against one item, using a view-supplied
// leaf predicate factory (predOf). Shared by both builders (post + poster).
export function evalNode(n: HologramQueryNode, item: unknown, predOf: (f: HologramQueryLeaf) => (item: any) => boolean): boolean {
  if (n.kind === 'cond') {
    const r = predOf(n)(item);
    return n.neg ? !r : r;
  }
  const r = n.op === 'or' ? n.children.some((c) => evalNode(c, item, predOf)) : n.children.every((c) => evalNode(c, item, predOf));
  return n.neg ? !r : r;
}

// --- Tree mutation domain (9th extraction slice). Pure tree surgery shared
// by BOTH builder instances (posts / posters): every function takes the tree
// (or nodes) as an argument and touches no DOM. The drag/drop/render/menu
// wiring stays in viewer.ts (createQueryBuilder), which binds these to its
// per-instance tree. ---
/** child → parent map, rebuilt for one surgery pass. */
export function treeParentMap(tree: HologramQueryGroup): Map<HologramQueryNode, HologramQueryGroup> {
  const m = new Map<HologramQueryNode, HologramQueryGroup>();
  (function rec(n: HologramQueryNode) {
    if (n.kind !== 'group') return;
    (n.children || []).forEach((c) => {
      m.set(c, n);
      rec(c);
    });
  })(tree);
  return m;
}
export function nodeContains(a: HologramQueryNode | null | undefined, b: HologramQueryNode | null | undefined): boolean {
  if (a === b) return true;
  if (!a || a.kind !== 'group') return false;
  return (a.children || []).some((c) => nodeContains(c, b));
}
export function detachNode(node: HologramQueryNode, pmap: Map<HologramQueryNode, HologramQueryGroup>): void {
  const par = pmap.get(node);
  if (!par) return;
  const i = par.children.indexOf(node);
  if (i >= 0) par.children.splice(i, 1);
}
// Auto-clean: drop empty groups, collapse single-member non-root groups,
// folding the group's negation into the survivor ("parentheses vanish once a
// group is down to one member").
export function cleanupTree(tree: HologramQueryGroup): void {
  (function rec(node: HologramQueryNode) {
    if (node.kind !== 'group') return;
    const out: HologramQueryNode[] = [];
    for (const c of node.children) {
      rec(c);
      if (c.kind === 'group') {
        if (!c.children.length) continue; // drop empty
        if (c.children.length === 1) {
          const only = c.children[0];
          if (c.neg) only.neg = !only.neg;
          out.push(only);
          continue;
        } // collapse singleton
      }
      out.push(c);
    }
    node.children = out;
  })(tree);
}
export function hasLeafValue(tree: HologramQueryGroup, type: string, value: unknown): boolean {
  return treeLeaves(tree).some((c) => c.type === type && c.value === value);
}
// Remove every cond leaf matching pred, anywhere in the tree (+ cleanup).
// Returns whether anything was actually removed (callers gate a refresh on it).
export function removeCondsMatching(tree: HologramQueryGroup, pred: (c: HologramQueryLeaf) => boolean): boolean {
  const before = treeLeaves(tree).length;
  (function rec(node: HologramQueryNode) {
    if (node.kind !== 'group') return;
    node.children = node.children.filter((c) => !(c.kind === 'cond' && pred(c)));
    node.children.forEach(rec);
  })(tree);
  cleanupTree(tree);
  return treeLeaves(tree).length !== before; // changed?
}
// Shadow-filter identity: date matches by type alone (single date condition),
// engagement by engType, everything else by value.
export function sameLeaf(c: HologramQueryLeaf, f: { type: string; [k: string]: any }): boolean {
  if (c.type !== f.type) return false;
  if (f.type === 'date') return true; // single date condition
  if (f.type === 'engagement') return c.engType === f.engType;
  return c.value === f.value;
}
// The flat (deduped) leaf shadow — what the sidebar highlight / row badges /
// tab title consume. date/engagement pass through whole (minus tree-only
// fields); other types dedupe on type+value.
export function buildShadow(tree: HologramQueryGroup): Array<{ type: string; [k: string]: any }> {
  const seen = new Set<string>();
  const out: Array<{ type: string; [k: string]: any }> = [];
  for (const c of treeLeaves(tree)) {
    if (c.type === 'date' || c.type === 'engagement') {
      const f: Record<string, any> = Object.assign({}, c);
      delete f.kind;
      delete f.neg;
      out.push(f as { type: string; [k: string]: any });
      continue;
    }
    const k = c.type + ' ' + c.value;
    if (seen.has(k)) continue;
    seen.add(k);
    const f: { type: string; [k: string]: any } = { type: c.type, value: c.value };
    if (c.label) f.label = c.label;
    out.push(f);
  }
  return out;
}
// Apply a drag-drop onto the tree: 'pair' wraps target+drag in a new group
// (with the opposite operator of the surrounding group), 'inside' adds drag
// as a member of the target group, 'root' moves it to the top level. Returns
// false (tree untouched) when the drop is rejected — onto itself or into its
// own descendant.
export function dropNode(tree: HologramQueryGroup, drag: HologramQueryNode | null | undefined, target: HologramQueryNode | null | undefined, mode: 'pair' | 'inside' | 'root'): boolean {
  if (!target || !drag || target === drag || nodeContains(drag, target)) return false;
  const pmap = treeParentMap(tree);
  detachNode(drag, pmap); // remove from its current parent first
  if (mode === 'pair') {
    const par = pmap.get(target) || tree;
    const g: HologramQueryGroup = { kind: 'group', op: opposite(par.op), neg: false, children: [target, drag] };
    const i = par.children.indexOf(target);
    if (i >= 0) par.children[i] = g;
    else par.children.push(g);
  } else if (mode === 'inside') {
    target.children.push(drag);
  } else {
    tree.children.push(drag);
  }
  cleanupTree(tree);
  return true;
}
// Wrap the whole current expression in one group (each press nests deeper).
// Returns the NEW root (the caller reassigns its tree) or null when there is
// nothing to wrap. A single-condition wrap collapses via cleanup (nothing
// meaningful to group).
export function wrapAllInGroup(tree: HologramQueryGroup): HologramQueryGroup | null {
  if (!tree.children.length) return null;
  const g = { kind: 'group', op: tree.op, neg: false, children: tree.children } as HologramQueryGroup;
  const root = { kind: 'group', op: 'and', neg: false, children: [g] } as HologramQueryGroup;
  cleanupTree(root);
  return root;
}

// --- Facet domain (改訂④ ファセット・チップ).
// The UI only ever BUILDS facet-CNF trees: root group(and) whose children are
// per-type groups (2+ positive values of one type), bare positive leaves, and
// negated leaves (the 除く cluster — root-AND makes them "none of these").
// Arbitrary trees remain evaluable (evalNode is untouched) for persisted
// 改訂③ states; the bar just renders those read-only.
// opts: { multiValueTypes: string[], standaloneTypes: string[] } — view-owned
// type schemas (posts vs posters differ), injected like predOf. ---
/** Default within-cluster operator: multi-value attributes narrow by default
 *  (すべて); for single-value attributes "any of" is the only satisfiable read. */
export function facetDefaultOp(type: string, opts: HologramFacetOpts): 'and' | 'or' {
  return (opts.multiValueTypes || []).includes(type) ? 'and' : 'or';
}
// Strict facet analysis. null = NOT facet-shaped (OR root / real nesting /
// negated, empty or mixed-type groups / two containers of one type) → the bar
// falls back to a read-only summary. Semantics-preserving with ONE deliberate
// repair: 2+ bare single-value leaves of one type read as 'or' (their root-AND
// was the 改訂③ two-platform always-false trap).
export function facetViewOf(tree: HologramQueryGroup, opts: HologramFacetOpts): HologramFacetView | null {
  if (!tree || tree.kind !== 'group' || tree.op !== 'and' || tree.neg) return null;
  const standalone = new Set<string>(opts.standaloneTypes || []);
  const multi = new Set<string>(opts.multiValueTypes || []);
  const clusters = new Map<string, HologramFacetCluster>(); // type → cluster (insertion order = display order)
  const singles: HologramQueryLeaf[] = [];
  const excl: HologramQueryLeaf[] = [];
  for (const c of tree.children) {
    if (c.kind === 'cond') {
      if (c.neg) {
        excl.push(c);
        continue;
      }
      if (standalone.has(c.type)) {
        singles.push(c);
        continue;
      }
      const cl = clusters.get(c.type);
      if (cl) {
        if (cl.grouped) return null; // group + stray leaf of one type = cluster∧leaf, not a cluster
        cl.leaves.push(c);
        cl.op = multi.has(c.type) ? 'and' : 'or'; // bare leaves combine via the root AND (single-value: repaired)
      } else clusters.set(c.type, { type: c.type, op: facetDefaultOp(c.type, opts), leaves: [c], grouped: false });
      continue;
    }
    if (c.kind !== 'group' || c.neg || !c.children.length) return null;
    const first = c.children[0];
    const t = first.kind === 'cond' ? first.type : null;
    if (!t || standalone.has(t) || clusters.has(t)) return null;
    for (const l of c.children) if (l.kind !== 'cond' || l.neg || l.type !== t) return null;
    clusters.set(t, { type: t, op: multi.has(t) ? c.op : 'or', leaves: c.children.slice() as HologramQueryLeaf[], grouped: true });
  }
  return { clusters: Array.from(clusters.values()), singles, excl };
}
// Rebuild a facet-shaped tree into canonical form IN PLACE: every 2+-value
// cluster becomes a real group (the すべて/どれか toggle needs a node to write
// to), ordered clusters → standalone leaves → excluded leaves. Returns true
// when the tree was facet-shaped (now canonical); false leaves it untouched.
export function canonicalizeFacet(tree: HologramQueryGroup, opts: HologramFacetOpts): boolean {
  const v = facetViewOf(tree, opts);
  if (!v) return false;
  const out: HologramQueryNode[] = [];
  for (const cl of v.clusters) out.push(cl.leaves.length === 1 ? cl.leaves[0] : ({ kind: 'group', op: cl.op, neg: false, children: cl.leaves } as HologramQueryGroup));
  out.push(...v.singles, ...v.excl);
  tree.children = out;
  return true;
}
// Insert a POSITIVE leaf into its type cluster: join the existing group, wrap
// the existing bare leaf + the newcomer into a fresh group (default op), or
// land at the top level (standalone types always do). Callers handle
// single-value replacement and dup checks; only call on facet-shaped trees.
export function facetAdd(tree: HologramQueryGroup, node: HologramQueryLeaf, opts: HologramFacetOpts): HologramQueryLeaf {
  if (!(opts.standaloneTypes || []).includes(node.type)) {
    for (let i = 0; i < tree.children.length; i++) {
      const c = tree.children[i];
      if (c.kind === 'group' && !c.neg && c.children.length && c.children[0].kind === 'cond' && c.children[0].type === node.type) {
        c.children.push(node);
        return node;
      }
      if (c.kind === 'cond' && !c.neg && c.type === node.type) {
        tree.children[i] = { kind: 'group', op: facetDefaultOp(node.type, opts), neg: false, children: [c, node] };
        return node;
      }
    }
  }
  tree.children.push(node);
  return node;
}
// The すべて/どれか toggle: set a cluster's operator. Clusters with 2+ values
// are real groups in a canonical tree; false when no such group exists.
export function facetSetOp(tree: HologramQueryGroup, type: string, op: string): boolean {
  for (const c of tree.children) {
    if (c.kind === 'group' && !c.neg && c.children.length && c.children[0].kind === 'cond' && c.children[0].type === type) {
      c.op = op === 'and' ? 'and' : 'or';
      return true;
    }
  }
  return false;
}
// Move a leaf between its cluster and the 除く cluster: detach, flip neg,
// re-insert (negated → top level; positive → back through facetAdd). A value
// returning while it already exists positively is dropped as redundant.
export function facetSetNeg(tree: HologramQueryGroup, node: HologramQueryLeaf, neg: boolean, opts: HologramFacetOpts): boolean {
  if (!!node.neg === !!neg) return false;
  detachNode(node, treeParentMap(tree));
  cleanupTree(tree);
  node.neg = !!neg;
  if (neg) {
    tree.children.push(node);
    return true;
  }
  const dup = treeLeaves(tree).some((c) => !c.neg && c.type === node.type && c.value === node.value);
  if (!dup) facetAdd(tree, node, opts);
  return true;
}

// --- Pure post helpers (used by the predicates below and by viewer.ts). ---
// Date filters compare in LOCAL days: from = local midnight, to = the NEXT
// local midnight (exclusive), so a single-day range covers the whole day.
export function localDayRange(from?: string | null, to?: string | null): { from: Date | null; to: Date | null } {
  return {
    from: from ? new Date(from + 'T00:00:00') : null,
    to: to
      ? (() => {
          const d = new Date(to + 'T00:00:00');
          d.setDate(d.getDate() + 1);
          return d;
        })()
      : null,
  };
}
export const hostOf = (url: string | null | undefined): string => {
  try {
    return new URL(url as string).hostname;
  } catch {
    return '';
  }
};
// Stable per-author key: prefer the platform user id, fall back to the handle.
export const userKey = (p: HologramPost): string => p.platform + ':' + (p.userId || '@' + (p.screenName || ''));
// Every text-ish field a free-text query can match against.
// (p.description = Eagle-migration annotation — real prose, so it belongs here.)
// media[].alt (#288): saved ALT text — X `ext_alt_text` / Bluesky `alt` / Misskey
// file `comment` / Mastodon attachment `description`, already captured on save.
// pixiv has no ALT concept (media[].alt is always null there) so this is a no-op
// for that platform. This is the ONLY live free-text search path today — the
// SQLite posts_fts index (lib-db-schema.ts) is not wired into the search UX yet
// (searchPostsFts in lib-db-query.ts has no caller outside tests/bench; #29 is
// the eventual consumer), so adding alt there would not change what a user can
// find until that stage lands.
export function textHaystackOf(p: HologramPost): string[] {
  return [p.text, p.title, p.eagleName, p.screenName, p.displayName, p.description]
    .concat(p.tags || [])
    .concat(p.hashtags || [])
    .concat((p.media || []).map((m: any) => m?.alt))
    .map((x) => (x == null ? '' : String(x)));
}

// --- Saved-leaf schema self-heal for retired leaf-type names ----------------
// The single place to record retired leaf-type renames. sanitizeSavedTabs runs
// every persisted tree + shadow (state.tree / state.f) through normalizeTree /
// normalizeLeaf on load, so an old tabs.json self-heals on the next write — no
// bulk rewrite script and no permanent predicate alias to carry. This is a
// standing mechanism, not one-off migration scaffolding: add a row here whenever
// a leaf `type` is renamed, now or in the future; unknown types pass through and
// the predicate fail-opens (default → () => true), so the chip still shows its type.
const LEAF_TYPE_RENAMES: Record<string, string> = { collection: 'folder' };
export function normalizeLeaf<T extends { type?: unknown }>(leaf: T): T {
  if (leaf && typeof (leaf as any).type === 'string') {
    const to = LEAF_TYPE_RENAMES[(leaf as any).type];
    if (to) (leaf as any).type = to;
  }
  return leaf;
}
// Recursively normalize every leaf in a query tree, in place. A group carries
// children; anything else is treated as a leaf.
export function normalizeTree(node: any): any {
  if (!node || typeof node !== 'object') return node;
  if (node.kind === 'group' && Array.isArray(node.children)) node.children.forEach(normalizeTree);
  else normalizeLeaf(node);
  return node;
}

// --- Post-side leaf predicate factory: a leaf condition → (post)=>bool. ---
// deps carry the runtime couplings the engine must not own:
//   isInFolder(id, captureId) — folders.ts state
//   fuzzyCompile(q) → matcher(string)=>bool, or null to fall back to exact
//   tagIdOf(name) → the DB tag id for a tag name (#5 2026-07-18 comment — tags
//     are an ID entity; a saved leaf that only has a name lazily resolves and
//     caches its id the first time it's evaluated post-DB-migration, below)
export function makePostPredOf(deps: {
  /** `only` = the leaf's 「このフォルダのみ」 flag; without it a folder stands for its subtree (#41). */
  isInFolder(id: string, captureId: string, only?: boolean): boolean;
  fuzzyCompile?(q: string): ((hay: string) => boolean) | null;
  postKeyOf?(url: string | null | undefined): string | null;
  tagIdOf?(name: string): number | undefined;
}): (f: HologramQueryLeaf) => (p: HologramPost) => boolean {
  return function postPredOf(f) {
    switch (f.type) {
      // 'post' = SNS投稿（リンクあり）/ 'image' = 取り込み画像（リンクなし）。url の有無が本質。
      case 'kind':
        return (p) => (f.value === 'post') === !!p.url;
      case 'platform':
        return (p) => (f.value === '__none' ? !p.platform : p.platform === f.value);
      case 'user':
        return (p) => userKey(p) === f.value;
      case 'instance':
        return (p) => (p.platform === 'misskey' || p.platform === 'mastodon') && hostOf(p.url) === f.value;
      case 'postType':
        return (p) => (f.value === 'post' ? !p.isReply && !p.isQuote && !p.isThread : f.value === 'reply' ? !!p.isReply : f.value === 'quote' ? !!p.isQuote : !!p.isThread);
      case 'media':
        return (p) => p.mediaType === f.value;
      // Tag leaves match by tagId when one is available — a rename changes
      // posts[].tags (the display name) but never the id, so a leaf pinned to
      // an id survives it (#5 2026-07-18 comment). A leaf saved before the DB
      // migration carries only `value` (name); it resolves and caches its
      // tagId here on first evaluation (mirrors the 'text' leaf's _compiled
      // memo below) rather than needing a separate migration pass over
      // tabs.json. Falls back to name matching when no id is resolvable
      // (deps.tagIdOf absent, or the name no longer exists) — never a hard
      // failure for an old or since-deleted tag.
      case 'tag': {
        if (f.tagId == null && deps.tagIdOf) f.tagId = deps.tagIdOf(f.value);
        return (p) => (f.tagId != null ? (p.tagIds || []).includes(f.tagId) : (p.tags || []).includes(f.value));
      }
      case 'hashtag':
        return (p) => (p.hashtags || []).includes(f.value);
      // A folder leaf means the folder AND everything nested under it; `only`
      // narrows it to the folder's own posts (#41). The flag is absent by
      // default, so every tree written before nesting keeps meaning what it
      // meant when nothing had children.
      case 'folder':
        return (p) => deps.isInFolder(f.value, p.captureId, f.only);
      case 'date': {
        const field = f.dateField || 'date';
        const { from, to } = localDayRange(f.from, f.to); // local-day bounds (see localDayRange)
        return (p) => {
          if (!p[field]) return false;
          const d = new Date(p[field]);
          return (!from || d >= from) && (!to || d < to);
        };
      }
      case 'engagement': {
        if (!(f.min > 0)) return () => true;
        return (p) => (f.op === 'lte' ? (p[f.engType] || 0) <= f.min : (p[f.engType] || 0) >= f.min);
      }
      // Free-text leaf: the search-box term, now a first-class tree citizen,
      // matched by the single smart matcher (deps.fuzzyCompile; the per-leaf
      // exact/fuzzy mode field is gone — P2④ 単一スマート検索). The compiled
      // matcher is memoized on the node — evalNode calls postPredOf per item, so
      // compiling in the bare factory body would recompile once per post.
      // The !_compiled guard is essential: a node round-tripped through JSON
      // (saved search / tab state / setTree's clone) keeps the string _compiledKey
      // but loses the _compiled function — recompile instead of returning undefined.
      case 'text': {
        const q = (f.value || '').trim();
        if (!q) return () => true;
        const key = q;
        if (f._compiledKey !== key || !f._compiled) {
          f._compiledKey = key;
          // URL probe: url/quotedUrl are matched only for URL-shaped queries
          // (contains '.' or '/') and always as plain substrings — never fuzzy,
          // because subsequence-matching short latin terms against long URLs
          // hits almost everything. A full pasted URL additionally matches by
          // normalized post key (deps.postKeyOf) so x.com⇄twitter.com and
          // tracking-param variants of a saved post still hit.
          const lq = q.toLowerCase();
          const urlish = /[./]/.test(q);
          const qKey = urlish && deps.postKeyOf ? deps.postKeyOf(q) : null;
          const urlHit: ((p: HologramPost) => boolean) | null = !urlish ? null : (p: HologramPost) => (qKey != null && (p._postKey === qKey || p._quotedKey === qKey)) || (p.url || '').toLowerCase().includes(lq) || (p.quotedUrl || '').toLowerCase().includes(lq);
          const m = deps.fuzzyCompile ? deps.fuzzyCompile(q) : null;
          if (m) {
            f._compiled = (p: HologramPost) => m(textHaystackOf(p).join(' ')) || (urlHit != null && urlHit(p));
          } else {
            f._compiled = (p: HologramPost) => textHaystackOf(p).some((s) => s.toLowerCase().includes(lq)) || (urlHit != null && urlHit(p));
          }
        }
        return f._compiled;
      }
      default:
        return () => true;
    }
  };
}

// --- Poster-side leaf predicate factory: a poster-filter leaf → (poster)=>bool.
// Mirrors makePostPredOf so both builders (posts / posters) source their
// predicate from this one engine (previously posterPredOf lived in viewer.ts —
// an asymmetry with the extracted post side). Poster facets are a subset
// (platform / instance / tag / folder / date). deps carry the poster-only
// couplings the engine must not own:
//   posterTagsOf(key) → string[]           — tags.ts (作品/キャラ share 'tag')
//   folderById(id) → {items:string[]}|null — poster-folders.js state
export function makePosterPredOf(deps: { posterTagsOf(key: string): string[]; folderById(id: string): { items: string[] } | null | undefined }): (f: HologramQueryLeaf) => (u: HologramUserAgg) => boolean {
  return function posterPredOf(f) {
    switch (f.type) {
      case 'platform':
        return (u) => u.platform === f.value;
      case 'instance':
        return (u) => u.instance === f.value;
      case 'tag':
        return (u) => deps.posterTagsOf(u.key).includes(f.value); // 作品/キャラも同じ tag 型
      case 'folder': {
        const fo = deps.folderById(f.value);
        const set = new Set(fo ? fo.items : []);
        return (u) => set.has(u.key);
      }
      case 'date': {
        const field = (f.dateField || 'latest') as keyof HologramUserAgg; // latest | lastCapture | authorCreatedAt
        const { from, to } = localDayRange(f.from, f.to); // local-day bounds (see localDayRange)
        return (u) => {
          const v = u[field];
          if (!v) return false;
          const d = new Date(v);
          return (!from || d >= from) && (!to || d < to);
        };
      }
      default:
        return () => true;
    }
  };
}
