// Presentational post card — the one cell component of the virtualized grid
// island (islands/grid). Emits the same DOM contract the old string-template
// path did — `.post-card[data-url/data-index/data-key]` with the
// `.select-check`, `.act-pill`, `.clip-btn[data-clip]` / `.info-btn[data-info]`
// / `.tag-btn[data-tagedit]` hover buttons, `.card-thumb > .card-img`
// (+ `.pf-badge`), `.card-ntag`, `.card-overlay`, and the `.post-meta` block.
// That contract is LOAD-BEARING: every delegated click/contextmenu/dblclick
// handler on #postGrid and all grid CSS key off these class names + data attrs.
//
// viewer.js resolves all the data (image src, formatted counts/dates, selection,
// clip, aspect, inspected) into a plain model; this component only lays it out.
// Raw strings (text, names) are passed unescaped — JSX escapes them.

// ── glyphs / icons (ported 1:1 from the old cardHtml) ──────────────────────────
// Engagement stat glyphs: outline TEXT presentation (not color emoji, not SVG).
const STAT_GLYPH = {
  likes: '\u2661', // heart
  reposts: '\u21c4', // repost
  replies: '\ud83d\udde8\ufe0e', // reply (text presentation)
  bookmarks: '\ud83d\udd16\ufe0e', // bookmark (text presentation)
};
const STAT_ORDER = ['likes', 'reposts', 'replies', 'bookmarks'];

function ClipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="7.6" x2="12" y2="7.7" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  );
}

// 📷 capture-date mark next to the secondary (captured) date.
function CdateIcon() {
  return (
    <svg className="cdate-ic" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

// Platform source badge on the thumbnail's bottom-left.
function PfBadge({ platform, name }) {
  return (
    <div className="pf-badge" title={name}>
      <span className={'pf-dot ' + platform} />
      <span className="pf-badge-name">{name}</span>
    </div>
  );
}

// onImgLoad reports a loaded image's natural aspect for cards without a
// reserved height (viewer.js caches it so the NEXT render reserves correctly).
export function PostCard({ m, L, cellRef, onImgLoad }) {
  const stats = STAT_ORDER.filter((k) => m.stats[k] != null);
  const fd = m.footDates;
  const hasStats = stats.length > 0;
  const hasFoot = !!(fd.post || fd.cap);
  return (
    <div ref={cellRef} className={'post-card' + (m.selected ? ' selected' : '') + (m.noUrl ? ' no-url' : '') + (m.inspected ? ' inspected' : '')} data-url={m.url} data-index={m.index} data-key={m.postKey}>
      <div className="select-check" title={L.tipSelect} />
      <div className="act-pill" aria-hidden="true" />
      <button className={'clip-btn' + (m.clipped ? ' in' : '')} data-clip={m.index} title={L.tipClip}>
        <ClipIcon />
      </button>
      <button className="info-btn" data-info={m.index} title={L.tipInfo} aria-label={L.tipInfo}>
        <InfoIcon />
      </button>
      <button className="tag-btn" data-tagedit={m.index} title={L.tipTagEdit} aria-label={L.tipTagEdit}>
        <TagIcon />
      </button>
      {m.hasThumb && (
        <div className="card-thumb">
          {m.imgSrc ? <img className="card-img" src={m.imgSrc} alt="" data-cap={m.captureId} style={m.aspRatio ? { aspectRatio: m.aspRatio } : undefined} loading={m.eager ? 'eager' : 'lazy'} decoding="async" onLoad={onImgLoad} /> : <div className="card-img card-video">{'▶'}</div>}
          {m.platform && <PfBadge platform={m.platform} name={m.pfName} />}
        </div>
      )}
      {m.nImg > 1 && <div className="card-ntag">{'×' + m.nImg}</div>}
      <div className="card-overlay">
        <span className="ov-author">{m.userName}</span>
        {m.likesOv != null && <span className="ov-likes">{'♡ ' + m.likesOv}</span>}
      </div>
      <div className="post-meta">
        <div className="user">
          <span className="uname">{m.userName}</span>
          {m.handle && <span className="handle">{m.handle}</span>}
        </div>
        {(m.flags.length > 0 || m.mediaLabel) && (
          <div className="post-flags">
            {m.flags.map((f, k) => (
              <span className="post-flag flag-type" key={k}>
                {f}
              </span>
            ))}
            {m.mediaLabel && <span className="post-flag flag-media">{m.mediaLabel}</span>}
          </div>
        )}
        {m.text && (
          <div className="text">
            {m.text}
            <span className="text-hint">{L.clickToExpand}</span>
          </div>
        )}
        {(hasStats || hasFoot) && (
          <div className="post-foot">
            {hasStats && (
              <div className="stats">
                {stats.map((k) => (
                  <span className="st" key={k}>
                    {STAT_GLYPH[k] + ' ' + m.stats[k]}
                  </span>
                ))}
              </div>
            )}
            <span className="foot-r">
              {fd.post && (
                <span className="pdate" title={fd.post.title || undefined}>
                  {fd.post.label}
                </span>
              )}
              {fd.cap && (
                <span className="cdate" title={fd.cap.title || undefined}>
                  <CdateIcon />
                  {fd.cap.label}
                </span>
              )}
            </span>
          </div>
        )}
        {m.tags.length > 0 && (
          <div className="tags-label">
            {m.tags.map((t, k) => (
              <span className="tag-chip" key={k}>
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
