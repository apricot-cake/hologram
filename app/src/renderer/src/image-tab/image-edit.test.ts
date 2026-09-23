import { expect, test } from 'vitest';
import { flipEdit, rotateEdit, type ImageEdit } from './image-edit.ts';

test('回転と反転に合わせてクロップ範囲を移す', () => {
  const edit: ImageEdit = { rotation: 0, flipped: false, crop: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } };
  const rotated = rotateEdit(edit);
  expect(rotated.rotation).toBe(90);
  expect(rotated.crop?.x).toBeCloseTo(0.4);
  expect(rotated.crop?.y).toBeCloseTo(0.1);
  expect(rotated.crop?.width).toBe(0.4);
  let full = edit;
  for (let i = 0; i < 4; i++) full = rotateEdit(full);
  expect(full.rotation).toBe(0);
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(full.crop![k]).toBeCloseTo(edit.crop![k]);
  expect(flipEdit(flipEdit(edit)).flipped).toBe(false);
  expect(flipEdit(flipEdit(edit)).crop?.x).toBeCloseTo(0.1);
  expect(rotateEdit(flipEdit(edit)).rotation).toBe(270);
});
