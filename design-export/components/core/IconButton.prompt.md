IconButton — square icon-only control for tile/row hover actions and toolbars.

```jsx
<IconButton icon="📁" label="フォルダに追加" tone="onMedia" active />
<IconButton icon="🗑" label="削除" tone="onMedia" danger />
<IconButton icon={<i data-lucide="info" />} label="詳細" />
```

Tones: `surface` (bordered chrome), `onMedia` (dark translucent pill over imagery), `ghost`. `active` fills with accent; `danger` makes hover red. Sizes map to 24/28/34px.
