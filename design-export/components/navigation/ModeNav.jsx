import React from 'react';

/**
 * ModeNav — the top-level mode switcher (投稿閲覧 / 画像閲覧). Always visible,
 * sticky across modes. Each item is an icon + label; the active item gets the
 * accent-subtle wash + accent text/icon. Designed to sit at the top of the
 * sidebar.
 */
export function ModeNav({ items = [], value, onChange, style = {} }) {
  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, ...style }}>
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button key={it.id} type="button" onClick={() => onChange && onChange(it.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              border: 'none', cursor: 'pointer', textAlign: 'left',
              padding: '8px 10px', borderRadius: 'var(--radius-md)',
              background: active ? 'var(--accent-subtle)' : 'transparent',
              color: active ? 'var(--accent-subtle-fg)' : 'var(--text)',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--text-md)', fontWeight: 'var(--weight-medium)',
              transition: 'background var(--dur-base), color var(--dur-base)',
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--hover)'; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ display: 'inline-flex', width: 18, height: 18, flexShrink: 0, color: active ? 'var(--accent)' : 'var(--text-muted)' }}>{it.icon}</span>
            <span>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
