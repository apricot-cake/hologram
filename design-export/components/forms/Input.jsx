import React from 'react';

/**
 * Input — text / search / number field. The search variant adds a leading
 * Lucide-style icon slot. Focus shows the indigo ring + accent border.
 * `hasValue` lights the border to signal an active filter (matches the app's
 * `.has-value` affordance).
 */
export function Input({
  value,
  onChange,
  placeholder = '',
  type = 'text',
  icon = null,           // leading node; renders a search-style field
  size = 'md',           // sm | md | lg
  hasValue = false,
  disabled = false,
  fullWidth = true,
  style = {},
  ...rest
}) {
  const h = { sm: 'var(--control-sm)', md: 'var(--control-md)', lg: 'var(--control-lg)' }[size];
  const [focus, setFocus] = React.useState(false);
  const accent = focus || hasValue;

  const wrap = {
    display: 'inline-flex', alignItems: 'center', gap: '7px',
    height: h, width: fullWidth ? '100%' : 'auto',
    padding: icon ? '0 11px' : '0 11px',
    background: 'var(--surface)',
    border: `1px solid ${accent ? 'var(--accent)' : 'var(--border-strong)'}`,
    borderRadius: 'var(--radius-sm)',
    boxShadow: focus ? 'var(--ring)' : (hasValue ? '0 0 0 1px var(--accent)' : 'none'),
    transition: 'border-color var(--dur-base), box-shadow var(--dur-base)',
    opacity: disabled ? 0.5 : 1, ...style,
  };
  const input = {
    flex: 1, minWidth: 0, height: '100%', border: 'none', outline: 'none',
    background: 'transparent', color: 'var(--text-strong)',
    fontFamily: type === 'number' ? 'var(--font-mono)' : 'var(--font-sans)',
    fontSize: 'var(--text-md)',
  };

  return (
    <span style={wrap}>
      {icon && <span style={{ display: 'inline-flex', color: 'var(--text-subtle)', fontSize: 14 }}>{icon}</span>}
      <input
        type={type} value={value} onChange={onChange} placeholder={placeholder}
        disabled={disabled} style={input}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        {...rest}
      />
    </span>
  );
}
