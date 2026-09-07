import { useSyncExternalStore } from 'react';
import { Bookmark, Eye, Heart, MessageCircle, PanelRight, Repeat2 } from 'lucide-react';
import { get, subscribe } from '../services/inspector.ts';
import { hologramIpc } from '../services/ipc.ts';
import { open as openMenu } from '../services/menu.ts';
import { t } from '../_shared/i18n.ts';
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
  return <dl className="grid grid-cols-[minmax(0,4.5rem)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-[12.5px]">{children}</dl>;
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

// 外部リンクの見た目をした操作。旧いマークアップは href の無い素の <a>（クリックハンドラ
// だけ）を使っていて、フォーカスもキーボード操作もできなかった。こちらは link のバリアントを
// まとった本物のボタン。
function ActionLink({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  return (
    <Button variant="link" size="sm" className="h-auto max-w-full min-w-0 justify-start gap-1 whitespace-normal p-0 text-left text-[12.5px] [overflow-wrap:anywhere]" onClick={onClick}>
      {children}
    </Button>
  );
}

function ExternalTextLink({ text, href, label, onClick }: { text?: string; href?: string; label?: string; onClick?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href}
            className="block max-w-full min-w-0 cursor-pointer text-left text-[12.5px] leading-normal text-blue-600 no-underline [overflow-wrap:anywhere] hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
          </a>
        }
      />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

// タグはその場で編集する（P2⑦）＝✎/🏷 からポップオーバーへ行く経路は無くなったので、
// ここが表示であり編集機でもある。チップの右クリックで種別メニューが開くのは今までどおり。
// m.focusTags が立つのは、コンテキストメニューの「タグを編集」からパネルを開いたときだけ
// ＝素のカードのクリックがグリッドからフォーカスを奪うことは一切ない。
function TagsSection({ m }: { m: HologramInspectorModel }) {
  return (
    <section data-slot="inspector-tags" className="flex flex-col gap-1.5">
      <span className="text-[12.5px] text-muted-foreground">{m.labels.tags}</span>
      <TagField tags={m.tags} vocabGroups={m.vocabGroups} coocGroups={m.coocGroups} srcTags={m.srcTagsForPicker} aliasMap={m.aliasMap} labels={m.tagLabels} onAdd={m.onTagAdd} onRemove={m.onTagRemove} onContextMenu={m.onTagContextMenu} autoFocus={m.focusTags} />
    </section>
  );
}

const ENGAGEMENT_ICONS = { likes: Heart, reposts: Repeat2, replies: MessageCircle, bookmarks: Bookmark, views: Eye } as const;

function EngagementItems({ items }: { items?: Array<{ kind: keyof typeof ENGAGEMENT_ICONS; value: string; label: string }> }) {
  if (!items?.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {items.map((item) => {
        const Icon = ENGAGEMENT_ICONS[item.kind];
        return (
          <Tooltip key={item.kind}>
            <TooltipTrigger
              render={
                <span role="group" className="inline-flex items-center gap-1.5 tabular-nums" aria-label={`${item.label}: ${item.value}`}>
                  <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span>{item.value}</span>
                </span>
              }
            />
            <TooltipContent side="top">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
}

// 投稿そのものの本文（#676）。Fields の行ではなく、全幅でラベルを持つセクション＝下の
// TagsSection / SourceTagsSection と同じ形。2列のグリッドの値の列は散文には狭すぎて、
// そこへ押し込んでいたことがこのセクションで置き換えた不具合そのものだった（タイトルが
// 無いときに見出しの <h2> が p.text を借りていた）。行数は詰めず（パネルが縦に流れる）、
// 太さも普通のまま。かつて成りすましていた、太字で一行のつもりの見出しとは違う。
function TextSection({ text, label }: { text: string; label?: string }) {
  return (
    <section data-slot="inspector-text" className="flex flex-col gap-1.5">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <p className="text-[13.5px] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>
    </section>
  );
}

// 元の投稿から持ち込まれたハッシュタグから、既に利用者のタグとして取り込んだものを除いた
// もの。塗りではなく輪郭にすることで、利用者自身の語彙とは別の種類のものだと見て分かる。
function SourceTagsSection({ tags, label }: { tags: string[]; label?: string }) {
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

// 投稿の詳細。m はビルダーが解決とローカライズを済ませた欄をすべて運ぶ（日付は整形済み・
// MSG の文字列は選択済み）。
function PostInspector({ m }: { m: HologramInspectorModel }) {
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
  const actions = m.groupBtn;
  return (
    <div data-slot="inspector-post" className="flex min-w-0 flex-col gap-3">
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
      {m.thumbSrc ? <img data-slot="inspector-thumb" data-peek={m.onThumbClick ? 'true' : undefined} className={'block w-full rounded-lg border border-border' + (m.onThumbClick ? ' cursor-zoom-in' : '')} src={m.thumbSrc} alt="" onClick={m.onThumbClick ?? undefined} /> : null}
      {m.bodyText ? <TextSection text={m.bodyText} label={m.labels.text} /> : null}
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
      {m.srcTagsView.length ? (
        <Divided>
          <SourceTagsSection tags={m.srcTagsView} label={m.labels.sourceTags} />
        </Divided>
      ) : null}
      {actions ? (
        <Divided>
          <div className="flex flex-col items-start gap-0.5">
            {m.groupBtn ? (
              <ActionLink onClick={m.groupBtn.onClick}>
                {m.groupBtn.icon} {m.groupBtn.label}
              </ActionLink>
            ) : null}
          </div>
        </Divided>
      ) : null}
    </div>
  );
}

// 投稿者の詳細。
function PosterInspector({ m }: { m: HologramInspectorModel }) {
  return (
    <div data-slot="inspector-poster" className="flex min-w-0 flex-col gap-3">
      {m.bannerSrc ? <img className="h-24 w-full rounded-md border border-border object-cover" src={m.bannerSrc} alt="" /> : null}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {m.avatarSrc ? <img data-slot="avatar-image" className="size-10 shrink-0 rounded-full border border-border object-cover" src={m.avatarSrc} alt="" /> : null}
          <span className="truncate text-[15px] font-semibold">{m.name}</span>
        </div>
      </div>
      <Fields>
        <Field k={m.labels.user} v={m.onOpenProfile ? <ExternalTextLink text={m.screenNameLabel} href={m.profileUrlLabel} label={m.labels.openProfile} onClick={m.onOpenProfile} /> : m.screenNameLabel} />
        <Field k={m.labels.platform} v={m.platformLabel} />
        <Field k={m.labels.posts} v={m.postsLabel} />
        <Field k={m.labels.followers} v={m.followersLabel} />
        <Field k={m.labels.following} v={m.followingLabel} />
        <Field k={m.labels.bio} v={m.bioLabel} />
        <Field k={m.labels.joined} v={m.joinedLabel} />
      </Fields>
      {m.works.length ? (
        <div className="grid grid-cols-3 gap-1.5">
          {m.works.map((w: { thumbSrc: string; onClick?: () => void }, i: number) => (
            <img
              // 位置で並ぶだけで自分の安定した id を持たない列＝ここでは添字が同一性そのもの。
              // decoding="async"（#569）＝横3枚のグリッドがまとめてデコードされ得るので、
              // PostCard のカードのサムネイルと同じ判断にする。
              key={i}
              data-slot="inspector-work-thumb"
              className="aspect-square w-full cursor-pointer rounded-md border border-border bg-muted object-cover transition-transform hover:scale-105"
              src={w.thumbSrc}
              alt=""
              loading="lazy"
              decoding="async"
              onClick={w.onClick}
            />
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
  if (!m) return <InspectorEmpty />;
  // key は openId（上がるのは open() のときだけで、refresh() では上がらない）＝別の投稿／
  // 投稿者になると載せ直してローカルの状態（タグ入力のテキスト）を初期化し、同じパネルへの
  // タグの書き換えではその場で描き直して状態を保つ＝旧い「全体を作り直す／部分だけ更新する」
  // の切り分けと同じ。
  return m.kind === 'poster' ? <PosterInspector key={m.openId} m={m} /> : <PostInspector key={m.openId} m={m} />;
}
