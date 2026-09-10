// 私用の固定版にだけ追加する。通常の build / dist には出力しない。
export function localFixedBuildPlugin() {
  return {
    name: 'hologram:local-fixed-build',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'local-fixed.css',
        source: ':root{--tabbar-bg:#ffedd5!important}:root.dark{--tabbar-bg:#594126!important}',
      });
    },
    transformIndexHtml() {
      return [{ tag: 'link', attrs: { rel: 'stylesheet', href: './local-fixed.css' }, injectTo: 'head' }];
    },
  };
}
