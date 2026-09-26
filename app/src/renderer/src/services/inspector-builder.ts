import type { Translate } from './translation.ts';
import { reveal as revealPanels } from './panels.ts';
import { imageEntrySelection, replyPostsOf } from './reply-thread.ts';
import { hostOf, userKey } from './query.ts';
import { posterProfileUrl } from './profile-url.ts';
import { formatCount, localeDate, localeDateTime } from './format.ts';
import { refreshInspector, requestDetailOptions, type DetailOptions } from './inspector-controller.ts';
import * as selection from './selection.ts';
import { clickCard as selectTrashCard } from './trash-view.ts';
import { setOpen as panelSetOpen } from './inspector-panel.ts';
import { get as confirmGet } from './confirm.ts';
import { get as kindMenuGet } from './tag-group-menu.ts';
import { get as menuGet } from './menu.ts';
import { isAnySelectOpen } from './open-select-registry.ts';
import { makeGallery, artworkFile, displayPostText, postIdKey, postKeyOf, quotedCardModelOf } from './records.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { store } from './store.ts';
import { sameTags } from './tags.ts';
import { applyTagWrite, updateTags as postsUpdateTags } from './posts.ts';
import { hologramIpc } from './ipc.ts';
import type { UndoChange } from './undo.ts';

export interface InspectorBuilderDeps {
  navigateToPosts(filter: { type: string; [k: string]: any }, options?: { replace?: boolean }): void;
  t: Translate;
  platformName(value: string): string;
  fileSrc(file: string, w?: number): string;
  showToast(msg: unknown): void;
  showTagGroupMenu(tag: string, x: number, y: number, onChange: () => void, entityId?: number | null): void;
  buildUsers(): HologramUserAgg[];
  // #810: レコードが実体を指しているならその実体で、タグがまだ利用者が入力した
  // ただの文字列のままならその名前で（maybeDistinguishHomonym を参照）。
  tagGroupOf(tagId: number | null | undefined): string | null | undefined;
  jumpToPoster(post: HologramPost): void;
  openImageEntry(g: HologramPostGroup, mediaIndex?: number): void;
  pushUndo(changes: readonly UndoChange[]): (() => void) | null;
  inspectorTagPickerData(tags: string[], recordsForSource: any[], kind: string): any;
  getViewGroups(): HologramPostGroup[];
  getAllPosts(): HologramPost[];
  getPostById(id: string): HologramPost | undefined;
  markPostsMutated(): void;
  renderPosts(keepLimit?: boolean): void;
  keepCurrentVisible(): void;
  getActiveTabId(): string | null;
  closeTab(id: string | null | undefined): void;
  // imageTabShowing は viewer.ts の `let`（image-tab.ts の利用側）＝値がモジュールの
  // 生存期間の中で変わるので getter にしている。
  imageTabShowing(): boolean;
}

