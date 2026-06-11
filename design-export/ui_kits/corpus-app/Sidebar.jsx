/* global React */
const { ModeNav, Tabs, Chip, Input, Switch } = window.CorpusDesignSystem_59d196;
const { PLATFORMS, TAGS, FOLDERS } = window.CorpusData;

const Lic = ({ n, size = 18 }) => { const I = window.Icon; return <I n={n} size={size} />; };

function SbSection({ title, action, children }) {
  return (
    <div style={{ padding: '8px 2px', marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="eyebrow">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function Sidebar({
  mode, setMode, tab, setTab, theme, setTheme,
  query, setQuery, platforms, togglePlatform,
  tags, toggleTag, folder, setFolder, onManageFolders,
}) {
  const isPost = mode === 'post';
  const showFilters = isPost ? tab === 'posts' : true;

  return (
    <aside style={{
      width: 264, flexShrink: 0, position: 'sticky', top: 0, height: '100vh',
      background: 'var(--surface)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', zIndex: 'var(--z-sidebar)',
    }}>
      {/* Brand + theme toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '14px 14px 12px' }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <b style={{ color: '#fff', fontWeight: 700, fontSize: 15, lineHeight: 1 }}>C</b>
        </span>
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text-strong)', flex: 1 }}>Corpus</span>
        <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="テーマ切替"
          style={{ width: 30, height: 30, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Lic n={theme === 'dark' ? 'sun' : 'moon'} size={15} />
        </button>
      </div>

      {/* Mode nav — always visible */}
      <div style={{ padding: '0 10px 8px' }}>
        <ModeNav value={mode} onChange={setMode} items={[
          { id: 'post', label: '投稿閲覧', icon: <Lic n="rows-3" /> },
          { id: 'image', label: '画像閲覧', icon: <Lic n="layout-grid" /> },
        ]} />
      </div>

      {/* Tabs (post mode only) */}
      {isPost && (
        <div style={{ padding: '6px 10px 4px', borderTop: '1px solid var(--border-subtle)' }}>
          <Tabs value={tab} onChange={setTab} items={[
            { id: 'posts', label: '投稿' }, { id: 'tags', label: 'ハッシュタグ' },
            { id: 'users', label: 'ユーザー' }, { id: 'settings', label: '設定' },
          ]} />
        </div>
      )}

      {/* Scroll region: filters */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 12px 16px', borderTop: '1px solid var(--border-subtle)' }}>
        {showFilters && (
          <>
            <div style={{ padding: '10px 0 4px' }}>
              <Input type="search" icon={<Lic n="search" size={15} />} placeholder="検索（作者・本文・タグ）" value={query} onChange={(e) => setQuery(e.target.value)} hasValue={!!query} />
            </div>

            <SbSection title="プラットフォーム">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {PLATFORMS.map((p) => (
                  <Chip key={p.id} size="sm" active={platforms.has(p.id)} onClick={() => togglePlatform(p.id)}>{p.label}</Chip>
                ))}
              </div>
            </SbSection>

            <SbSection title="タグ">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {TAGS.slice(0, 6).map((t) => (
                  <Chip key={t.label} size="sm" active={tags.has(t.label)} count={t.count} onClick={() => toggleTag(t.label)}>{t.label}</Chip>
                ))}
              </div>
            </SbSection>

            <SbSection title="フォルダ" action={<button type="button" onClick={onManageFolders} style={{ fontSize: 10, fontWeight: 500, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>管理</button>}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {FOLDERS.map((f) => (
                  <Chip key={f.id} size="sm" active={folder === f.id} leading={f.default ? '★' : null} count={f.count} onClick={() => setFolder(folder === f.id ? null : f.id)}>{f.label}</Chip>
                ))}
              </div>
            </SbSection>
          </>
        )}
        {isPost && tab === 'settings' && (
          <div style={{ padding: '14px 2px', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
            設定は右側のパネルで変更できます。
          </div>
        )}
        {isPost && (tab === 'tags' || tab === 'users') && (
          <div style={{ padding: '10px 0' }}>
            <Input type="search" icon={<Lic n="search" size={15} />} placeholder={tab === 'tags' ? 'ハッシュタグを絞り込み' : 'ユーザー名で絞り込み'} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}
      </div>
    </aside>
  );
}

window.Sidebar = Sidebar;
