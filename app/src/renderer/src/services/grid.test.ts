import { expect, test } from 'vitest';
import { hologramPostGridSource as source } from './grid';
import { store } from './store';

test('閲覧回数の更新では配置を保持し、並び替えと絞り込みでは更新する', () => {
  const previous = store.getState().postGroups;
  source.configure({ modelOf: (item) => item, keyOf: (item) => item.id, onAspect: () => {} });
  const setItems = (items: { id: string; localViewCount: number }[]) => {
    store.setState({ postGroups: items as any });
    return source.get()!;
  };
  try {
    const original = setItems([
      { id: 'a', localViewCount: 0 },
      { id: 'b', localViewCount: 0 },
    ]);
    const updated = setItems([
      { id: 'a', localViewCount: 1 },
      { id: 'b', localViewCount: 0 },
    ]);
    expect(updated.itemsKey).toBe(original.itemsKey);
    expect(updated.items[0].localViewCount).toBe(1);
    const sorted = setItems([
      { id: 'b', localViewCount: 0 },
      { id: 'a', localViewCount: 1 },
    ]);
    expect(sorted.itemsKey).not.toBe(updated.itemsKey);
    const filtered = setItems([{ id: 'b', localViewCount: 0 }]);
    expect(filtered.itemsKey).not.toBe(sorted.itemsKey);
  } finally {
    store.setState({ postGroups: previous });
  }
});
