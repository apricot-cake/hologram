import React from 'react';

export interface TabItem { id: string; label: React.ReactNode; }

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange?: (id: string) => void;
  /** @default "vertical" */
  orientation?: 'vertical' | 'horizontal';
  style?: React.CSSProperties;
}

/**
 * In-sidebar tab strip (Posts / Hashtags / Users / Settings).
 */
export function Tabs(props: TabsProps): JSX.Element;
