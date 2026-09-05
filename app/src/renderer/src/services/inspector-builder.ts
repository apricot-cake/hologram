// post-inspector（常設の右カラムインスペクタ）のビルダー＝旧 viewer.ts の
// モノリスから抽出。post-grid-builder.ts / poster-grid-builder.ts を鏡写しに
// している: 開閉の外枠、常に生きたインラインタグエディタ（追加／トグル／
// ソースタグの取り込み＋同名キャラクターの同名異体チェック）、パネルに表示する
// グループ解体／再グループ化ボタン、Esc／外側クリックでの解除ガードは全部
// ここへ移した。inspector.ts（React コンポーネントへの open/refresh/close/get/
// subscribe のブリッジ）は変更しない＝このモジュールはその2つの利用側の
// 一方（もう一方は Inspector.tsx）。
// 'inspectedKey' は横断的な状態（ポスターカードのクリック、undo、閲覧モードの
// 切り替えもこれを読み書きする）なので、ストアに置き、それらの読み手はすべて
// ストアへ直接アクセスする＝getter/setter の deps 対は作らない。
import { hostOf, userKey } from './query.ts';
import { posterProfileUrl } from './profile-url.ts';
import { formatCount, localeDate, localeDateTime } from './format.ts';
import { open as inspectorOpen, refresh as inspectorRefresh, close as inspectorClose } from './inspector.ts';
import { isOpen as panelIsOpen, setOpen as panelSetOpen, subscribe as panelSubscribe } from './inspector-panel.ts';
import { get as confirmGet, open as confirmOpen } from './confirm.ts';
import { get as kindMenuGet } from './kind-menu.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { get as menuGet } from './menu.ts';
import { isAnySelectOpen } from './open-select-registry.ts';
import { subscribe as subscribePostsData } from './posts-data.ts';
import { postIdKey, postKeyOf, persistManualGroups, persistUngrouped, quotedCardModelOf } from './records.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { store } from './store.ts';
import { sameTags, setTagKind as tagsSetTagKind } from './tags.ts';
import { applyTagWrite, updateTags as postsUpdateTags } from './posts.ts';
import { hologramIpc } from './ipc.ts';
import type { UndoChange } from './undo.ts';

