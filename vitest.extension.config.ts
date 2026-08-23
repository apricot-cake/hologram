import path from 'node:path';
import { type Plugin, transformWithOxc } from 'vite';
import { defineConfig } from 'vitest/config';

const ctsAsTypeScript = (): Plugin => ({
  name: 'hologram:cts-as-typescript',
  async transform(code, id) {
    if (!id.endsWith('.cts')) return null;
    const { code: js, map } = await transformWithOxc(code, id, { lang: 'ts' });
    return { code: js, map };
  },
});

// Chrome のテスト専用バンドルを直接読むスイート。`npm run test:extension` が
// バンドルを作ってから、この設定で対象だけを実行する。
export default defineConfig({
  plugins: [ctsAsTypeScript()],
  test: {
    include: ['scripts/**/*.extension-bundle.test.ts'],
    environment: 'node',
    setupFiles: [path.resolve(__dirname, 'scripts/vitest.setup.ts')],
  },
});
