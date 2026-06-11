import React from 'react';

/**
 * Props for the Corpus Button.
 * @startingPoint section="Core" subtitle="Buttons — primary, secondary, ghost, danger" viewport="700x120"
 */
export interface ButtonProps {
  children?: React.ReactNode;
  /** Visual weight. `primary` is the only accent-filled variant. @default "secondary" */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** @default "md" */
  size?: 'sm' | 'md' | 'lg';
  /** Leading icon node (Lucide svg or functional emoji). */
  icon?: React.ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  style?: React.CSSProperties;
}

/**
 * Primary action control for Corpus. Neutral by default; reserve `primary`
 * (indigo) for the single most important action in a view.
 * @startingPoint section="Core" subtitle="Buttons — primary, secondary, ghost, danger" viewport="700x120"
 */
export function Button(props: ButtonProps): JSX.Element;
