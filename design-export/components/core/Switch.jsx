import React from 'react';

/**
 * Switch — a compact toggle. Corpus uses it for the theme switch and binary
 * settings. Accent-filled when on; neutral track when off. No bounce.
 */
export function Switch({
  checked = false,
  onChange,
  disabled = false,
  size = 'md',          // sm | md
  label = null,
  style = {},
  ...rest
}) {
  const dims = size === 'sm'
    ? { w: 30, h: 18, k: 12 }
    : { w: 38, h: 22, k: 16 };

  const track = {
    position: 'relative', width: dims.w, height: dims.h, flexShrink: 0,
    borderRadius: 'var(--radius-pill)',
    background: checked ? 'var(--accent)' : 'var(--surface-3)',
    border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    transition: 'background var(--dur-base) var(--ease-out), border-color var(--dur-base)',
    padding: 0,
  };
  const knob = {
    position: 'absolute', top: '50%', left: checked ? `calc(100% - ${dims.k + 2}px)` : '2px',
    transform: 'translateY(-50%)',
    width: dims.k, height: dims.k, borderRadius: '50%',
    background: '#fff', boxShadow: 'var(--shadow-xs)',
    transition: 'left var(--dur-base) var(--ease-out)',
  };

  const btn = (
    <button
      type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      style={track} {...rest}
    >
      <span style={knob} />
    </button>
  );

  if (!label) return btn;
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-5)', cursor: disabled ? 'default' : 'pointer', fontSize: 'var(--text-base)', color: 'var(--text)', ...style }}>
      {btn}<span>{label}</span>
    </label>
  );
}
