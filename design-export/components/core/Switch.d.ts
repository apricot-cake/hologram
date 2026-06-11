import React from 'react';

export interface SwitchProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  /** @default "md" */
  size?: 'sm' | 'md';
  /** Optional trailing label; renders the switch inside a <label>. */
  label?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Compact toggle for the theme switch and binary settings. Accent-filled on.
 */
export function Switch(props: SwitchProps): JSX.Element;
