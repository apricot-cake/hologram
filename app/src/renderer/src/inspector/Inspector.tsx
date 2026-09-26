import { Tabs } from '@base-ui/react/tabs';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Bookmark, ExternalLink, Eye, Heart, MessageCircle, PanelRight, Repeat2 } from 'lucide-react';
import { get, subscribe } from '../services/inspector.ts';
import { hologramImageTabSource, isActive as imageViewIsActive } from '../services/image-tab.ts';
import { hologramIpc } from '../services/ipc.ts';
import { open as openMenu } from '../services/menu.ts';
import { t } from '../_shared/i18n.ts';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { hashtagParts } from './hashtag-parts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LinkCard } from './LinkCard.tsx';
import { PollCard } from './PollCard.tsx';
import { QuotedPostCard } from './QuotedPostCard.tsx';
import { TagField } from './TagField.tsx';
import type { ReactNode } from 'react';

// このパネルは長い罫線付きの一覧1本ではなく、Separator で区切ったセクションの積み重ね
// （P2⑦）。各セクションはラベルと値の対を並べた2列のグリッドなので、行ごとに罫線を背負う
// のではなくセクションをまたいで値の位置が揃う＝旧い .iv-insp-row の一覧がのっぺりと
// 読めていた原因はそこにあった。
function Fields({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[minmax(max-content,5.5rem)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-[12.5px] [&>dt]:whitespace-nowrap">{children}</dl>;
}

function Field({ k, v }: { k?: string; v?: ReactNode }) {
  if (v == null || v === '') return null;
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
    </>
  );
}

// 中の欄がすべて空で何も描かないセクションでも、Separator だけは出てしまい迷子の罫線が
// 残る。だからセクションを含めるかどうかは呼び出し側が決める。ここが描くのは、あるセク
// ションの上の区切り線だけ。
function Divided({ children }: { children: ReactNode }) {
  return (
    <>
      <Separator />
      {children}
    </>
  );
}

function ExternalTextLink({ text, href, label, onClick }: { text?: string; href?: string; label?: string; onClick?: () => void }) {
  return (
    <a
      href={href}
      className="block max-w-full min-w-0 cursor-pointer text-left text-[12.5px] leading-normal text-[color:var(--text-muted-strong)] no-underline [overflow-wrap:anywhere] hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
      }}
      onAuxClick={(event) => event.preventDefault()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!href) return;
        openMenu({ items: [{ label: t('ctxCopyLink'), act: 'copyLink' }], x: event.clientX, y: event.clientY }, (item) => {
          if (item.act === 'copyLink') void hologramIpc.copyText(href);
        });
      }}
    >
      {text}
      {'\u00a0'}
      <ExternalLink aria-hidden="true" className="inline-block size-3 align-[-1px]" />
    </a>
  );
}

function TagsSection({ m }: { m: HologramInspectorModel }) {
  return <AssignedTagsSection tags={m.tags} label={m.labels.tags} />;
}

const ENGAGEMENT_ICONS = { likes: Heart, reposts: Repeat2, replies: MessageCircle, bookmarks: Bookmark, views: Eye } as const;

function EngagementItems({ items }: { items?: Array<{ kind: keyof typeof ENGAGEMENT_ICONS; value: string; label: string }> }) {
  if (!items?.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {items.map((item) => {
        const Icon = ENGAGEMENT_ICONS[item.kind];
        return (
          <span key={item.kind} role="group" className="inline-flex items-center gap-1.5 tabular-nums" aria-label={`${item.label}: ${item.value}`}>
            <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <span>{item.value}</span>
          </span>
        );
      })}
    </span>
  );
}

