import React from 'react';

/**
 * Select — native dropdown styled to match Input. Keeps the OS picker (good
 * for an Electron tool) while wearing the brand's border/radius and a
 * Geist caret. Used for sort order, date field, engagement type.
 */
export function Select({
  value,
  onChange,
  children,
  size = 'md',           // sm | md | lg
  fullWidth = true,
  disabled = false,
  style = {},
  ...rest
}) {
  const h = { sm: 'var(--control-sm)', md: 'var(--control-md)', lg: 'var(--control-lg)' }[size];
  const [focus, setFocus] = React.useState(false);

  const caret =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236c7280' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>";

  const base = {
    height: h, width: fullWidth ? '100%' : 'auto',
    padding: '0 30px 0 11px', appearance: 'none', WebkitAppearance: 'none',
    background: `var(--surface) url("${caret}") no-repeat right 10px center`,
    color: 'var(--text-strong)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)',
    border: `1px solid ${focus ? 'var(--accent)' : 'var(--border-strong)'}`,
    borderRadius: 'var(--radius-sm)', cursor: disabled ? 'default' : 'pointer',
    boxShadow: focus ? 'var(--ring)' : 'none', outline: 'none',
    opacity: disabled ? 0.5 : 1,
    transition: 'border-color var(--dur-base), box-shadow var(--dur-base)', ...style,
  };

  return (
    <select
      value={value} onChange={onChange} disabled={disabled} style={base}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} {...rest}
    >
      {children}
    </select>
  );
}
