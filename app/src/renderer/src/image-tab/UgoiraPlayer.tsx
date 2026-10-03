import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ugoiraFrame, ugoiraFramesPresent } from '../services/posts.ts';
import { PLATE } from './plate.ts';
import { UGOIRA_DECODED_BUDGET_BYTES, UgoiraFrameCache, UgoiraPrefetcher } from './ugoira-frame-cache.ts';

// pixiv のうごイラの再生（#119 St3）。ライブラリは pixiv 自身の書庫をそのまま保存する
// ＝フレーム画像の zip。1ファイルにまとめるどの形（mp4/webm/gif）にしても再符号化になり、
// アプリにエンコーダを抱えることと、作者が上げたものを捨てることを意味するから。zip を
// そのまま再生できるものは無いので、サイドカーのフレーム表が与える時間割でフレームを
// canvas へ描く。
export interface UgoiraFrame {
  file: string;
  delay: number; // このフレームを見せるミリ秒（pixiv 自身のフレームごとの値）
}

// デコード済みのフレームは、枚数ではなくバイト数で上限を決める。実測したうごイラ
// （2026-07-29・pixiv のデイリーランキング）は、500x500 の 8 フレームから 1280x720 の
// 104 フレーム、2000x1125 の 24 フレームまで幅がある＝書庫を丸ごと先にデコードすると、
// 最初のものは 8MB、2つめは約 366MB になる。だからこのプレイヤーは再生位置の先に窓を
// 滑らせて持ち、通り過ぎたビットマップは閉じる＝メモリはフレームの大きさで決まり、
// アニメーションの長さでは決まらない。
const MIN_AHEAD = 3; // 容量内で、この枚数までは先読みを試みる
const MAX_AHEAD = 8; // 容量に余裕があっても、一度の先読みは有限の窓だけにする
// でたらめな delay の入ったフレーム表は、アニメーションを止めるかイベントループを空回り
// させる。pixiv の数字をそのまま信じず、範囲へ丸める。
const MIN_DELAY_MS = 10;
const MAX_DELAY_MS = 10000;

