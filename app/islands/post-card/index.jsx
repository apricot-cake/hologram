import { renderToStaticMarkup } from 'react-dom/server';
import { PostCard } from './PostCard.jsx';

// Card markup generator for the post grid. Unlike every other island, React does
// NOT own #postGrid — viewer.js keeps its hand-written keyed reconcile (data-key
// + data-sig node reuse so each <img> survives), its JS masonry column packing,
// its windowed load-more (renderLimit + IntersectionObserver), and ALL #postGrid
// event delegation. This island only TURNS A MODEL INTO THE CARD HTML STRING that
// viewer.js feeds into that machinery, so React is used here as a template
// (renderToStaticMarkup), not as a runtime root. The emitted DOM stays identical
// to the old cardHtml, so the delegated handlers + CSS keep working unchanged.
//
// Loaded BEFORE viewer.js (see index.html) so cardHtml() can call this on the
// very first renderPosts(). i18n labels are pushed once per render via setLabels
// (they're the same for every card), so the per-card model stays data-only.

let LABELS = {};

function setLabels(l) { LABELS = l || {}; }

function html(model) {
  return renderToStaticMarkup(<PostCard m={model} L={LABELS} />);
}

window.corpusPostCard = { setLabels, html };

// In dev this island is a deferred module loaded AFTER viewer.js, so an early
// renderPosts() may have stashed itself waiting for us — replay it now.
if (window.__corpusOnPostCardReady) {
  const replay = window.__corpusOnPostCardReady;
  window.__corpusOnPostCardReady = null;
  replay();
}
