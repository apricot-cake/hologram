import React from 'react';

export interface PlatformBadgeProps {
  /** @default "x" */
  platform?: 'x' | 'bluesky' | 'misskey' | 'mastodon' | 'pixiv';
  style?: React.CSSProperties;
}

/**
 * Small brand-colored capsule identifying a post's source platform — the only
 * place platform brand colors appear. X inverts in dark theme.
 */
export function PlatformBadge(props: PlatformBadgeProps): JSX.Element;
