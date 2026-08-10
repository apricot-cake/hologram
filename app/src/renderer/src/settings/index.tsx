import { App as SettingsApp } from './App.tsx';
import { close as settingsClose, isOpen as settingsIsOpen, open as settingsOpen, subscribe as settingsSubscribe } from '../services/settings.ts';

// 設定モーダル＝単一の App のルートの素の子（#621 で、以前ポータル先にしていた空の
// <div id="settingsRoot"> を外した。ダイアログは自分で document.body へポータルするので、
// あの取り付け先は初めから何もしていなかった）。開閉のストアは services/settings.ts へ
// 移した＝orchestrator.ts（ブランドバーの歯車）と *-builder.ts の Esc・ショートカットの
// 防ぎが、グローバルなブリッジを読まずに open()/close()/isOpen() を直接呼べるようにする
// ため。正本は useSyncExternalStore 越しに React 側にあり続け、下で App.tsx が期待する
// OpenStore の形へつないである。i18n は統合されたルートが描画の前に解決するので、
// モーダルの中では t() が同期で動く。
const store = { isOpen: settingsIsOpen, set: (v: boolean) => (v ? settingsOpen() : settingsClose()), subscribe: settingsSubscribe };

export function SettingsHost() {
  return <SettingsApp store={store} />;
}
