import React from 'react';

/**
 * Dialog — centered modal over a dim scrim. Used for the delete confirmation,
 * folder-management, and tag-edit modals. Header (title + ×), body (children),
 * and an optional footer for actions. Click the scrim to dismiss.
 */
export function Dialog({
  open = false,
  title = '',
  onClose,
  children,
  footer = null,
  width = 420,
  style = {},
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
        background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-9)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)', color: 'var(--text)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)', width: '100%', maxWidth: width,
          maxHeight: '85vh', overflowY: 'auto', ...style,
        }}
      >
        {(title || onClose) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)' }}>{title}</h3>
            {onClose && (
              <button type="button" onClick={onClose} aria-label="閉じる"
                style={{ border: 'none', background: 'none', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 2 }}>×</button>
            )}
          </div>
        )}
        <div style={{ padding: '16px' }}>{children}</div>
        {footer && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border-subtle)' }}>{footer}</div>
        )}
      </div>
    </div>
  );
}
