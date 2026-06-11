import React from 'react';

/**
 * Corpus Button — the primary action control.
 * Variants map to the brand's restraint: `primary` is the only accent-filled
 * surface; everything else is neutral. Structure comes from borders, not shadow.
 */
export function Button({
  children,
  variant = 'secondary', // primary | secondary | ghost | danger
  size = 'md',           // sm | md | lg
  icon = null,           // leading node (e.g. an <svg> / emoji)
  disabled = false,
  fullWidth = false,
  type = 'button',
  onClick,
  style = {},
  ...rest
}) {
  const sizes = {
    sm: { height: 'var(--control-sm)', padding: '0 10px', font: 'var(--text-base)', gap: '6px' },
    md: { height: 'var(--control-md)', padding: '0 14px', font: 'var(--text-md)',  gap: '7px' },
    lg: { height: 'var(--control-lg)', padding: '0 18px', font: 'var(--text-md)',  gap: '8px' },
  }[size];

  const variants = {
    primary: {
      background: 'var(--accent)', color: 'var(--accent-fg)',
      border: '1px solid var(--accent)',
    },
    secondary: {
      background: 'var(--surface)', color: 'var(--text-strong)',
      border: '1px solid var(--border-strong)',
    },
    ghost: {
      background: 'transparent', color: 'var(--text)',
      border: '1px solid transparent',
    },
    danger: {
      background: 'var(--surface)', color: 'var(--danger)',
      border: '1px solid color-mix(in oklch, var(--danger) 40%, var(--border))',
    },
  }[variant];

  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: sizes.gap, height: sizes.height, padding: sizes.padding,
    width: fullWidth ? '100%' : 'auto',
    fontFamily: 'var(--font-sans)', fontSize: sizes.font, fontWeight: 'var(--weight-medium)',
    lineHeight: 1, whiteSpace: 'nowrap',
    borderRadius: 'var(--radius-sm)', cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out), color var(--dur-base)',
    userSelect: 'none', ...variants, ...style,
  };

  const hoverBg = {
    primary: 'var(--accent-hover)',
    secondary: 'var(--hover)',
    ghost: 'var(--hover)',
    danger: 'var(--danger-bg)',
  }[variant];

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={base}
      onMouseEnter={(e) => { if (!disabled) {
        e.currentTarget.style.background = hoverBg;
        if (variant === 'primary') e.currentTarget.style.borderColor = 'var(--accent-hover)';
      }}}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = variants.background;
        e.currentTarget.style.borderColor = variants.border.split(' ').slice(2).join(' ');
      }}
      {...rest}
    >
      {icon && <span style={{ display: 'inline-flex', fontSize: '1.05em' }}>{icon}</span>}
      {children}
    </button>
  );
}
