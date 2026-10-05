import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { expect, test, vi } from 'vitest';

function screenshot(result: 'blank' | 'timeout' | 'success') {
  const methods: string[] = [];
  const writeFileSync = vi.fn();
  const error = vi.fn();
  const exit = vi.fn();
  const close = vi.fn();
  class Socket extends EventEmitter {
    constructor() {
      super();
      queueMicrotask(() => this.emit('open'));
    }
    close = close;
    send(raw: string) {
      const request = JSON.parse(raw);
      methods.push(request.method);
      if (request.method === 'Page.captureScreenshot' && result === 'timeout') return;
      const response = request.method === 'Page.captureScreenshot' ? { data: Buffer.alloc(result === 'success' ? 7000 : 1).toString('base64') } : {};
      queueMicrotask(() => this.emit('message', JSON.stringify({ id: request.id, result: response })));
    }
  }
  const require = (name: string) => {
    if (name === 'node:http')
      return {
        get: (_url: string, callback: (response: EventEmitter) => void) => {
          const response = new EventEmitter();
          callback(response);
          queueMicrotask(() => {
            response.emit('data', JSON.stringify([{ type: 'page', url: 'index.html', webSocketDebuggerUrl: 'ws://test' }]));
            response.emit('end');
          });
          return new EventEmitter();
        },
      };
    if (name === 'node:fs') return { mkdirSync: vi.fn(), writeFileSync };
    if (name === 'node:path') return path;
    if (name === 'ws') return Socket;
    if (name === './lib-sandbox-instance.cts') return { assertMainWorkingTree: vi.fn(), isSandboxPort: () => false };
    if (name === './lib-verification-output.cts') return { resolveVerificationOutput: () => 'safe-output.jpg' };
    throw new Error(`Unexpected dependency ${name}`);
  };
  vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, 'cdp-verify.cts'), 'utf8')), {
    require,
    __dirname,
    Buffer,
    setTimeout,
    clearTimeout,
    process: { argv: ['node', 'script', 'shot'], env: { CDP_FOCUS: '1' }, exit },
    console: { error, log: vi.fn() },
  });
  return { methods, writeFileSync, error, exit, close };
}

test.each(['blank', 'timeout'] as const)('撮影失敗時も前面表示せず終了する: %s', async (result) => {
  const probe = screenshot(result);
  await vi.waitFor(() => expect(probe.exit).toHaveBeenCalledWith(1), { timeout: 3000 });
  expect(probe.methods).toEqual(['Page.enable', 'Runtime.enable', 'Page.captureScreenshot']);
  expect(probe.writeFileSync).not.toHaveBeenCalled();
  expect(probe.close).toHaveBeenCalled();
  expect(probe.error).toHaveBeenCalled();
});

test('背面で撮影できた画像は保存する', async () => {
  const probe = screenshot('success');
  await vi.waitFor(() => expect(probe.writeFileSync).toHaveBeenCalledOnce());
  expect(probe.methods).toEqual(['Page.enable', 'Runtime.enable', 'Page.captureScreenshot']);
  expect(probe.exit).not.toHaveBeenCalled();
  expect(probe.close).toHaveBeenCalled();
});
