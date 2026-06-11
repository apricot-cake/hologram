import React from 'react';

export interface InputProps {
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  /** @default "text" */
  type?: 'text' | 'search' | 'number' | 'date';
  /** Leading icon — renders a search-style field. */
  icon?: React.ReactNode;
  /** @default "md" */
  size?: 'sm' | 'md' | 'lg';
  /** Light the border to mark an active filter. */
  hasValue?: boolean;
  disabled?: boolean;
  /** @default true */
  fullWidth?: boolean;
  style?: React.CSSProperties;
}

/**
 * Text / search / number / date field. Focus shows the indigo ring.
 */
export function Input(props: InputProps): JSX.Element;
