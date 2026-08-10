// CJS の 'use-sync-external-store' の shim パッケージ（@base-ui/react と @base-ui/utils が
// 連れてくる推移的な依存）の、ESM での代役。React 18 以降は useSyncExternalStore を標準で
// 持っているうえ、CJS のパッケージが書いている literal な require("react") はバンドル後の
// レンダラーの出力にそのまま残り（external がグローバルへ写されるのは ESM の import に
// 対してだけ）、file:// の下では読み込み時に例外を投げる。
// electron.vite.config.ts の RESOLVE_ALIAS で別名にしてある。
export { useSyncExternalStore } from 'react';
