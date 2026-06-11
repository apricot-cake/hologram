import React from 'react';
import { IconButton } from '../core/IconButton.jsx';

/**
 * ImageTile — the square media tile from image-view. Shows the image with a
 * bottom scrim carrying author + likes, an ○ select ring (top-left), hover
 * actions (📁 / ℹ / ↗ / 🗑) top-right, an optional ×N group badge, and a
 * play/GIF overlay for motion. Selected tiles get the inset accent outline.
 */
export function ImageTile({
  src,
  author = '',
  likes = null,           // number
  count = 1,              // ×N group size
  media = 'image',        // image | video | gif
  selected = false,
  inFolder = false,
  onOpen,
  onFolder,
  onDetail,
  onDelete,
  onSelect,
  style = {},
}) {
  const [hover, setHover] = React.useState(false);
  const fmt = (n) => n == null ? null : (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));

  const tile = {
    position: 'relative', aspectRatio: '1', width: '100%',
    background: 'var(--surface-3)',
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    outline: selected ? '2px solid var(--accent)' : 'none', outlineOffset: '-3px',
    borderRadius: 'var(--radius-sm)', overflow: 'hidden', cursor: 'pointer',
    boxShadow: hover ? 'var(--shadow-md)' : 'none',
    transform: hover ? 'scale(1.015)' : 'none',
    transition: 'transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast), border-color var(--dur-fast)',
    ...style,
  };

  return (
    <div style={tile} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={onOpen}>
      <img src={src} alt="" loading="lazy" decoding="async"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />

      {/* play / GIF overlay */}
      {media !== 'image' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ width: 42, height: 42, borderRadius: '50%', background: 'rgba(8,10,14,0.55)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: media === 'gif' ? 12 : 15, fontWeight: 600, paddingLeft: media === 'video' ? 3 : 0 }}>
            {media === 'gif' ? 'GIF' : '▶'}
          </span>
        </div>
      )}

      {/* ×N badge — fades on hover so actions can take the corner */}
      {count > 1 && (
        <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, padding: '2px 6px', borderRadius: 'var(--radius-xs)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', fontWeight: 600, background: 'rgba(8,10,14,0.8)', color: '#fff', opacity: hover ? 0 : 1, transition: 'opacity var(--dur-fast)' }}>×{count}</div>
      )}

      {/* ○ select ring */}
      <span
        onClick={(e) => { e.stopPropagation(); onSelect && onSelect(); }}
        style={{
          position: 'absolute', top: 6, left: 6, zIndex: 5, width: 22, height: 22, borderRadius: '50%',
          background: selected ? 'var(--accent)' : 'transparent',
          border: `2px solid ${selected ? '#fff' : '#fff'}`, boxShadow: '0 0 2px 1px rgba(0,0,0,0.45)',
          display: hover || selected ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
        {selected && <span style={{ width: 5, height: 9, marginTop: -1, border: 'solid #fff', borderWidth: '0 2px 2px 0', transform: 'rotate(45deg)' }} />}
      </span>

      {/* hover actions */}
      <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 3, display: 'flex', gap: 4, opacity: hover ? 1 : 0, transition: 'opacity var(--dur-fast)' }}>
        <IconButton tone="onMedia" size="sm" icon="📁" label="フォルダ" active={inFolder} onClick={(e) => { e.stopPropagation(); onFolder && onFolder(); }} />
        <IconButton tone="onMedia" size="sm" icon="ℹ" label="詳細" onClick={(e) => { e.stopPropagation(); onDetail && onDetail(); }} />
        {onOpen && <IconButton tone="onMedia" size="sm" icon="↗" label="元投稿" onClick={(e) => { e.stopPropagation(); onOpen && onOpen(); }} />}
        <IconButton tone="onMedia" size="sm" icon="🗑" label="削除" danger onClick={(e) => { e.stopPropagation(); onDelete && onDelete(); }} />
      </div>

      {/* bottom scrim: author + likes */}
      {(author || likes != null) && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 8px 7px', background: 'var(--scrim-grad)', color: '#fff', fontSize: 'var(--text-xs)', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ color: '#eee', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{author}</span>
          {likes != null && <span className="mono" style={{ flexShrink: 0 }}>❤ {fmt(likes)}</span>}
        </div>
      )}
    </div>
  );
}
