import React from 'react';

export interface SelectProps {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  /** <option> children. */
  children?: React.ReactNode;
  /** @default "md" */
  size?: 'sm' | 'md' | 'lg';
  /** @default true */
  fullWidth?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}

/**
 * Native dropdown styled to match Input — sort order, date field, engagement.
 */
export function Select(props: SelectProps): JSX.Element;