// 本文は全幅で表示し、元の改行を保つ。
function PostTags({ m }: { m: HologramInspectorModel }) {
  const [open, setOpen] = useState(false);
  const inline = new Set(hashtagParts(m.bodyText || '', m.hashtags || []).map((part) => part.tag));
  const tags = (m.hashtags || []).filter((tag) => m.platformLabel === 'pixiv' || !inline.has(tag));
  if (!tags.length) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="self-start" />}>{t('inspectorPlatformTags', { site: m.platformLabel, count: tags.length })}</PopoverTrigger>
      <PopoverContent className="w-64 max-h-72 overflow-y-auto p-1.5" align="start">
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className="block w-full rounded-md px-2 py-1.5 text-left text-sm break-words hover:bg-muted"
            onClick={() => {
              setOpen(false);
              m.onHashtagClick?.(tag);
            }}
          >
            {tag}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function TextSection({ text, hashtags, onPick }: { text: string; hashtags: string[]; onPick?: (tag: string) => void }) {
  return (
    <section data-slot="inspector-text">
      <p className="text-[13.5px] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]">
        {hashtagParts(text, hashtags).map((part, index) =>
          part.tag ? (
            <button key={index} type="button" className="inline cursor-pointer text-inherit underline decoration-current/40 underline-offset-2 hover:decoration-current" onClick={() => part.tag && onPick?.(part.tag)}>
              {part.text}
            </button>
          ) : (
            part.text
          ),
        )}
      </p>
    </section>
  );
}

function AssignedTagsSection({ tags, label }: { tags: string[]; label?: string }) {
  return (
    <section className="flex flex-col gap-1.5">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <Badge key={tag} variant="outline" className="text-muted-foreground">
            {tag}
          </Badge>
        ))}
      </div>
    </section>
  );
}