export function makeInspector(deps: InspectorBuilderDeps) {
  // インスペクタのインラインタグフィールド（下の showDetail）用の文字列。
  function tagLabels() {
    return {
      tagsLabel: deps.t('detailTags'),
      newTagPlaceholder: deps.t('tagNewName'),
      addBtn: deps.t('tagAddBtn'),
      noTags: deps.t('editNoTags'),
      noMatch: deps.t('tagPalNoMatch'),
      noVocab: deps.t('tagNoTags'),
      removeTag: deps.t('tagRemove'),
    };
  }

  // --- インスペクタのタグ変更（P2⑦: 編集はパネル自身のインラインフィールドで行う） ---
  // 正本はレコードの実タグ。変更はそれぞれ即座に保存し、パネルのタグ
  // フィールドだけを更新する（フル再オープンではない＝画像／メタ情報が
  // ちらつかず、フィールドがフォーカスを保つ）。

  function refreshInspectorTagFields(g: HologramPostGroup | null | undefined) {
    if (!g) return;
    refreshInspector();
  }

  // 閲覧回数の加算は画像ビューを描いた直後に非同期で返る。今検査している投稿自身なら、
  // 入力中のタグやメモを載せ直さず、この名前–値行だけを最新値へ差し替える。
  function refreshPostViewCount(postId: string) {
    if (store.getState().inspectedKey !== postId) return;
    refreshInspector();
  }

  // 検査中グループの全レコードにタグの変更を適用し、即座に永続化し、undo を
  // 記録し、グリッド＋インスペクタのタグフィールドを更新する（フル showDetail
  // ではない＝画像／メタ情報がちらつかず、入力欄がフォーカスを保つ）。
  async function applyInspectorTagChange(g: HologramPostGroup | null | undefined, mutate: (prev: string[]) => string[] | null | undefined) {
    if (!g) return;
    const recs = g.records && g.records.length ? g.records : [g.rep];
    deps.keepCurrentVisible(); // タグを外すと、有効なタグフィルタに一致しなくなることがある
    const changes: UndoChange[] = [];
    const writes: Array<{ rec: HologramPost; next: string[]; image: string }> = [];
    for (const r of recs) {
      const prev: string[] = (r.tags || []).slice();
      const next = mutate(prev.slice());
      if (!next || sameTags(prev, next)) continue;
      const rec = deps.getPostById(r.captureId); // O(1) の検索。allPosts は同じレコード参照を共有している
      if (rec) {
        applyTagWrite(rec, next, null);
        writes.push({ rec, next, image: r.image || r.video || r.captureId });
      }
      // 記録する変更は2つのリストの差分であって、リストそのものではない（#235）。
      changes.push({
        kind: 'post-tags',
        target: r.captureId,
        image: r.image || r.video || r.captureId,
        added: next.filter((tag) => !prev.includes(tag)),
        removed: prev.filter((tag) => !next.includes(tag)),
      });
    }
    if (!changes.length) return;
    deps.pushUndo(changes);
    deps.markPostsMutated();
    deps.renderPosts(true);
    const fresh = deps.getViewGroups().find((g2) => postIdKey(g2.rep) === store.getState().inspectedKey);
    refreshInspectorTagFields(fresh);
    await Promise.all(
      writes.map(async ({ rec, next, image }) => {
        try {
          applyTagWrite(rec, next, await postsUpdateTags(image, next));
        } catch {
          /* 他の項目の保存は続ける */
        }
      }),
    );
  }

  // タグの変更はどれも、パネルを開いたときに捕まえたグループではなく「今の」
  // グループから始めなければならない: renderPosts は変更のたびに view の
  // グループを作り直すので、捕まえたグループのレコードは1回編集が入った
  // 瞬間に古くなる。古いタグから計算した2回目の編集は誤った集合を書き込む＝
  // その間にタグが増えていたカードからタグを1つ外そうとすると、古い `prev`
  // には新しいタグが入っていないので、両方とも落ちてしまう。
  const freshGroup = (g: HologramPostGroup) => deps.getViewGroups().find((gg) => postIdKey(gg.rep) === store.getState().inspectedKey) || g;

  async function addInspectorTag(g: HologramPostGroup, tag: string) {
    const _adding = !(freshGroup(g).rep.tags || []).includes(tag);
    await applyInspectorTagChange(freshGroup(g), (prev) => (prev.includes(tag) ? prev : [...prev, tag]));
  }
  async function removeInspectorTag(g: HologramPostGroup, tag: string) {
    await applyInspectorTagChange(freshGroup(g), (prev) => prev.filter((t) => t !== tag));
  }

  // キャラクタータグが、このキャラクターがこれまで一緒に見られたどの Work とも
  // 異なる Work を持つカードに加わったとき、それは別作品の同名キャラクターの
  // 可能性が高い。danbooru 式の自由記述による区別「キャラクター（作品）」を
  // 提案する。決定的で、確認ダイアログ越しで、履歴が無いうちは沈黙する
  // （データが薄いうちは黙っている）。

  // #180: quote／repost された、または返信先の投稿。保存済み
  // サイドカーのサブレコードから直接組み立てた埋め込みカードとして描画する
  // （ライブ取得は一切しない＝v1 はメタデータのみに留まる）。「quote カード」
  // 1つではなく2つの独立したスロットにしている＝投稿は何かを quote しつつ
  // 同時に reply-to も持ちうるため。フィールドの写像自体は
  // records.ts の quotedCardModelOf にある。保存済みの引用先へ移動する機能をここで追加する。
  function quotedCardOf(sub: any, kind: 'quote' | 'reply'): HologramQuotedCardModel | null {
    const base = quotedCardModelOf(sub, kind, deps.t);
    if (!base) return null;
    const url: string | null = sub.url || null;
    if (!url) return base;
    // 同一投稿の identity 判定: このパーマリンは独立したレコードとしても
    // 保存されているか？（#180 への 2026-07-27 の設計コメント）＝postKeyOf は
    // アプリ内の重複検知の経路がすでにすべて共有している唯一の URL→identity
    // 正規化（records.ts）なので、quote とその独立保存済みの対象は、「何を
    // もって同じ投稿とするか」についてグリッド自身のグルーピングと一致する。
    const key = postKeyOf(url);
    const savedRec = deps.getAllPosts().find((q) => postKeyOf(q.url) === key);
    const files = kind === 'quote' ? (sub.media || []).filter((m: any) => m.file) : [];
    const localRec = { ...sub, captureId: sub.captureId || url, tags: [], tagIds: [], media: files } as HologramPost;
    return {
      ...base,
      onOpen: () => jumpToQuotedPost(savedRec, url),
      media: files.map((m: any, index: number) => ({
        src: deps.fileSrc(m.posterFile || m.file),
        alt: m.alt || '',
        video: !m.posterFile && (m.type === 'video' || m.type === 'gif'),
        onOpen: () => deps.openImageEntry({ key: sub.captureId || url, rep: localRec, records: [localRec], files: files.map((other: any) => other.file) }, index),
      })),
    };
  }

  // #179: 投稿のアンケート＝インスペクタが見せる形。設計として読み取り専用――
  // 選択肢は結果であり、決して操作対象ではない（PollCard.tsx 参照）。
  //
  // パーセンテージの分母は、保存された選択肢の得票数の合計。
  function pollCardOf(poll: any): HologramPollCardModel | null {
    const choices = poll && Array.isArray(poll.choices) ? poll.choices.filter((c: any) => c && typeof c.text === 'string') : [];
    if (!choices.length) return null;
    const counted = choices.filter((c: any) => typeof c.votes === 'number');
    const totalVotes = counted.reduce((s: number, c: any) => s + c.votes, 0);
    const denom = totalVotes;
    const meta: string[] = [];
    if (poll.multiple) meta.push(deps.t('pollMultiple'));
    if (counted.length) meta.push(deps.t('pollVotes', { count: totalVotes, formattedCount: formatCount(totalVotes) }));
    const deadline = localeDateTime(poll.expiresAt);
    if (deadline) meta.push(deps.t('pollDeadline', { date: deadline }));
    return {
      label: deps.t('pollCardLabel'),
      choices: choices.map((c: any) => {
        const votes: number | null = typeof c.votes === 'number' ? c.votes : null;
        const percent = votes != null && denom > 0 ? Math.round((votes / denom) * 1000) / 10 : null;
        return {
          text: c.text,
          votesLabel: votes != null ? deps.t('pollVotes', { count: votes, formattedCount: formatCount(votes) }) : '',
          percentLabel: percent != null ? `${percent}%` : '',
          percent,
        };
      }),
      metaLabel: meta.join('  ・  '),
    };
  }

  // #181: 投稿の OGP プレビューカード（あれば）。thumbSrc は投稿自身のサムネイル
  // が使うのと同じ asset:// ヘルパー（deps.fileSrc）でダウンロード済みファイルを
  // 読む＝カード自身の元のリモート URL は決して使わない（#181 の範囲: サムネイル
  // は保存時にダウンロード済み。#180 の quote 先投稿カードが従う「表示時にライブ
  // ネットワーク取得はしない」規則と同じ）。onOpen は常に既存の https 限定の
  // 外部オープン経路を通る: quote／renote された投稿（#180 の
  // jumpToQuotedPost）と違い、リンクカードはアプリ内でナビゲートすべき別の
  // 「保存済みレコード」を決して指さない＝このライブラリが独立したエントリを
  // 持たない外部ページを指しているだけ。
  function linkCardOf(card: any): HologramLinkCardModel | null {
    if (!card || !card.url) return null;
    return {
      label: deps.t('linkCardLabel'),
      title: card.title || card.url,
      description: card.description || '',
      domainLabel: hostOf(card.url) || '',
      thumbSrc: card.thumbnailFile ? deps.fileSrc(card.thumbnailFile) : null,
      onOpen: () => hologramIpc.openExternal(card.url),
    };
  }

  // クリック遷移（#180 への 2026-07-27 の設計コメント）: 独立保存済みのコピーは
  // アプリ内でナビゲートし、何も保存されていなければサブレコード自身の URL を
  // 外部で開く（既存の https 限定の外部オープン経路）。アプリ内の経路は
  // jumpToPoster/openPosterPosts がすでに使っているのとまったく同じ絞り込みの
  // 手口（木をリセットし、フィルタを1つだけ追加する）＝それによって #144 の
  // 戻る／進むも新しいナビ履歴コードなしでついてくる理由は deps インターフェース
  // のコメントを参照。
  function jumpToQuotedPost(rec: HologramPost | undefined, url: string) {
    if (!rec) {
      hologramIpc.openExternal(url);
      return;
    }
    deps.navigateToPosts({ type: 'text', value: rec.url || url }, { replace: true });
    const g = deps.getViewGroups().find((gg) => postIdKey(gg.rep) === postIdKey(rec));
    if (g) showDetail(g);
  }

  // opts.openPanel: 「詳細」のように、パネルを明示的に要求した操作。
  // opts.focusTags: キャレットをすでにタグ欄に置いた状態でパネルを開く。カードの
  // 右クリックメニューの「タグを編集」経路＝以前は独自のポップオーバーを開いて
  // いたカードの 🏷 ボタンの後継（P2⑦）。ただのカードクリックが決してフォーカスを
  // 奪ってはいけないので、これはパネルのプロパティではなくオープンごとの指定に
  // なっている。
  //
  // これはまた、閉じたパネルを「開く」唯一の経路でもあり、この例外は #243 の
  // 規則を破るのではなくむしろ証明している: カードを選ぶことはパネルへの要求
  // ではないが、パネルの中にしか存在しないコマンドを呼び出すことはそう。これが
  // 無いと、閉じたパネルへの「タグを編集」は黙って何もしなかった＝利用者に見え
  // ない画面を埋めていただけだった。Eagle も Lightroom も同じ理由で自分たちの
  // インスペクターを表に出す。
  function showDetail(g: HologramPostGroup, opts?: { openPanel?: boolean; focusTags?: boolean; showReplies?: boolean }) {
    if (!g) return;
    if (opts?.showReplies) revealPanels();
    if (opts?.openPanel || opts?.focusTags || opts?.showReplies) panelSetOpen(true);
    if (store.getState().activeImageTab) {
      if (store.getState().inspectedKey !== postIdKey(g.rep)) deps.openImageEntry(g);
    } else if (store.getState().browseMode === 'trash') {
      selectTrashCard(postIdKey(g.rep), {});
    } else {
      selection.selectOnly(deps.getViewGroups().indexOf(g), postIdKey(g.rep));
    }
    requestDetailOptions(opts);
  }

  function buildPostModel(g: HologramPostGroup, opts: DetailOptions = {}): Omit<HologramInspectorModel, 'openId'> {
    const p = g.rep;
    const postUrl = p.url;
    const engagementItems = [
      p.likes != null ? { kind: 'likes', value: formatCount(p.likes), label: deps.t('detailLikes') } : null,
      p.reposts != null ? { kind: 'reposts', value: formatCount(p.reposts), label: deps.t('detailReposts') } : null,
      p.replies != null ? { kind: 'replies', value: formatCount(p.replies), label: deps.t('detailReplies') } : null,
      p.bookmarks != null ? { kind: 'bookmarks', value: formatCount(p.bookmarks), label: deps.t('detailBookmarks') } : null,
      p.views != null ? { kind: 'views', value: formatCount(p.views), label: deps.t('detailViews') } : null,
    ].filter(Boolean);
    const userTags = Array.isArray(p.tags) ? p.tags : [];
    // 投稿者の行はローカル保存済みのアバター（asset://）があればそれを運ぶ＝
    // インスペクタは「ラベル: 値」のリズムを保ちつつ、名前に顔を添える。
    const avatarSrc = p.avatarFile ? deps.fileSrc(p.avatarFile) : null;
    // 投稿者はポスタービューには SNS の投稿についてしか存在しない（buildUsers は
    // url を持たない移行データを飛ばす）。存在するときは、名前＋アバターがそこへ
    // リンクする（双方向ナビ: posts ↔ posters）。
    const jumpUser = p.url ? deps.buildUsers().find((u) => u.key === userKey(p)) : null;
    const posterProfileHref = posterProfileUrl({ platform: p.platform, screenName: p.screenName });
    // #676: 見出しは名前（title）であって本文ではない＝title を持たない SNS の
    // 投稿は、投稿テキストを借りるのではなく見出しを一切表示しない（すぐ下の
    // 投稿者行がすでに identity を運んでいるので、代わりに出すものが無い）。
    // 本文は見出しになりすますのではなく、自分の専用セクション（下の bodyText）
    // を持つ。
    const heading = p.title || '';
    const bodyText = displayPostText(p);
    // #180: 投稿自身の bodyText の直下に描画される（Inspector.tsx）＝配信元の
    // プラットフォームで quote されたツイート／renote のカードが座るのと同じ
    // 入れ子。
    const quotedCards = [quotedCardOf(p.quotedPost, 'quote'), quotedCardOf(p.replyToPost, 'reply')].filter((c): c is HologramQuotedCardModel => !!c);
    // #179: それらのすぐ後、それでも投稿自身のテキストの直下に描画される＝
    // アンケートを持つどのプラットフォームでも投稿テキストがそのままアンケートの
    // 問いなので、その間には何も入ってはいけない。
    const pollCard = pollCardOf(p.poll);
    // #181: quotedCards/pollCard と並んで、投稿自身のテキストの直下に描画される
    // ＝配信元のプラットフォームでリンク共有の埋め込みが占めるのと同じ枠
    // （実際には quote／poll とは相互排他的だが、ここでは強制していない）。
    const linkCard = linkCardOf(p.linkCard);
    const thumbFile = artworkFile(p) || g.records.map(artworkFile).find(Boolean) || '';
    const previewSources = new Set<string>();
    const previewOffset = imageEntrySelection(g).idx;
    const previews = makeGallery({ fileSrc: (file) => file })
      .buildGroupGalleryItems(g)
      .map((item, index) => {
        const record = g.records.find((r) => r.captureId === item.postId);
        const media = record?.media?.find((m) => m.file === item.src);
        const poster = media?.posterFile || item.poster;
        return { src: deps.fileSrc(poster || item.src, 480), video: item.video && !poster, onClick: () => deps.openImageEntry(g, previewOffset + index) };
      })
      .filter((item) => {
        if (previewSources.has(item.src)) return false;
        previewSources.add(item.src);
        return true;
      });
    return {
      kind: 'post',
      showReplies: opts?.showReplies,
      replyThread: replyPostsOf(p).map((group) => ({
        key: group.key,
        current: group.records.some((r) => r.captureId === p.captureId),
        text: displayPostText(group.rep),
        author: group.rep.displayName || group.rep.screenName || '',
        date: group.rep.date ? localeDateTime(group.rep.date) : '',
        thumbSrc: artworkFile(group.rep) ? deps.fileSrc(artworkFile(group.rep), 480) : null,
        onClick: () => showDetail(group, { showReplies: true }),
      })),
      focusTags: !!(opts && opts.focusTags),
      heading,
      bodyText,
      thumbSrc: thumbFile ? deps.fileSrc(thumbFile, 480) : null,
      previews,
      onThumbClick: thumbFile ? () => deps.openImageEntry(g) : null,
      quotedCards,
      pollCard: pollCard || undefined,
      linkCard: linkCard || undefined,
      platformLabel: p.platform ? deps.platformName(p.platform) : '',
      urlLabel: p.url || '',
      avatarSrc,
      authorName: p.displayName || '',
      jumpable: !!jumpUser,
      followersLabel: p.followers != null ? formatCount(p.followers) : '',
      followingLabel: p.following != null ? formatCount(p.following) : '',
      joinedLabel: localeDate(p.authorCreatedAt),
      engagementItems,
      localViewCountLabel: formatCount(Number(p.localViewCount) || 0),
      postedLabel: localeDateTime(p.date),
      savedLabel: localeDateTime(p.capturedAt),
      imagesLabel: g.files.length > 1 ? deps.t('imagesCount', { count: g.files.length }) : '',
      imageOfLabel: p.imageIndex && p.imageCount ? deps.t('imageOf', { index: p.imageIndex, total: p.imageCount }) : '',
      // pixiv のシリーズ所属（#188）。seriesTitle/seriesOrder はモデルの中で
      // 独立したフィールド（ここで1つの文に組み立てたりしない）＝順序が何らかの
      // 理由で null になって返ってきたシリーズでも、名前だけは表示され続ける。
      seriesLabel: p.seriesTitle || '',
      seriesOrderLabel: p.seriesOrder != null ? String(p.seriesOrder) : '',
      tags: userTags,
      classificationPostIds: g.records.map((record) => record.captureId),
      hashtags: [...new Set(p.hashtags || [])],
      onHashtagClick: (tag: string) => deps.navigateToPosts({ type: 'hashtag', value: tag }),
      // インラインタグ編集（P2⑦）: ピッカー自身のデータはインスペクタのモデルに乗る。
      ...deps.inspectorTagPickerData(userTags, g.records, 'post'),
      tagLabels: tagLabels(),
      onTagAdd: (tag: string) => addInspectorTag(g, tag),
      onTagRemove: (tag: string) => removeInspectorTag(g, tag),
      labels: {
        platform: deps.t('detailPlatform'),
        author: deps.t('detailAuthor'),
        followers: deps.t('detailFollowers'),
        following: deps.t('detailFollowing'),
        joined: deps.t('detailJoined'),
        engagement: deps.t('detailEngagement'),
        localViews: deps.t('detailLocalViews'),
        posted: deps.t('detailPosted'),
        saved: deps.t('detailSaved'),
        images: deps.t('detailImages'),
        imageOf: deps.t('detailImageOf'),
        text: deps.t('detailText'),
        series: deps.t('detailSeries'),
        seriesOrder: deps.t('detailSeriesOrder'),
        tags: deps.t('detailTags'),
        tagsEmpty: deps.t('tagsEmpty'),
        editTags: deps.t('tipEditTags'),
        viewPoster: deps.t('ctxViewPoster'),
        url: deps.t('detailUrl'),
        open: deps.t('detailOpen'),
        openProfile: deps.t('detailOpenProfile'),
      },
      onOpenExternal: postUrl ? () => hologramIpc.openExternal(postUrl) : null,
      onOpenProfile: posterProfileHref ? () => hologramIpc.openExternal(posterProfileHref) : null,
      onPosterJump: jumpUser ? () => deps.jumpToPoster(p) : null,
      onTagContextMenu: (tag: string, x: number, y: number) => {
        // #810: このカード自身の tags/tagIds は並行しているので、チップは自分の
        // 実体を正確に名指しできる＝名前検索は不要で、たまたま同じ文字列を持つ
        // 別のタグを分類してしまう心配も無い。
        const i = (p.tags || []).indexOf(tag);
        const tagId = i >= 0 ? p.tagIds?.[i] : undefined;
        deps.showTagGroupMenu(
          tag,
          x,
          y,
          () => {
            const g2 = deps.getViewGroups().find((gg) => postIdKey(gg.rep) === store.getState().inspectedKey);
            if (g2) refreshInspectorTagFields(g2);
          },
          tagId ?? null,
        );
      },
    };
  }

  function handleEscDismissDetail(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (settingsIsOpen()) return;
    if (confirmGet()) return;
    if (menuGet() || kindMenuGet()) return;
    if (isAnySelectOpen()) return; // …と開いている shadcn の Select（表示ポップオーバー／フィルタエディタ）。DOM ではなく状態で追跡している
    if (deps.imageTabShowing()) {
      deps.closeTab(deps.getActiveTabId());
      return;
    }
  }

  return {
    showDetail,
    buildPostModel,
    refreshPostViewCount,
    handleEscDismissDetail,
  };
}
