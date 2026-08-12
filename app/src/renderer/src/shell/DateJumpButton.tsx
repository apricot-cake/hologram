// 年月ジャンプ（#47）。一覧を絞り込むのではなく、日付順のグリッド内を移動する入口。
// カードを覆う常設レールにはせず、ツールバーのカレンダーボタンから必要なときだけ開く。
import { CalendarDays } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { scrollSectionToTop } from '../services/section-nav.ts';
import { store, subscribeKey } from '../services/store.ts';

const subSections = (cb: () => void) => subscribeKey('postSections', cb);
const getSections = () => store.getState().postSections;
const subBrowseMode = (cb: () => void) => subscribeKey('browseMode', cb);
const getBrowseMode = () => store.getState().browseMode;

function yearMonthLabel(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' }).format(new Date(ms));
}

export function DateJumpButton() {
  const sections = useSyncExternalStore(subSections, getSections);
  const mode = useSyncExternalStore(subBrowseMode, getBrowseMode);
  const [open, setOpen] = useState(false);
  const shown = (mode === 'posts' || mode === 'timeline') && !!sections && sections.length > 1;

  useEffect(() => {
    if (!shown) setOpen(false);
  }, [shown]);

  if (!shown) return null;

  const label = t('dateJumpTitle');
  const jump = (key: string) => {
    scrollSectionToTop(key);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button data-slot="date-jump-button" variant="ghost" size="icon-sm" aria-label={label}>
                  <CalendarDays />
                </Button>
              }
            />
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="max-h-[min(70vh,32rem)] w-52 gap-1 overflow-y-auto p-1.5">
        <PopoverHeader className="px-1.5 py-1">
          <PopoverTitle>{label}</PopoverTitle>
        </PopoverHeader>
        {(sections || []).map((sec) => (
          <button key={sec.key} type="button" data-slot="date-jump-item" className="flex w-full items-baseline justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm tabular-nums transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" onClick={() => jump(sec.key)}>
            <span>{sec.key === 'unknown' ? '—' : yearMonthLabel(sec.ms)}</span>
            <span className="text-muted-foreground">{sec.count}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
