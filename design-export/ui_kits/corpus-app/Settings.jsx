/* global React */
const { Button, Switch, Select } = window.CorpusDesignSystem_59d196;

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 20px', marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
      <h2 className="eyebrow" style={{ marginBottom: 12 }}>{title}</h2>
      {children}
    </div>
  );
}

function Settings({ theme, setTheme, confirmDelete, setConfirmDelete, onToast }) {
  return (
    <div style={{ padding: '20px 28px 40px', maxWidth: 720 }}>
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-strong)', marginBottom: 18 }}>設定</h1>

      <Section title="保存先フォルダ">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <code style={{ flex: 1, minWidth: 200, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '7px 11px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>~/Corpus/save</code>
          <Button variant="primary" onClick={() => onToast('フォルダを選択しました')}>フォルダを選択</Button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 8, lineHeight: 1.5 }}>キャプチャした画像とメタデータの保存先。変更すると次回キャプチャ分から新しい場所に保存されます。</p>
      </Section>

      <Section title="外観">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>ダークテーマ</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>暗い環境で長時間眺めるときに。</div>
          </div>
          <Switch checked={theme === 'dark'} onChange={(v) => setTheme(v ? 'dark' : 'light')} />
        </div>
      </Section>

      <Section title="言語">
        <Select defaultValue="ja">
          <option value="auto">自動（OSの言語設定に従う）</option>
          <option value="ja">日本語</option>
          <option value="en">English</option>
        </Select>
        <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 8 }}>ビューアの表示言語を変更します。変更後に再読み込みされます。</p>
      </Section>

      <Section title="データ">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => onToast('エクスポートしました')}>ZIP エクスポート</Button>
          <Button onClick={() => onToast('インポートしました')}>ZIP から復元</Button>
          <Button onClick={() => onToast('画像を取り込みました')}>画像を取り込み</Button>
        </div>
      </Section>

      <Section title="危険な操作">
        <Switch checked={confirmDelete} onChange={setConfirmDelete} label="投稿削除時に確認を表示する" />
        <div style={{ marginTop: 14 }}>
          <Button variant="danger" onClick={() => onToast('全データを削除しました')}>全データを削除</Button>
        </div>
      </Section>
    </div>
  );
}

window.Settings = Settings;
