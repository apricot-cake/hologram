import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ugoiraFrame, ugoiraFramesPresent } from '../services/posts.ts';
import { PLATE } from './plate.ts';

// pixiv ugoira playback (#119 St3). The library stores pixiv's own archive
// untouched — a zip of frame images — because every single-file form of it
// (mp4/webm/gif) would mean re-encoding, i.e. carrying an encoder in the app and
// throwing away what the artist uploaded. Nothing native plays a zip, so the
// frames are drawn to a canvas on the schedule the sidecar's frame table gives.
export interface UgoiraFrame {
  file: string;
  delay: number; // ms this frame is shown (pixiv's own per-frame value)
}

// Decoded frames are bounded by BYTES, not by frame count. Measured ugoira
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

// flip/gray (#80): the SAME two overlay toggles the still image and <video> slides get
// (image-tab/ImageTab.tsx), applied here to whichever of canvas/poster is on screen. Grid
// stays out — v1 is Zoomable-only (no pan/zoom surface exists here to hang it on).
export function UgoiraPlayer({ file, frames, poster, alt, labels, flip, gray }: { file: string; frames: UgoiraFrame[]; poster?: string; alt?: string; labels: Record<string, string>; flip: boolean; gray: boolean }) {
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
    let frameCount = 0;
    // The archive is NOT opened here. main reads it off disk and hands over one
    // frame's bytes per call (#506) — neither the file nor a base64 copy of it
    // crosses IPC, the same rule the export/import paths follow (ADR 0015).
    // Those bytes are cached so a second lap costs no IPC at all; that cache is
    // bounded by the archive's own size, unlike the decoded bitmaps above.
    const blobs = new Map<number, Blob>();
    const blobJobs = new Map<number, Promise<Blob | null>>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sizeOf = (b: ImageBitmap) => b.width * b.height * 4;
    const drop = (i: number) => {
      const b = bitmaps.get(i);
      if (!b) return;
      decodedBytes -= sizeOf(b);
      bitmaps.delete(i);
      b.close();
    };
    const blobFor = (i: number): Promise<Blob | null> => {
      const held = blobs.get(i);
      if (held) return Promise.resolve(held);
      const running = blobJobs.get(i);
      if (running) return running;
      const name = framesRef.current[i]?.file;
      if (!name) return Promise.resolve(null);
      const job = ugoiraFrame(file, name)
        .then((bytes) => {
          if (!bytes) return null;
          const blob = new Blob([bytes]);
          blobs.set(i, blob);
          return blob;
        })
        .catch(() => null)
        .finally(() => blobJobs.delete(i));
      blobJobs.set(i, job);
      return job;
    };
    const decode = (i: number): Promise<ImageBitmap | null> => {
      const held = bitmaps.get(i);
      if (held) return Promise.resolve(held);
      const running = pending.get(i);
      if (running) return running;
      const job = blobFor(i)
        .then((blob) => (blob ? createImageBitmap(blob) : null))
        .then((bmp) => {
          if (!bmp) return null;
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
      const n = frameCount;
      for (let k = 0; k < n; k++) {
        if (disposed) return;
        if (k >= MIN_AHEAD && decodedBytes >= DECODED_BUDGET_BYTES) return;
        await decode((from + k) % n);
      }
    };
    // Free what the playhead has passed, but only once the budget is actually
    // under pressure — a small archive stays fully decoded and loops for free.
    const releaseBehind = (i: number) => {
      const n = frameCount;
      for (const k of [...bitmaps.keys()]) {
        if (k === i || decodedBytes < DECODED_BUDGET_BYTES) continue;
        if ((k - i + n) % n >= MIN_AHEAD) drop(k);
      }
    };

    (async () => {
      try {
        const names = framesRef.current.map((f) => f.file);
        if (!names.length) throw new Error('no frames');
        // A frame named in the table but absent from the archive means the two
        // no longer describe the same animation — better to show the poster than
        // to play a silently reordered one. main answers this in one pass over
        // the central directory, without expanding a single entry.
        if (!(await ugoiraFramesPresent(file, names))) throw new Error('archive does not match the frame table');
        if (disposed) return;
        frameCount = names.length;

        let i = 0;
        const tick = async () => {
          if (disposed) return;
          const bmp = await decode(i);
          if (disposed) return;
          // A frame that was there at the check above and unreadable now means
          // the archive changed under us; stop rather than skip, and let the
          // poster take over.
          if (!bmp) {
            setStatus('error');
            return;
          }
          const canvas = canvasRef.current;
          if (!canvas) return;
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
            i = (i + 1) % frameCount;
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
      blobs.clear();
    };
  }, [file]);

  // The canvas is mounted from the first render (the draw loop needs its ref
  // the moment the archive opens) and the poster covers it until then. Loading
  // and failure both fall back to that poster — the still frame pixiv serves
  // for this work, already downloaded next to the archive — so an ugoira whose
  // archive won't open still shows the artwork.
  return (
    <div data-slot="ugoira-stage" className="relative flex min-w-0 flex-1">
      {/* data-slot="viewer-canvas": the ugoira's stage surface, named alongside
          ImageTab.tsx's data-slot="viewer-image"/"viewer-video". */}
      <canvas ref={canvasRef} data-slot="viewer-canvas" className={`m-auto max-h-full max-w-full object-contain ${flip ? 'scale-x-[-1]' : ''} ${gray ? 'grayscale' : ''}`} role="img" aria-label={alt || labels.ugoira || ''} style={status === 'ready' ? undefined : { display: 'none' }} />
      {/* decoding="async" like the rest of the viewer surface (#241) — the
          archive is being unzipped and decoded on the same thread's tasks, so
          the poster must not add a blocking decode on top of that. Shares
          data-slot="viewer-image" with the still frame below — it's the same
          "still image standing in for this work" role. */}
      {status !== 'ready' && poster && <img data-slot="viewer-image" className={`m-auto max-h-full max-w-full object-contain ${flip ? 'scale-x-[-1]' : ''} ${gray ? 'grayscale' : ''}`} src={poster} alt={alt || ''} decoding="async" />}
      {/* Bottom-left, where a <video> puts its own play button — the same corner the
          browser's native controls use for the neighbouring slide type. Same translucent
          plate as the stage's other floating controls (P2⑫). */}
      {status === 'ready' && (
        <Button data-slot="ugoira-toggle" variant="ghost" size="icon" aria-label={playing ? labels.pause : labels.play} onClick={() => setPlaying((p) => !p)} className={`absolute bottom-3 left-3 z-2 ${PLATE}`}>
          {playing ? <Pause /> : <Play />}
        </Button>
      )}
    </div>
  );
}
