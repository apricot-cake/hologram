// グリッドのセル（#618）＝保存した投稿1件を、表示の軸が指す形で描く。リスト表示側の双子は
// ListRow.tsx で、両方とも同じモデルを受け取る。そのモデルは records.ts の makeCardModel が
// プリミティブ（画像の src、整形済みの件数と日付）まで解決するので、このファイルは並べるだけ。
//
// このカードが意図して持たないものが2つある。
//
//  - ホバーで出る部品。ℹ ボタンも 🏷 ボタンも ○ の選択リングもホバーの強調も無い（案 A で
//    確定、Eagle の素の形）。カードにできることはすべて、選択（クリック／Ctrl／Shift）か
//    コンテキストメニューから届く。ホバーがするのはカードを持ち上げることだけで、これは
//    手応えであってコントロールではない。
//  - DOM の取り決め。旧いマークアップは `data-index` / `data-key` / `data-url` / `data-cap`
//    を積んでいた。グリッドのコンテナに載せた委譲リスナーが、クリックがどのグループのもの
//    だったかを探すためにそれらを読み返していたから（#153 の分類1と2）。ジェスチャは今は
//    props で、グループそのものを閉じ込めているので、それらの属性に答えるべきことはもう
//    残っていない。`data-slot` は残る。あれは「コンポーネントのどの部分か」を示す shadcn 自身
//    の印で、テストが読んでいるのもそれ。
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';
import type { DisplayShape } from '../services/display.ts';

// makeCardModel がカードごとに解決するセルのモデル＝ここで並べる欄だけ。
export interface PostCardFootDate {
  label: string;
  title?: string | null;
}
export interface PostCardModel {
  index: number;
  postKey?: string | null;
  selected?: boolean;
  inspected?: boolean;
  hasThumb?: boolean;
  imgSrc?: string | null;
  /** この形が静止画を出す代わりにその場でループ再生する、mp4 を積んだ GIF（#476）。 */
  videoSrc?: string | null;
  /** その poster の静止画。最初のフレームがデコードされるまでこれを描く。 */
  videoPoster?: string | null;
  /** 先頭のメディアが動画か gif(mp4) のとき、poster のサムネイルに ▶ バッジを重ねる（#119 St1）。 */
  videoBadge?: boolean;
  captureId?: string;
  aspRatio?: string | null;
  cropPosition?: string | null;
  eager?: boolean;
  nImg?: number;
  /** 複数画像のグループの2枚目・3枚目の画像のサムネの src＝背面のシートに乗る。 */
  stackSrcs?: string[];
  userName?: string;
  /** 本物のアバター画像（#658）＝形のアバターのスイッチが ON のとき AuthorLine が描く。 */
  avatarSrc?: string | null;
  /** avatarSrc が無いときの、代わりのアバターの頭文字。 */
  monogram?: string | null;
  /** avatarSrc が無いときの、代わりのアバターの色相。 */
  monoHue?: number | null;
  handle?: string | null;
  flags: string[];
  mediaLabel?: string | null;
  text?: string | null;
  stats: Partial<Record<string, string | number | null>>;
  footDates: { post?: PostCardFootDate | null; cap?: PostCardFootDate | null };
  tags: string[];
}

export interface PostCellProps {
  m: PostCardModel;
  shape: DisplayShape;
  /** サイズの軸の小さい方の端（#141）。セルは丸ごとサムネイルなので、その上にバッジは出さない。 */
  overview?: boolean;
  /** このセルが描くグループ＝どの動作が起きても、そのままそれへ渡し返す。 */
  group: unknown;
  actions?: HologramCardActions;
  cellRef?: Ref<HTMLDivElement>;
  /** 高さを確保しなかったセルのために、読み込んだ画像の本来の縦横比を知らせる。 */
  onAspect?: (captureId: string, aspectRatio: string) => void;
}

// 並び替えと絞り込みが焦点にした件数のグリフ。輪郭のテキスト表示
// （色付きの絵文字でも SVG でもない）。人気度は値自体が「上位 N%」と説明する。
const STAT_GLYPH = {
  likes: '♡', // いいね
  reposts: '⇄', // リポスト
  replies: '🗨︎', // 返信（テキスト表示）
  bookmarks: '🔖︎', // ブックマーク（テキスト表示）
  localViews: '👁︎', // Hologram 内の閲覧回数（テキスト表示）
  popularity: '', // SNS 内のパーセンタイル
};
const STAT_ORDER = ['likes', 'reposts', 'replies', 'bookmarks', 'localViews', 'popularity'] as const;

