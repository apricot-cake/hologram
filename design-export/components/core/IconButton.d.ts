import React from 'react';

export interface IconButtonProps {
  /** Icon node — Lucide svg or a functional emoji. */
  icon: React.ReactNode;
  /** Accessible label (sets title + aria-label). */
  label: string;
  /** `surface` bordered chrome · `onMedia` dark pill over images · `ghost`. @default "surface" */
  tone?: 'surface' | 'onMedia' | 'ghost';
  /** @default "md" */
  size?: 'sm' | 'md' | 'lg';
  /** Hover resolves to destructive red. */
  danger?: boolean;
  /** Filled accent state (e.g. 📁 already in default folder). */
  active?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  style?: React.CSSProperties;
}

/**
 * Square icon-only control for tile/row hover actions and toolbars.
 */
export function IconButton(props: IconButtonProps): JSX.Element;
