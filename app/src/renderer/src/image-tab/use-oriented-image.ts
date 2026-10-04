import { useEffect, useState } from 'react';
import { hologramIpc } from '../services/ipc.ts';
import { fileOfSrc } from '../services/asset-src.ts';
import type { Rotation } from './image-edit.ts';

// 元ファイルには触れず、回転・反転済みの表示用画像を作る。
export function useOrientedImage(src: string, rotation: Rotation, flipped: boolean) {
  const key = `${src}:${rotation}:${flipped}`;
  const [result, setResult] = useState<{ key: string; src?: string; error?: string } | null>(null);
  useEffect(() => {
    if (!rotation && !flipped) return;
    let canceled = false;
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const data = await hologramIpc.imageDataUrl(fileOfSrc(src));
        if (canceled) return;
        if (!data) throw new Error('画像を読み込めませんでした');
        const image = new Image();
        image.src = data;
        await image.decode();
        if (canceled) return;
        const canvas = document.createElement('canvas');
        const quarter = rotation % 180 !== 0;
        canvas.width = quarter ? image.naturalHeight : image.naturalWidth;
        canvas.height = quarter ? image.naturalWidth : image.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('画像を表示できませんでした');
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(flipped ? -1 : 1, 1);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (canceled) return;
        if (!blob) throw new Error('画像を表示できませんでした');
        objectUrl = URL.createObjectURL(blob);
        setResult({ key, src: objectUrl });
      } catch (error) {
        if (!canceled) setResult({ key, error: error instanceof Error ? error.message : '画像を表示できませんでした' });
      }
    })();
    return () => {
      canceled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, rotation, flipped, key]);
  if (!rotation && !flipped) return { src, error: undefined };
  return result?.key === key ? result : { src: undefined, error: undefined };
}
