// 'use-sync-external-store/shim/with-selector'（@base-ui/utils の推移的な依存）の ESM 版の
// 代役。動機は use-sync-external-store-shim.ts と同じで、CJS のパッケージにある字面どおりの
// require("react") が束ねたレンダラーの出力にそのまま残り、file:// の下で読み込み時に例外を
// 投げるため。React は useSyncExternalStore を自前で export しているが with-selector の版は
// export していないので、ここは上流のメモ化ラッパーを忠実に移植したもの。別名の割り当ては
// electron.vite.config.ts の RESOLVE_ALIAS。
import { useDebugValue, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => Snapshot, getServerSnapshot: undefined | null | (() => Snapshot), selector: (snapshot: Snapshot) => Selection, isEqual?: (a: Selection, b: Selection) => boolean): Selection {
  const instRef = useRef<{ hasValue: boolean; value: Selection | null } | null>(null);
  let inst: { hasValue: boolean; value: Selection | null };
  if (instRef.current === null) {
    inst = { hasValue: false, value: null };
    instRef.current = inst;
  } else {
    inst = instRef.current;
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: inst はスナップショットの時点で遅延して読む安定した ref の状態（上流の書き方）＝依存に並べるとメモ化が無駄になる
  const [getSelection, getServerSelection] = useMemo(() => {
    // メモ化した状態は、この getSnapshot 関数のメモ化されたインスタンスに閉じた
    // クロージャ変数で追う。useRef のフックを意図して使っていない。あの状態はフックや
    // コンポーネントの並行する複製すべてで共有されてしまうため。
    let hasMemo = false;
    let memoizedSnapshot: Snapshot;
    let memoizedSelection: Selection;
    const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
      if (!hasMemo) {
        // フックが最初に呼ばれた時は、メモ化した結果が無い。
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        if (isEqual !== undefined && inst.hasValue) {
          const currentSelection = inst.value as Selection;
          if (isEqual(currentSelection, nextSelection)) {
            memoizedSelection = currentSelection;
            return currentSelection;
          }
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }
      const prevSnapshot = memoizedSnapshot;
      const prevSelection = memoizedSelection;
      if (Object.is(prevSnapshot, nextSnapshot)) {
        // スナップショットが前回と同じ。前の選択結果を使い回す。
        return prevSelection;
      }
      // スナップショットが変わったので、新しい選択結果を計算する必要がある。
      const nextSelection = selector(nextSnapshot);
      // 独自の isEqual 関数が渡されていれば、それでデータが変わったかを調べる。変わって
      // いなければ前の選択結果を返す。それは選択結果が概念として等しいことを React へ
      // 伝える合図になり、描画を打ち切れる。
      if (isEqual !== undefined && isEqual(prevSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return prevSelection;
      }
      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };
    const maybeGetServerSnapshot = getServerSnapshot === undefined || getServerSnapshot === null ? null : getServerSnapshot;
    const getSnapshotWithSelector = () => memoizedSelector(getSnapshot());
    const getServerSnapshotWithSelector = maybeGetServerSnapshot === null ? undefined : () => memoizedSelector(maybeGetServerSnapshot());
    return [getSnapshotWithSelector, getServerSnapshotWithSelector];
  }, [getSnapshot, getServerSnapshot, selector, isEqual]);

  const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);

  useEffect(() => {
    inst.hasValue = true;
    inst.value = value;
  }, [inst, value]);

  useDebugValue(value);
  return value;
}