function InspectorPreviews({ items }: { items: NonNullable<HologramInspectorModel['previews']> }) {
  const [index, setIndex] = useState(0);
  const item = items[index];
  const stacked = items.length > 1;
  if (!item) return null;
  return (
    <div data-slot="inspector-previews" className="min-w-0">
      <button type="button" className={'grid w-full grid-cols-[minmax(0,1fr)] cursor-zoom-in ' + (stacked ? 'overflow-hidden rounded-lg border border-border' : '')} aria-label={t('inspectorOpenViewer')} onClick={item.onClick}>
        {/* 同じセルに重ね、未選択画像も高さの計算に含める。画像送りで操作位置を動かさない。 */}
        {items.map((preview, i) => {
          const className = 'col-start-1 row-start-1 block h-auto max-h-[50cqh] w-auto max-w-full self-center justify-self-center ' + (stacked ? '' : 'rounded-lg border border-border ') + (i === index ? '' : 'invisible');
          return preview.video ? <video key={preview.src} src={preview.src} preload="metadata" muted aria-hidden={i !== index} className={className} /> : <img key={preview.src} data-slot="inspector-thumb" src={preview.src} alt="" aria-hidden={i !== index} className={className} />;
        })}
      </button>
      {items.length > 1 && (
        <div className="mt-1 flex items-center justify-between">
          <Button variant="ghost" size="icon" aria-label={t('fpPrevious')} onClick={() => setIndex((current) => (current - 1 + items.length) % items.length)}>
            <ChevronLeft />
          </Button>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {index + 1} / {items.length}
          </span>
          <Button variant="ghost" size="icon" aria-label={t('fpNext')} onClick={() => setIndex((current) => (current + 1) % items.length)}>
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}

// 投稿の詳細。m はビルダーが解決とローカライズを済ませた欄をすべて運ぶ（日付は整形済み・
// MSG の文字列は選択済み）。
function PostInspector({ m }: { m: HologramInspectorModel }) {
  const imageView = useSyncExternalStore(hologramImageTabSource.subscribe, imageViewIsActive);
  const hasAuthor = !!(m.authorName || m.avatarSrc);
  const authorName = (
    <span data-slot="inspector-author-name" className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">
      {m.authorName}
    </span>
  );
  const authorValue = m.avatarSrc ? (
    <span className="flex min-w-0 items-start gap-1.5">
      <img data-slot="avatar-image" className="size-6 shrink-0 rounded-full border border-border object-cover" src={m.avatarSrc} alt="" />
      {authorName}
    </span>
  ) : (
    authorName
  );
  return (
    <div data-slot="inspector-post" className="flex min-w-0 flex-col gap-3 [&>[data-slot=separator]]:my-1">
      {m.heading ? <h2 className="min-w-0 text-[13.5px] leading-snug font-semibold [overflow-wrap:anywhere]">{m.heading}</h2> : null}
      {!!m.replyThread?.length && (
        <details key={String(m.showReplies)} open={m.showReplies || undefined} data-slot="inspector-replies" className="min-w-0 rounded-lg border p-3">
          <summary className="cursor-pointer text-[12.5px] font-medium">{t('replyThread')}</summary>
          <div className="mt-3 ml-1 border-l-2 border-border pl-3">
            {m.replyThread.map((post) => (
              <button key={post.key} type="button" aria-current={post.current ? 'true' : undefined} onClick={post.onClick} className="relative mb-3 block w-full rounded-md border p-2 text-left last:mb-0 aria-current:border-primary">
                <span aria-hidden="true" className="absolute -left-[19px] top-4 size-2 rounded-full bg-muted-foreground" />
                <span className="block text-[12.5px] font-medium">{post.author}</span>
                <span className="block text-[11px] text-muted-foreground">{post.date}</span>
                {post.thumbSrc && <img src={post.thumbSrc} alt="" className="mt-2 max-h-40 w-full rounded object-contain" />}
                <span className="mt-2 block whitespace-pre-wrap text-[12.5px] [overflow-wrap:anywhere]">{post.text}</span>
              </button>
            ))}
          </div>
        </details>
      )}
      {imageView ? null : m.previews?.length ? (
        <InspectorPreviews key={m.previews.map((item) => item.src).join('|')} items={m.previews} />
      ) : m.thumbSrc ? (
        <img data-slot="inspector-thumb" data-peek={m.onThumbClick ? 'true' : undefined} className={'block w-full rounded-lg border border-border' + (m.onThumbClick ? ' cursor-zoom-in' : '')} src={m.thumbSrc} alt="" onClick={m.onThumbClick ?? undefined} />
      ) : null}
      {m.bodyText ? <TextSection text={m.bodyText} hashtags={m.hashtags || []} onPick={m.onHashtagClick} /> : null}
      <PostTags key={m.openId} m={m} />
      {/* #180: 引用／リポストされた投稿、または返信先の投稿を、その投稿
          自身の本文の直下に入れ子で置く＝引用ツイート／リノートのカードが元のプラット
          フォーム上で座っているのと同じ位置。 */}
      {m.quotedCards && m.quotedCards.length ? (
        <div className="flex flex-col gap-1.5">
          {m.quotedCards.map((c: HologramQuotedCardModel, i: number) => (
            <QuotedPostCard key={i} m={c} />
          ))}
        </div>
      ) : null}
      {/* #179: 投稿のアンケートを、各プラットフォーム自身が置いているのと同じ場所に置く
          ＝投稿自身の本文の下。その本文が設問そのものだから（設問を別の欄で持つプラット
          フォームは無い）。 */}
      {m.pollCard ? <PollCard m={m.pollCard} /> : null}
      {/* #181: 投稿の OGP プレビューカード。すぐ上の引用／アンケートのカードと同じ位置
          ＝投稿自身の本文の直下に置く。 */}
      {m.linkCard ? <LinkCard m={m.linkCard} /> : null}
      {m.bodyText || m.quotedCards?.length || m.pollCard || m.linkCard ? <Separator /> : null}
      <Fields>
        <Field k={m.labels.platform} v={m.platformLabel} />
        {hasAuthor ? (
          <>
            <dt data-slot="inspector-author-label" className="self-start pt-1 text-muted-foreground">
              {m.labels.author}
            </dt>
            <dd data-slot="inspector-author-value" className="flex min-w-0 self-start items-center gap-1">
              {m.jumpable ? (
                <button
                  type="button"
                  data-slot="inspector-author-link"
                  className="flex max-w-full min-w-0 cursor-pointer items-start gap-1.5 rounded-md border border-border bg-transparent px-1.5 py-1 text-left hover:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={m.onPosterJump}
                >
                  {authorValue}
                </button>
              ) : (
                authorValue
              )}
            </dd>
          </>
        ) : null}
        <Field k={m.labels.url} v={m.onOpenExternal ? <ExternalTextLink text={m.urlLabel} href={m.urlLabel} label={m.labels.open} onClick={m.onOpenExternal} /> : m.urlLabel} />
        <Field k={m.labels.followers} v={m.followersLabel} />
        <Field k={m.labels.following} v={m.followingLabel} />
        <Field k={m.labels.joined} v={m.joinedLabel} />
      </Fields>
      <Divided>
        <Fields>
          <Field k={m.labels.engagement} v={<EngagementItems items={m.engagementItems} />} />
          <Field k={m.labels.localViews} v={m.localViewCountLabel} />
          <Field k={m.labels.posted} v={m.postedLabel} />
          <Field k={m.labels.saved} v={m.savedLabel} />
          <Field k={m.labels.images} v={m.imagesLabel} />
          <Field k={m.labels.imageOf} v={m.imageOfLabel} />
          <Field k={m.labels.series} v={m.seriesLabel} />
          <Field k={m.labels.seriesOrder} v={m.seriesOrderLabel} />
        </Fields>
      </Divided>
      <Divided>
        <TagsSection m={m} />
      </Divided>
    </div>
  );
}

function PosterNameHistory({ names }: { names?: HologramInspectorModel['previousNames'] }) {
  if (!names?.length) return null;
  return (
    <>
      {(['displayName', 'screenName'] as const).map((field) => {
        const entries = names.filter((name) => name.field === field);
        if (!entries.length) return null;
        return (
          <Field
            key={field}
            k={t(field === 'displayName' ? 'posterPreviousDisplayName' : 'posterPreviousHandle')}
            v={
              <div data-slot="poster-name-history" className="flex flex-col items-start gap-1.5">
                {entries.map((name) => (
                  <Tooltip key={name.value}>
                    <TooltipTrigger className="w-full min-w-0 whitespace-normal pr-1 text-left text-inherit [overflow-wrap:anywhere]">
                      {field === 'screenName' ? '@' : ''}
                      {name.value}
                    </TooltipTrigger>
                    <TooltipContent>{t('posterNameLastSeen', { date: name.lastObservedAt.slice(0, 10).replaceAll('-', '/') })}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            }
          />
        );
      })}
    </>
  );
}

// 投稿者の詳細。
function PosterInspector({ m }: { m: HologramInspectorModel }) {
  return (
    <div data-slot="inspector-poster" className="flex min-w-0 flex-col gap-3">
      {m.bannerSrc ? <img className="h-24 w-full rounded-md border border-border object-cover" src={m.bannerSrc} alt="" /> : null}
      <div className="flex items-start justify-between gap-2">
        <div className="flex w-full min-w-0 items-center gap-2.5">
          {m.avatarSrc ? <img data-slot="avatar-image" className="size-10 shrink-0 rounded-full border border-border object-cover" src={m.avatarSrc} alt="" /> : null}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{m.name}</div>
            {m.onOpenProfile ? <ExternalTextLink text={m.screenNameLabel} href={m.profileUrlLabel} label={m.labels.openProfile} onClick={m.onOpenProfile} /> : <span className="text-[12.5px] text-muted-foreground">{m.screenNameLabel}</span>}
          </div>
        </div>
      </div>
      <Fields>
        <PosterNameHistory names={m.previousNames} />
        <Field k={m.labels.platform} v={m.platformLabel} />
        <Field k={m.labels.posts} v={m.postsLabel} />
        <Field k={m.labels.followers} v={m.followersLabel} />
        <Field k={m.labels.following} v={m.followingLabel} />
        <Field k={m.labels.bio} v={m.bioLabel} />
        <Field k={m.labels.joined} v={m.joinedLabel} />
      </Fields>
      {m.works.length ? (
        <div className="grid grid-cols-3 gap-1.5">
          {m.works.map((w: { key: string; thumbSrc: string | null; text: string; onClick?: () => void }) => (
            <button
              key={w.key}
              type="button"
              data-slot="inspector-work"
              aria-label={w.text}
              onClick={w.onClick}
              className="aspect-square min-w-0 w-full overflow-hidden rounded-md border border-border bg-muted/30 text-left text-foreground hover:border-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {w.thumbSrc ? (
                <img data-slot="inspector-work-thumb" className="block size-full object-cover" src={w.thumbSrc} alt="" loading="lazy" decoding="async" />
              ) : (
                <span data-slot="inspector-work-text" className="block p-1.5 text-xs leading-normal">
                  <span className="line-clamp-3 [overflow-wrap:anywhere]">{w.text}</span>
                </span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      <Divided>
        <TagsSection m={m} />
      </Divided>
    </div>
  );
}

// 何も選択していないとき（#244）。パネルは常設になったので、「選択が無い」はパネルが消える
// 理由ではなくパネルの普通の状態の1つ＝ここに置くべきなのはその事実だけ。ライブラリ全体の
// 要約は検討して却下した。この面は選択したものの詳細として定義されており（#143）、そこで
// 出す件数はタブに既に出ている。
//
// 作りはアプリ共通の Empty（P2⑫）＝グリッド・ゴミ箱・画像ビューが使うのと同じアイコンの
// 台座＋タイトルなので、中身の無いパネルはどこでも同じ種類の状態として読める。説明も操作も
// 持たないが、これはコンポーネントが許している形＝ここで言うことはちょうど1つしかない。
function InspectorEmpty() {
  return (
    <Empty data-slot="inspector-empty" className="h-full px-4">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PanelRight />
        </EmptyMedia>
        <EmptyTitle>{t('inspectorEmpty')}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

export function Inspector() {
  const m = useSyncExternalStore(subscribe, get);
  const [tab, setTab] = useState<string>('detail');
  useEffect(() => {
    if (m?.openId != null && m.focusTags) setTab('tags');
  }, [m?.openId, m?.focusTags]);
  if (!m) return <InspectorEmpty />;
  return (
    <Tabs.Root value={tab} onValueChange={(value) => setTab(String(value))} className="flex h-full min-h-0 flex-col gap-3">
      <Tabs.List className="flex shrink-0 gap-4" aria-label={t('inspectorTabs')}>
        <Tabs.Tab value="detail" className="border-b-2 border-transparent px-2 pb-2 text-muted-foreground data-active:border-foreground data-active:text-foreground">
          {t('inspectorDetailsTab')}
        </Tabs.Tab>
        <Tabs.Tab value="tags" className="border-b-2 border-transparent px-2 pb-2 text-muted-foreground data-active:border-foreground data-active:text-foreground">
          {m.labels.tags}
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="detail" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2">
        {m.kind === 'poster' ? <PosterInspector key={m.openId} m={m} /> : <PostInspector key={m.openId} m={m} />}
      </Tabs.Panel>
      <Tabs.Panel value="tags" className="flex min-h-0 flex-1 flex-col">
        <TagField key={m.openId} tags={m.tags} postIds={m.classificationPostIds} vocabGroups={m.vocabGroups} labels={m.tagLabels} onAdd={m.onTagAdd} onRemove={m.onTagRemove} onContextMenu={m.onTagContextMenu} autoFocus={m.focusTags} />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
