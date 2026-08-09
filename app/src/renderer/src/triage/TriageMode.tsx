import { useEffect, useState, useSyncExternalStore } from 'react';
import { CheckCheck, Inbox, X } from 'lucide-react';
import { DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { t } from '../_shared/i18n.ts';
import { includesNormalized } from '../services/search.ts';
import * as triage from '../services/triage.ts';
import { triageApplyFolder, triageApplyTag, triageCloseTriage, triageCurrentMedia, triageListFolders, triageSkip, triageUndoLast } from '../services/orchestrator.ts';

// 全画面のトリアージ台（#46）。他のオーバーレイと同じく Dialog（Esc・外側の押下・
// フォーカストラップは Base UI から来る＝同じ組み立ての例は lightbox/Lightbox.tsx）。
// ただし Popup は中央のカードではなくページそのもの。トリアージは開いている間ずっと
// グリッドを置き換える＝image-tab/ が詳細表示に与えているのと同じ「閲覧用の枠から出て、
// ここからはウィンドウ全体」という感じ。z-13000 は他のモーダル（設定・確認・
// BulkTagDialog）と揃えてある。トリアージのセッションが画面を占めている間、その下に
// 重ねる必要のあるものは何もない。
//
// 状態は triage.ts のストア（純粋・依存なし）から useSyncExternalStore で直接読む。
// 動作の側（タグ・フォルダの適用／スキップ／取り消し）は束ね済みの orchestrator.ts の
// export で、他の *Host コンポーネントと同じ分け方（例えば image-tab/index.tsx は
// モデルを services/image-tab.ts から取りつつ、orchestrator が繋いだコールバック経由で
// 送り出す）。
//
// v1 は意図して TagField（inspector/TagField.tsx）を使い回していない。キューの項目は
// 作りからしてすべて未タグなので、TagField のチップ一覧は常に空から始まり、実際に使う
// のは語彙のポップオーバーだけになる。Enter で足すだけの素の入力欄にしておけば、この
// コンポーネントは詳細パネルのピッカー用データの配線から切り離せる。語彙を踏まえた
// 選び方は、下の動作の配線を変えずに後から足せる。同じ理由でズームやパン
// （image-tab/ImageTab.tsx の Zoomable）も、うごイラの再生も無い。トリアージは
// 見て決めるだけの速い一巡であって、じっくり見る場ではない＝よく見たい投稿はここで
// 大まかにタグを付けておき、後からグリッドで詰める。

function ProgressLabel({ idx, total }: { idx: number; total: number }) {
  return (
    <div className="tabular-nums text-muted-foreground text-sm" data-slot="triage-progress">
      {t('triageProgress', [Math.min(idx + 1, total), total])}
    </div>
  );
}

function PinSlot({ slot, tag }: { slot: number; tag: string }) {
  const [draft, setDraft] = useState('');
  const [popOpen, setPopOpen] = useState(false);
  if (tag) {
    return (
      <div className="group relative inline-flex items-center" data-slot="triage-pin-slot" data-pinned="true">
        <Button type="button" variant="outline" size="sm" className="gap-1 pr-6" onClick={() => void triageApplyTag(tag)}>
          <span className="rounded bg-muted px-1 font-mono text-[10px] tabular-nums">{slot + 1}</span>
          {tag}
        </Button>
        <button type="button" aria-label={t('triagePinClear')} title={t('triagePinClear')} onClick={() => triage.setPinnedTag(slot, null)} className="absolute right-1 rounded-full p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100">
          <X className="size-3" />
        </button>
      </div>
    );
  }
  return (
    <Popover
      open={popOpen}
      onOpenChange={(next) => {
        setPopOpen(next);
        if (next) setDraft('');
      }}
    >
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm" aria-label={t('triagePinEmpty')} title={t('triagePinEmpty')} className="border-dashed text-muted-foreground">
            <span className="rounded bg-muted px-1 font-mono text-[10px] tabular-nums">{slot + 1}</span>+
          </Button>
        }
      />
      <PopoverContent className="w-56" side="top">
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft.trim();
            if (v) triage.setPinnedTag(slot, v);
            setPopOpen(false);
          }}
        >
          <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('triagePinInputPlaceholder')} />
          <Button type="submit" size="sm">
            {t('triagePinSave')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function FolderPopover({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [query, setQuery] = useState('');
  const folders = triageListFolders().filter((f) => includesNormalized(f.name, query.trim()));
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) setQuery('');
      }}
    >
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            {t('triageFolderButton')}
          </Button>
        }
      />
      <PopoverContent className="w-64" side="top">
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('triageFolderSearchPlaceholder')} />
        <div className="mt-1.5 max-h-56 overflow-y-auto">
          {folders.length === 0 ? (
            <div className="px-1 py-2 text-muted-foreground text-xs">{t('triageFolderEmpty')}</div>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                type="button"
                className="block w-full cursor-default rounded-sm px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onOpenChange(false);
                  triageApplyFolder(f.id);
                }}
              >
                {f.name}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TriageStage({ state }: { state: triage.TriageState }) {
  const [tagDraft, setTagDraft] = useState('');
  const [folderOpen, setFolderOpen] = useState(false);
  const g = triage.current();
  const media = triageCurrentMedia();
  const total = state.queue.length;

  // 'F' でフォルダのポップオーバーを開く。UI だけの話なので、triage-builder.ts の
  // handleTriageKey ではなくこのコンポーネントの中に置く（あちらはデータ側の動作を
  // 受け持つ＝1-9 の素早いタグ付け／Space でスキップ／Backspace で取り消し。
  // そのモジュールのファイル冒頭のコメントを参照）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFolderOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (total === 0) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox />
          </EmptyMedia>
          <EmptyTitle>{t('triageEmptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('triageEmptyDesc')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => triageCloseTriage()}>
            {t('triageClose')}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  if (!g) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CheckCheck />
          </EmptyMedia>
          <EmptyTitle>{t('triageDoneTitle')}</EmptyTitle>
          <EmptyDescription>{t('triageDoneDesc')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => triageCloseTriage()}>
            {t('triageClose')}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  return (
    <div data-slot="triage-stage" className="flex h-full min-h-0 w-full flex-col">
      {/* pr-[--window-controls-w]: WindowControls.tsx は OS 風の最小化・最大化・閉じるの
          帯を右上の固定位置へ portal で出していて、その z-[13600] はこのダイアログの
          z-13000 より上にある。だからこの分を空けておかないと、トリアージ自身の閉じる
          ボタンがちょうどその真下に描かれて押せなくなる（AppShell のタイトルバー帯が
          タブの帯に対して空けているのと同じ分。スクリーンショットで気付いた＝ボタンが
          見えなくなっていた）。 */}
      <div className="flex items-center justify-between border-b py-2 pr-[var(--window-controls-w,138px)] pl-4">
        <ProgressLabel idx={state.idx} total={total} />
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('triageClose')} title={t('triageClose')} onClick={() => triageCloseTriage()} className="mr-2">
          <X />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        {media &&
          (media.video ? (
            <video key={media.src} data-slot="triage-media" className="max-h-full max-w-full object-contain" src={media.src} controls playsInline preload="metadata" />
          ) : (
            <img key={media.poster || media.src} data-slot="triage-media" className="max-h-full max-w-full object-contain" src={media.poster || media.src} alt={media.alt || ''} decoding="async" />
          ))}
      </div>
      <div className="flex flex-col gap-2 border-t px-4 py-3">
        {state.lastAction && (
          <div className="flex items-center gap-2 text-muted-foreground text-xs" data-slot="triage-last-action">
            <span>{state.lastAction.label}</span>
            <Button type="button" variant="ghost" size="sm" className="h-5 px-1.5 text-xs" onClick={() => triageUndoLast()}>
              {t('triageUndo')} (Backspace)
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <form
            className="mr-1 flex-1 basis-48"
            onSubmit={(e) => {
              e.preventDefault();
              const v = tagDraft.trim();
              if (v) void triageApplyTag(v);
            }}
          >
            <Input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder={t('triageTagPlaceholder')} />
          </form>
          {Array.from({ length: 9 }, (_, i) => (
            <PinSlot key={i} slot={i} tag={state.pinnedTags[i] || ''} />
          ))}
          <FolderPopover open={folderOpen} onOpenChange={setFolderOpen} />
          <Button type="button" variant="outline" size="sm" onClick={() => triageSkip()}>
            {t('triageSkip')} (Space)
          </Button>
        </div>
        <div className="text-muted-foreground text-xs">{t('triageHint')}</div>
      </div>
    </div>
  );
}

export function TriageMode() {
  const state = useSyncExternalStore(triage.subscribe, triage.get);
  return (
    <DialogPrimitive.Root
      open={state.open}
      onOpenChange={(next) => {
        if (!next) triageCloseTriage();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="bg-background" />
        <DialogPrimitive.Popup className="fixed inset-0 z-[13000] flex outline-none duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)] data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0">
          <DialogTitle className="sr-only">{t('cmdTriageStart')}</DialogTitle>
          {/* key を今の項目に取る。1件進むたびに載せ直すことで、次の投稿に向けてタグの
              下書き入力が消え、フォルダのポップオーバーが閉じる。唯一の依存（項目の同一性）
              が本体にまったく現れない effect を書かずに済む＝ImageTab の Zoomable のスライド
              が使っているのと同じ、載せ直しによるリセット（image-tab/ImageTab.tsx は
              item.src を key にしている）。 */}
          <TriageStage key={triage.current()?.key || String(state.idx)} state={state} />
        </DialogPrimitive.Popup>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
