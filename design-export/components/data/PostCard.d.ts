import React from 'react';

export interface Post {
  platform?: 'x' | 'bluesky' | 'misskey' | 'mastodon' | 'pixiv';
  displayName?: string;
  screenName?: string;
  text?: string;
  image?: string | null;
  likes?: number;
  reposts?: number;
  replies?: number;
  date?: string;
  tags?: string[];
  isThread?: boolean;
  isReply?: boolean;
  isQuote?: boolean;
  mediaType?: 'image' | 'video' | 'gif';
}

/**
 * Information-dense saved-post card — the core of the post-view surface.
 * @startingPoint section="Data" subtitle="Saved-post card — grid & list layouts" viewport="700x420"
 */
export interface PostCardProps {
  post: Post;
  /** `grid` image-on-top · `list` thumbnail-left text-first. @default "grid" */
  layout?: 'grid' | 'list';
  selected?: boolean;
  selectable?: boolean;
  /** 📁 already in the default folder. */
  inFolder?: boolean;
  onOpen?: () => void;
  onFolder?: () => void;
  onDelete?: () => void;
  style?: React.CSSProperties;
}

/**
 * Information-dense saved-post card — the core of the post-view surface.
 * @startingPoint section="Data" subtitle="Saved-post card — grid & list layouts" viewport="700x420"
 */
export function PostCard(props: PostCardProps): JSX.Element;
