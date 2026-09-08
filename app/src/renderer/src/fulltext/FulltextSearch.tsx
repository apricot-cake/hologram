import type { MessageKey } from '../services/translation.ts';
import { Autocomplete } from '@base-ui/react/autocomplete';
import { FileSearch } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '../_shared/i18n.ts';
import { close, isOpen, openId, subscribe } from '../services/fulltext-dialog.ts';
import { type FullTextMatch, fullTextBridge, runFullTextSearch } from '../services/fulltext.ts';
const FIELD_LABEL: Record<FullTextMatch['field'], MessageKey> = {
  text: 'ftFieldText',
  title: 'ftFieldTitle',
  seriesTitle: 'ftFieldSeries',
  alt: 'ftFieldAlt',
  quoted: 'ftFieldQuoted',
  poll: 'ftFieldPoll',
  linkCard: 'ftFieldLinkCard',
  displayName: 'ftFieldAuthor',
  screenName: 'ftFieldAuthor',
  eagleName: 'ftFieldEagle',
  tag: 'ftFieldTag',
  hashtag: 'ftFieldHashtag',
};

const FULLTEXT_DEBOUNCE_MS = 150; // #29 設計:「150ms デバウンス」
const FULLTEXT_CAP = 50; // #29 設計: 上限50件＋「すべて表示」

const authorLabelOf = (p: HologramPost): string => p.displayName || p.screenName || t('unnamedUser');
const thumbFileOf = (p: HologramPost): string | null => p.image || (Array.isArray(p.media) && p.media[0]?.file) || null;

function FulltextBody() {
  const [ftQuery, setFtQuery] = useState('');
  const [hits, setHits] = useState<FullTextMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [showAll, setShowAll] = useState(false);
  // 素早く打ち消された古いキー入力の、遅れて届いた応答が新しい方の後に着地するのを防ぐ＝
  // 反映するのは常に最新の要求の結果だけ。
  const seqRef = useRef(0);

  useEffect(() => {
    const bridge = fullTextBridge();
    const q = ftQuery.trim();
    if (!q || !bridge) {
      setHits([]);
      setTotal(0);
      return;
    }
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      runFullTextSearch(q, bridge.allPosts(), showAll ? Number.POSITIVE_INFINITY : FULLTEXT_CAP).then((res) => {
        if (seqRef.current !== seq) return;
        setHits(res.hits);
        setTotal(res.total);
      });
    }, FULLTEXT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [ftQuery, showAll]);

  function jumpTo(hit: FullTextMatch) {
    close();
    fullTextBridge()?.openResult(ftQuery, hit.post.captureId);
  }

  const bridge = fullTextBridge();

  return (
    <DialogContent className="top-[15%] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
      <DialogHeader className="sr-only">
        <DialogTitle>{t('fulltextTitle')}</DialogTitle>
        <DialogDescription>{t('fulltextDesc')}</DialogDescription>
      </DialogHeader>
      <Autocomplete.Root inline open mode="none" items={hits} value={ftQuery} onValueChange={setFtQuery} autoHighlight="always" itemToStringValue={(hit: FullTextMatch) => hit.post.captureId}>
        <div className="flex items-center gap-1 border-b p-1">
          <FileSearch className="ml-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Autocomplete.Input autoFocus aria-label={t('fulltextTitle')} placeholder={t('fulltextPlaceholder')} className="h-8 w-full min-w-0 border-0 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground md:text-sm" />
        </div>
        <Autocomplete.List className="max-h-80 overflow-y-auto overscroll-contain p-1">
          {(hit: FullTextMatch) => {
            const file = thumbFileOf(hit.post);
            return (
              <Autocomplete.Item key={hit.post.captureId} value={hit} onClick={() => jumpTo(hit)} className="flex cursor-default items-start gap-2 rounded-sm px-2 py-1.5 text-sm select-none data-highlighted:bg-muted">
                {file && bridge ? <img src={bridge.fileSrc(file, 64)} alt="" className="mt-0.5 size-8 shrink-0 rounded object-cover" /> : <div className="mt-0.5 size-8 shrink-0 rounded bg-muted" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <span className="truncate font-medium text-foreground">{authorLabelOf(hit.post)}</span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">{t(FIELD_LABEL[hit.field])}</span>
                  </div>
                  <div className="truncate">
                    {hit.matchStart >= 0 ? (
                      <>
                        {hit.snippetText.slice(0, hit.matchStart)}
                        <mark className="rounded-none bg-transparent px-0 font-semibold text-foreground">{hit.snippetText.slice(hit.matchStart, hit.matchEnd)}</mark>
                        {hit.snippetText.slice(hit.matchEnd)}
                      </>
                    ) : (
                      hit.snippetText
                    )}
                  </div>
                </div>
              </Autocomplete.Item>
            );
          }}
        </Autocomplete.List>
        <Autocomplete.Empty className="px-3 py-6 text-center text-sm text-muted-foreground empty:hidden">{t('fulltextEmpty')}</Autocomplete.Empty>
      </Autocomplete.Root>
      {total > hits.length && (
        <button type="button" onClick={() => setShowAll(true)} className="w-full shrink-0 border-t px-3 py-2 text-center text-xs text-muted-foreground hover:bg-muted">
          {t('fulltextShowAll', { count: total })}
        </button>
      )}
    </DialogContent>
  );
}

export function FulltextSearchHost() {
  const open = useSyncExternalStore(subscribe, isOpen);
  // openId を key にする。閉じるアニメーションの最中に開き直しても、打ちかけのクエリを
  // 持ち越さずに開き直る（ConfirmHost や BulkTagDialogHost と同じ作法）。initialMode は
  // 描画のたびに読み直されるが、ある key にとって効くのは載せる時だけ＝openMode() と
  // open_ と openSeq は open()/openFulltext() の中で同期的に揃って設定されるので、これが
  // 描画し直される頃には既に一致している。
  const seq = useSyncExternalStore(subscribe, openId);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close(); // Esc か背景のクリック
      }}
    >
      {/* 常に載せたままにする＝閉じるアニメーションは Base UI の Dialog（Portal/Popup）が
          `open` を見て動かしているので、ここで載せ外しすると出ていくアニメーションが消える。 */}
      <FulltextBody key={seq} />
    </Dialog>
  );
}