// 副次の日付（保存した日）の隣に置く 📷 の印。
function CdateIcon() {
  return (
    <svg className="shrink-0" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

// --- 複数画像の重なり -------------------------------------------------------
// 画像のグループは、カードそのものを複製して描く。後ろへ倒したシートが、カードの上端に沿った
// 帯から覗く。覗きはカード自身の占める矩形の内側なので、レイアウトの溝は何も負担しないし、
// セルがどんな大きさでも覗きは残る。幾何は形ごとに違う。s1 が最も奥のシートで、帯を一番上から
// 埋めるので、×2 のグループは空の帯を作らず1段のきれいな段差として読める。
function deckGeometry(shape: DisplayShape) {
  if (shape.list) return { deck: 10, s1: 'scale(0.997, 0.8)', s2: 'translateY(5px) scale(0.999, 0.9)' };
  if (shape.square) return { deck: 13, s1: 'scale(0.92)', s2: 'translateY(6px) scale(0.955)' };
  return { deck: 15, s1: 'scale(0.93)', s2: 'translateY(7px) scale(0.965)' };
}

/**
 * 背面のシートと、前面の顔の縁を引き直したもの。どちらのセルもこれを描くので、重なりはどの形
 * でも同じに読める。`imgBox` はシートのサムネイルの切り出し方＝カード自身の作りを縮めたもの
 * （グリッドのセルなら画像が上、行なら画像が左）。
 */
export function StackSheets({ shape, srcs, imgBox, imgStyle }: { shape: DisplayShape; srcs: string[]; imgBox: string; imgStyle?: CSSProperties }) {
  const g = deckGeometry(shape);
  const radius = shape.list ? 'rounded-md' : 'rounded-lg';
  return (
    <>
      {srcs.map((src, k) => (
        <span key={src || k} aria-hidden="true" className={cn('pointer-events-none absolute inset-0 origin-top overflow-hidden border border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow-md)]', radius, k === 0 ? '-z-[2]' : '-z-[1]')} style={{ transform: k === 0 ? g.s1 : g.s2 }}>
          {src && (
            // data-slot="post-card-stack-thumb": これも保存した画像（複数画像のグループの
            // 2枚目・3枚目の覗き）で、<img> ではなく CSS の背景として描いているだけ。
            <span data-slot="post-card-stack-thumb" className={cn('absolute bg-center bg-cover', imgBox, radius)} style={{ backgroundImage: `url("${src}")`, ...imgStyle }}>
              {/* 奥行きのための暗さは画像にだけ掛ける。ほぼ白の線画を段違いに重ねた束は、
                  色を差さないと層として読めない。だがシートの本体まで暗くすると、行の上端を
                  横切る灰色の帯として見えてしまう。 */}
              <span className="absolute inset-0 rounded-[inherit]" style={{ background: `color-mix(in srgb, var(--text) ${k === 0 ? 15 : 8}%, transparent)` }} />
            </span>
          )}
        </span>
      ))}
      {/* 前面の顔自身の縁を、z が負のシートより上に引き直したもの（カードに掛けた
          box-shadow はシートの下に塗られる＝CSS の描画順）。帯の下端から始めるので、顔が
          重なりの上に載っているように読める。 */}
      <span aria-hidden="true" className={cn('pointer-events-none absolute right-[-1px] bottom-[-1px] left-[-1px] z-0 shadow-[0_0_0_1px_var(--border-strong),0_2px_8px_rgba(16,19,26,0.18)] dark:shadow-[0_0_0_1px_var(--border-strong),0_2px_8px_rgba(0,0,0,0.55)]', radius)} style={{ top: g.deck }} />
    </>
  );
}

/** ×N のバッジ＝重なりが「1枚より多い」と匂わせている、その正確な枚数。 */
export function CountBadge({ n, top }: { n: number; top: number }) {
  return (
    <div className="absolute left-2 z-[1] rounded bg-black/70 px-[7px] py-0.5 font-semibold text-[11px] text-white" style={{ top }}>
      {'×' + n}
    </div>
  );
}

export interface AvatarModel {
  avatarSrc?: string | null;
  monogram?: string | null;
  monoHue?: number | null;
}

/**
 * 円形のアバター。画像が無いときは GitHub や Google 風の、代わりの頭文字の円盤を出す
 * （#107）＝淡い円盤に頭文字を載せ、円盤の色は識別子のハッシュから色相だけを振る（彩度と
 * 明度はテーマごとに固定）。投稿カード・投稿者カード（#630）・AuthorLine（#658）が共有する
 * ので、アバターの無い人物はどこでも同じに見える。
 */
export function Avatar({ c, className, discClassName }: { c: AvatarModel; className?: string; discClassName?: string }) {
  return (
    <div className={cn('@container flex shrink-0 items-center justify-center overflow-hidden bg-[var(--surface-3)]', className)}>
      {c.avatarSrc ? (
        // data-slot="avatar-image": アプリ内のすべてのアバター（投稿カード、投稿者カード、
        // AuthorLine）が共有するので、セレクタ1本で全部に届く。
        <img data-slot="avatar-image" className="block size-full object-cover" src={c.avatarSrc} alt="" loading="lazy" decoding="async" />
      ) : (
        <span
          className={cn('flex items-center justify-center rounded-full font-semibold leading-none', 'bg-[hsl(var(--mono-h,220)_52%_88%)] text-[hsl(var(--mono-h,220)_42%_32%)]', 'dark:bg-[hsl(var(--mono-h,220)_26%_27%)] dark:text-[hsl(var(--mono-h,220)_50%_78%)]', discClassName)}
          style={{ '--mono-h': c.monoHue ?? undefined } as CSSProperties}
        >
          {c.monogram}
        </span>
      )}
    </div>
  );
}

/** どの形も共有する投稿者の行。任意でアバター、表示名、そして通り名の @handle。 */
export function AuthorLine({ userName, handle, avatar, className }: { userName?: string; handle?: string | null; avatar?: AvatarModel | null; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      {avatar && <Avatar c={avatar} className="size-5 rounded-full border border-[var(--border-soft)]" discClassName="size-full text-[10px]" />}
      <span className="truncate">{userName}</span>
      {handle && <span className="min-w-0 flex-1 truncate font-normal text-[11px] text-[var(--text-subtle)]">{handle}</span>}
    </div>
  );
}

/** 左にエンゲージメントの件数（意味があるときだけ）、右に投稿の日付。 */
export function MetaFoot({ m, className }: { m: PostCardModel; className?: string }) {
  const stats = STAT_ORDER.filter((k) => m.stats[k] != null);
  const fd = m.footDates;
  if (!stats.length && !fd.post && !fd.cap) return null;
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {stats.length > 0 && (
        <div data-slot="post-card-stats" className="flex gap-2.5 text-[11.5px] text-[var(--text-subtle)]">
          {stats.map((k) => (
            <span data-stat={k} className="inline-flex items-center gap-[3px]" key={k}>
              {STAT_GLYPH[k] ? STAT_GLYPH[k] + ' ' : ''}
              {m.stats[k]}
            </span>
          ))}
        </div>
      )}
      <span className="ml-auto inline-flex min-w-0 items-center gap-[7px] text-[11px] text-[var(--text-subtle)]">
        {fd.post && (
          <span data-slot="post-card-date" title={fd.post.title || undefined}>
            {fd.post.label}
          </span>
        )}
        {fd.cap && (
          <span data-slot="post-card-capdate" className="inline-flex items-center gap-0.5 opacity-80" title={fd.cap.title || undefined}>
            <CdateIcon />
            {fd.cap.label}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * サムネイル。mp4 を積んだ GIF は静止画と同じ枠に入り、そこでループする。メディアを一度も
 * ダウンロードできなかった投稿には、穴ではなく ▶ のプレースホルダを出す。自動再生が許される
 * のは `muted` があるからで（無音のものを Chromium は決して止めない）、`loop` と
 * `playsInline`、そして `controls` を付けないことが、それを本来の GIF らしく読ませる。
 * マウントされるのはスクロールで見えている窓の分だけなので、再生されるものはビューポートで
 * 頭打ちになる。
 */
export function CardThumb({ m, shape, onAspect, className, imgClassName, style: boxStyle }: { m: PostCardModel; shape: DisplayShape; onAspect?: (captureId: string, aspectRatio: string) => void; className?: string; imgClassName?: string; style?: CSSProperties }) {
  const style = m.aspRatio || m.cropPosition ? { ...(m.aspRatio ? { aspectRatio: m.aspRatio } : {}), ...(m.cropPosition ? { objectPosition: m.cropPosition } : {}) } : undefined;
  return (
    <div data-slot="post-card-thumb" className={cn('relative block leading-[0]', className)} style={boxStyle}>
      {m.videoSrc ? (
        <video data-slot="post-card-media" className={imgClassName} src={m.videoSrc} poster={m.videoPoster || undefined} style={style} autoPlay muted loop playsInline draggable={false} disablePictureInPicture />
      ) : m.imgSrc ? (
        <>
          <img
            data-slot="post-card-media"
            className={imgClassName}
            src={m.imgSrc}
            alt=""
            style={style}
            loading={m.eager ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
            onLoad={
              // 学ぶことがあるのは、高さを一切確保しなかったセルだけ（shotW/H も学習済みの
              // 縦横比も無い、原アスペクト比のグリッド）。残りはもう知っている。
              onAspect && !m.aspRatio && m.captureId && !shape.list && !shape.square
                ? (e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth && img.naturalHeight) onAspect(m.captureId as string, `${img.naturalWidth}/${img.naturalHeight}`);
                  }
                : undefined
            }
          />
          {m.videoBadge && (
            <span data-slot="post-card-play" aria-hidden="true" className="absolute right-1.5 bottom-1.5 z-[1] flex size-[22px] items-center justify-center rounded-full bg-black/70 text-[10px] text-white">
              {'▶'}
            </span>
          )}
        </>
      ) : (
        <div data-slot="post-card-media" className={cn('flex items-center justify-center bg-[var(--surface-2)] text-[30px] text-[var(--text-muted)]', imgClassName)}>
          {'▶'}
        </div>
      )}
    </div>
  );
}

// #365: プレートが本文を何行まで見せてから切り落とすか。records.ts の textPlateAspect が
// 割り当てる離散的な高さの段ごとに、区分を1つ持つ。正方形の切り抜きは自前の固定値を持つ＝
// その高さは段を丸ごと無視する（段が効くのは原アスペクト比のグリッドが確保する高さだけで、
// 正方形は aspRatio に関わらず全セルを列の幅に切り抜く）。
const PLATE_LINES: Record<string, string> = {
  '4/3': 'line-clamp-3',
  '1/1': 'line-clamp-6',
  '3/4': 'line-clamp-[10]',
  '2/3': 'line-clamp-[14]',
};

/** 俯瞰ズーム（#141）のための ¶ 風のグリフ。その大きさでは本文が読めない（このすぐ下の
 * PostCard で ×N のバッジが黙るのと同じ理由）ので、プレートは、どうせ誰にも読めない段落の
 * 代わりに素の印へ退避する。 */
function PlateGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="30%" height="30%" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M6 7h12M6 12h12M6 17h8" />
    </svg>
  );
}

/**
 * テキストだけの投稿が、サムネイルの枠にそのまま出す顔（#365）。今これが出るのは、カードに
 * 他の言い場所が無いときだけ＝「情報を表示」が OFF のとき（本文の行を抱える情報のブロックが
 * そこではまったく描かれない）と、俯瞰ズームのとき。情報が ON なら、本文は代わりにカード
 * 本体のふつうの行になる＝画像のあるカードが本文を書くのと同じ場所で、絵の額を埋めるように
 * 引き伸ばした段落にはしない（#953）。
 *
 * 引用符も吹き出しもプラットフォームごとの装いも付けない＝カードの他の部分が既に守っている
 * 「カードは1つ、プラットフォームの真似はしない」の規則と同じ。
 */
export function TextPlate({ m, shape, overview, className, style: boxStyle }: { m: PostCardModel; shape: DisplayShape; overview?: boolean; className?: string; style?: CSSProperties }) {
  const style = m.aspRatio ? { aspectRatio: m.aspRatio, ...boxStyle } : boxStyle;
  return (
    <div data-slot="post-card-plate" className={cn('flex items-center justify-center bg-[var(--surface-2)] p-3 text-[var(--text-muted)]', className)} style={style}>
      {overview ? <PlateGlyph /> : <p className={cn('w-full text-[13px] text-[var(--text)] leading-snug whitespace-pre-wrap', shape.square ? 'line-clamp-6' : (PLATE_LINES[m.aspRatio || ''] ?? 'line-clamp-6'))}>{m.text}</p>}
    </div>
  );
}

/** グリッドのモデルが持つ動作の一式を、セルのルートが展開する props に変える。 */
export function cellHandlers(actions: HologramCardActions | undefined, group: unknown) {
  if (!actions) return {};
  return {
    onClick: actions.onClick && ((e: ReactMouseEvent) => actions.onClick?.(group, e)),
    onDoubleClick: actions.onDoubleClick && ((e: ReactMouseEvent) => actions.onDoubleClick?.(group, e)),
    onAuxClick: actions.onAuxClick && ((e: ReactMouseEvent) => actions.onAuxClick?.(group, e)),
    onContextMenu: actions.onContextMenu && ((e: ReactMouseEvent) => actions.onContextMenu?.(group, e)),
    onMouseDown: actions.onMouseDown && ((e: ReactMouseEvent) => actions.onMouseDown?.(group, e)),
  };
}

/**
 * カードで共有する外装＝面、ホバーの持ち上がり、そして選択中／詳細表示中のリング。読むものだけ
 * を受け取るので、投稿者のセル（#630）は同じ6つの宣言をもう1組持つのではなく、投稿のセルと
 * 同じ外装をまとう。
 */
export function cellChrome(m: { inspected?: boolean }, grouped: boolean): string {
  return cn(
    'group relative cursor-pointer overflow-hidden border border-[var(--border-subtle)] bg-[var(--surface)] shadow-[var(--shadow-sm)]',
    'transition-[box-shadow,border-color,transform] duration-[var(--dur-hover)] ease-[var(--ease-out)]',
    // つまみ上げた状態＝影を深くしたうえで、少し浮かせて少し大きくする（Pinterest 系の
    // ギャラリーの言い回し）。z-index で隣より上に上げるので、大きくなった分が切られない。
    'hover:z-[1] hover:translate-y-[-3px] hover:scale-[1.014] hover:border-[var(--border)] hover:shadow-[var(--shadow-md)]',
    'motion-reduce:hover:transform-none',
    // グループになったカードは重なりそのもの。枠線と影はすべてシートと引き直した縁が持つ
    // ので、カードの箱自身は何も持たないところまで引き下がる。
    grouped && 'overflow-visible border-transparent bg-transparent shadow-none hover:shadow-none',
    m.inspected && 'border-[var(--accent-border)] shadow-[0_0_0_1px_var(--accent-border)]',
  );
}

/**
 * 選択のリング。カードの箱に掛ける ring/outline ではなく、オーバーレイとして描く。あの2つは
 * どちらもサムネイルの下に塗られる（カードは自前の重ね合わせコンテキストを作り、画像はその上
 * に載る）ので、リングが絵の上ではメタデータの上より細く出ていた。旧いビルドで報告された
 * ことであり、これがずっと配置された要素である理由。
 */
export function SelectionRing() {
  return <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-[6] rounded-[inherit] border-[3px] border-selected/45" />;
}

export function PostCard({ m, shape, overview, group, actions, cellRef, onAspect }: PostCellProps) {
  const grouped = (m.nImg as number) > 1;
  const g = deckGeometry(shape);
  const stack = grouped ? (m.stackSrcs ?? []) : [];
  const showBadge = grouped && !overview;
  // #953: テキストだけの投稿は、サムネイルの枠を埋めるプレートではなく、カード本体に本文を
  // 書く＝画像のあるカードが本文を書くのと同じ行。だからここではメディアの箱をまったく描かず、
  // 高さはテキストが必要とする分だけになる（残りは masonry が詰める）。プレートが戻ってくる
  // のは、情報のブロック自体が無く、本文に他の行き場が無いときだけ。
  const bodyInMeta = !m.hasThumb && shape.info;
  const info: ReactNode = shape.info && (
    // 正方形のサムネを選ぶのは均一な格子を得るためなので、その下のブロックはテキストに合わせて
    // 伸びる高さではなく、固定の高さ（INFO_BLOCK）にする。そうしないと、正方形は揃うのにその
    // 下のカードが揃わない。原アスペクト比ではどのみち何も揃わないので、そこではブロックは
    // 必要な分だけ取る。テキストだけのカードには揃える相手の正方形が無い（#953）ので、そこでも
    // 固定の高さは切ってある。格子を何も得られないまま本文を1行に切り落とすだけになるため。
    <div data-slot="post-card-meta" className={cn('relative flex min-w-0 flex-1 flex-col rounded-b-lg bg-[var(--surface)] p-3', shape.square && !bodyInMeta && 'h-24 overflow-hidden')}>
      <AuthorLine userName={m.userName} handle={m.handle} avatar={shape.avatar ? m : null} className="mb-1 font-semibold text-[13px]" />
      {(m.flags.length > 0 || m.mediaLabel) && (
        <div className="mb-[3px] flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[var(--text-muted)] leading-[1.6]">
          {m.flags.map((f) => (
            <span key={f}>{f}</span>
          ))}
          {m.mediaLabel && <span>{m.mediaLabel}</span>}
        </div>
      )}
      {/* 本文。画像のあるカードでは絵の下に置く短い抜粋だが、テキストだけのカード（#953）
          では本文こそがカードそのものなので、行数を多く取り、自身の改行も保つ＝詳細パネルが
          全文で見せるのと同じ段落。 */}
      {m.text && <div className={cn('mb-1.5 text-[13px] text-[var(--text)]', bodyInMeta ? 'line-clamp-[12] whitespace-pre-wrap leading-snug' : shape.square ? 'line-clamp-1' : 'line-clamp-3')}>{m.text}</div>}
      {/* 下端に留めてあるので、テキストの長さがまちまちなカードが並んだ行でも日付が揃う。 */}
      <MetaFoot m={m} className="mt-auto pt-1.5" />
      {m.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-[3px]">
          {m.tags.map((tag) => (
            <span key={tag} className="rounded-[10px] bg-[var(--surface-3)] px-2 py-px text-[10px] text-[var(--text-muted)]">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
  return (
    <div ref={cellRef} data-slot="post-card" data-selected={m.selected || undefined} data-inspected={m.inspected || undefined} className={cn(cellChrome(m, grouped), 'flex w-full flex-col rounded-lg')} style={grouped ? { paddingTop: g.deck } : undefined} {...cellHandlers(actions, group)}>
      {grouped && <StackSheets shape={shape} srcs={stack} imgBox={shape.square ? 'inset-0' : 'inset-x-0 top-0 bottom-[44%]'} />}
      {m.hasThumb ? (
        <CardThumb
          m={m}
          shape={shape}
          onAspect={onAspect}
          className={cn('overflow-hidden', shape.square && 'aspect-square w-full', shape.info ? 'rounded-t-lg' : 'rounded-lg')}
          // ここでは拡大のカーソルを出さない。カードのクリックは、そのカードを選んで詳細
          // パネルを開く（#143 のジェスチャの型）＝覗き見へはインスペクタ自身のサムネイルか
          // Space から届き、どちらもそのことを自分で示している。この枠が出すべきなのは、
          // セルの cursor-pointer（cellChrome）。
          imgClassName={cn('block w-full object-cover transition-transform duration-500 ease-[var(--ease-out)] group-hover:scale-[1.055] motion-reduce:transform-none', shape.square ? 'h-full max-h-none' : 'max-h-[300px]')}
        />
      ) : (
        // サムネイルが無い場合。情報のブロックが ON なら本文は既に下にあるので、この枠は
        // 何も描かない（#953）。OFF なら、プレートこそがカードそのもの。
        !bodyInMeta && <TextPlate m={m} shape={shape} overview={overview} className={cn('overflow-hidden rounded-lg', shape.square && 'aspect-square w-full')} />
      )}
      {showBadge && <CountBadge n={m.nImg as number} top={(grouped ? g.deck : 0) + 8} />}
      {info}
      {m.selected && <SelectionRing />}
    </div>
  );
}
