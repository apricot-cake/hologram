const path = require('node:path');

const root = __dirname;

module.exports = {
  outDir: path.join(root, 'artifacts'),
  packagerConfig: {
    asar: { unpack: '**/{.**,**}/**/*.node' },
    icon: path.join(root, 'assets', 'icon'),
    extraResource: [path.join(root, '..', 'native-host'), path.join(root, 'vendor', 'meilisearch')],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        authors: 'apricot-cake',
        description: 'Hologram desktop viewer',
        exe: 'Hologram.exe',
        noMsi: true,
        setupExe: 'HologramSetup.exe',
        setupIcon: path.join(root, 'assets', 'icon.ico'),
      },
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'apricot-cake',
          name: 'hologram',
        },
        draft: true,
      },
    },
  ],
};
