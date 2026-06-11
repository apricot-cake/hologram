import React from 'react';

export interface ToastProps {
  children?: React.ReactNode;
  show?: boolean;
  style?: React.CSSProperties;
}

/**
 * Transient bottom-center confirmation pill. Caller controls show/auto-dismiss.
 */
export function Toast(props: ToastProps): JSX.Element;
