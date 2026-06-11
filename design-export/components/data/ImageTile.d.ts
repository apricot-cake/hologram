import React from 'react';

/**
 * Square media tile for image-view — scrim overlay, ○ select, hover actions.
 * @startingPoint section="Data" subtitle="Image-grid tile with overlay & actions" viewport="700x360"
 */
export interface ImageTileProps {
  src: string;
  /** Author shown in the bottom scrim. */
  author?: string;
  /** Like count (formatted to k). */
  likes?: number | null;
  /** Group size — shows a ×N badge when > 1. @default 1 */
  count?: number;
  /** @default "image" */
  media?: 'image' | 'video' | 'gif';
  selected?: boolean;
  /** 📁 already in default folder. */
  inFolder?: boolean;
  onOpen?: () => void;
  onFolder?: () => void;
  onDetail?: () => void;
  onDelete?: () => void;
  onSelect?: () => void;
  style?: React.CSSProperties;
}

/**
 * Square media tile for image-view — scrim overlay, ○ select, hover actions.
 * @startingPoint section="Data" subtitle="Image-grid tile with overlay & actions" viewport="700x360"
 */
export function ImageTile(props: ImageTileProps): JSX.Element;
