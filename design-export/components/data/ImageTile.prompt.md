ImageTile — the square media tile from image-view; the image is the hero, chrome stays out of the way.

```jsx
<ImageTile src="art.jpg" author="なまえ" likes={2480} count={3} media="image"
           selectable selected={sel} inFolder
           onOpen={open} onFolder={fold} onDetail={info} onDelete={del} onSelect={toggle} />
```

Bottom scrim carries author + likes over any image. Hover reveals 📁 / ℹ / ↗ / 🗑 (top-right); the ○ ring (top-left) toggles selection and fills with a geometric ✓. `count > 1` shows a ×N group badge; `media` `video`/`gif` adds a play overlay. Composes IconButton. Place in a CSS grid with `minmax(var(--iv-tile), 1fr)`.