// 左右反転を、表示中のキャンバスまたは代替画像へ適用する。
export function UgoiraPlayer({ file, frames, poster, alt, labels, flip }: { file: string; frames: UgoiraFrame[]; poster?: string; alt?: string; labels: Record<string, string>; flip: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [playing, setPlaying] = useState(true);
  // ループはこれらを ref 越しに読む＝再生／一時停止の切り替え（と、描画のたびに新しい配列
  // として届くフレーム表）でデコードが振り出しに戻ることはない。
  const playingRef = useRef(true);
  playingRef.current = playing;
  const framesRef = useRef(frames);
  framesRef.current = frames;

  useEffect(() => {
    let disposed = false;
    let frameCount = 0;
    // 書庫はここでは開かない。main がディスクから読み、1回の呼び出しにつき1フレーム分の
    // バイト列を渡す（#506）＝ファイルそのものも base64 の写しも IPC を渡らない。エクス
    // エクスポート／インポートの経路と同じ規則。渡された展開済みバイト列とデコード結果は
    // それぞれ byte 上限付き LRU に置き、長いアニメーションを一周しても累積させない。
    const cache = new UgoiraFrameCache<ImageBitmap>(
      async (i) => {
        const name = framesRef.current[i]?.file;
        return name ? ugoiraFrame(file, name) : null;
      },
      (blob) => createImageBitmap(blob),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    // tick ごとに別の全周走査を作らない。最新の再生位置だけを単一ワーカーへ渡し、現在フレーム
    // を保護した有限窓を順番に予約する。容量が無ければ cache が null を返した地点で止める。
    const prefetcher = new UgoiraPrefetcher(cache, MAX_AHEAD);
    // 再生位置が通り過ぎたものを解放する。ただし予算が実際に逼迫したときだけ＝小さい書庫は
    // デコード済みのまま残り、ループの費用がゼロになる。
    const releaseBehind = (i: number) => {
      const n = frameCount;
      for (const k of [...cache.bitmaps.keys()]) {
        if (k === i || cache.decodedBytes < UGOIRA_DECODED_BUDGET_BYTES) continue;
        if ((k - i + n) % n >= MIN_AHEAD) cache.dropBitmap(k);
      }
    };

    (async () => {
      try {
        const names = framesRef.current.map((f) => f.file);
        if (!names.length) throw new Error('no frames');
        // 表に名前があるのに書庫に無いフレームは、両者がもう同じアニメーションを指して
        // いないということ＝黙って並び替わったものを再生するより、poster を見せる方がいい。
        // main はセントラルディレクトリを1回走査して答える。エントリを1つも展開しない。
        if (!(await ugoiraFramesPresent(file, names))) throw new Error('archive does not match the frame table');
        if (disposed) return;
        frameCount = names.length;

        let i = 0;
        const tick = async () => {
          if (disposed) return;
          const bmp = await cache.getBitmap(i, new Set([i]));
          if (disposed) return;
          // 上の確認では在ったフレームが今読めないということは、書庫が足元で変わったと
          // いうこと。飛ばさずに止めて、poster に引き継がせる。
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
          prefetcher.request(i + 1, i, frameCount);
          const raw = framesRef.current[i]?.delay ?? 100;
          const delay = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, raw));
          const step = () => {
            if (disposed) return;
            // 一時停止中はこのフレームのまま留まって確認し直す。タイマーを畳んでしまうと、
            // 再開時にデコードの窓を作り直すことになるため。
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
      prefetcher.dispose();
      cache.dispose();
    };
  }, [file]);

  // canvas は最初の描画から載せてある（書庫が開いた瞬間に描画ループがその ref を要るため）。
  // それまでは poster が覆う。読み込み中も失敗時も、どちらもその poster へ退避する＝pixiv が
  // この作品に配っている静止フレームで、書庫の隣に既にダウンロードしてある。だから書庫の
  // 開けないうごイラでも、作品そのものは出る。
  return (
    <div data-slot="ugoira-stage" className="relative flex min-w-0 flex-1">
      {/* data-slot="viewer-canvas"＝うごイラの舞台の面。ImageTab.tsx の
          data-slot="viewer-image"/"viewer-video" と並ぶ名前にしてある。 */}
      <canvas ref={canvasRef} data-slot="viewer-canvas" className={`m-auto max-h-full max-w-full object-contain ${flip ? 'scale-x-[-1]' : ''}`} role="img" aria-label={alt || labels.ugoira || ''} style={status === 'ready' ? undefined : { display: 'none' }} />
      {/* ビューアの他の面と同じく decoding="async" にする（#241）＝書庫の展開とデコードは
          同じスレッドのタスクで走っているので、poster がその上に同期的なデコードを積み増して
          はいけない。下の静止フレームと data-slot="viewer-image" を共有する＝「この作品の
          代わりに立つ静止画」という同じ役割だから。 */}
      {status !== 'ready' && poster && <img data-slot="viewer-image" className={`m-auto max-h-full max-w-full object-contain ${flip ? 'scale-x-[-1]' : ''}`} src={poster} alt={alt || ''} decoding="async" />}
      {/* 左下＝<video> が自分の再生ボタンを置く場所で、隣り合うスライド種別でブラウザ標準の
          コントロールが使うのと同じ角。舞台の他の浮いたコントロールと同じ半透明の台座を
          使う（P2⑫）。 */}
      {status === 'ready' && (
        <Button data-slot="ugoira-toggle" variant="ghost" size="icon" aria-label={playing ? labels.pause : labels.play} onClick={() => setPlaying((p) => !p)} className={`absolute bottom-3 left-3 z-2 ${PLATE}`}>
          {playing ? <Pause /> : <Play />}
        </Button>
      )}
    </div>
  );
}
