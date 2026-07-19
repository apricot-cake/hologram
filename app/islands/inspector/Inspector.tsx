import { useSyncExternalStore } from 'react';
import { PanelRight } from 'lucide-react';
import { get, subscribe } from '../../renderer/inspector.ts';
import { t } from '../_shared/i18n.ts';
import type { ReactNode } from 'react';

function Row({ k, v }: { k?: string; v?: ReactNode }) {
  if (v == null || v === '') return null;
  return (
    <div className="iv-insp-row">
      <span className="iv-insp-k">{k}</span>
      <span className="iv-insp-v">{v}</span>
    </div>
  );
}

const Pencil = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

// Read-only tag row shared by the post/poster inspector — tags are display-only
// chips (right-click still opens the kind-menu, a read operation) + a trailing ✎
// that opens the tag picker pop (Issue #22) anchored to itself. Editing moved OUT
// of the inspector entirely — see tag-pop.ts / TagPop.tsx.
function TagsRow({ tags, label, emptyLabel, editTip, onTagContextMenu, onEditTags }: { tags: string[]; label?: string; emptyLabel?: string; editTip?: string; onTagContextMenu: (tag: string, x: number, y: number) => void; onEditTags: (anchorRect: CorpusAnchorRect) => void }) {
  return (
    <div className="iv-insp-row iv-tags-row">
      <span className="iv-insp-k">{label}</span>
      <span className="iv-insp-v">
        <div className="iv-insp-tags">
          {tags.length ? (
            tags.map((t) => (
              <span
                key={t}
                className="iv-insp-tag"
                onContextMenu={(e) => {
                  e.preventDefault();
                  onTagContextMenu(t, e.clientX, e.clientY);
                }}
              >
                {t}
              </span>
            ))
          ) : (
            <span className="edit-empty">{emptyLabel}</span>
          )}
        </div>
      </span>
      <button type="button" className="icon-btn icon-btn--ghost iv-tag-edit-btn" aria-label={editTip} data-tip={editTip} onClick={(e) => onEditTags(e.currentTarget.getBoundingClientRect())}>
        <Pencil />
      </button>
    </div>
  );
}

// Post detail — mirrors the old showDetail() innerHTML build. m carries every field
// already resolved/localized by viewer.js (dates formatted, MSG strings picked).
function PostInspector({ m }: { m: CorpusInspectorModel }) {
  return (
    <>
      <button type="button" className="iv-insp-close" aria-label="閉じる" data-tip="閉じる" onClick={m.onClose}>
        &times;
      </button>
      {m.heading ? <div className="iv-insp-title">{m.heading}</div> : null}
      {m.thumbSrc ? <img className={'iv-insp-thumb' + (m.onThumbClick ? ' iv-insp-thumb--peek' : '')} src={m.thumbSrc} alt="" onClick={m.onThumbClick ?? undefined} /> : null}
      <Row k={m.labels.platform} v={m.platformLabel} />
      {m.authorName || m.avatarSrc ? (
        <div className="iv-insp-row">
          <span className="iv-insp-k">{m.labels.author}</span>
          <span className="iv-insp-v iv-insp-author">
            {m.jumpable ? (
              <button type="button" className="iv-insp-author-link" data-tip={m.labels.viewPoster} onClick={m.onPosterJump}>
                {m.avatarSrc ? <img className="iv-insp-avatar" src={m.avatarSrc} alt="" /> : null}
                <span>{m.authorName}</span>
              </button>
            ) : (
              <>
                {m.avatarSrc ? <img className="iv-insp-avatar" src={m.avatarSrc} alt="" /> : null}
                <span>{m.authorName}</span>
              </>
            )}
          </span>
        </div>
      ) : null}
      <Row k={m.labels.user} v={m.screenNameLabel} />
      <Row k={m.labels.followers} v={m.followersLabel} />
      <Row k={m.labels.joined} v={m.joinedLabel} />
      <Row k={m.labels.engagement} v={m.engagementLabel} />
      <Row k={m.labels.posted} v={m.postedLabel} />
      <Row k={m.labels.saved} v={m.savedLabel} />
      <Row k={m.labels.updated} v={m.updatedLabel} />
      <Row k={m.labels.images} v={m.imagesLabel} />
      <Row k={m.labels.imageOf} v={m.imageOfLabel} />
      <TagsRow tags={m.tags} label={m.labels.tags} emptyLabel={m.labels.tagsEmpty} editTip={m.labels.editTags} onTagContextMenu={m.onTagContextMenu} onEditTags={m.onEditTags} />
      {m.srcTagsView.length ? (
        <div className="iv-insp-row">
          <span className="iv-insp-k">{m.labels.sourceTags}</span>
          <span className="iv-insp-v">
            <div className="iv-insp-tags">
              {m.srcTagsView.map((t: string) => (
                <span key={t} className="iv-insp-tag iv-insp-tag-src">
                  {t}
                </span>
              ))}
            </div>
          </span>
        </div>
      ) : null}
      <div className="iv-insp-actions">
        {m.onOpenExternal ? (
          <a className="iv-insp-open" onClick={m.onOpenExternal}>
            {m.labels.open} &#8599;
          </a>
        ) : null}
        {m.onSauce ? (
          <a className="iv-insp-open" onClick={m.onSauce}>
            {m.labels.sauce} &#8599;
          </a>
        ) : null}
        {m.onAscii ? (
          <a className="iv-insp-open" onClick={m.onAscii}>
            {m.labels.ascii} &#8599;
          </a>
        ) : null}
        {m.groupBtn ? (
          <a className="iv-insp-open" onClick={m.groupBtn.onClick}>
            {m.groupBtn.icon} {m.groupBtn.label}
          </a>
        ) : null}
      </div>
    </>
  );
}

