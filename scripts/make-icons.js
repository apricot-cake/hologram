'use strict';

// Regenerates the app/extension icons (extension/icons/icon{16,32,48,128,256}.png)
// as the corpus fill mark: a rounded square tile with a solid { heart } glyph,
// sized to read at 16px. Run with Electron (for Chromium SVG render + alpha
// capture):
//
//   app/node_modules/.bin/electron scripts/make-icons.js
//
// The icon ships a solid tile so it stays legible on any taskbar/background at
// 16px. Colors follow the brand tokens (DESIGN.md "ブランド／ロゴ"):
//   ink  #23222c (dark) / #e9e7f3 (light)
//   sky  #28a8db (dark) / #8ad3ec (light)

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// --- Adopted mark (switch the whole icon here) -----------------------------
// VARIANT: 'a' = thin braces flanking a centered solid heart.
//          'b' = fat braces forming a vessel around a nested solid heart.
// SURFACE: 'light' = ink tile + light glyph (for app/light contexts).
//          'dark'  = light tile + ink glyph (for dark contexts).
// The default below mirrors assets/icon-mark-<VARIANT>-<SURFACE>.svg, the
// source of truth for the shapes; keep them in sync if either is tweaked.
const VARIANT = 'b';
const SURFACE = 'light';
// ---------------------------------------------------------------------------

const SIZE = 256;       // render at 256 (Windows packaging needs >=256), downscale for the rest
const SIZES = [256, 128, 48, 32, 16];

// Brand tokens.
const INK_DARK = '#23222c';
const INK_LIGHT = '#e9e7f3';
const SKY_DARK = '#28a8db';
const SKY_LIGHT = '#8ad3ec';

// Per-surface palette: tile fill, brace stroke, heart fill.
const PALETTE = {
  light: { tile: INK_DARK, brace: INK_LIGHT, heart: SKY_DARK },
  dark: { tile: INK_LIGHT, brace: INK_DARK, heart: SKY_LIGHT }
};

// Mark glyphs in the 56x56 coordinate space (matches the assets/icon-mark-*.svg
// files exactly). Each variant carries its brace stroke width and heart path so
// the PNG output is identical to the committed SVG.
const MARKS = {
  a: {
    braceWidth: 3.4,
    heartWidth: 1.4,
    braces: [
      'M19 15 q-4.5 0 -4.5 5.2 v3 q0 3.6 -3.6 5.1 q3.6 1.5 3.6 5.1 v3 q0 5.2 4.5 5.2',
      'M37 15 q4.5 0 4.5 5.2 v3 q0 3.6 3.6 5.1 q-3.6 1.5 -3.6 5.1 v3 q0 5.2 -4.5 5.2'
    ],
    heart: 'M28 39.5 C21 33.5 18.4 29.6 20 26.2 C21.2 23.7 24.7 23.7 26.5 26 C27.2 26.9 27.6 27.5 28 28.4 C28.4 27.5 28.8 26.9 29.5 26 C31.3 23.7 34.8 23.7 36 26.2 C37.6 29.6 35 33.5 28 39.5 Z'
  },
  b: {
    braceWidth: 5,
    heartWidth: 1.2,
    braces: [
      'M21 13 q-5 0 -5 5.6 v3.2 q0 4 -4 5.6 q4 1.6 4 5.6 v3.2 q0 5.6 5 5.6',
      'M35 13 q5 0 5 5.6 v3.2 q0 4 4 5.6 q-4 1.6 -4 5.6 v3.2 q0 5.6 -5 5.6'
    ],
    heart: 'M28 37 C22.5 32.2 20.5 29.1 21.7 26.4 C22.6 24.5 25.4 24.5 26.8 26.3 C27.4 27 27.7 27.5 28 28.2 C28.3 27.5 28.6 27 29.2 26.3 C30.6 24.5 33.4 24.5 34.3 26.4 C35.5 29.1 33.5 32.2 28 37 Z'
  }
};

const mark = MARKS[VARIANT];
const colors = PALETTE[SURFACE];

// The 56x56 mark fills the 256 tile via a single scale (256/56) with no inset:
// the tile rect in the source already insets 4 units (x=4..52), so the rounded
// corners land safely inside the canvas.
const scale = SIZE / 56;
const braceStrokes = mark.braces
  .map((d) => `<path d="${d}"/>`)
  .join('\n      ');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;background:transparent;overflow:hidden}
  svg{display:block}
</style></head><body>
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <g transform="scale(${scale})">
    <rect x="4" y="4" width="48" height="48" rx="13" fill="${colors.tile}"/>
    <g fill="none" stroke="${colors.brace}" stroke-width="${mark.braceWidth}" stroke-linecap="round" stroke-linejoin="round">
      ${braceStrokes}
    </g>
    <path d="${mark.heart}" fill="${colors.heart}" stroke="${colors.heart}" stroke-width="${mark.heartWidth}" stroke-linejoin="round"/>
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
