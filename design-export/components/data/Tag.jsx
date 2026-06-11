import React from 'react';

/**
 * Tag — a small neutral metadata pill shown on cards and in detail views
 * (user-applied tags). Quieter than Chip: not interactive by default.
 * `tone="flag-type"` / `"flag-media"` render the post-type / media flags.
 */
export function Tag({ children, tone = 'default', style = {}, ...rest }) {
  const tones = {
    default:     { background: 'var(--surface-3)', color: 'var(--text-muted)' },
    'flag-type': { background: 'color-mix(in oklch, var(--accent) 12%, var(--surface))', color: 'var(--accent-subtle-fg)' },
    'flag-media':{ background: 'var(--surface-3)', color: 'var(--text-muted)' },
  }[tone];

  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '1px 8px', borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-sans)', fontSize: 'var(--text-2xs)', lineHeight: 1.6,
        whiteSpace: 'nowrap', ...tones, ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
