import { expect, test } from 'vitest';
import { localFixedBuildPlugin } from './local-fixed-build.mjs';

test('固定版の色は外部CSSとして生成し、文字や操作を追加しない', () => {
  const plugin = localFixedBuildPlugin();
  const assets: any[] = [];
  plugin.generateBundle.call({ emitFile: (asset) => assets.push(asset) });
  expect(assets).toEqual([{ type: 'asset', fileName: 'local-fixed.css', source: expect.stringContaining('#ffedd5') }]);
  expect(plugin.transformIndexHtml()).toEqual([{ tag: 'link', attrs: { rel: 'stylesheet', href: './local-fixed.css' }, injectTo: 'head' }]);
});
