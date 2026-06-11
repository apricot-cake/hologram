import React from 'react';

/**
 * Chip — the pill filter / tag control. A brand-core component: the sidebar
 * filters, tag chips, and active-filter bar are all Chips.
 * - default: neutral pill, hover lifts border+text to accent
 * - active: solid accent fill
 * - removable: shows an × and calls onRemove
 * - category: faint per-facet tint for active-filter pills (platform/date/…)
 */
export function Chip({
  children,
  active = false,
  count = null,
  leading = null,         // e.g. ★ for default folder
  removable = false,
  onRemove,
  onClick,
  category = null,        // platform | postType | date | engagement | tag | media | user
  size = 'md',            // sm | md
  style = {},
  ...rest
}) {
  const pad = size === 'sm' ? '2px 9px' : '4px 11px';
  const font = size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)';

  // Category tints (used on active-filter pills). Subtle, theme-aware.
  const tint = category ? {
    background: 'var(--accent-subtle)',
    color: 'var(--accent-subtle-fg)',
    border: '1px solid var(--accent-border)',
  } : null;

  const base = active ? {
    background: 'var(--accent)', color: 'var(--accent-fg)', border: '1px solid var(--accent)',
  } : tint || {
    background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)',
  };

  const wrap = {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    padding: pad, fontFamily: 'var(--font-sans)', fontSize: font, fontWeight: 'var(--weight-medium)',
    lineHeight: 1.4, whiteSpace: 'nowrap', borderRadius: 'var(--radius-pill)',
    cursor: 'pointer', userSelect: 'none',
    transition: 'background var(--dur-base) var(--ease-out), border-color var(--dur-base), color var(--dur-base)',
    ...base, ...style,
  };

  return (
    <button
      type="button" onClick={onClick} style={wrap}
      onMouseEnter={(e) => { if (!active && !category) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; } else if (category || active) { e.currentTarget.style.opacity = '0.82'; } }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; if (!active && !category) { e.currentTarget.style.borderColor = base.border.split(' ').slice(2).join(' '); e.currentTarget.style.color = base.color; } }}
      {...rest}
    >
      {leading && <span style={{ opacity: 0.85 }}>{leading}</span>}
      {children}
      {count != null && (
        <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', opacity: 0.6, fontSize: '0.92em' }}>{count}</span>
      )}
      {removable && (
        <span
          onClick={(e) => { e.stopPropagation(); onRemove && onRemove(); }}
          style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '1px', marginRight: '-2px', fontSize: '1.05em', lineHeight: 1, opacity: 0.7 }}
        >×</span>
      )}
    </button>
  );
}
