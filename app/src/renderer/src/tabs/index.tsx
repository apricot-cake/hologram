import { useEffect, useState } from 'react';
import { hologramTabsSource } from '../services/tabs.ts';
import { Tabs } from './Tabs.tsx';

// タブの帯のホスト＝単一の App のルートの下、AppShell のタイトルバーの帯の中にある。
// 以前の押し込み（viewer.js が renderTabs() で TabsModel を組み立て、約15か所の呼び出し元
// から共用の描画ブリッジへ押し込んでいた）から、引かれるソース（services/tabs.ts の
// hologramTabsSource）へ移してある＝グリッドや image-tab のソースと同じ形。状態そのものは
// hologramStore の tabs/activeTabId のキー。変更（switchTab/addTab/…）は tabs-builder.ts が
// 持ち続け、帯はそれを直接呼ぶ（#621）。

// useSyncExternalStore は使わない: get() は通知のたびに新しいオブジェクトを計算し直す
// （グリッドや image-tab のソースと同じ）＝素の subscribe→setState の effect にすれば
// テアリングの検査をすり抜けられる。
export function TabsHost() {
  const [model, setModel] = useState(() => hologramTabsSource.get());
  useEffect(() => {
    const sync = () => setModel(hologramTabsSource.get());
    const unsub = hologramTabsSource.subscribe(sync);
    sync(); // この effect が走る前に変わったものを拾う
    return unsub;
  }, []);
  return <Tabs model={model} />;
}
