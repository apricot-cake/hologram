// 背景はレンダラーだけが描く。ネイティブの操作領域は常時透明にする。
export const TITLEBAR_HEIGHT = 44;
export const TITLEBAR_OVERLAY_BACKGROUND = '#00000000';
export const TITLEBAR_COLORS = {
  light: { color: '#f0f0f0', symbolColor: '#202124' },
  dark: { color: '#0f0f0f', symbolColor: '#e6e8ed' },
} as const;

export function dimTitlebarSymbolColor(color: string, amount: number): string {
  const match = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(color);
  if (!match) return color;
  const factor = 1 - Math.max(0, Math.min(1, amount));
  return `#${[0, 2, 4]
    .map((offset) =>
      Math.round(Number.parseInt(match[1].slice(offset, offset + 2), 16) * factor)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}${match[2] ?? ''}`;
}
