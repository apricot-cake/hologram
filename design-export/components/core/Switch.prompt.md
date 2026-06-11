Switch — compact toggle for the theme switch and binary settings.

```jsx
<Switch checked={dark} onChange={setDark} />
<Switch checked={on} onChange={setOn} label="投稿削除時に確認を表示する" />
```

Accent-filled when on, neutral track when off. `size` `sm | md`. Pass `label` to wrap it in a clickable row.
