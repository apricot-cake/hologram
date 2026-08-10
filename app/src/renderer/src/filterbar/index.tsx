//「フィルタ」からの入口（再設計 §3-2 / P2③）＝Linear 風のフィルタ追加の流れで、P1 が
// サイドバーのファセットの行を外した後（あの行は qf-pop や filter-popover を開いていた。
// 今はどちらにも辿り着けない）に、フィルタを追加する手立てを取り戻すもの。2段構えの
// ポップオーバーで、まず今のモードのファセットの分類を Command の一覧で見せ、次にその分類の
// エディタ（値のチェックリスト、タグをまとめた2ペイン、または日付や反応数のフォーム）を
// 見せる。データも振り分けもすべて orchestrator.filterCategories() から使い回す。この
// コンポーネントがやるのは2段の描画と行き来だけ。
import { ArrowLeft, BookMarked, Calendar, Drama, Folder, Globe, Hash, Heart, Image, Link2, ListFilter, type LucideIcon, MessageSquare, Ruler, Search, Server, Tag, User } from 'lucide-react';
import { useState } from 'react';
import { defaultFilter } from 'cmdk';
import { type FilterCat, filterCategories } from '../services/orchestrator.ts';
import { normalize } from '../services/search.ts';
import { FormEditor } from './FormEditor.tsx';
import { ValueEditor } from './ValueEditor.tsx';
import { t } from '../_shared/i18n.ts';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// チップの先頭のグリフが分類の手がかりを担う（フィルタのチップと同じ言い回し）。
// poster-* の分類は元のアイコンを共有する（poster-tag → Tag など）。
// #253: 'domain'（未対応サイトの行の葉）は 'platform' のグリフを共有する＝どちらも同じ「サイト」のファセットの行。
const ICONS: Record<string, LucideIcon> = { kind: Link2, platform: Globe, domain: Globe, postType: MessageSquare, media: Image, tag: Tag, work: BookMarked, character: Drama, hashtag: Hash, user: User, instance: Server, folder: Folder, date: Calendar, engagement: Heart, text: Search, dimension: Ruler };
//「フィルタ」の分類の一覧と、効いているフィルタのチップ（FilterChips）で共有する。
// 分類のキー（'poster-tag'）でも葉の型（'tag'）でも受け取れる＝どちらも同じ元のグリフに
// 行き着く。
export function CatIcon({ cat }: { cat: string }) {
  const Icon = ICONS[cat.replace(/^poster-/, '')] || ListFilter;
  return <Icon className="size-4 text-muted-foreground" />;
}

function CatList({ cats, onPick }: { cats: FilterCat[]; onPick: (c: FilterCat) => void }) {
  return (
    <Command className="w-64" filter={(value, search, keywords) => defaultFilter(normalize(value), normalize(search), keywords?.map(normalize))}>
      <CommandInput placeholder={t('qfFindPh')} />
      <CommandList>
        <CommandEmpty>—</CommandEmpty>
        <CommandGroup>
          {cats.map((c) => (
            <CommandItem key={c.cat} value={c.label} onSelect={() => onPick(c)}>
              <CatIcon cat={c.cat} />
              <span>{c.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export function AddFilterButton() {
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState<FilterCat[]>([]);
  const [sel, setSel] = useState<FilterCat | null>(null);
  // 開くたびに分類の一覧を計算し直す（件数・語彙・モードは開いている間隔で変わる）。
  // そして分類を選ぶ段へ戻す。filterCategories は orchestrator.ts の起動時の即時実行関数が
  // 代入する＝ここは利用者のクリックでしか走らず、起動から十分経っているので安全。
  const handleOpen = (o: boolean) => {
    setOpen(o);
    if (o) {
      setCats(filterCategories());
      setSel(null);
    }
  };
  const close = () => setOpen(false);
  // フォルダ管理のモーダルはポップオーバーのフォーカス範囲を共有できない＝先に閉じる。
  const manage = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <Popover open={open} onOpenChange={(o) => handleOpen(o)}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <ListFilter />
        <span>{t('sbFilterTitle')}</span>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} collisionPadding={8} className="w-max max-w-[min(520px,calc(100vw-24px))] p-0">
        {sel ? (
          <>
            <div className="flex items-center gap-1 border-b border-border p-1">
              <Button variant="ghost" size="icon-sm" aria-label="戻る" onClick={() => setSel(null)}>
                <ArrowLeft />
              </Button>
              <span className="text-sm font-medium">{sel.label}</span>
            </div>
            {sel.editor === 'values' ? <ValueEditor key={sel.cat} cat={sel} onManage={manage} /> : <FormEditor key={sel.cat} cat={sel} onClose={close} />}
          </>
        ) : (
          <CatList cats={cats} onPick={setSel} />
        )}
      </PopoverContent>
    </Popover>
  );
}
