import React from 'react';

/**
 * IconButton — a square, icon-only control. Used for tile/row hover actions
 * (folder, info, open, delete) and toolbar affordances.
 * `tone="onMedia"` renders the dark translucent pill used over imagery;
 * `tone="surface"` is the bordered chrome variant.
 */
export function IconButton({
  icon,
  label,                  // accessible label (title + aria-label)
  tone = 'surface',       // surface | onMedia | ghost
  size = 'md',            // sm | md | lg
  danger = false,
  active = false,
  onClick,
  style = {},
  ...rest
}) {
  const dim = { sm: 24, md: 28, lg: 34 }[size];

  const tones = {
    surface: {
      background: active ? 'var(--accent)' : 'var(--surface)',
      color: active ? 'var(--accent-fg)' : 'var(--text-muted)',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
    },
    onMedia: {
      background: active ? 'var(--accent)' : 'rgba(8,10,14,0.62)',
      color: '#fff', border: '1px solid transparent',
    },
    ghost: {
      background: 'transparent', color: 'var(--text-muted)',
      border: '1px solid transparent',
    },
  }[tone];

  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: dim, height: dim, flexShrink: 0, padding: 0,
    fontSize: size === 'lg' ? 14 : 12, lineHeight: 1,
    borderRadius: tone === 'onMedia' ? 'var(--radius-xs)' : 'var(--radius-sm)',
    cursor: 'pointer',
    transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast), border-color var(--dur-fast)',
    ...tones, ...style,
  };

  const hover = danger
    ? (tone === 'onMedia' ? '#c0392b' : 'var(--danger-bg)')
    : (tone === 'onMedia' ? 'var(--accent)' : 'var(--hover)');
  const hoverColor = danger && tone !== 'onMedia' ? 'var(--danger)'
    : (tone === 'onMedia' ? '#fff' : 'var(--accent)');

  return (
    <button
      type="button" title={label} aria-label={label} onClick={onClick} style={base}
      onMouseEnter={(e) => { e.currentTarget.style.background = hover; e.currentTarget.style.color = hoverColor; if (tone === 'surface') e.currentTarget.style.borderColor = danger ? 'var(--danger)' : 'var(--accent)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = tones.background; e.currentTarget.style.color = tones.color; if (tone === 'surface') e.currentTarget.style.borderColor = active ? 'var(--accent)' : 'var(--border-strong)'; }}
      {...rest}
    >
      {icon}
    </button>
  );
}
