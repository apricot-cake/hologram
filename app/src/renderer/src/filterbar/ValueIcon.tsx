import { AlignLeft, Calendar, CalendarDays, Clapperboard, Folder, Globe, HardDrive, Hash, Image, Layers, type LucideIcon, MessageSquare, MoveHorizontal, MoveVertical, Quote, Reply, Ruler, Tag, User, Video } from 'lucide-react';
import { useState } from 'react';
import { fileSrc } from '../services/asset-src.ts';
import type { FilterRow } from '../services/orchestrator.ts';
const values: Record<string, LucideIcon> = {
  image: Image,
  video: Video,
  gif: Clapperboard,
  text: AlignLeft,
  __none: AlignLeft,
  post: MessageSquare,
  reply: Reply,
  quote: Quote,
  thread: Reply,
  width: MoveHorizontal,
  height: MoveVertical,
  long: Ruler,
  bytes: HardDrive,
  date: CalendarDays,
  capturedAt: Calendar,
};
const categories: Record<string, LucideIcon> = { kind: Layers, platform: Globe, media: Image, postType: MessageSquare, tag: Tag, hashtag: Hash, user: User, folder: Folder, date: Calendar, followers: User, dimension: Ruler };
const ratioSizes: Record<string, [number, number]> = { portrait: [9, 18], slightlyPortrait: [12, 18], square: [16, 16], slightlyLandscape: [18, 12], landscape: [18, 9] };
export function ValueIcon({ cat, row }: { cat: string; row: FilterRow }) {
  const [failedSrc, setFailedSrc] = useState('');
  const src = row.avatarFile ? fileSrc(row.avatarFile, 40) : '';
  if (cat === 'aspectRatio' && ratioSizes[String(row.v)]) {
    const [width, height] = ratioSizes[String(row.v)];
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-muted-foreground">
        <rect x={(24 - width) / 2} y={(24 - height) / 2} width={width} height={height} rx={2} />
      </svg>
    );
  }
  if (cat === 'user')
    return (
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs text-muted-foreground">
        {src && src !== failedSrc ? <img src={src} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailedSrc(src)} /> : row.l?.slice(0, 1) || <User className="size-4" />}
      </span>
    );
  const Icon = (!['tag', 'poster-tag', 'hashtag', 'folder', 'platform', 'poster-platform'].includes(cat) && values[String(row.v)]) || categories[cat.replace(/^poster-/, '')] || Tag;
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;
}
