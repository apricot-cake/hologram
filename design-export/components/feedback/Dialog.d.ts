import React from 'react';

export interface DialogProps {
  open?: boolean;
  title?: React.ReactNode;
  onClose?: () => void;
  children?: React.ReactNode;
  /** Footer node — usually the action Buttons. */
  footer?: React.ReactNode;
  /** Max width in px. @default 420 */
  width?: number;
  style?: React.CSSProperties;
}

/**
 * Centered modal over a dim scrim — confirm, folder-management, tag-edit.
 */
export function Dialog(props: DialogProps): JSX.Element;
