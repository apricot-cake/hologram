import type { CropRect } from './ImageTab.tsx';
export type Rotation = 0 | 90 | 180 | 270;
export interface ImageEdit {
  crop: CropRect | null;
  rotation: Rotation;
  flipped: boolean;
}
export function rotateEdit(edit: ImageEdit): ImageEdit {
  const c = edit.crop;
  return { ...edit, rotation: ((edit.rotation + (edit.flipped ? 270 : 90)) % 360) as Rotation, crop: c ? { x: Math.max(0, 1 - c.y - c.height), y: c.x, width: c.height, height: c.width } : null };
}
export function flipEdit(edit: ImageEdit): ImageEdit {
  const c = edit.crop;
  return { ...edit, flipped: !edit.flipped, crop: c ? { ...c, x: Math.max(0, 1 - c.x - c.width) } : null };
}
