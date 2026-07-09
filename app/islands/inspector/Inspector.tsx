import { useSyncExternalStore } from 'react';
import { TagEditor } from '../_shared/TagEditor.tsx';
import { get, subscribe } from '../../renderer/inspector.ts';
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

// Post detail — mirrors the old showDetail() innerHTML build. m carries every field
// already resolved/localized by viewer.js (dates formatted, MSG strings picked).
function PostInspector({ m }: { m: CorpusInspectorModel }) {
  return (
    <>
      <button type="button" className="iv-insp-close" aria-label="閉じる" data-tip="閉じる" onClick={m.onClose}>
        &times;
      </button>
      {m.heading ? <div className="iv-insp-title">{m.heading}</div> : null}
      {m.thumbSrc ? <img className="iv-insp-thumb" src={m.thumbSrc} alt="" /> : null}
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
      <TagEditor idPrefix="iv" className="iv-tag-edit" tags={m.tags} vocabGroups={m.vocabGroups} coocGroups={m.coocGroups} srcTags={m.srcTagsForPicker} labels={m.tagLabels} onAdd={m.onTagAdd} onRemove={m.onTagRemove} onToggle={m.onTagToggle} onContextMenu={m.onTagContextMenu} />
      <div id="ivTagView" className="iv-tag-view">
        {m.srcTagsView.length ? (
          <div className="iv-insp-row">
            <span className="iv-insp-k">{m.labels.sourceTags}</span>
            <span className="iv-insp-v">
              <div className="iv-insp-tags">
                {m.srcTagsView.map((t: string) => (
                  <button key={t} type="button" className="iv-insp-tag iv-insp-tag-src" data-tip={m.labels.tipAdoptTag} onClick={() => m.onAdoptSourceTag(t)}>
                    {t}
                  </button>
                ))}
              </div>
            </span>
          </div>
        ) : null}
      </div>
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
      <TagEditor
        idPrefix="pd"
        className="iv-tag-edit iv-tag-edit-poster"
        tags={m.tags}
        vocabGroups={m.vocabGroups}
        coocGroups={m.coocGroups}
        srcTags={m.srcTagsForPicker}
        labels={m.tagLabels}
        onAdd={m.onTagAdd}
        onRemove={m.onTagRemove}
        onToggle={m.onTagToggle}
        onContextMenu={m.onTagContextMenu}
        autoFocus={m.autoFocusTag}
      />
      <div className="iv-insp-actions">
        <a className="iv-insp-open" onClick={m.onPosterPosts}>
          {m.labels.posterViewPosts} &#8594;
        </a>
      </div>
    </>
  );
}

export function Inspector() {
  const m = useSyncExternalStore(subscribe, get);
  if (!m) return null;
  // Keyed on openId (bumped only by open(), not refresh()): a fresh post/poster remounts
  // and resets local state (tag-input text), while a tag mutation on the SAME panel
  // re-renders in place and keeps it — matching the old full-rebuild-vs-subpart-refresh split.
  return m.kind === 'poster' ? <PosterInspector key={m.openId} m={m} /> : <PostInspector key={m.openId} m={m} />;
}
