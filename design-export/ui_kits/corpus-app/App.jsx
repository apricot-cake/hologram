/* global React, Sidebar, PostView, ImageView, Settings */
const { Chip, Dialog, Toast, Button, Input } = window.CorpusDesignSystem_59d196;
const { POSTS, TAGS, FOLDERS } = window.CorpusData;

function HashtagsPanel({ query }) {
  const list = TAGS.filter((t) => t.label.includes(query));
  return (
    <div style={{ padding: '20px 28px 40px', maxWidth: 900 }}>
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-strong)', marginBottom: 18 }}>ハッシュタグ</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {list.map((t) => (
          <span key={t.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', color: 'var(--accent)', fontSize: 13, cursor: 'pointer' }}>
            #{t.label}<span className="mono" style={{ fontSize: 11, color: 'var(--text-subtle)', background: 'var(--surface-2)', padding: '1px 7px', borderRadius: 'var(--radius-pill)' }}>{t.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function UsersPanel({ query }) {
  const users = [...new Map(POSTS.map((p) => [p.screenName, p])).values()]
    .filter((p) => p.displayName.includes(query) || p.screenName.includes(query));
  return (
    <div style={{ padding: '20px 28px 40px', maxWidth: 900 }}>
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-strong)', marginBottom: 18 }}>ユーザー</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {users.map((u) => (
          <button key={u.screenName} type="button" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface)', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{u.displayName}</span>
            <span className="mono" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>@{u.screenName}</span>
            <span className="mono" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', background: 'var(--surface-2)', borderRadius: 'var(--radius-pill)', padding: '2px 10px' }}>{POSTS.filter((p) => p.screenName === u.screenName).length} 件</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function FolderModal({ open, onClose, onToast }) {
  const [name, setName] = React.useState('');
  return (
    <Dialog open={open} title="フォルダを管理" onClose={onClose} width={440}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <Input placeholder="新しいフォルダ名" value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="secondary" onClick={() => { setName(''); onToast('フォルダを作成しました'); }}>作成</Button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {FOLDERS.map((f) => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ color: f.default ? 'var(--accent)' : 'var(--text-subtle)', cursor: 'pointer' }} title="デフォルトに設定">★</span>
            <span style={{ flex: 1, color: 'var(--text)' }}>{f.label}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.count}</span>
            <button type="button" title="削除" style={{ border: 'none', background: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 14 }}>🗑</button>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 12, color: 'var(--text-subtle)', fontSize: 11 }}>★ = 📁 ワンクリックで追加される先（デフォルト）</p>
    </Dialog>
  );
}

function DetailModal({ post, onClose }) {
  if (!post) return null;
  const row = (k, v) => v != null && (
    <div style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 12 }}>
      <span style={{ color: 'var(--text-muted)', flex: '0 0 76px' }}>{k}</span>
      <span style={{ flex: 1, color: 'var(--text)', wordBreak: 'break-word' }}>{v}</span>
    </div>
  );
  return (
    <Dialog open title={post.displayName + ' — 詳細'} onClose={onClose} width={420}>
      <img src={post.image} alt="" style={{ width: '100%', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: 12, display: 'block' }} />
      {row('作者', `${post.displayName} @${post.screenName}`)}
      {row('プラットフォーム', post.platform)}
      {row('いいね', post.likes?.toLocaleString('en-US'))}
      {row('投稿日', post.date)}
      {row('タグ', post.tags?.join('、'))}
    </Dialog>
  );
}

function App() {
  const [theme, setTheme] = React.useState('light');
  const [mode, setMode] = React.useState('post');
  const [tab, setTab] = React.useState('posts');
  const [view, setView] = React.useState('grid');
  const [sort, setSort] = React.useState('date-desc');
  const [tile, setTile] = React.useState(180);
  const [query, setQuery] = React.useState('');
  const [platforms, setPlatforms] = React.useState(new Set());
  const [tags, setTags] = React.useState(new Set());
  const [folder, setFolder] = React.useState(null);
  const [selected, setSelected] = React.useState(new Set());
  const [confirmDelete, setConfirmDelete] = React.useState(true);
  const [folderModal, setFolderModal] = React.useState(false);
  const [detail, setDetail] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const toastTimer = React.useRef();

  React.useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  const onToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };
  const togglePlatform = (id) => setPlatforms((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleTag = (l) => setTags((s) => { const n = new Set(s); n.has(l) ? n.delete(l) : n.add(l); return n; });
  const toggleSelect = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // filter + sort
  let posts = POSTS.filter((p) => {
    if (platforms.size && !platforms.has(p.platform)) return false;
    if (tags.size && !p.tags?.some((t) => tags.has(t))) return false;
    if (folder && !p.folder) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!(`${p.displayName} ${p.screenName} ${p.text} ${(p.tags || []).join(' ')}`.toLowerCase().includes(q))) return false;
    }
    return true;
  });
  posts = [...posts].sort((a, b) => {
    if (sort === 'likes-desc') return (b.likes || 0) - (a.likes || 0);
    if (sort === 'date-asc') return a.date.localeCompare(b.date);
    return b.date.localeCompare(a.date);
  });

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar
        key={mode + '|' + tab}
        mode={mode} setMode={setMode} tab={tab} setTab={setTab}
        theme={theme} setTheme={setTheme}
        query={query} setQuery={setQuery}
        platforms={platforms} togglePlatform={togglePlatform}
        tags={tags} toggleTag={toggleTag}
        folder={folder} setFolder={setFolder}
        onManageFolders={() => setFolderModal(true)}
      />
      <main style={{ flex: 1, minWidth: 0 }}>
        {mode === 'image'
          ? <ImageView posts={posts} tile={tile} setTile={setTile} selected={selected} toggleSelect={toggleSelect} onToast={onToast} onDetail={setDetail} />
          : tab === 'posts' ? <PostView posts={posts} view={view} setView={setView} sort={sort} setSort={setSort} selected={selected} toggleSelect={toggleSelect} onToast={onToast} />
          : tab === 'tags' ? <HashtagsPanel query={query} />
          : tab === 'users' ? <UsersPanel query={query} />
          : <Settings theme={theme} setTheme={setTheme} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} onToast={onToast} />}
      </main>

      <FolderModal open={folderModal} onClose={() => setFolderModal(false)} onToast={onToast} />
      <DetailModal post={detail} onClose={() => setDetail(null)} />
      <Toast show={!!toast}>{toast}</Toast>
    </div>
  );
}

window.CorpusApp = App;
