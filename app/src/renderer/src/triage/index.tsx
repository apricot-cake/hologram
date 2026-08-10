import { useEffect } from 'react';
import { loadPinnedTags } from '../services/triage.ts';
import { triageHandleKey } from '../services/orchestrator.ts';
import { TriageMode } from './TriageMode.tsx';

// App.tsx で一度だけ載せる。body 直下の他のオーバーレイのホスト（Lightbox・Settings・
// BulkTagDialog…）と並ぶ。ダイアログの描画のほかに責務が2つある:
//  - 載せた時に一度だけ、ピン留めしたタグの設定を突き合わせる（triage.ts 自身の load。
//    panels.ts と同じ書き方＝なぜ bootApp に置かないかはそのモジュールのコメントを参照）
//  - トリアージの範囲の keydown リスナー（1-9/Space/Backspace）を、アプリの生存期間ぶん
//    登録する。トリアージが閉じている間は何もしない（triage-builder.ts の handleTriageKey
//    が先に isOpen() を見る）ので、開閉の状態に合わせて載せ外しする段取りを挟まずに
//    GlobalShortcuts の隣に置ける＝image-tab/index.tsx 自身の ←/→ のリスナーと同じ
//    「一度だけ登録して、内側で防ぐ」形。
export function TriageHost() {
  useEffect(() => {
    loadPinnedTags();
  }, []);
  useEffect(() => {
    // AppToolbar の TriageButton と同じ防ぎ方。このリスナーは最初に載せた時点から生きて
    // いて、orchestrator.ts の非同期の起動が triageHandleKey を代入し終えているとは限ら
    // ない（理由はそのコンポーネントのコメントを参照）。
    const onKeydown = (e: KeyboardEvent) => triageHandleKey?.(e);
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  }, []);
  return <TriageMode />;
}
