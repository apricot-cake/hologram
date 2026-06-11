/* global React */
const { PostCard, Select, Chip } = window.CorpusDesignSystem_59d196;

function ViewToggle({ view, setView }) {
  const Btn = ({ id, icon, label }) => {
    const active = view === id;
    return (
      <button type="button" title={label} onClick={() => setView(id)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 'var(--control-md)',
          border: 'none', background: active ? 'var(--accent)' : 'var(--surface)',
          color: active ? '#fff' : 'var(--text-muted)', cursor: 'pointer',
        }}>
        <window.Icon n={icon} size={15} />
      </button>
    );
  };
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
      <Btn id="grid" icon="layout-grid" label="グリッド" />
      <span style={{ width: 1, background: 'var(--border-strong)' }} />
      <Btn id="list" icon="rows-3" label="リスト" />
    </div>
  );
}

function PostView({ posts, view, setView, sort, setSort, selected, toggleSelect, onToast }) {
  return (
    <div style={{ padding: '20px 28px 40px' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-strong)' }}>投稿</h1>
        <span className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-subtle)' }}>{posts.length} 件</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} fullWidth={false} size="md" style={{ minWidth: 130 }}>
            <option value="date-desc">新しい順</option>
            <option value="date-asc">古い順</option>
            <option value="likes-desc">いいね順</option>
            <option value="captured-desc">キャプチャ日時順</option>
          </Select>
          <ViewToggle view={view} setView={setView} />
        </div>
      </div>

      {/* Grid / list */}
      {view === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {posts.map((p) => (
            <PostCard key={p.id} post={p} selectable selected={selected.has(p.id)} inFolder={p.folder}
              onOpen={() => toggleSelect(p.id)} onFolder={() => onToast('フォルダに追加しました')} onDelete={() => onToast('削除しました')} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {posts.map((p) => (
            <PostCard key={p.id} post={p} layout="list" inFolder={p.folder}
              onOpen={() => onToast('投稿を開きます')} onFolder={() => onToast('フォルダに追加しました')} onDelete={() => onToast('削除しました')} />
          ))}
        </div>
      )}
      {posts.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <p style={{ marginBottom: 6, color: 'var(--text)' }}>見つかりませんでした</p>
          <p style={{ fontSize: 13 }}>検索条件を変更してください。</p>
        </div>
      )}
    </div>
  );
}

window.PostView = PostView;
