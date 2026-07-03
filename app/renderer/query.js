// Query engine — the boolean condition-tree core of Corpus filtering
// (docs/design-query-builder.md 改訂③), extracted 1:1 from viewer.js as the
// first "pure logic → service" slice of the viewer decomposition (最終形B).
// Plain IIFE on window (like store.js / search.js); loaded BEFORE viewer.js;
// touches no DOM. Runtime couplings (collections / clips / fuzzy matcher) are
// INJECTED via makePostPredOf(deps), so this file loads under a bare `window`
// shim in Node (scripts/test-query-unit.js).
(function () {
  'use strict';

  // --- Condition-tree machinery. The tree is ALWAYS a root group (op 'and' by
  // default); leaves are {kind:'cond', type, value, …}, groups carry children
  // and an optional neg. Shared by BOTH query builders (posts / posters). ---
  /** @returns {CorpusQueryGroup} */
  function emptyTree() {
    return { kind: 'group', op: 'and', neg: false, children: [] };
  }
  function treeLeaves(n, out) {
    out = out || [];
    if (!n) return out;
    if (n.kind === 'cond') out.push(n);
    else (n.children || []).forEach((c) => treeLeaves(c, out));
    return out;
  }
  function opposite(op) {
    return op === 'and' ? 'or' : 'and';
  }
  // Migration only: rebuild a tree from an old persisted faceted state (f + typeOps).
  function facetTreeFrom(f, ops) {
    const root = emptyTree();
    const NO_OP = new Set(['date', 'engagement', 'clip', 'workspace']);
    const byType = new Map();
    for (const x of f) {
      if (!byType.has(x.type)) byType.set(x.type, []);
      byType.get(x.type).push(x);
    }
    for (const [type, list] of byType) {
      const leaves = list.map((x) => Object.assign({ kind: 'cond' }, x));
      if (NO_OP.has(type)) {
        root.children.push(...leaves);
        continue;
      }
      const op = (ops || {})[type] || 'or';
      root.children.push({ kind: 'group', op: op === 'and' ? 'and' : 'or', neg: op === 'not', children: leaves });
    }
    return root;
  }
  // Recursive evaluation of a query tree against one item, using a view-supplied
  // leaf predicate factory (predOf). Shared by both builders (post + poster).
  function evalNode(n, item, predOf) {
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
  // wiring stays in viewer.js (createQueryBuilder), which binds these to its
  // per-instance tree. ---
  /** child → parent map, rebuilt for one surgery pass. */
  function treeParentMap(tree) {
    const m = new Map();
    (function rec(n) {
      (n.children || []).forEach((c) => {
        m.set(c, n);
        rec(c);
      });
    })(tree);
    return m;
  }
  function nodeContains(a, b) {
    if (a === b) return true;
    if (!a || a.kind !== 'group') return false;
    return (a.children || []).some((c) => nodeContains(c, b));
  }
  function detachNode(node, pmap) {
    const par = pmap.get(node);
    if (!par) return;
    const i = par.children.indexOf(node);
    if (i >= 0) par.children.splice(i, 1);
  }
  // Auto-clean: drop empty groups, collapse single-member non-root groups,
  // folding the group's negation into the survivor ("parentheses vanish once a
  // group is down to one member").
  function cleanupTree(tree) {
    (function rec(node) {
      if (node.kind !== 'group') return;
      const out = [];
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
  function hasLeafValue(tree, type, value) {
    return treeLeaves(tree).some((c) => c.type === type && c.value === value);
  }
  // Remove every cond leaf matching pred, anywhere in the tree (+ cleanup).
  // Returns whether anything was actually removed (callers gate a refresh on it).
  function removeCondsMatching(tree, pred) {
    const before = treeLeaves(tree).length;
    (function rec(node) {
      if (node.kind !== 'group') return;
      node.children = node.children.filter((c) => !(c.kind === 'cond' && pred(c)));
      node.children.forEach(rec);
    })(tree);
    cleanupTree(tree);
    return treeLeaves(tree).length !== before; // changed?
  }
  // Shadow-filter identity: date matches by type alone (single date condition),
  // engagement by engType, everything else by value.
  function sameLeaf(c, f) {
    if (c.type !== f.type) return false;
    if (f.type === 'date') return true; // single date condition
    if (f.type === 'engagement') return c.engType === f.engType;
    return c.value === f.value;
  }
  // The flat (deduped) leaf shadow — what the sidebar highlight / row badges /
  // tab title consume. date/engagement pass through whole (minus tree-only
  // fields); other types dedupe on type+value.
  function buildShadow(tree) {
    const seen = new Set();
    const out = [];
    for (const c of treeLeaves(tree)) {
      if (c.type === 'date' || c.type === 'engagement') {
        const f = Object.assign({}, c);
        delete f.kind;
        delete f.neg;
        out.push(f);
        continue;
      }
      const k = c.type + ' ' + c.value;
      if (seen.has(k)) continue;
      seen.add(k);
      const f = { type: c.type, value: c.value };
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
  function dropNode(tree, drag, target, mode) {
    if (!target || target === drag || nodeContains(drag, target)) return false;
    const pmap = treeParentMap(tree);
    detachNode(drag, pmap); // remove from its current parent first
    if (mode === 'pair') {
      const par = pmap.get(target) || tree;
      const g = { kind: 'group', op: opposite(par.op), neg: false, children: [target, drag] };
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
  /**
   * @param {CorpusQueryGroup} tree
   * @returns {CorpusQueryGroup | null}
   */
  function wrapAllInGroup(tree) {
    if (!tree.children.length) return null;
    /** @type {CorpusQueryGroup} */
    const g = { kind: 'group', op: tree.op, neg: false, children: tree.children };
    /** @type {CorpusQueryGroup} */
    const root = { kind: 'group', op: 'and', neg: false, children: [g] };
    cleanupTree(root);
    return root;
  }

  // --- Pure post helpers (used by the predicates below and by viewer.js). ---
  // Date filters compare in LOCAL days: from = local midnight, to = the NEXT
  // local midnight (exclusive), so a single-day range covers the whole day.
  function localDayRange(from, to) {
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
  const hostOf = (url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  };
  // Stable per-author key: prefer the platform user id, fall back to the handle.
  const userKey = (p) => p.platform + ':' + (p.userId || '@' + (p.screenName || ''));
  // Every text-ish field a free-text query can match against.
  // (p.description = Eagle-migration annotation — real prose, so it belongs here.)
  function textHaystackOf(p) {
    return [p.text, p.title, p.eagleName, p.screenName, p.displayName, p.description]
      .concat(p.tags || [])
      .concat(p.hashtags || [])
      .map((x) => (x == null ? '' : String(x)));
  }

  // --- Post-side leaf predicate factory: a leaf condition → (post)=>bool. ---
  // deps carry the runtime couplings the engine must not own:
  //   isInCollection(id, captureId) / isClipped(captureId) — folders.js state
  //   fuzzyCompile(q) → matcher(string)=>bool, or null to fall back to exact
  function makePostPredOf(deps) {
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
        case 'tag':
          return (p) => (p.tags || []).includes(f.value);
        case 'hashtag':
          return (p) => (p.hashtags || []).includes(f.value);
        case 'collection':
          return (p) => deps.isInCollection(f.value, p.captureId);
        case 'clip':
          return (p) => deps.isClipped(p.captureId);
        case 'workspace':
          return (p) => deps.isClipped(p.captureId); // legacy alias for any old persisted ws leaf (tabs.json)
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
        // Free-text leaf: the search-box term, now a first-class tree citizen.
        // mode (exact/fuzzy) is frozen onto the leaf at confirm time. The compiled
        // matcher is memoized on the node — evalNode calls postPredOf per item, so
        // compiling in the bare factory body would recompile once per post.
        // The !_compiled guard is essential: a node round-tripped through JSON
        // (saved search / tab state / setTree's clone) keeps the string _compiledKey
        // but loses the _compiled function — recompile instead of returning undefined.
        case 'text': {
          const q = (f.value || '').trim();
          if (!q) return () => true;
          const key = q + '\0' + (f.mode || 'exact');
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
            const urlHit = !urlish ? null : (p) => (qKey != null && (p._postKey === qKey || p._quotedKey === qKey)) || (p.url || '').toLowerCase().includes(lq) || (p.quotedUrl || '').toLowerCase().includes(lq);
            const m = f.mode === 'fuzzy' && deps.fuzzyCompile ? deps.fuzzyCompile(q) : null;
            if (m) {
              f._compiled = (p) => m(textHaystackOf(p).join(' ')) || (urlHit != null && urlHit(p));
            } else {
              f._compiled = (p) => textHaystackOf(p).some((s) => s.toLowerCase().includes(lq)) || (urlHit != null && urlHit(p));
            }
          }
          return f._compiled;
        }
        default:
          return () => true;
      }
    };
  }

  window.corpusQuery = { emptyTree, treeLeaves, opposite, facetTreeFrom, evalNode, treeParentMap, nodeContains, detachNode, cleanupTree, hasLeafValue, removeCondsMatching, sameLeaf, buildShadow, dropNode, wrapAllInGroup, localDayRange, hostOf, userKey, textHaystackOf, makePostPredOf };
})();
