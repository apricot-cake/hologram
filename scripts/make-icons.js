'use strict';

// Regenerates the extension icons (icons/icon{16,32,48,128}.png) as a gradient
// ring on a transparent background. Run with Electron (for Chromium canvas +
// alpha capture):
//
//   app/node_modules/.bin/electron scripts/make-icons.js
//
// Edit STOP1 / STOP2 to change the gradient colors.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const STOP1 = '#7c3aed'; // purple (top-left)
const STOP2 = '#1d9bf0'; // blue (bottom-right)
const SIZE = 256; // render at 256 (Windows packaging needs >=256), downscale for the rest
const SIZES = [256, 128, 48, 32, 16];

const cx = SIZE / 2, r = SIZE * 0.375, lw = SIZE * 0.109;
const g0 = SIZE * 0.14, g1 = SIZE * 0.86;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;background:transparent;overflow:hidden}
  canvas{display:block}
</style></head><body>
<canvas id="c" width="${SIZE}" height="${SIZE}"></canvas>
<script>
  const x = document.getElementById('c').getContext('2d');
  const g = x.createLinearGradient(${g0}, ${g0}, ${g1}, ${g1});
  g.addColorStop(0, '${STOP1}');
  g.addColorStop(1, '${STOP2}');
  x.lineWidth = ${lw};
  x.strokeStyle = g;
  x.beginPath();
  x.arc(${cx}, ${cx}, ${r}, 0, Math.PI * 2);
  x.stroke();
  document.title = 'done';
</script></body></html>`;

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
  const outDir = path.join(__dirname, '..', 'icons');

  for (const s of SIZES) {
    const out = s === SIZE ? img : img.resize({ width: s, height: s, quality: 'best' });
    fs.writeFileSync(path.join(outDir, `icon${s}.png`), out.toPNG());
    console.log(`wrote icon${s}.png`);
  }

  app.quit();
});
