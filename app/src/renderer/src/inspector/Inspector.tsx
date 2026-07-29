import { useSyncExternalStore } from 'react';
import { ArrowUpRight, PanelRight, Plus, X } from 'lucide-react';
import { get, subscribe } from '../services/inspector.ts';
import { t } from '../_shared/i18n.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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
    <Button variant="ghost" size="icon-xs" className="-mt-0.5 -mr-1 shrink-0 text-muted-foreground" aria-label={t('close')} data-tip={t('close')} onClick={onClose}>
      <X aria-hidden="true" />
    </Button>
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
// kind-menu. m.focusTags is set only when the panel was opened BY the タグを編集
// context-menu item, so a plain card click never steals focus from the grid.
function TagsSection({ m }: { m: HologramInspectorModel }) {
  return (
    <section data-slot="inspector-tags" className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{m.labels.tags}</span>
      <TagField tags={m.tags} vocabGroups={m.vocabGroups} coocGroups={m.coocGroups} srcTags={m.srcTagsForPicker} labels={m.tagLabels} onAdd={m.onTagAdd} onRemove={m.onTagRemove} onContextMenu={m.onTagContextMenu} autoFocus={m.focusTags} />
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
      <img className="size-6 shrink-0 rounded-full border border-border object-cover" src={m.avatarSrc} alt="" />
      <span className="truncate">{m.authorName}</span>
    </span>
  ) : (
    <span className="truncate">{m.authorName}</span>
  );
  const actions = m.onOpenExternal || m.onSauce || m.onAscii || m.groupBtn;
  return (
    <div data-slot="inspector-post" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        {m.heading ? <h2 className="min-w-0 text-[13px] leading-snug font-semibold break-words">{m.heading}</h2> : <span />}
        <CloseButton onClose={m.onClose} />
      </div>
      {m.thumbSrc ? <img data-slot="inspector-thumb" data-peek={m.onThumbClick ? 'true' : undefined} className={'block w-full rounded-lg border border-border' + (m.onThumbClick ? ' cursor-zoom-in' : '')} src={m.thumbSrc} alt="" onClick={m.onThumbClick ?? undefined} /> : null}
      <Fields>
        <Field k={m.labels.platform} v={m.platformLabel} />
        {hasAuthor ? (
          <>
            <dt className="text-muted-foreground">{m.labels.author}</dt>
            <dd className="min-w-0">
              {m.jumpable ? (
                <button type="button" className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left hover:text-primary" data-tip={m.labels.viewPoster} onClick={m.onPosterJump}>
                  {authorValue}
                </button>
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
            {m.onOpenExternal ? (
              <ActionLink onClick={m.onOpenExternal}>
                {m.labels.open}
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
          {m.avatarSrc ? <img className="size-10 shrink-0 rounded-full border border-border object-cover" src={m.avatarSrc} alt="" /> : null}
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
              key={i}
              className="aspect-square w-full cursor-pointer rounded-md border border-border bg-muted object-cover transition-transform hover:scale-105"
              src={w.thumbSrc}
              alt=""
              loading="lazy"
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
            <Badge variant="outline" className="cursor-pointer text-muted-foreground hover:bg-muted" aria-label={m.labels.newFolderPlaceholder} data-tip={m.labels.newFolderPlaceholder} render={<button type="button" onClick={m.onFolderCreate} />}>
              <Plus aria-hidden="true" />
            </Badge>
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
        </div>
      </Divided>
    </div>
  );
}

// Nothing selected (#244). The panel is persistent now, so "no selection" is a normal
// state of it rather than a reason for it to disappear — and what belongs here is only
// that fact. A library-wide summary was considered and rejected: this surface is defined
// as the detail OF a selection (#143), and the counts it would show are already on the tab.
function InspectorEmpty() {
  return (
    <div data-slot="inspector-empty" className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
      <PanelRight className="size-6 opacity-40" aria-hidden="true" />
      <span className="text-xs">{t('inspectorEmpty')}</span>
    </div>
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
