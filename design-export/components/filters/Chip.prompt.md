Chip — the pill filter/tag control. Sidebar filters, tag chips, and the active-filter bar are all Chips.

```jsx
<Chip active onClick={toggle}>X</Chip>
<Chip count={128}>イラスト</Chip>
<Chip leading="★" count={42}>お気に入り</Chip>
<Chip category="platform" removable onRemove={clear}>Bluesky</Chip>
```

`active` = solid indigo fill (selected). `category` applies a faint accent tint for active-filter pills. `removable` shows an × → `onRemove`. `count` renders in tabular mono. Sizes `sm | md`.
