import React from 'react';

export interface ModeNavItem { id: string; label: React.ReactNode; icon?: React.ReactNode; }

export interface ModeNavProps {
  items: ModeNavItem[];
  value: string;
  onChange?: (id: string) => void;
  style?: React.CSSProperties;
}

/**
 * Top-level mode switcher (Post view / Image view) — always visible, sticky.
 */
export function ModeNav(props: ModeNavProps): JSX.Element;
