// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useOrientedImage } from './use-oriented-image.ts';

const bridge = vi.hoisted(() => ({ imageDataUrl: vi.fn() }));
vi.mock('../services/ipc.ts', () => ({ hologramIpc: bridge }));

let root: Root;
let container: HTMLDivElement;
let decode: ReturnType<typeof vi.fn>;
function View({ src }: { src: string }) {
  const image = useOrientedImage(src, 90, false);
  return createElement('span', null, image.error || image.src || 'loading');
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  decode = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode = decode;
    },
  );
  bridge.imageDataUrl.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('回転画像の取得待ちと選択の終了', () => {
  test.each(['switch', 'unmount'])('取得完了前の %s では古い画像を復号しない', async (action) => {
    let resolve!: (data: string) => void;
    bridge.imageDataUrl.mockImplementationOnce(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    bridge.imageDataUrl.mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(createElement(View, { src: 'asset://img/old.png' })));
    if (action === 'switch') await act(async () => root.render(createElement(View, { src: 'asset://img/new.png' })));
    else await act(async () => root.render(null));
    await act(async () => resolve('data:image/png;base64,owned'));
    expect(decode).not.toHaveBeenCalled();
  });
});
