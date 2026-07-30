// Presentational post card — the one cell component of the virtualized grid
// component (grid/). Emits the same DOM contract the old string-template
// path did — `.post-card[data-url/data-index/data-key]` with the
// `.act-pill`,
// `.card-thumb > .card-img`,
// `.card-ntag`, `.card-overlay`, and the `.post-meta` block.
// That contract is LOAD-BEARING: every delegated click/contextmenu/dblclick
// handler on #postGrid and all grid CSS key off these class names + data attrs.
//
// viewer.js resolves all the data (image src, formatted counts/dates, selection,
// aspect, inspected) into a plain model; this component only lays it out.
// Raw strings (text, names) are passed unescaped — JSX escapes them.

import type { ReactEventHandler, Ref } from 'react';

// The cell model viewer.js resolves per card (see its cardModel()) — only the
// fields this component lays out.
export interface PostCardFootDate {
  label: string;
  title?: string | null;
}
export interface PostCardModel {
  index: number;
  url?: string | null;
  postKey?: string | null;
  selected?: boolean;
  noUrl?: boolean;
  inspected?: boolean;
  hasThumb?: boolean;
  imgSrc?: string | null;
  /** An mp4-backed GIF this density loops in place instead of showing a still
      (#476) — set by the model only for card/list. Takes the .card-img slot, so
      every delegated card gesture keeps working on it unchanged. */
  videoSrc?: string | null;
  /** Its poster still, painted until the first frame decodes. */
  videoPoster?: string | null;
  /** Video/gif(mp4) lead media: overlay a ▶ badge on the poster thumbnail
      (#119 St1). Not set for a real .gif — it already reads as animated — nor
      when videoSrc is playing that media right here. */
  videoBadge?: boolean;
  captureId?: string;
  aspRatio?: string | null;
  eager?: boolean;
  nImg?: number;
  /** Thumb srcs for the 2nd/3rd images of a multi-image group — they ride the
      back stack sheets (real thumbnails, not placeholders). */
  stackSrcs?: string[];
  userName?: string;
  likesOv?: string | number | null;
  handle?: string | null;
  flags: string[];
  mediaLabel?: string | null;
  text?: string | null;
  stats: Partial<Record<string, string | number | null>>;
  footDates: { post?: PostCardFootDate | null; cap?: PostCardFootDate | null };
  tags: string[];
}

// ── glyphs / icons (ported 1:1 from the old cardHtml) ──────────────────────────
// Engagement stat glyphs: outline TEXT presentation (not color emoji, not SVG).
const STAT_GLYPH = {
  likes: '\u2661', // heart
  reposts: '\u21c4', // repost
  replies: '\ud83d\udde8\ufe0e', // reply (text presentation)
  bookmarks: '\ud83d\udd16\ufe0e', // bookmark (text presentation)
};
const STAT_ORDER = ['likes', 'reposts', 'replies', 'bookmarks'] as const;

function _TagIcon() {
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

// onImgLoad reports a loaded image's natural aspect for cards without a
// reserved height (viewer.js caches it so the NEXT render reserves correctly).
export function PostCard({ m, L, cellRef, onImgLoad }: { m: PostCardModel; L: Record<string, string>; cellRef?: Ref<HTMLDivElement>; onImgLoad?: ReactEventHandler<HTMLImageElement> }) {
  const stats = STAT_ORDER.filter((k) => m.stats[k] != null);
  const fd = m.footDates;
  const hasStats = stats.length > 0;
  const hasFoot = !!(fd.post || fd.cap);
  return (
    <div ref={cellRef} className={'post-card' + ((m.nImg as number) > 1 ? ' grouped' : '') + (m.selected ? ' selected' : '') + (m.noUrl ? ' no-url' : '') + (m.inspected ? ' inspected' : '')} data-url={m.url} data-index={m.index} data-key={m.postKey}>
      {/* Multi-image group → the whole card reads as a duplicated pile: rotated
          dummy cards peek out BEHIND this one (z-index:-1), each carrying the
          group's 2nd/3rd real thumbnail. Per-layout geometry lives in CSS. */}
      {(m.nImg as number) > 1 &&
        (m.stackSrcs || []).map((src, k) => (
          <span key={k} className={'stack-sheet stack-s' + (k + 1)} aria-hidden="true">
            {src && <span className="stack-sheet-img" style={{ backgroundImage: `url("${src}")` }} />}
          </span>
        ))}
      <div className="act-pill" aria-hidden="true" />
      {/* draggable is spelled out on the <video> and on the placeholder — an <img>
          already is by default. All three hand the gesture to the #postGrid
          dragstart delegate, which cancels the HTML5 drag (it would carry the
          asset:// URL) and starts an OS drag of the ORIGINAL files instead (#132). */}
      {m.hasThumb && (
        <div className="card-thumb">
          {m.videoSrc ? (
            // muted is what makes autoplay legal at all (Chromium never blocks a
            // silent one); loop + playsInline make it read as the GIF it is, and
            // no `controls` keeps the card a card. It only exists while the cell
            // is mounted, and the grid unmounts everything outside the scrolled
            // window — so what plays is bounded by the viewport, not the library.
            // draggable: <video> is not draggable by default, and the drag-out
            // delegate (#132) is armed on .card-img.
            <video className="card-img" src={m.videoSrc} poster={m.videoPoster || undefined} data-cap={m.captureId} style={m.aspRatio ? { aspectRatio: m.aspRatio } : undefined} autoPlay muted loop playsInline draggable disablePictureInPicture />
          ) : m.imgSrc ? (
            <>
              <img className="card-img" src={m.imgSrc} alt="" data-cap={m.captureId} style={m.aspRatio ? { aspectRatio: m.aspRatio } : undefined} loading={m.eager ? 'eager' : 'lazy'} decoding="async" onLoad={onImgLoad} />
              {m.videoBadge && (
                <span className="card-play-badge" aria-hidden="true">
                  {'▶'}
                </span>
              )}
            </>
          ) : (
            <div className="card-img card-video" draggable>
              {'▶'}
            </div>
          )}
        </div>
      )}
      {(m.nImg as number) > 1 && <div className="card-ntag">{'×' + m.nImg}</div>}
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
                <span className="pdate" data-tip={fd.post.title || undefined}>
                  {fd.post.label}
                </span>
              )}
              {fd.cap && (
                <span className="cdate" data-tip={fd.cap.title || undefined}>
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
