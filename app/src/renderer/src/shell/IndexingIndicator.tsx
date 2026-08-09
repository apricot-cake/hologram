import { Pause, Play } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { indexQueueStatus, pauseIndexQueue, resumeIndexQueue, subscribeIndexQueue } from '../services/index-queue.ts';

// 背面での索引付けを、それが起きている間だけ示す（#834、親の #98 の「使っている間」に
// ついての透明性の原則）。ライブラリの解析は見えて、止められなければならない＝アプリが
// 黙ってやることであってはならない。
//
// 仕事がある間だけ出す。これは手本自身の形でもある。Lightroom Classic は背面の仕事
//（プレビューの生成、顔の認識）を identity plate の上のアクティビティ領域に進捗バーと
// 中止の操作つきで出し、何も走っていない時その領域は空になる。「ライブラリのどれだけに
// 索引が付いているか」という常設の数字はまた別のもので、置き場も別＝Zotero は環境設定 →
// 検索に Indexed / Partial / Unindexed を常設の統計として置いている。ここではそれは
// ツールバーではなく #100 の健康状態のダッシュボードのもの。
//
// ライブラリの走査がまだ動いている間、バーは不定にする。走査が仕事を見つけるたびに
// `total` が増えるので、その時点で計算した割合は目に見えて逆戻りしてしまう。走査が
// 終われば total は確定し、バーは見たままの意味になる。
export function IndexingIndicator() {
  const status = useSyncExternalStore(subscribeIndexQueue, indexQueueStatus);
  if (!status.active) return null;

  const percent = status.total > 0 ? Math.min(100, Math.round((status.done / status.total) * 100)) : 0;
  const label = status.paused ? t('indexingPaused') : t('indexingProgress', [status.done, status.total]);

  return (
    <div data-slot="indexing-indicator" className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="flex w-28 flex-col gap-1" aria-live="polite">
              <span className="truncate text-[11px] leading-none text-muted-foreground tabular-nums">{label}</span>
              {/* 不定の Progress は `value={null}` を取る（Base UI）＝どちらの場合も同じ
                  コンポーネントなので、走査が終わって数字が意味を持ち始めた時にバーの
                  大きさが跳ねない。 */}
              <Progress value={status.scanning ? null : percent} className="w-full" />
            </div>
          }
        />
        <TooltipContent>{status.scanning ? t('indexingScanning') : t('indexingTooltip', [status.done, status.total])}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button data-slot="indexing-pause-button" variant="ghost" size="icon-sm" aria-label={status.paused ? t('indexingResume') : t('indexingPause')} onClick={() => void (status.paused ? resumeIndexQueue() : pauseIndexQueue())}>
              {status.paused ? <Play /> : <Pause />}
            </Button>
          }
        />
        <TooltipContent>{status.paused ? t('indexingResume') : t('indexingPause')}</TooltipContent>
      </Tooltip>
    </div>
  );
}
