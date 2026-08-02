import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, PanelRight, Plus, X } from 'lucide-react';
import { get, subscribe } from '../services/inspector.ts';
import { t } from '../_shared/i18n.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TagField } from './TagField.tsx';
import type { ReactNode } from 'react';

// The panel is a stack of sections divided by Separator rather than one long
// ruled list (P2⑦). Each section is a 2-column grid of label/value pairs, so the
// values line up across sections instead of each row carrying its own rule —
// which is what made the old .iv-insp-row list read as undifferentiated.
function Fields({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[minmax(0,4.5rem)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-xs">{children}</dl>;
}

function Field({ k, v }: { k?: string; v?: ReactNode }) {
  if (v == null || v === '') return null;
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="min-w-0 break-words">{v}</dd>
    </>
  );
}

// A section that renders nothing when every field in it is empty would still emit
// its Separator, leaving a stray rule. Callers therefore decide whether to include
// a section at all; this only draws the divider above one.
function Divided({ children }: { children: ReactNode }) {
  return (
    <>
      <Separator />
      {children}
    </>
  );
}

function CloseButton({ onClose }: { onClose?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-xs" className="-mt-0.5 -mr-1 shrink-0 text-muted-foreground" aria-label={t('close')} onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        }
      />
      <TooltipContent side="bottom" align="end">
        {t('close')}
      </TooltipContent>
    </Tooltip>
  );
}

// External-link style action. The old markup used bare <a> elements with no href
// (click handlers only), which are not focusable or keyboard-operable; these are
// real buttons wearing the link variant.
function ActionLink({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  return (
    <Button variant="link" size="sm" className="h-auto justify-start gap-1 p-0 text-xs" onClick={onClick}>
      {children}
    </Button>
  );
}

// Tags are edited in place (P2⑦) — the ✎/🏷-to-popover route is gone, so this is
// both the display and the editor. Right-click on a chip still opens the
// kind-menu. m.focusTags is set only when the panel was opened BY the "Edit tag"
// context-menu item, so a plain card click never steals focus from the grid.
function TagsSection({ m }: { m: HologramInspectorModel }) {
  return (
    <section data-slot="inspector-tags" className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{m.labels.tags}</span>
      <TagField tags={m.tags} vocabGroups={m.vocabGroups} coocGroups={m.coocGroups} srcTags={m.srcTagsForPicker} labels={m.tagLabels} onAdd={m.onTagAdd} onRemove={m.onTagRemove} onContextMenu={m.onTagContextMenu} autoFocus={m.focusTags} />
    </section>
  );
}

// Free-text note (#36) — the only per-post field with no card-face representation
// (design decision on #36: "カードには出さない"). Local state so keystrokes render
// instantly; the write itself is debounced (so a fast typist isn't sending one
// IPC call per keystroke) and also flushed on blur (so navigating away right
// after typing never drops the last unsent burst). Uncontrolled from the
// model's point of view once mounted — m.memo only seeds the initial value, the
// same shape TagField's own input state already has for the same reason.
function MemoSection({ m }: { m: HologramInspectorModel }) {
  const [text, setText] = useState(m.memo || '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    m.onMemoChange?.(value);
  };
  // Cancels a pending debounce on unmount (a fresh subject remounts this
  // component, keyed on openId by PostInspector below) — the blur that
  // precedes any focus-losing navigation already committed the latest text,
  // so this is only a safety net against a stray timer firing against a
  // subject that is no longer the one on screen.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <section data-slot="inspector-memo" className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{m.labels.memo}</span>
      <Textarea
        value={text}
        placeholder={m.labels.memoPlaceholder}
        rows={3}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(value), 600);
        }}
        onBlur={() => commit(text)}
      />
    </section>
  );
}

// The post's own text (#676). A full-width labeled section — the same shape as
// TagsSection/SourceTagsSection below — rather than a Fields row: the 2-column
// grid's value column is too narrow for prose, and cramming it in there was the
// bug this section replaces (the heading <h2> borrowing p.text when there was no
// title). Un-clamped (the panel scrolls) and normal weight, unlike the bold,
// single-line-in-spirit heading it used to masquerade as.
function TextSection({ text, label }: { text: string; label?: string }) {
  return (
    <section data-slot="inspector-text" className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className="text-[13px] leading-snug whitespace-pre-wrap break-words">{text}</p>
    </section>
  );
}

