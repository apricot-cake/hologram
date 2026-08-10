import { useEffect, useState, useSyncExternalStore } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { store, subscribeKey } from '../services/store.ts';

// 2つのライブラリのグリッド（投稿・投稿者）の読み込み中の仮表示。「ウィンドウが開いた」
// から「ライブラリの最初の読み込みが届いた」までの間に出す（#682）。以前この間は何も
// 描かれず、ごく小さなライブラリでない限り「ライブラリが空だ」と読めてしまっていた。
// empty/EmptyState.tsx が受け持つのは残り2つの状態（空だと確かめられた／絞り込んだ結果が
// 空）で、こちらは「まだ分からない」を受け持つ。
//
// スピナーではなくスケルトンにする。配置が分かっている内容（フィード・一覧・検索結果＝
// https://www.nngroup.com/articles/skeleton-screens/）について NN/G が勧めているのは、
// これから来る形を写したスケルトンで、スピナーは短い間ふさぐ動作（送信・認証・保存）に
// 取っておく。投稿のグリッドは前者に当たる。新しい読み込み用の部品を作らず、既存の
// shadcn の Skeleton（components/ui/skeleton.tsx）から組む＝shadcn 自身のドキュメントも
// これを「内容の読み込み中に置くプレースホルダ」と説明している。
const subLibraryLoaded = (cb: () => void) => subscribeKey('libraryLoaded', cb);
const getLibraryLoaded = () => store.getState().libraryLoaded;
const subMode = (cb: () => void) => subscribeKey('browseMode', cb);
const getMode = () => store.getState().browseMode;

// 300ms ほどより短い待ちは人が待ちとして認識しないので、出てすぐ消えるスケルトンは進捗
// ではなく雑音のひらめきに見える。互いに独立した複数のデザインシステム（eBay の Playbook、
// Semrush の Intergalactic、英国情報コミュニティの ICDS）が同じ線を引いている＝300ms 未満
// では何も出さず、それを越えて初めてプレースホルダを出す。出典は #682 を参照。
const SHOW_DELAY_MS = 300;
const SKELETON_COUNT = 18;

function useDelayed(active: boolean, delayMs: number): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return show;
}

export function LibraryLoading() {
  const mode = useSyncExternalStore(subMode, getMode);
  const loaded = useSyncExternalStore(subLibraryLoaded, getLibraryLoaded);
  const pending = mode !== 'trash' && !loaded;
  const show = useDelayed(pending, SHOW_DELAY_MS);
  if (!show) return null;
  return (
    <div aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="aspect-square w-full rounded-lg" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
