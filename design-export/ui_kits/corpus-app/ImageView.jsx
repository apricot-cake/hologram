/* global React */
const { ImageTile } = window.CorpusDesignSystem_59d196;

function ImageView({ posts, tile, setTile, selected, toggleSelect, onToast, onDetail }) {
  const selCount = selected.size;
  return (
    <div style={{ padding: '16px 28px 40px', height: '100vh', overflowY: 'auto' }}>
      {/* Head bar — sticky */}
      <div style={{
        position: 'sticky', top: -16, zIndex: 10, background: 'var(--bg)',
        display: 'flex', alignItems: 'center', gap: 12,
        margin: '-16px -28px 14px', padding: '16px 28px 12px',
      }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-strong)' }}>画像</h1>
        <span className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-subtle)' }}>{posts.length} 件</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {selCount > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selCount} 件選択中</span>}
          {selCount > 0 && (
            <button type="button" onClick={() => onToast(`${selCount} 件をグループ化しました`)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', padding: '5px 12px', fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}>選択をグループ化</button>
          )}
          {/* tile size */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
            <span>タイル</span>
            <button type="button" onClick={() => setTile(Math.max(120, tile - 30))} style={tileBtn}>−</button>
            <button type="button" onClick={() => setTile(Math.min(260, tile + 30))} style={tileBtn}>＋</button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${tile}px, 1fr))`, gap: 8 }}>
        {posts.map((p, i) => (
          <ImageTile key={p.id} src={p.image} author={p.displayName} likes={p.likes}
            count={i % 5 === 0 ? 3 : 1} media={p.mediaType} inFolder={p.folder}
            selected={selected.has(p.id)} onSelect={() => toggleSelect(p.id)}
            onOpen={() => onToast('元投稿を開きます')} onFolder={() => onToast('フォルダに追加しました')}
            onDetail={() => onDetail(p)} onDelete={() => onToast('削除しました')} />
        ))}
      </div>
    </div>
  );
}

const tileBtn = {
  width: 28, height: 24, border: '1px solid var(--border-strong)', background: 'var(--surface)',
  color: 'var(--text)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 14, lineHeight: 1,
};

window.ImageView = ImageView;
