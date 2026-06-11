PostCard — the information-dense saved-post card; the heart of the post-view surface.

```jsx
<PostCard
  post={{ platform:'bluesky', displayName:'なまえ', screenName:'handle',
          text:'本文…', image:'art.jpg', likes:12480, reposts:321, replies:42,
          date:'2026-06-08', tags:['イラスト','風景'], mediaType:'image' }}
  layout="grid" selectable inFolder
  onOpen={open} onFolder={addToFolder} onDelete={del}
/>
```

`layout="grid"` puts the image on top; `layout="list"` is a compact thumbnail-left, text-first row. Hover reveals 📁 / ↗ / 🗑 actions. `selectable` shows the ○ ring; `selected` draws the accent outline. Composes PlatformBadge, Tag, IconButton.
