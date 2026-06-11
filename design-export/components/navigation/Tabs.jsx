import React from 'react';

/**
 * Tabs — the in-sidebar tab strip (投稿 / ハッシュタグ / ユーザー / 設定).
 * Vertical by default (sidebar); pass orientation="horizontal" for a top strip.
 * Active tab gets accent text + a leading rail (vertical) or underline (horizontal).
 */
export function Tabs({
  items = [],             // [{ id, label }]
  value,
  onChange,
  orientation = 'vertical',
  style = {},
}) {
  const vertical = orientation === 'vertical';
  return (
    <div style={{
      display: 'flex', flexDirection: vertical ? 'column' : 'row',
      gap: vertical ? 2 : 4,
      borderBottom: vertical ? 'none' : '1px solid var(--border)',
      ...style,
    }}>
      {items.map((it) => {
        const active = it.id === value;
        const base = {
          appearance: 'none', background: active ? 'var(--accent-subtle)' : 'transparent',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          fontFamily: 'var(--font-sans)', fontSize: 'var(--text-md)', fontWeight: 'var(--weight-medium)',
          color: active ? 'var(--accent-subtle-fg)' : 'var(--text-muted)',
          transition: 'color var(--dur-base), background var(--dur-base), border-color var(--dur-base)',
          ...(vertical
            ? { padding: '8px 12px', borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`, borderRadius: '0 var(--radius-sm) var(--radius-sm) 0' }
            : { padding: '9px 4px', marginBottom: -1, borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`, background: 'transparent' }),
        };
        return (
          <button key={it.id} type="button" style={base} onClick={() => onChange && onChange(it.id)}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-strong)'; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