// Poster detail — mirrors the old showPosterDetail() innerHTML build.
function PosterInspector({ m }: { m: CorpusInspectorModel }) {
  return (
    <>
      <button type="button" className="iv-insp-close" aria-label="閉じる" data-tip="閉じる" onClick={m.onClose}>
        &times;
      </button>
      <div className="iv-poster-head">
        {m.avatarSrc ? <img className="iv-insp-avatar" src={m.avatarSrc} alt="" /> : null}
        <span className="iv-poster-name">{m.name}</span>
      </div>
      <Row k={m.labels.user} v={m.screenNameLabel} />
      <Row k={m.labels.platform} v={m.platformLabel} />
      <Row k={m.labels.posts} v={m.postsLabel} />
      <Row k={m.labels.followers} v={m.followersLabel} />
      <Row k={m.labels.joined} v={m.joinedLabel} />
      {m.works.length ? (
        <div className="iv-poster-works">
          {m.works.map((w: any, i: number) => (
            <img key={i} className="iv-poster-thumb" src={w.thumbSrc} alt="" loading="lazy" onClick={w.onClick} />
          ))}
        </div>
      ) : null}
      <div className="iv-insp-row iv-poster-folders-row">
        <span className="iv-insp-k">{m.labels.posterFolders}</span>
        <span className="iv-insp-v">
          <div className="iv-poster-folder-chips">
            {m.folders.map((f: any) => (
              <button key={f.id} type="button" className={'iv-folder-chip' + (f.on ? ' on' : '')} onClick={() => m.onFolderToggle(f.id)}>
                {f.name}
              </button>
            ))}
            <button type="button" className="iv-folder-chip iv-folder-add" aria-label={m.labels.newFolderPlaceholder} data-tip={m.labels.newFolderPlaceholder} onClick={m.onFolderCreate}>
              +
            </button>
          </div>
        </span>
      </div>
      <TagsRow tags={m.tags} label={m.labels.tags} emptyLabel={m.labels.tagsEmpty} editTip={m.labels.editTags} onTagContextMenu={m.onTagContextMenu} onEditTags={m.onEditTags} />
      <div className="iv-insp-actions">
        <a className="iv-insp-open" onClick={m.onPosterPosts}>
          {m.labels.posterViewPosts} &#8594;
        </a>
      </div>
    </>
  );
}

// Nothing selected (#244). The panel is persistent now, so "no selection" is a normal
// state of it rather than a reason for it to disappear — and what belongs here is only
// that fact. A library-wide summary was considered and rejected: this surface is defined
// as the detail OF a selection (#143), and the counts it would show are already on the tab.
function InspectorEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
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
