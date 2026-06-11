import React from 'react';

export interface TagProps {
  children?: React.ReactNode;
  /** `default` neutral · `flag-type` post-type flag · `flag-media` media flag. @default "default" */
  tone?: 'default' | 'flag-type' | 'flag-media';
  style?: React.CSSProperties;
}

/**
 * Quiet metadata pill for card tags and post-type/media flags.
 */
export function Tag(props: TagProps): JSX.Element;
