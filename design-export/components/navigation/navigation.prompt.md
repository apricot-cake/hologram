Tabs / ModeNav — navigation primitives for the persistent left sidebar.

```jsx
<ModeNav value={mode} onChange={setMode} items={[
  { id:'post',  label:'投稿閲覧', icon:<i data-lucide="rows-3" /> },
  { id:'image', label:'画像閲覧', icon:<i data-lucide="layout-grid" /> },
]} />

<Tabs value={tab} onChange={setTab} items={[
  { id:'posts', label:'投稿' }, { id:'tags', label:'ハッシュタグ' },
  { id:'users', label:'ユーザー' }, { id:'settings', label:'設定' },
]} />
```

ModeNav is the icon+label top switcher (always visible across modes). Tabs is the vertical sidebar strip (`orientation="horizontal"` for a top underline strip). Both use the accent-subtle active wash.
