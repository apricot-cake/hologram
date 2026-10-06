const { fetchPostMetadata } = require('../extension/utils/extractor/index.ts');
const { createCaptureSession, endpointOf, MAX_RESPONSE_BYTES } = require('./lib-api-response-capture.cts');

// 開発用 Chrome の管理プロセス内だけで使う。拡張や Native Host へ組み込まない。
exports.run = async ({ context, args }) => {
  const options = JSON.parse(args[0]);
  const session = createCaptureSession(options);
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init: RequestInit = {}) => {
    const url = String(input);
    if (!endpointOf(url)) throw new Error('収集対象外のAPI要求です');
    const remaining = session.expiresAt - Date.now();
    if (remaining <= 0) {
      session.capture.limited = true;
      throw new Error('収集期限を過ぎました');
    }
    let raw: { status: number | null; body: string | null; outcome: string };
    try {
      raw = await worker.evaluate(
        async ({ url, credentials, redirect, maxBytes, timeout }) => {
          try {
            const response = await fetch(url, { credentials, redirect, signal: AbortSignal.timeout(timeout) });
            const reader = response.body?.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            if (reader) {
              try {
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  size += value.byteLength;
                  if (size > maxBytes) {
                    await reader.cancel();
                    return { status: response.status, body: null, outcome: 'oversize' };
                  }
                  chunks.push(value);
                }
              } finally {
                reader.releaseLock();
              }
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            return { status: response.status, body: new TextDecoder().decode(bytes), outcome: 'response' };
          } catch {
            return { status: null, body: null, outcome: 'transport' };
          }
        },
        { url, credentials: init.credentials || 'same-origin', redirect: init.redirect || 'follow', maxBytes: MAX_RESPONSE_BYTES, timeout: Math.min(15000, remaining) },
      );
    } catch {
      raw = { status: null, body: null, outcome: 'transport' };
    }
    if (raw.outcome === 'oversize') session.capture.limited = true;
    if (!session.addResponse({ url, ...raw })) throw new Error('収集上限に達しました');
    if (raw.outcome !== 'response' || raw.status === null) throw new Error('開発用API取得が完了しませんでした');
    return new Response([204, 205, 304].includes(raw.status) ? null : raw.body, { status: raw.status });
  };
  try {
    for (const url of options.urls) {
      if (Date.now() >= session.expiresAt) {
        session.capture.limited = true;
        break;
      }
      session.addPost(url, await fetchPostMetadata(url, {}));
    }
    return session.finish();
  } finally {
    globalThis.fetch = original;
    session.finish();
  }
};
