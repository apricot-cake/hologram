'use strict';

// Regenerates the app/extension icons (extension/icons/icon{16,32,48,128,256}.png)
// as the corpus mark: an indigo rounded square with a white { heart } glyph.
// Run with Electron (for Chromium SVG render + alpha capture):
//
//   app/node_modules/.bin/electron scripts/make-icons.js
//
// The light/dark UI accent lives in design-tokens.css; this icon uses a solid
// indigo tile so it stays legible on any taskbar/background at 16px.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const BG = '#5b53b8';   // indigo tile
const FG = '#ffffff';   // white glyph
const SIZE = 256;       // render at 256 (Windows packaging needs >=256), downscale for the rest
const SIZES = [256, 128, 48, 32, 16];

// The mark in its native 72x56 coordinate space (gap 40, line 2.8), scaled to
// the center of the 256 tile.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;background:transparent;overflow:hidden}
  svg{display:block}
</style></head><body>
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <rect x="8" y="8" width="240" height="240" rx="56" fill="${BG}"/>
  <g transform="translate(128,128) scale(2.7) translate(-36,-28)" fill="none" stroke="${FG}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 10 q-6 0 -6 7 v4 q0 5 -5 7 q5 2 5 7 v4 q0 7 6 7"/>
    <path d="M52 10 q6 0 6 7 v4 q0 5 5 7 q-5 2 -5 7 v4 q0 7 -6 7"/>
    <path d="M36 37 C28 31 25 26 27 22 C28.5 19 32.5 19 34.5 21.5 C35.3 22.5 35.7 23 36 24 C36.3 23 36.7 22.5 37.5 21.5 C39.5 19 43.5 19 45 22 C47 26 44 31 36 37 Z"/>
  </g>
</svg>
<script>document.title = 'done';</script>
</body></html>`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    paintWhenInitiallyHidden: true,
    webPreferences: { offscreen: false }
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));

  const img = await win.webContents.capturePage();
  const outDir = path.join(__dirname, '..', 'extension', 'icons');

  for (const s of SIZES) {
    const out = s === SIZE ? img : img.resize({ width: s, height: s, quality: 'best' });
    fs.writeFileSync(path.join(outDir, `icon${s}.png`), out.toPNG());
    console.log(`wrote icon${s}.png`);
  }

  app.quit();
});
