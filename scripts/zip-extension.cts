'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yazl = require('yazl');
const { verifyOutput } = require('./build-extension.cts');

const ROOT = path.join(__dirname, '..');
const output = verifyOutput('chrome');
const destination = path.join(ROOT, 'extension', '.output', 'hologram-chrome-mv3.zip');
const zip = new yazl.ZipFile();

for (const entry of fs.readdirSync(output, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const absolute = path.join(entry.parentPath, entry.name);
  const relative = path.relative(output, absolute).replaceAll('\\', '/');
  zip.addFile(absolute, relative);
}

zip.end();
zip.outputStream.pipe(fs.createWriteStream(destination)).on('close', () => {
  console.log(`[hologram] wrote verified Chrome ZIP: ${destination}`);
});
