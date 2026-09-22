'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { packager } = require('@electron/packager');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'app');
const forgeConfig = require(path.join(appDir, 'forge.config.cjs'));
const appPackage = require(path.join(appDir, 'package.json'));

async function packageApp() {
  const packageOptions = {
    ...forgeConfig.packagerConfig,
    dir: appDir,
    out: forgeConfig.outDir,
    name: appPackage.name,
    executableName: 'Hologram',
    electronVersion: appPackage.devDependencies.electron,
    platform: 'win32',
    arch: 'x64',
    overwrite: true,
    prune: false,
    ignore: [/^\/(?!assets(?:\/|$)|node_modules(?:\/|$)|out(?:\/|$)|package\.json$).*/],
    afterComplete: [({ buildPath }) => fs.cp(path.join(appDir, 'third-party-licenses'), path.join(buildPath, 'resources', 'licenses'), { recursive: true })],
  };
  const outputs = await packager(packageOptions);
  for (const output of outputs) console.log(output);
}

packageApp().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
