Button — the primary action control; neutral by default, accent-filled only as `primary`.

```jsx
<Button variant="primary" onClick={save}>保存</Button>
<Button>キャンセル</Button>
<Button variant="ghost" size="sm" icon="📁">フォルダ</Button>
<Button variant="danger">全データを削除</Button>
```

Variants: `primary` (indigo fill — one per view), `secondary` (default, neutral border), `ghost` (transparent, hover wash), `danger` (red text/border). Sizes `sm | md | lg` map to the 28/34/40px control heights. `fullWidth` for sidebar/settings rows. Pass `icon` for a leading glyph.
