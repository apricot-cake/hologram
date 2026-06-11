import React from 'react';

/**
 * Toast — the transient bottom-center pill ("フォルダに追加しました"). Dark,
 * rounded, fades + lifts in. Controlled via `show`; auto-dismiss handled by
 * the caller. Mirrors the app's .iv-toast.
 */
export function Toast({ children, show = false, style = {} }) {
  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: '50%', bottom: 30,
        transform: `translateX(-50%) translateY(${show ? '0' : '8px'})`,
        background: 'rgba(8,10,14,0.88)', color: '#fff',
        padding: '9px 18px', borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)',
        boxShadow: 'var(--shadow-lg)',
        opacity: show ? 1 : 0, pointerEvents: 'none',
        transition: 'opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)',
        zIndex: 'var(--z-toast)', ...style,
      }}
    >
      {children}
    </div>
  );
}
