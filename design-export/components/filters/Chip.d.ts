import React from 'react';

/**
 * Pill filter / tag chip — the brand-core selectable control.
 * @startingPoint section="Filters" subtitle="Pill filter & tag chips" viewport="700x120"
 */
export interface ChipProps {
  children?: React.ReactNode;
  /** Solid accent fill — the selected state. */
  active?: boolean;
  /** Trailing count in tabular mono (e.g. tag/folder counts). */
  count?: number | string | null;
  /** Leading glyph, e.g. ★ for the default folder. */
  leading?: React.ReactNode;
  /** Show an × that calls onRemove (active-filter pills). */
  removable?: boolean;
  onRemove?: () => void;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Faint per-facet tint for active-filter pills. */
  category?: 'platform' | 'postType' | 'date' | 'engagement' | 'tag' | 'media' | 'user' | null;
  /** @default "md" */
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
}

/**
 * Pill filter / tag chip — the brand-core selectable control.
 * @startingPoint section="Filters" subtitle="Pill filter & tag chips" viewport="700x120"
 */
export function Chip(props: ChipProps): JSX.Element;
