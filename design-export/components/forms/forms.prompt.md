Input / Select — text & dropdown form controls. Focus shows the indigo ring; `hasValue` lights the border to mark an active filter.

```jsx
<Input type="search" icon={<i data-lucide="search" />} placeholder="テキスト・ユーザー名で検索" value={q} onChange={e=>setQ(e.target.value)} />
<Input type="number" size="sm" placeholder="0" hasValue={!!min} />
<Select value={sort} onChange={e=>setSort(e.target.value)}>
  <option value="date-desc">新しい順</option>
  <option value="likes-desc">いいね順</option>
</Select>
```

Sizes `sm | md | lg` map to 28/34/40px. Both are `fullWidth` by default for sidebar/settings rows.
