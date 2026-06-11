import React from 'react';

const BRAND = {
  x:        { bg: 'var(--brand-x)',        fg: '#fff' },
  bluesky:  { bg: 'var(--brand-bluesky)',  fg: '#fff' },
  misskey:  { bg: 'var(--brand-misskey)',  fg: '#1a2e05' },
  mastodon: { bg: 'var(--brand-mastodon)', fg: '#fff' },
  pixiv:    { bg: 'var(--brand-pixiv)',    fg: '#fff' },
};

/**
 * PlatformBadge — the small brand-colored capsule identifying a post's source.
 * The only place platform brand colors appear. In dark theme the X badge
 * inverts to light (via --brand-x).
 */
export function PlatformBadge({ platform = 'x', style = {}, ...rest }) {
  const key = String(platform).toLowerCase();
  const c = BRAND[key] || { bg: 'var(--text-muted)', fg: '#fff' };
  // dark-theme X badge: light bg, dark text. Detect via CSS var fallback handled
  // by --brand-x flip; force readable text for X specifically.
  const isX = key === 'x';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '2px 7px', borderRadius: 'var(--radius-xs)',
        background: c.bg, color: isX ? 'var(--surface)' : c.fg,
        fontFamily: 'var(--font-sans)', fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)',
        letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.4, whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {key === 'pixiv' ? 'pixiv' : key}
    </span>
  );
}