// Hashtags carried in from the source post, minus the ones already adopted as user
// tags. Outline (not filled) keeps them visibly a different class of thing from the
// user's own vocabulary.
function SourceTagsSection({ tags, label }: { tags: string[]; label?: string }) {
  return (
    <section className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
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

// Post detail. m carries every field already resolved/localized by the builder
// (dates formatted, MSG strings picked).
function PostInspector({ m }: { m: HologramInspectorModel }) {
  const hasAuthor = !!(m.authorName || m.avatarSrc);
  const authorValue = m.avatarSrc ? (
    <span className="flex items-center gap-1.5">
      <img data-slot="avatar-image" className="size-6 shrink-0 rounded-full border border-border object-cover" src={m.avatarSrc} alt="" />
      <span className="truncate">{m.authorName}</span>
    </span>
  ) : (
    <span className="truncate">{m.authorName}</span>
  );
  const actions = m.onOpenExternal || m.onOpenProfile || m.onSauce || m.onAscii || m.groupBtn;
  return (
    <div data-slot="inspector-post" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        {m.heading ? <h2 className="min-w-0 text-[13px] leading-snug font-semibold break-words">{m.heading}</h2> : <span />}
        <CloseButton onClose={m.onClose} />
      </div>
      {m.thumbSrc ? <img data-slot="inspector-thumb" data-peek={m.onThumbClick ? 'true' : undefined} className={'block w-full rounded-lg border border-border' + (m.onThumbClick ? ' cursor-zoom-in' : '')} src={m.thumbSrc} alt="" onClick={m.onThumbClick ?? undefined} /> : null}
      {m.bodyText ? <TextSection text={m.bodyText} label={m.labels.text} /> : null}
      <Fields>
        <Field k={m.labels.platform} v={m.platformLabel} />
        {hasAuthor ? (
          <>
            <dt className="text-muted-foreground">{m.labels.author}</dt>
            <dd className="min-w-0">
              {m.jumpable ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button type="button" className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left hover:text-primary" onClick={m.onPosterJump}>
                        {authorValue}
                      </button>
                    }
                  />
                  <TooltipContent side="bottom" align="start">
                    {m.labels.viewPoster}
                  </TooltipContent>
                </Tooltip>
              ) : (
                authorValue
              )}
            </dd>
          </>
        ) : null}
        <Field k={m.labels.user} v={m.screenNameLabel} />
        <Field k={m.labels.followers} v={m.followersLabel} />
        <Field k={m.labels.joined} v={m.joinedLabel} />
      </Fields>
      <Divided>
        <Fields>
          <Field k={m.labels.engagement} v={m.engagementLabel} />
          <Field k={m.labels.posted} v={m.postedLabel} />
          <Field k={m.labels.saved} v={m.savedLabel} />
          <Field k={m.labels.updated} v={m.updatedLabel} />
          <Field k={m.labels.images} v={m.imagesLabel} />
          <Field k={m.labels.imageOf} v={m.imageOfLabel} />
          <Field k={m.labels.series} v={m.seriesLabel} />
          <Field k={m.labels.seriesOrder} v={m.seriesOrderLabel} />
        </Fields>
      </Divided>
      <Divided>
        <TagsSection m={m} />
      </Divided>
      <Divided>
        <MemoSection m={m} />
      </Divided>
      {m.srcTagsView.length ? (
        <Divided>
          <SourceTagsSection tags={m.srcTagsView} label={m.labels.sourceTags} />
        </Divided>
      ) : null}
      {actions ? (
        <Divided>
          <div className="flex flex-col items-start gap-0.5">
            {m.onOpenExternal ? (
              <ActionLink onClick={m.onOpenExternal}>
                {m.labels.open}
                <ArrowUpRight aria-hidden="true" />
              </ActionLink>
            ) : null}
            {m.onOpenProfile ? (
              <ActionLink onClick={m.onOpenProfile}>
                {m.labels.openProfile}
                <ArrowUpRight aria-hidden="true" />
              </ActionLink>
            ) : null}
            {m.onSauce ? (
              <ActionLink onClick={m.onSauce}>
                {m.labels.sauce}
                <ArrowUpRight aria-hidden="true" />
              </ActionLink>
            ) : null}
            {m.onAscii ? (
              <ActionLink onClick={m.onAscii}>
                {m.labels.ascii}
                <ArrowUpRight aria-hidden="true" />
              </ActionLink>
            ) : null}
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

// Poster detail.
function PosterInspector({ m }: { m: HologramInspectorModel }) {
  return (
    <div data-slot="inspector-poster" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {m.avatarSrc ? <img data-slot="avatar-image" className="size-10 shrink-0 rounded-full border border-border object-cover" src={m.avatarSrc} alt="" /> : null}
          <span className="truncate text-[15px] font-semibold">{m.name}</span>
        </div>
        <CloseButton onClose={m.onClose} />
      </div>
      <Fields>
        <Field k={m.labels.user} v={m.screenNameLabel} />
        <Field k={m.labels.platform} v={m.platformLabel} />
        <Field k={m.labels.posts} v={m.postsLabel} />
        <Field k={m.labels.followers} v={m.followersLabel} />
        <Field k={m.labels.joined} v={m.joinedLabel} />
      </Fields>
      {m.works.length ? (
        <div className="grid grid-cols-3 gap-1.5">
          {m.works.map((w: { thumbSrc: string; onClick?: () => void }, i: number) => (
            <img
              // A positional strip with no stable id of its own — the index IS the identity here.
              // decoding="async" (#569): a 3-wide grid of these can be decoding together,
              // same call as PostCard's card thumbnail.
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
        <section className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{m.labels.posterFolders}</span>
          <div className="flex flex-wrap gap-1">
            {m.folders.map((f: { id: string; name: string; on?: boolean }) => (
              <Badge key={f.id} variant={f.on ? 'default' : 'outline'} className={f.on ? 'cursor-pointer hover:bg-primary/80' : 'cursor-pointer hover:bg-muted'} render={<button type="button" onClick={() => m.onFolderToggle(f.id)} />}>
                {f.name}
              </Badge>
            ))}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Badge variant="outline" className="cursor-pointer text-muted-foreground hover:bg-muted" aria-label={m.labels.newFolderPlaceholder} render={<button type="button" onClick={m.onFolderCreate} />}>
                    <Plus aria-hidden="true" />
                  </Badge>
                }
              />
              <TooltipContent side="top">{m.labels.newFolderPlaceholder}</TooltipContent>
            </Tooltip>
          </div>
        </section>
      </Divided>
      <Divided>
        <TagsSection m={m} />
      </Divided>
      <Divided>
        <div className="flex flex-col items-start gap-0.5">
          <ActionLink onClick={m.onPosterPosts}>
            {m.labels.posterViewPosts}
            <ArrowUpRight aria-hidden="true" />
          </ActionLink>
          {m.onOpenProfile ? (
            <ActionLink onClick={m.onOpenProfile}>
              {m.labels.openProfile}
              <ArrowUpRight aria-hidden="true" />
            </ActionLink>
          ) : null}
        </div>
      </Divided>
    </div>
  );
}

// Nothing selected (#244). The panel is persistent now, so "no selection" is a normal
// state of it rather than a reason for it to disappear — and what belongs here is only
// that fact. A library-wide summary was considered and rejected: this surface is defined
// as the detail OF a selection (#143), and the counts it would show are already on the tab.
//
// The anatomy is the app's shared Empty (P2⑫) — the same icon plate + title the grids,
// the trash and the image view use — so a panel with nothing in it reads as the same
// kind of state everywhere. It carries no description and no action, which the component
// allows: there is exactly one thing to say here.
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
  // Keyed on openId (bumped only by open(), not refresh()): a fresh post/poster remounts
  // and resets local state (tag-input text), while a tag mutation on the SAME panel
  // re-renders in place and keeps it — matching the old full-rebuild-vs-subpart-refresh split.
  return m.kind === 'poster' ? <PosterInspector key={m.openId} m={m} /> : <PostInspector key={m.openId} m={m} />;
}