export interface InspectorBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  fileSrc(file: string, w?: number): string;
  showToast(msg: unknown): void;
  showKindMenu(tag: string, x: number, y: number, onChange: () => void, entityId?: number | null): void;
  buildUsers(): HologramUserAgg[];
  // #23 St1（名前マージ）: posterKey をそのグループの正準（プライマリ）キーへ
  // 畳み込む＝投稿者がマージされていなければ恒等写像。buildUsers() の行は
  // すでにプライマリでキー付けされているので、生の userKey(p) は u.key と
  // 比較する前に必ずこれを通す必要がある。
  resolve(key: string): string;
  // #810: レコードが実体を指しているならその実体で、タグがまだ利用者が入力した
  // ただの文字列のままならその名前で（maybeDistinguishHomonym を参照）。
  tagKindOf(tagId: number | null | undefined): string | null | undefined;
  tagKindOfName(tag: string): string | null | undefined;
  worksCooccurringWith(tag: string, exclude: Set<string>): Set<string>;
  jumpToPoster(post: HologramPost): void;
  // このグループをクイックビューのライトボックスで覗く（#143 の保留項目3）＝
  // インスペクタのプレビューサムネイルはその2つの入り口の一方（もう一方はカード上の
  // Space キー）。
  openQuickView(g: HologramPostGroup): void;
  pushUndo(changes: readonly UndoChange[]): (() => void) | null;
  inspectorTagPickerData(tags: string[], recordsForSource: any[], kind: string): any;
  getViewGroups(): HologramPostGroup[];
  getAllPosts(): HologramPost[];
  getPostById(id: string): HologramPost | undefined;
  getUngrouped(): Set<string>;
  getManualGroups(): string[][];
  markPostsMutated(): void;
  renderPosts(keepLimit?: boolean): void;
  keepCurrentVisible(): void;
  getActiveTabId(): string | null;
  closeTab(id: string | null | undefined): void;
  // imageTabShowing は viewer.ts の `let`（image-tab.ts の利用側）＝値がモジュールの
  // 生存期間の中で変わるので getter にしている。
  imageTabShowing(): boolean;
  // #180: quote／reply-to カードのクリック遷移＝「保存済みの独立レコードへ移動する」
  // は、新しいナビゲーション機構ではなく、jumpToPoster/openPosterPosts がすでに
  // 使っているのとまったく同じ絞り込みの手口（postQBResetTree ＋ addFilter を
  // 1回）で実装している。クエリ木自身の 'text' の葉（すでに postKeyOf で貼り
  // 付けたパーマリンに一致する＝query.ts の urlHit 参照）を再利用しているので、
  // 結果として得られる view と新しい showDetail は、既存の「描画のたびに push
  // する」ナビ履歴の配線（tabs-builder.ts の syncTitleAndPersist）にも自然に
  // 乗る。そのため戻る／進む（#144）はここに新しいコードを足さなくても動く。
  postQBResetTree(): void;
  addFilter(filter: { type: string; [k: string]: any }): void;
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
      adoptSource: deps.t('editAdoptSource'),
      removeTag: deps.t('tagRemove'),
    };
  }
  // === インスペクタ: 常設の右カラム ===
  //
  // 表示するかどうかは今では利用者のもの（#243）なので、ここからの `hidden` の
  // 突つきではなく inspector-panel ストアに置く。閉じるとはストアに尋ねること。
  // 表示状態の変化と「同時に」起きるべきことはすべて下の subscriber が行うので、
  // シェルのトグルとパネル自身の × は同じ結果を生む。
  //
  // これは永続化された設定＝「このパネルは要らない」、再起動をまたいで残る。
  // それを言えるのは2つだけ: シェルのトグルとパネル自身の ×。docked された
  // カラムが画面から消える方法はこの2つしかない。
  function closeDetail() {
    panelSetOpen(false);
  }

  // パネルを空にすることは、閉じることと同じ動作ではない。「今は何も検査
  // していない」（背景クリック、#242）は、カラムをそのプレースホルダの上に
  // 立たせたままにする＝ここで永続化された設定を反転させると、次のカードクリック
  // が閉じたパネルに着地してしまい、それこそ #243 がトグル探しをやめさせるために
  // 存在する理由そのもの。
  function dismissDetail() {
    inspectorClose();
    store.setState({ inspectedKey: null });
  }

  // === 検査対象は存在し続けなければならない（#633） ===
  //
  // パネルの中身はスナップショット: showDetail() はグループを一度だけ読み、
  // 完成したモデルを inspector.ts へ渡す。その下のライブラリは生きているので、
  // 存在しなくなった対象を放置すると、パネルはもう無いレコードについて答え続ける
  // ことになり、しかもそのインラインタグエディタはそれに書き込み続けてしまう。
  // image view はこれを可視化した＝そのステージ自体が生きている（
  // services/image-tab.ts が notify のたびにライブラリに照らしてグループを
  // 解決する）ので、画像は「ライブラリに無い」に落ちる一方、隣のカラムは
  // その投稿を表示し続けていた。
  //
  // 対象が消えうるあらゆる経路について、問いを発する場所を1つだけにしている＝
  // #617 が「パネルが画面上にあるか」（isVisible）に対して行い、#619 が
  // 「image view が表示中か」（isActive）に対して行ったのと同じ動き。これが
  // 無かったころは、削除の経路ごとにそれぞれ自力で覚えておく必要があった:
  // カードメニューの削除は覚えていたが、フローティングバーの一括削除は覚えて
  // いなかった。ライブラリの一掃も、ZIP インポートの Replace（重複モード）も、
  // レコードを落としうる他の何もかもがそうだった。興味の対象は削除ではなく
  // 「消失」であり、posts-data.ts がライブラリがそれを告知する場所
  // （markPostsMutated がすでにあらゆる変更が通る唯一のゲート）。
  //
  // 着地先は「この投稿は削除されました」という新しいパネル状態ではなく
  // dismissDetail(): インスペクタは選択「の」詳細として定義されている
  // （#143/#244）ので、対象が消えれば選択も無く、それをすでに意味している
  // プレースホルダこそ正直な答え。「削除済み」という2つ目の空状態は、
  // 隣のカラムがすでに言っていることをもう一度言うだけになる。
  function inspectedSubjectExists(key: string): boolean {
    // poster のキーは集計側自身のもの（poster-grid-builder が 'poster:' + u.key
    // として刻む）＝投稿者はその投稿のどれかが存在する限りちょうど存在する。
    // それを再計算するのが buildUsers（ライブラリの世代の裏でキャッシュされて
    // いるので、すでにそれを無効化した notify の上でこれを呼んでも余分な
    // コストは無い）。
    if (key.indexOf('poster:') === 0) {
      // #23 St1: 保存されたキーはインスペクタを開いた「時点」でのプライマリ＝
      // そのグループへの後の setPrimary()／unlink() は、今ではプライマリでなく
      // なったメンバーをキーが指したままにしうるが、resolve() はそれでも見つける。
      const uk = deps.resolve(key.slice('poster:'.length));
      return deps.buildUsers().some((u) => u.key === uk);
    }
    // postIdKey は保存済みのどのレコードについても captureId そのものなので、
    // マップ検索が O(1) で答える。走査に至るのは url|capturedAt フォールバック
    // キーのときと、本当に消えてしまったレコードのとき（削除1回につき1度、
    // 配列の作り直しと同時）だけ。
    if (deps.getPostById(key)) return true;
    return deps.getAllPosts().some((p) => postIdKey(p) === key);
  }
  subscribePostsData(() => {
    const key = store.getState().inspectedKey;
    if (key == null || inspectedSubjectExists(key)) return;
    dismissDetail();
  });

  // パネルの × は設定を保存する。docked されたカラムには画面から出る他の方法が
  // 無いため（#975 でそれが唯一の形になった）。以前は分岐していた: #259 の
  // 狭幅オーバーレイでは × は Esc や外側クリックと並んでいて、どちらも保存せずに
  // 解除していた。3つのうち一番わかりやすいものにパネルを永久に無効化させて
  // しまうのは、dismissDetail のコメントが説明している罠だった＝2026-07-27 の
  // 利用報告で、狭いウィンドウでの1回の × がカードクリックによるインスペクタの
  // オープンを完全に止めてしまったことがあった。一時的な形が無くなった今、
  // 分岐にも2つの解除経路にも対象は無い。

  // 閉じたパネルは中身を保持しない: 再度開くのはプレースホルダから（#244）、
  // 検査中カードのリングもそれを説明するパネルより長生きはできない。サイズの
  // 追跡はここで突つく必要が無い＝表示ポップオーバーは開くときに生きたグリッド幅
  // から計算する。
  //
  // 表示状態に連動するグリッドの外枠は、以前はここからも #postGrid への
  // classList の直接操作として切り替えていたが、今ではシェルが data 属性として
  // 描画する（P2⑦／#153 ④）ので、この subscriber には自分が持つ状態だけが残る。
  panelSubscribe(() => {
    if (panelIsOpen()) return;
    inspectorClose();
    store.setState({ inspectedKey: null }); // グリッド／ポスターのセルは（hologramStore の subscribe で）自分のリングをリアクティブにクリアする
  });
  function persistManual() {
    persistManualGroups(deps.getManualGroups());
  }
  // post key を自動グルーピングから外す（または戻す）＝ungrouped.json に永続化する。
  function setGroupKey(key: string, ungroup: boolean) {
    if (!key) return;
    deps.keepCurrentVisible(); // 「複数画像のみ」のようなフィルタから外れても即座には消えない
    const ungrouped = deps.getUngrouped();
    if (ungroup) ungrouped.add(key);
    else ungrouped.delete(key);
    persistUngrouped(ungrouped);
    dismissDetail(); // ここで検査中のグループは存在しなくなる＝それは「パネルを閉じる」ではない
    deps.renderPosts(true);
    if (ungroup) deps.showToast(deps.t('ungroupDone'));
  }
  function ungroupManual(idx: number) {
    const manualGroups = deps.getManualGroups();
    if (!(idx >= 0 && idx < manualGroups.length)) return;
    deps.keepCurrentVisible();
    manualGroups.splice(idx, 1);
    persistManual();
    dismissDetail(); // 上と同様＝再グループ化で失うのは対象であってパネルではない
    deps.renderPosts(true);
    deps.showToast(deps.t('ungroupDone'));
  }
  // --- インスペクタのタグ変更（P2⑦: 編集はパネル自身のインラインフィールドで行う） ---
  // 正本はレコードの実タグ。変更はそれぞれ即座に保存し、パネルのタグ
  // フィールドだけを更新する（フル再オープンではない＝画像／メタ情報が
  // ちらつかず、フィールドがフォーカスを保つ）。

  function refreshInspectorTagFields(g: HologramPostGroup | null | undefined) {
    if (!g) return;
    const tags = Array.isArray(g.rep.tags) ? g.rep.tags : [];
    const userSet = new Set(tags);
    const srcTagsView = (Array.isArray(g.rep.hashtags) ? g.rep.hashtags : []).filter((h: string) => !userSet.has(h));
    // ピッカーのデータは今のタグから導出される（共起の階層、まだ取り込まれて
    // いないソースタグがどれか）ので、タグと一緒に運ばなければならない＝
    // `tags` だけを動かす更新は、提案の内容を前の状態のまま残してしまう。
    inspectorRefresh({ tags, srcTagsView, ...deps.inspectorTagPickerData(tags, g.records, 'post') });
  }

  // 閲覧回数の加算は画像ビューを描いた直後に非同期で返る。今検査している投稿自身なら、
  // 入力中のタグやメモを載せ直さず、この名前–値行だけを最新値へ差し替える。
  function refreshPostViewCount(postId: string, count: number) {
    if (store.getState().inspectedKey !== postId) return;
    inspectorRefresh({ localViewCountLabel: formatCount(count) });
  }

  // 検査中グループの全レコードにタグの変更を適用し、即座に永続化し、undo を
  // 記録し、グリッド＋インスペクタのタグフィールドを更新する（フル showDetail
  // ではない＝画像／メタ情報がちらつかず、入力欄がフォーカスを保つ）。
  async function applyInspectorTagChange(g: HologramPostGroup | null | undefined, mutate: (prev: string[]) => string[] | null | undefined) {
    if (!g) return;
    const recs = g.records && g.records.length ? g.records : [g.rep];
    deps.keepCurrentVisible(); // タグを外すと、有効なタグフィルタに一致しなくなることがある
    const changes: UndoChange[] = [];
    for (const r of recs) {
      const prev: string[] = (r.tags || []).slice();
      const next = mutate(prev.slice());
      if (!next || sameTags(prev, next)) continue;
      let res: Awaited<ReturnType<typeof postsUpdateTags>> | null = null;
      try {
        res = await postsUpdateTags(r.image || r.video, next);
      } catch {
        /* このまま続ける */
      }
      const rec = deps.getPostById(r.captureId); // O(1) の検索。allPosts は同じレコード参照を共有している
      if (rec) applyTagWrite(rec, next, res);
      // 記録する変更は2つのリストの差分であって、リストそのものではない（#235）。
      changes.push({
        kind: 'post-tags',
        target: r.captureId,
        image: r.image || r.video,
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
  }

  // #36: インスペクタのメモ用テキストエリア（blur／デバウンスでの確定＝
  // Inspector.tsx の MemoSection がタイミングを持ち、これはすでに確定した1つの
  // 値を適用するだけ）。タグ編集と同様にグループ全体に効く＝レコードごとでは
  // ない: グループは1度だけ表示される同じ内容（重複／同胞）なので、それに
  // 対するメモは applyInspectorTagChange がすでに持っているのと同じ広がりで
  // 全員に適用される。タグと違って undo エントリは無い＝#36 の設計判断は
  // それを求めておらず、追加／削除されたタグ名のような自然な「差分」が
  // フリーテキストには無い。
  async function applyInspectorMemo(g: HologramPostGroup | null | undefined, memo: string) {
    if (!g) return;
    const recs = g.records && g.records.length ? g.records : [g.rep];
    let changed = false;
    for (const r of recs) {
      if ((r.memo || '') === memo) continue;
      changed = true;
      try {
        await postsUpdateTags(r.image || r.video, r.tags || [], { memo });
      } catch {
        /* このまま続ける＝applyInspectorTagChange と同じ、できる範囲での契約 */
      }
      const rec = deps.getPostById(r.captureId);
      if (rec) rec.memo = memo;
    }
    if (!changed) return;
    deps.markPostsMutated();
    deps.renderPosts(true); // メモの編集は、有効なフリーテキスト検索が何に一致するかを変えうる
  }

  // タグの変更はどれも、パネルを開いたときに捕まえたグループではなく「今の」
  // グループから始めなければならない: renderPosts は変更のたびに view の
  // グループを作り直すので、捕まえたグループのレコードは1回編集が入った
  // 瞬間に古くなる。古いタグから計算した2回目の編集は誤った集合を書き込む＝
  // その間にタグが増えていたカードからタグを1つ外そうとすると、古い `prev`
  // には新しいタグが入っていないので、両方とも落ちてしまう。
  const freshGroup = (g: HologramPostGroup) => deps.getViewGroups().find((gg) => postIdKey(gg.rep) === store.getState().inspectedKey) || g;

  // 検査中グループにタグを追加（入力／ピッカークリック）またはトグル
  // （ピッカークリックのみ）し、そのタグが新規に追加されたときだけ
  // （新しいタグだけが、語彙にすでにあるキャラクターの同名異体でありうる）
  // 同名キャラクターの同名異体をチェックする。
  async function addInspectorTag(g: HologramPostGroup, tag: string) {
    const adding = !(freshGroup(g).rep.tags || []).includes(tag);
    await applyInspectorTagChange(freshGroup(g), (prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    if (adding) maybeDistinguishHomonym(freshGroup(g), tag);
  }
  async function removeInspectorTag(g: HologramPostGroup, tag: string) {
    await applyInspectorTagChange(freshGroup(g), (prev) => prev.filter((t) => t !== tag));
  }

  // キャラクタータグが、このキャラクターがこれまで一緒に見られたどの Work とも
  // 異なる Work を持つカードに加わったとき、それは別作品の同名キャラクターの
  // 可能性が高い。danbooru 式の自由記述による区別「キャラクター（作品）」を
  // 提案する。決定的で、確認ダイアログ越しで、履歴が無いうちは沈黙する
  // （データが薄いうちは黙っている）。
  function maybeDistinguishHomonym(g: HologramPostGroup | null | undefined, addedTag: string) {
    // 名前空間（#810）: ここでのタグはすべて利用者がタグ欄に入力した文字列で、
    // これが最終的に書き込むものはまだまったく存在していない。
    if (!g || deps.tagKindOfName(addedTag) !== 'character') return;
    const cardTags: string[] = g.rep && Array.isArray(g.rep.tags) ? g.rep.tags : [];
    const worksNow = cardTags.filter((t) => deps.tagKindOfName(t) === 'work');
    if (!worksNow.length) return; // 区別の基準にできる Work の文脈が無い
    const exclude = new Set<string>((g.records || [g.rep]).map((r) => r && r.captureId).filter(Boolean));
    const past = deps.worksCooccurringWith(addedTag, exclude);
    if (!past.size) return; // 履歴が無い → 沈黙する
    if (worksNow.some((w) => past.has(w))) return; // これらの Work のどれかと一緒に見られている → 同じキャラクター
    const work = worksNow[0];
    const distinguished = `${addedTag}（${work}）`;
    if (cardTags.includes(distinguished)) return;
    // window.confirm ではなく共有の AlertDialog（confirm.ts）を使う＝ネイティブの
    // 方はブロッキング呼び出しで、これがかつて素直な `if` として書かれていた理由。
    // 代わりに改名はダイアログの onOk の継続として行う。下流の何もそれを待たない
    // （唯一の呼び出し元であるインスペクタの onTagAdd も await していない）。破壊的
    // ではない＝たった今入力したタグを改名するだけなので、OK ボタンは既定の
    // バリアントのまま。
    confirmOpen({
      message: deps.t('homonymConfirm', [addedTag, work]),
      okLabel: deps.t('promptOk'),
      cancelLabel: deps.t('confirmCancel'),
      okDestructive: false,
      onOk: async () => {
        // 先に改名し、分類は後（#810）。Kind は tags 行の id に書き込まれ、
        // 区別後の名前は、この書き込みが1行作るまでは行を持たない＝以前の順序は
        // 名前をキーにしたマップを通して kind を設定しており、それが副作用として
        // タグを作っていたが、実体をキーにしたストアではそれができない。書き込みは
        // id をレコードへ返す（services/posts.ts の applyTagWrite）ので、新しい
        // 実体は直後から名前で参照できるようになる。
        await applyInspectorTagChange(g, (prev) => prev.map((t) => (t === addedTag ? distinguished : t)));
        const fresh = freshGroup(g);
        const i = (fresh.rep.tags || []).indexOf(distinguished);
        const tagId = i >= 0 ? fresh.rep.tagIds?.[i] : undefined;
        // 区別後の文字列も引き続きキャラクター（danbooru 式）＝その Kind を記録する。
        if (tagId != null && !deps.tagKindOf(tagId)) await tagsSetTagKind(tagId, 'character');
        deps.showToast(deps.t('homonymDistinguished', [distinguished]));
      },
    });
  }

  // #180: quote／repost された、または返信先の投稿。保存済み
  // サイドカーのサブレコードから直接組み立てた埋め込みカードとして描画する
  // （ライブ取得は一切しない＝v1 はメタデータのみに留まる）。「quote カード」
  // 1つではなく2つの独立したスロットにしている＝投稿は何かを quote しつつ
  // 同時に reply-to も持ちうるため。フィールドの写像自体は
  // records.ts の quotedCardModelOf にある（#183 がタイムラインカードとこれを
  // 共有する）＝このラッパーが足すのはインスペクタだけが使う唯一のもの: quote
  // 先の投稿が独立したレコードとしても保存されていれば、そこへジャンプする機能。
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
    return { ...base, onOpen: () => jumpToQuotedPost(savedRec, url) };
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
    if (counted.length) meta.push(deps.t('pollVotes', [formatCount(totalVotes)]));
    const deadline = localeDateTime(poll.expiresAt);
    if (deadline) meta.push(deps.t('pollDeadline', [deadline]));
    return {
      label: deps.t('pollCardLabel'),
      choices: choices.map((c: any) => {
        const votes: number | null = typeof c.votes === 'number' ? c.votes : null;
        const percent = votes != null && denom > 0 ? Math.round((votes / denom) * 1000) / 10 : null;
        return {
          text: c.text,
          votesLabel: votes != null ? deps.t('pollVotes', [formatCount(votes)]) : '',
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
    deps.postQBResetTree();
    deps.addFilter({ type: 'text', value: rec.url || url });
    const g = deps.getViewGroups().find((gg) => postIdKey(gg.rep) === postIdKey(rec));
    if (g) showDetail(g);
  }

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
  function showDetail(g: HologramPostGroup, opts?: { focusTags?: boolean }) {
    if (!g) return;
    if (opts && opts.focusTags) panelSetOpen(true);
    const p = g.rep;
    const eng: string[] = [];
    if (p.likes != null) eng.push('♡ ' + formatCount(p.likes));
    if (p.reposts != null) eng.push('⇄ ' + formatCount(p.reposts));
    if (p.replies != null) eng.push('🗨︎ ' + formatCount(p.replies));
    if (p.bookmarks != null) eng.push('🔖︎ ' + formatCount(p.bookmarks));
    if (p.views != null) eng.push('👁︎ ' + formatCount(p.views));
    // ソースタグ（pixiv／SNS のハッシュタグ）は独自の行を持つ。ユーザータグは
    // パネルのインラインタグフィールドに置くので、ここでは繰り返さない。
    // すでに `tags` へ取り込み済みのソースタグは隠し、残りはクリックで取り込める。
    const userTags = Array.isArray(p.tags) ? p.tags : [];
    const userSet = new Set(userTags);
    const srcTagsView = (Array.isArray(p.hashtags) ? p.hashtags : []).filter((h: string) => !userSet.has(h));
    // 投稿者の行はローカル保存済みのアバター（asset://）があればそれを運ぶ＝
    // インスペクタは「ラベル: 値」のリズムを保ちつつ、名前に顔を添える。
    const avatarSrc = p.avatarFile ? deps.fileSrc(p.avatarFile) : null;
    // 投稿者はポスタービューには SNS の投稿についてしか存在しない（buildUsers は
    // url を持たない移行データを飛ばす）。存在するときは、名前＋アバターがそこへ
    // リンクする（双方向ナビ: posts ↔ posters）。
    // #23 St1: userKey(p) は投稿自身の生のキー。buildUsers() の行はグループの
    // プライマリでキー付けされているので、マージ済み投稿者の投稿は resolve()
    // を通してでしか自分の（畳み込まれた）行を見つけられない。
    const jumpUser = p.url ? deps.buildUsers().find((u) => u.key === deps.resolve(userKey(p))) : null;
    const posterProfileHref = posterProfileUrl({ platform: p.platform, screenName: p.screenName });
    // #676: 見出しは名前（title）であって本文ではない＝title を持たない SNS の
    // 投稿は、投稿テキストを借りるのではなく見出しを一切表示しない（すぐ下の
    // 投稿者行がすでに identity を運んでいるので、代わりに出すものが無い）。
    // 本文は見出しになりすますのではなく、自分の専用セクション（下の bodyText）
    // を持つ。
    const heading = p.title || '';
    const bodyText = (p.text || '').trim();
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
    const thumbFile = g.files[0] || '';
    // 逆画像検索には公開されている画像 URL が要る。media[].url は元の CDN URL
    // （pbs.twimg.com／cdn.bsky.app／instance media／pximg）を保持する。
    // 原本 URL が無い投稿では検索リンクを隠す。pixiv（i.pximg.net）は referer 制限があるので取得側が 403 になる
    // ことがあるが、pixiv 自体が出所そのものなので、そこでの逆検索はどのみち
    // 意味を持たない。
    const srcImageUrl = (g.records.flatMap((r) => (Array.isArray(r.media) ? r.media : [])).find((m: { url?: string }) => m && m.url) || {}).url || '';
    // このカードは（解除／再）グループ化できるか？ 手動グループには解体リンクが
    // 付き、自動グループ（同じ投稿 URL を持つ兄弟がいる）は永続化された
    // ungrouped 集合を通してトグルする。
    const gkey = postKeyOf(p.url);
    const potential = gkey ? deps.getAllPosts().filter((q) => postKeyOf(q.url) === gkey).length : 0;
    const isManual = !!(g.key && String(g.key).indexOf('manual:') === 0);
    // ✂ は URL が違うレコードから成る、リプライで合流したチェーンにも効く:
    // 代表レコードのキーを opt-out させることで、この親のところで自己リプライの
    // 合流が止まり、カードが分かれる。
    const groupBtn = isManual
      ? { icon: '🔗', label: deps.t('groupUngroupManual'), onClick: () => ungroupManual(Number.parseInt(String(g.key).split(':')[1], 10)) }
      : gkey && (potential > 1 || g.records.length > 1)
        ? deps.getUngrouped().has(gkey)
          ? { icon: '🔗', label: deps.t('groupRegroup'), onClick: () => setGroupKey(gkey, false) }
          : { icon: '✂', label: deps.t('groupUngroup'), onClick: () => setGroupKey(gkey, true) }
        : null;
    inspectorOpen({
      kind: 'post',
      focusTags: !!(opts && opts.focusTags),
      heading,
      bodyText,
      thumbSrc: thumbFile ? deps.fileSrc(thumbFile, 480) : null,
      onThumbClick: thumbFile ? () => deps.openQuickView(g) : null,
      quotedCards,
      pollCard: pollCard || undefined,
      linkCard: linkCard || undefined,
      platformLabel: (p.platform || '').toUpperCase(),
      avatarSrc,
      authorName: p.displayName || '',
      jumpable: !!jumpUser,
      screenNameLabel: p.screenName ? '@' + p.screenName : '',
      followersLabel: p.followers != null ? formatCount(p.followers) : '',
      followingLabel: p.following != null ? formatCount(p.following) : '',
      joinedLabel: localeDate(p.authorCreatedAt),
      engagementLabel: eng.join('   '),
      localViewCountLabel: formatCount(Number(p.localViewCount) || 0),
      postedLabel: localeDateTime(p.date),
      savedLabel: localeDateTime(p.capturedAt),
      updatedLabel: localeDateTime(p.updatedAt),
      imagesLabel: g.files.length > 1 ? deps.t('imagesCount', [g.files.length]) : '',
      imageOfLabel: p.imageIndex && p.imageCount ? deps.t('imageOf', [p.imageIndex, p.imageCount]) : '',
      // pixiv のシリーズ所属（#188）。seriesTitle/seriesOrder はモデルの中で
      // 独立したフィールド（ここで1つの文に組み立てたりしない）＝順序が何らかの
      // 理由で null になって返ってきたシリーズでも、名前だけは表示され続ける。
      seriesLabel: p.seriesTitle || '',
      seriesOrderLabel: p.seriesOrder != null ? String(p.seriesOrder) : '',
      tags: userTags,
      srcTagsView,
      // インラインタグ編集（P2⑦）: ピッカー自身のデータはインスペクタのモデルに乗る。
      ...deps.inspectorTagPickerData(userTags, g.records, 'post'),
      tagLabels: tagLabels(),
      onTagAdd: (tag: string) => addInspectorTag(g, tag),
      onTagRemove: (tag: string) => removeInspectorTag(g, tag),
      // #36: フリーテキストのメモ。上のタグと同様にその場で編集できる
      // （Inspector.tsx の MemoSection）。設計としてカード面には出さない
      // （#36 の決定コメント）。
      memo: p.memo || '',
      onMemoChange: (text: string) => applyInspectorMemo(g, text),
      groupBtn,
      labels: {
        platform: deps.t('detailPlatform'),
        author: deps.t('detailAuthor'),
        user: deps.t('detailUser'),
        followers: deps.t('detailFollowers'),
        following: deps.t('detailFollowing'),
        joined: deps.t('detailJoined'),
        engagement: deps.t('detailEngagement'),
        localViews: deps.t('detailLocalViews'),
        posted: deps.t('detailPosted'),
        saved: deps.t('detailSaved'),
        updated: deps.t('detailUpdated'),
        images: deps.t('detailImages'),
        imageOf: deps.t('detailImageOf'),
        text: deps.t('detailText'),
        series: deps.t('detailSeries'),
        seriesOrder: deps.t('detailSeriesOrder'),
        tags: deps.t('detailTags'),
        tagsEmpty: deps.t('tagsEmpty'),
        editTags: deps.t('tipEditTags'),
        memo: deps.t('detailMemo'),
        memoPlaceholder: deps.t('memoPlaceholder'),
        sourceTags: deps.t('detailSourceTags'),
        viewPoster: deps.t('ctxViewPoster'),
        open: deps.t('detailOpen'),
        openProfile: deps.t('detailOpenProfile'),
        sauce: deps.t('detailSauce'),
        ascii: deps.t('detailAscii'),
      },
      onClose: closeDetail,
      onOpenExternal: p.url ? () => hologramIpc.openExternal(p.url) : null,
      onOpenProfile: posterProfileHref ? () => hologramIpc.openExternal(posterProfileHref) : null,
      onSauce: srcImageUrl ? () => hologramIpc.openExternal('https://saucenao.com/search.php?url=' + encodeURIComponent(srcImageUrl)) : null,
      onAscii: srcImageUrl ? () => hologramIpc.openExternal('https://ascii2d.net/search/url/' + encodeURIComponent(srcImageUrl)) : null,
      onPosterJump: jumpUser ? () => deps.jumpToPoster(p) : null,
      onTagContextMenu: (tag: string, x: number, y: number) => {
        // #810: このカード自身の tags/tagIds は並行しているので、チップは自分の
        // 実体を正確に名指しできる＝名前検索は不要で、たまたま同じ文字列を持つ
        // 別のタグを分類してしまう心配も無い。
        const i = (p.tags || []).indexOf(tag);
        const tagId = i >= 0 ? p.tagIds?.[i] : undefined;
        deps.showKindMenu(
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
    });
    // カードを選ぶとパネルは中身で満たされるが、利用者が閉じたパネルを開くこと
    // までは一切しない（#243）。表示状態に連動する外枠（data-insp-open、タイル
    // トラック）はここでは触らない＝それはパネルストアに従うのであって中身には
    // 従わない。
    //
    // 検査中のカードにリングの印を付け、中身の入れ替えを追跡できるようにする＝
    // グリッドのセルは（hologramStore の subscribe で）自分のリングをリアクティブに
    // 導出するので、ここで手動の DOM classList 操作や repaint() は要らない。
    store.setState({ inspectedKey: postIdKey(p) });
  }

  // Esc は image タブの詳細ビュー（Eagle 流）を離れるだけで、ここでは他には何もしない。
  // インスペクタには触れない: #244 は Esc の範囲を一時的な画面（クイックビュー／
  // ポップオーバー／モーダル）に絞った。常設パネルはそれを持つどの製品でも
  // Esc で解除するものではないため、#143/#242 は選択解除の手段として Esc を
  // 使わないと決めている。カラムを閉じるのはトグル、×、または #245 の一括
  // ショートカットの仕事。#259 は狭幅オーバーレイのために例外を切り出した＝
  // そこは Esc が正しく応答すべき一時的な形だったが、#975 がその形を無くしたので
  // 例外もそれと一緒に消えた。
  //
  // 依然として（app/App.tsx の DetailDismiss コンポーネントから）キャプチャ
  // フェーズで登録している＝それらのハンドラが同じ押下で自分自身を解除する前に、
  // 他に何が開いているかを確認できるようにするため。この Esc は一時的な画面が
  // 勝ち取り、何も残っていないときだけ詳細ビューが閉じる。
  function handleEscDismissDetail(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (lightboxIsOpen()) return;
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
    closeDetail,
    dismissDetail,
    showDetail,
    refreshPostViewCount,
    persistManual,
    handleEscDismissDetail,
  };
}
