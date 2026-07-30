import JSZip from 'jszip';
import { useEffect, useRef, useState } from 'react';
import { imageDataUrl } from '../services/posts.ts';

// pixiv うごイラ playback (#119 St3). The library stores pixiv's own archive
// untouched — a zip of frame images — because every single-file form of it
// (mp4/webm/gif) would mean re-encoding, i.e. carrying an encoder in the app and
// throwing away what the artist uploaded. Nothing native plays a zip, so the
// frames are drawn to a canvas on the schedule the sidecar's frame table gives.
export interface UgoiraFrame {
  file: string;
  delay: number; // ms this frame is shown (pixiv's own per-frame value)
}

// Decoded frames are bounded by BYTES, not by frame count. Measured うごイラ
// (2026-07-29, pixiv daily ranking) run from 8 frames of 500x500 to 104 frames
// of 1280x720 and 24 frames of 2000x1125 — decoding a whole archive up front
// would be 8MB for the first and ~366MB for the second. The player therefore
// keeps a rolling window ahead of the playhead and closes the bitmaps behind
// it, so memory depends on the frame SIZE and not on how long the animation is.
const DECODED_BUDGET_BYTES = 96 * 1024 * 1024;
const MIN_AHEAD = 3; // always keep this many decoded, however large the frames
// A frame table with a nonsense delay would either freeze the animation or spin
// the event loop; clamp instead of trusting pixiv's number outright.
const MIN_DELAY_MS = 10;
const MAX_DELAY_MS = 10000;

const PLAY_ICON = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const PAUSE_ICON = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
  </svg>
);

export function UgoiraPlayer({ file, frames, poster, alt, labels }: { file: string; frames: UgoiraFrame[]; poster?: string; alt?: string; labels: Record<string, string> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [playing, setPlaying] = useState(true);
  // The loop reads these through refs so toggling play/pause (and a frame table
  // arriving as a fresh array identity each render) never restarts the decode.
  const playingRef = useRef(true);
  playingRef.current = playing;
  const framesRef = useRef(frames);
  framesRef.current = frames;

  useEffect(() => {
    let disposed = false;
    const bitmaps = new Map<number, ImageBitmap>();
    // In-flight decodes, so the prefetch fired on every tick can overlap the
    // previous one without decoding the same frame twice (which would leak the
    // loser and double-count its bytes).
    const pending = new Map<number, Promise<ImageBitmap | null>>();
    let decodedBytes = 0;
    let blobs: Blob[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sizeOf = (b: ImageBitmap) => b.width * b.height * 4;
    const drop = (i: number) => {
      const b = bitmaps.get(i);
      if (!b) return;
      decodedBytes -= sizeOf(b);
      bitmaps.delete(i);
      b.close();
    };
    const decode = (i: number): Promise<ImageBitmap | null> => {
      const held = bitmaps.get(i);
      if (held) return Promise.resolve(held);
      const running = pending.get(i);
      if (running) return running;
      const job = createImageBitmap(blobs[i])
        .then((bmp) => {
          if (disposed) {
            bmp.close();
            return null;
          }
          bitmaps.set(i, bmp);
          decodedBytes += sizeOf(bmp);
          return bmp;
        })
        .finally(() => pending.delete(i));
      pending.set(i, job);
      return job;
    };
    // Decode forward from `from` until the budget is spent, always covering at
    // least MIN_AHEAD frames so a huge-frame archive still plays (one oversized
    // bitmap must not stop the window from advancing).
    const prefetch = async (from: number) => {
      const n = blobs.length;
      for (let k = 0; k < n; k++) {
        if (disposed) return;
        if (k >= MIN_AHEAD && decodedBytes >= DECODED_BUDGET_BYTES) return;
        await decode((from + k) % n);
      }
    };
    // Free what the playhead has passed, but only once the budget is actually
    // under pressure — a small archive stays fully decoded and loops for free.
    const releaseBehind = (i: number) => {
      const n = blobs.length;
      for (const k of [...bitmaps.keys()]) {
        if (k === i || decodedBytes < DECODED_BUDGET_BYTES) continue;
        if ((k - i + n) % n >= MIN_AHEAD) drop(k);
      }
    };

    (async () => {
      try {
        if (!framesRef.current.length) throw new Error('no frames');
        // NOT fetch('asset://…'): the renderer document is served from file://,
        // and Chromium refuses a cross-origin fetch to a custom scheme outright
        // ("Cross origin requests are only supported for protocol schemes:
        // chrome, chrome-extension, chrome-untrusted, data, http, https") — a
        // CSP allowance cannot grant what the scheme check denies. The existing
        // image-data-url IPC hands the bytes over instead, with the same
        // save-folder containment check every other file read goes through.
        const url = await imageDataUrl(file);
        if (!url) throw new Error('archive unreadable');
        const res = await fetch(url);
        const zip = await JSZip.loadAsync(await res.arrayBuffer());
        blobs = await Promise.all(
          framesRef.current.map(async (f) => {
            const entry = zip.file(f.file);
            // A frame named in the table but absent from the archive means the
            // two no longer describe the same animation — better to show the
            // poster than to play a silently reordered one.
            if (!entry) throw new Error(`missing frame ${f.file}`);
            return (await entry.async('blob')) as Blob;
          }),
        );
        if (disposed || !blobs.length) return;

        let i = 0;
        const tick = async () => {
          if (disposed) return;
          const bmp = await decode(i);
          const canvas = canvasRef.current;
          if (disposed || !bmp || !canvas) return;
          if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
            canvas.width = bmp.width;
            canvas.height = bmp.height;
          }
          canvas.getContext('2d')?.drawImage(bmp, 0, 0);
          releaseBehind(i);
          void prefetch(i + 1);
          const raw = framesRef.current[i]?.delay ?? 100;
          const delay = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, raw));
          const step = () => {
            if (disposed) return;
            // Paused: hold on this frame and re-check, rather than tearing the
            // timer down and having to rebuild the decode window on resume.
            if (!playingRef.current) {
              timer = setTimeout(step, 100);
              return;
            }
            i = (i + 1) % blobs.length;
            void tick();
          };
          timer = setTimeout(step, delay);
        };
        setStatus('ready');
        void tick();
      } catch {
        if (!disposed) setStatus('error');
      }
    })();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      for (const b of bitmaps.values()) b.close();
      bitmaps.clear();
    };
  }, [file]);

  // The canvas is mounted from the first render (the draw loop needs its ref
  // the moment the archive opens) and the poster covers it until then. Loading
  // and failure both fall back to that poster — the still frame pixiv serves
  // for this work, already downloaded next to the archive — so a うごイラ whose
  // archive won't open still shows the artwork.
  return (
    <div className="itv-ugoira">
      <canvas ref={canvasRef} className="itv-media" role="img" aria-label={alt || labels.ugoira || ''} style={status === 'ready' ? undefined : { display: 'none' }} />
      {/* decoding="async" like the rest of the viewer surface (#241) — the
          archive is being unzipped and decoded on the same thread's tasks, so
          the poster must not add a blocking decode on top of that. */}
      {status !== 'ready' && poster && <img className="itv-media" src={poster} alt={alt || ''} decoding="async" />}
      {status === 'ready' && (
        <button type="button" className="icon-btn itv-ugoira-toggle" aria-label={playing ? labels.pause : labels.play} data-tip={playing ? labels.pause : labels.play} onClick={() => setPlaying((p) => !p)}>
          {playing ? PAUSE_ICON : PLAY_ICON}
        </button>
      )}
    </div>
  );
}
