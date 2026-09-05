import type { PercentCrop } from 'react-image-crop';

export interface StoredCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function toPercentCrop(rect: StoredCropRect): PercentCrop {
  return { unit: '%', x: rect.x * 100, y: rect.y * 100, width: rect.width * 100, height: rect.height * 100 };
}

export function fromPercentCrop(crop: PercentCrop): StoredCropRect | null {
  const x = Math.max(0, Math.min(1, crop.x / 100));
  const y = Math.max(0, Math.min(1, crop.y / 100));
  const width = Math.max(0, Math.min(1 - x, crop.width / 100));
  const height = Math.max(0, Math.min(1 - y, crop.height / 100));
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}
