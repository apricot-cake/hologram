// Switch — compact toggle, translated 1:1 from the Claude Design "Corpus Design
// System" kit (components/core/Switch.tsx) as the first real design→code port of
// a kit component. Faithful to the source; the only adaptation is dropping the
// kit's `import React` (this island compiles with the automatic JSX runtime).
//
// It needs no CSS file: every token it references already exists in the app's
// ported design-tokens.css (--accent / --surface-3 / --border-strong /
// --radius-pill / --shadow-xs / --dur-base / --ease-out / --space-5 / --text-base
// / --text), so the kit's inline styles drop in untouched. That low friction is
// the whole point of sharing the token layer with Design.
//
// Replaces the previous bare-checkbox Toggle. Same {checked, onChange} contract,
// so onChange(next) hands back the next boolean.
import type { CSSProperties, ReactNode } from 'react';

interface SwitchProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label?: ReactNode;
  style?: CSSProperties;
  [rest: string]: any; // extra props spread onto the <button>
}

export function Switch({
  checked = false,
  onChange,
  disabled = false,
  size = 'md', // sm | md
  label = null,
  style = {},
  ...rest
}: SwitchProps) {
  const dims = size === 'sm' ? { w: 30, h: 18, k: 12 } : { w: 38, h: 22, k: 16 };

  const track: CSSProperties = {
    position: 'relative',
    width: dims.w,
    height: dims.h,
    flexShrink: 0,
    borderRadius: 'var(--radius-pill)',
    background: checked ? 'var(--accent)' : 'var(--surface-3)',
    border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background var(--dur-base) var(--ease-out), border-color var(--dur-base)',
    padding: 0,
  };
  const knob: CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: checked ? `calc(100% - ${dims.k + 2}px)` : '2px',
    transform: 'translateY(-50%)',
    width: dims.k,
    height: dims.k,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: 'var(--shadow-xs)',
    transition: 'left var(--dur-base) var(--ease-out)',
  };

  const btn = (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => !disabled && onChange && onChange(!checked)} style={track} {...rest}>
      <span style={knob} />
    </button>
  );

  if (!label) return btn;
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-5)', cursor: disabled ? 'default' : 'pointer', fontSize: 'var(--text-base)', color: 'var(--text)', ...style }}>
      {btn}
      <span>{label}</span>
    </label>
  );
}
