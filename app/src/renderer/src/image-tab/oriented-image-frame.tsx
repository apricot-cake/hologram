import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ImgHTMLAttributes, Ref, RefObject } from 'react';
import type { CropRect } from './ImageTab.tsx';
import type { Rotation } from './image-edit.ts';

export function orientedDimensions(width: number, height: number, rotation: Rotation) {
  return rotation % 180 ? { width: height, height: width } : { width, height };
}

export function orientedFrameLayout(width: number, height: number, rotation: Rotation, flipped: boolean, availableWidth: number, availableHeight: number, crop?: CropRect | null) {
  const oriented = orientedDimensions(width, height, rotation);
  const region = crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const scale = width > 0 && height > 0 ? Math.min(1, availableWidth / (oriented.width * region.width), availableHeight / (oriented.height * region.height)) : 0;
  return {
    frame: { width: oriented.width * region.width * scale, height: oriented.height * region.height * scale },
    plane: { width: oriented.width * scale, height: oriented.height * scale, left: -region.x * oriented.width * scale, top: -region.y * oriented.height * scale },
    image: {
      width: width * scale,
      height: height * scale,
      // 旧 canvas と同じく、回転後の表示面を左右反転する (S × R)。
      transform: `translate(-50%, -50%) scaleX(${flipped ? -1 : 1}) rotate(${rotation}deg)`,
    },
  };
}

// 回転後の box をレイアウトへ参加させ、クロップ・フィット・ズームの寸法を揃える。
export function OrientedImageFrame({
  rotation = 0,
  flipped = false,
  crop,
  sourceWidth,
  sourceHeight,
  boundsRef,
  imageRef,
  ...imageProps
}: ImgHTMLAttributes<HTMLImageElement> & {
  rotation?: Rotation;
  flipped?: boolean;
  crop?: CropRect | null;
  sourceWidth?: number;
  sourceHeight?: number;
  boundsRef?: RefObject<HTMLDivElement | null>;
  imageRef?: Ref<HTMLImageElement>;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const bounds = boundsRef?.current ?? frameRef.current?.parentElement;
    if (!bounds) return;
    const measure = () => {
      const style = getComputedStyle(bounds);
      setAvailable({ width: Math.max(0, bounds.clientWidth - Number.parseFloat(style.paddingLeft || '0') - Number.parseFloat(style.paddingRight || '0')), height: Math.max(0, bounds.clientHeight - Number.parseFloat(style.paddingTop || '0') - Number.parseFloat(style.paddingBottom || '0')) });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(bounds);
    return () => observer.disconnect();
  }, [boundsRef]);
  const width = naturalSize.width || sourceWidth || 0;
  const height = naturalSize.height || sourceHeight || 0;
  const layout = orientedFrameLayout(width, height, rotation, flipped, available.width, available.height, crop);
  const position: CSSProperties = { position: 'absolute', left: '50%', top: '50%', maxWidth: 'none', maxHeight: 'none', transformOrigin: 'center' };
  return (
    <div ref={frameRef} data-slot="oriented-image-frame" className="relative shrink-0 overflow-hidden" style={layout.frame}>
      <div className="absolute" style={layout.plane}>
        <img
          {...imageProps}
          alt={imageProps.alt ?? ''}
          ref={imageRef}
          style={{ ...imageProps.style, ...position, ...layout.image }}
          onLoad={(event) => {
            setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
            imageProps.onLoad?.(event);
          }}
        />
      </div>
    </div>
  );
}
