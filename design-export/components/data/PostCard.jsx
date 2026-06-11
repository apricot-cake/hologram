import React from 'react';
import { PlatformBadge } from '../data/PlatformBadge.jsx';
import { Tag } from '../data/Tag.jsx';
import { IconButton } from '../core/IconButton.jsx';

/**
 * PostCard — the information-dense saved-post card. Surfaces, at a glance:
 * platform badge · author + handle · post-type/media flags · body text ·
 * engagement (likes/reposts/replies) · date · tags · the 📁 one-click folder
 * action and hover actions (edit / open / delete).
 *
 * Two layouts: `grid` (image on top) and `list` (thumbnail left, text-first).
 */
export function PostCard({
  post = {},
  layout = 'grid',        // grid | list
  selected = false,
  selectable = false,
  inFolder = false,
  onOpen,
  onFolder,
  onDelete,
  style = {},
}) {
  const {
    platform = 'x', displayName = '', screenName = '', text = '',
    image = null, likes, reposts, replies, date = '', tags = [],
    isThread, isReply, isQuote, mediaType,
  } = post;

  const [hover, setHover] = React.useState(false);
  const isList = layout === 'list';

  const fmt = (n) => n == null ? null : n.toLocaleString('en-US');
  const stats = [
    likes  != null && `❤ ${fmt(likes)}`,
    reposts!= null && `🔁 ${fmt(reposts)}`,
    replies!= null && `💬 ${fmt(replies)}`,
  ].filter(Boolean);

  const flags = [
    isThread && 'セルフリプ', isReply && 'リプライ', isQuote && '引用',
  ].filter(Boolean);
  const mediaLabel = { image: '画像', video: '動画', gif: 'GIF' }[mediaType];

  const card = {
    position: 'relative', display: 'flex',
    flexDirection: isList ? 'row' : 'column',
    alignItems: 'stretch',
    background: 'var(--surface)',
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    outline: selected ? '2px solid var(--accent)' : 'none', outlineOffset: '-2px',
    borderRadius: isList ? 'var(--radius-sm)' : 'var(--radius-md)',
    overflow: 'hidden', cursor: 'pointer',
    boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
    transition: 'box-shadow var(--dur-base) var(--ease-out), border-color var(--dur-base)',
    ...style,
  };

  const img = image && (
    <div style={{
      position: 'relative', flexShrink: 0,
      width: isList ? 92 : '100%',
      height: isList ? 'auto' : 'auto',
      background: 'var(--surface-3)',
    }}>
      <img src={image} alt="" loading="lazy" style={{
        display: 'block', width: '100%',
        height: isList ? '100%' : 'auto',
        maxHeight: isList ? 116 : 280, objectFit: 'cover',
      }} />
    </div>
  );

  const actions = (
    <div style={{
      position: 'absolute', top: 8, right: 8, zIndex: 2, display: 'flex', gap: 6,
      opacity: hover ? 1 : 0, transition: 'opacity var(--dur-fast)',
      ...(isList ? { top: '50%', transform: 'translateY(-50%)' } : {}),
    }}>
      <IconButton tone="onMedia" size="md" icon="📁" label="フォルダに追加" active={inFolder}
        onClick={(e) => { e.stopPropagation(); onFolder && onFolder(); }} />
      {onOpen && <IconButton tone="onMedia" size="md" icon="↗" label="投稿を開く"
        onClick={(e) => { e.stopPropagation(); onOpen && onOpen(); }} />}
      <IconButton tone="onMedia" size="md" icon="🗑" label="削除" danger
        onClick={(e) => { e.stopPropagation(); onDelete && onDelete(); }} />
    </div>
  );

  return (
    <div style={card} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={onOpen}>
      {selectable && (
        <span style={{
          position: 'absolute', top: 8, left: 8, zIndex: 3, width: 22, height: 22,
          borderRadius: '50%', border: `2px solid ${selected ? 'var(--accent)' : '#fff'}`,
          background: selected ? 'var(--accent)' : 'rgba(255,255,255,0.85)',
          boxShadow: '0 0 2px 1px rgba(0,0,0,0.3)',
          display: hover || selected ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center',
        }}>
          {selected && <span style={{ width: 5, height: 9, marginTop: -1, border: 'solid #fff', borderWidth: '0 2px 2px 0', transform: 'rotate(45deg)' }} />}
        </span>
      )}
      {actions}
      {img}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: isList ? 3 : 5,
        padding: isList ? '9px 14px' : '12px', flex: 1, minWidth: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)', minWidth: 0, order: isList ? 1 : 0 }}>
          <PlatformBadge platform={platform} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
          {screenName && <span className="mono" style={{ color: 'var(--text-subtle)', fontWeight: 400, fontSize: 'var(--text-sm)' }}>@{screenName}</span>}
        </div>
        {!isList && (flags.length || mediaLabel) ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {flags.map((f) => <Tag key={f} tone="flag-type">{f}</Tag>)}
            {mediaLabel && <Tag tone="flag-media">{mediaLabel}</Tag>}
          </div>
        ) : null}
        {text && (
          <div style={{
            order: isList ? 0 : 0,
            fontSize: isList ? 'var(--text-md)' : 'var(--text-base)',
            lineHeight: 'var(--leading-snug)', color: isList ? 'var(--text-strong)' : 'var(--text)',
            display: '-webkit-box', WebkitLineClamp: isList ? 2 : 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{text}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, order: isList ? 2 : 0, flexWrap: 'wrap' }}>
          {stats.length > 0 && (
            <div className="mono" style={{ display: 'flex', gap: 12, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              {stats.map((s) => <span key={s}>{s}</span>)}
            </div>
          )}
          {date && <span className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-subtle)', marginLeft: isList ? 'auto' : 0 }}>{date}</span>}
        </div>
        {!isList && tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 1 }}>
            {tags.map((t) => <Tag key={t}>{t}</Tag>)}
          </div>
        )}
      </div>
    </div>
  );
}
