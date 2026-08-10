// ページ上のすべての保存経路が描画に使う、唯一のステータス画面（#44）。
//
// これは同じ対応表を手作業で保っていた4つのコピーを置き換える＝
// capture.ts の setBanner、drag.ts の setState、bulk-capture.ts のバナー、
// overlay.ts の失敗バナーは、それぞれ独立に、ある状態がどんな色・絵文
// 字・アニメーションになるかを決めていて、すでにずれが生じていた（一括
// 用のバナーは輪郭を一切着色していなかったし、失敗バナーには、ずれる相
// 手となる busy 状態自体がなかった）。#226 はまさにこれを求めていて、旧
// glass ヘルパーの上に積むのではなく #44 に統合された。
//
// バナーとドロップゾーンの間で変わるのは `variant`＝どこに座るか、どれく
// らいの大きさか。それ以外（状態の語彙、色、絵文字、入場と退場）はすべて
// 同じオブジェクトが担う。
import { ICONS, makeIcon } from './icons.ts';
import { motion, prefersReducedMotion } from './tokens.ts';
import { ensureUiRoot } from './ui-root.ts';

// #154 §2 の語彙。`ask` は `partial` の色に入力操作を付け足したもの＝質問
// は「あなたの対応が必要」という琥珀色であり、専用の名前を与えておくこと
// で、呼び出し元が `partial` を2つの異なる意味で使い回すのを防ぐ。
export type SurfaceState = 'idle' | 'active' | 'busy' | 'success' | 'partial' | 'ask' | 'error';
export type SurfaceVariant = 'banner' | 'zone';

// 状態 → 絵文字を1か所に。`null` はパスの絵文字ではなくスピナーを意味す
// る。`resting` は呼び出し元自身の idle/active 用の絵文字で、variant が
// 選べるのはこれだけ（バナーは狙いを定めていて、ゾーンは的だ）。
const GLYPH: Record<SurfaceState, readonly string[] | null> = {
  idle: null,
  active: null,
  busy: null,
  success: ICONS.check,
  partial: ICONS.warn,
  ask: ICONS.warn,
  error: ICONS.cross,
};

export interface StatusSurfaceOptions {
  variant: SurfaceVariant;
  // idle/active 用の絵文字＝「欲しい投稿をクリックして」なら ICONS.target、
  // 「ここへドロップして」なら ICONS.drop。
  resting: readonly string[];
  // 支援技術へどう告知するか。質問は 'alert'（誰かの対応を待つ）、進行中
  // の実況は 'status'（割り込まない）。
  role?: 'status' | 'alert';
}

// 挿入されたばかりの live region に、言葉を与える前にどれだけ登録の猶予
// を与えるか（announce を参照）。支援技術は region が現れた時点でそれを
// 購読する。現れた時点ですでにテキストが入っていれば変化とみなされず、
// 誰にも読み上げられない。約50msという遅延は、この慣習が落ち着いた値だ＝
// 登録には十分な長さで、それでいて文がその原因となった操作にまだ属して
// いると言える短さ。
const ANNOUNCE_MS = 50;

export class StatusSurface {
  readonly el: HTMLDivElement;
  readonly badge: HTMLDivElement;
  readonly label: HTMLDivElement;
  readonly ring: HTMLDivElement | null;
  private readonly resting: readonly string[];
  private readonly variant: SurfaceVariant;
  private slotted: HTMLElement | null = null;
  private exitAnim: Animation | null = null;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: StatusSurfaceOptions) {
    this.variant = options.variant;
    this.resting = options.resting;

    this.el = document.createElement('div');
    this.el.className = 'surface';
    this.el.dataset.variant = options.variant;
    this.el.dataset.state = 'idle';
    this.el.setAttribute('role', options.role || 'status');

    // ゾーンの破線のリングは的の一部なので、ゾーンにしか存在しない。
    if (options.variant === 'zone') {
      this.ring = document.createElement('div');
      this.ring.className = 'ring';
      this.el.appendChild(this.ring);
    } else {
      this.ring = null;
    }

    this.badge = document.createElement('div');
    this.badge.className = 'badge';
    this.el.appendChild(this.badge);

    this.label = document.createElement('div');
    this.label.className = 'label';
    this.el.appendChild(this.label);
  }

  // 共有 ShadowRoot の中に置く。root が得られないとき（root を持てない
  // document、constructed stylesheets のないエンジン）は document へフォー
  // ルバックする＝スタイルなしの UI でも画像の保存はできるが、ここで例外
  // を投げると呼び出し元のこれ以降の行がすべて道連れになる（memory:
  // dead-dom-throw-kills-next-line）。
  mount(): void {
    const root = ensureUiRoot();
    if (root) root.appendChild(this.el);
    else (document.body || document.documentElement)?.appendChild(this.el);
  }

  // 状態が見た目になる唯一の場所。色は属性経由で components.css から来
  // る。このメソッドが決めるのは絵文字とテキストだけだ。
  setState(state: SurfaceState, text?: string): void {
    // 保留中の announce が言おうとしていたことは、それを求めた状態のもの
    // であって、この状態のものではない。
    this.cancelAnnounce();
    if (text !== undefined) this.label.textContent = text;
    this.el.dataset.state = state;
    // 質問は入力を受け取るが、それ以外の状態はすべて読み上げ表示であっ
    // て、ページ向けのクリックを横取りしてはいけない。ゾーンは例外で、
    // 常にドロップの的であり続ける。これは components.css が variant ご
    // とに定めている。
    if (this.variant === 'banner') this.el.style.pointerEvents = state === 'ask' ? 'auto' : 'none';
    // 前の状態が乗せたものは、その状態だけに属する。
    this.clearSlot();
    this.badge.replaceChildren();
    if (state === 'busy') {
      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      this.badge.appendChild(spinner);
      return;
    }
    this.badge.appendChild(makeIcon(GLYPH[state] || this.resting, this.variant === 'zone' ? 18 : 15));
  }

  // 選択肢の行、停止ボタンなど、1つの状態が追加する何か。呼び出し元では
  // なくここで保持しておくことで、すべての呼び出し元が覚えておかなくて
  // も setState がそれを片付けられるようにしている。
  slot(el: HTMLElement): void {
    this.clearSlot();
    this.slotted = el;
    this.el.appendChild(el);
  }

  private clearSlot(): void {
    this.slotted?.remove();
    this.slotted = null;
  }

  // この1つのメッセージのために生まれた画面のための言葉、つまりそ
  // の live region が、中の文と同じ瞬間に DOM へ入ってくる場合のもの
  // （#367）。
  //
  // 支援技術は live region への「変化」を告知するのであって、すでに登録
  // 済みの region への変化しか気付けない。テキストが最初から入った状態で
  // 現れる `status` は、だから誰にも読まれない＝保存の注意書きについて言
  // えば、これは読まれない `title` を読まれないバナーに置き換えるだけの
  // ことになり、#367 が直そうとしたものをそのままの場所に残すことにな
  // る。MDN いわく:「空の live region から始め、別のステップで region 内
  // のコンテンツを変える」。
  //
  // `alert` は仕様上の例外だ（すでに中身が入った状態で挿入されても、ブラ
  // ウザはそれを告知する）ので、失敗はここを通る理由がなく、通らない理
  // 由しかない＝緊急性こそがその階層の存在意義そのものだから。
  //
  // 呼び出し元は先に mount してから、これを呼ぶ。この遅延はアニメーショ
  // ンの合図ではなく登録のための猶予だ＝画面は opacity 0 で入場する
  // ので、文が乗る前のフレームはどのみち画面には出ていない。
  announce(text: string): void {
    this.cancelAnnounce();
    this.announceTimer = setTimeout(() => {
      this.announceTimer = null;
      this.label.textContent = text;
    }, ANNOUNCE_MS);
  }

  private cancelAnnounce(): void {
    if (this.announceTimer) clearTimeout(this.announceTimer);
    this.announceTimer = null;
  }

  // 入場: アプリのトーストを、この画面が住む辺に合わせて反転させた
  // もの。CSS ではなく Web Animations を使うのは、このポップが挿入の瞬間
  // に走らなければならず、その持続時間はトークンシートが `animate()` へ
  // 渡せる数字ではないからだ。
  enter(): void {
    this.exitAnim?.cancel();
    this.exitAnim = null;
    this.el.style.opacity = '';
    if (prefersReducedMotion()) return;
    const [from, to] = this.frames();
    this.el.animate([from, to], { duration: motion.durationBase, easing: motion.easeOut });
  }

  // 退場は入場を逆再生してから remove する。いきなりの remove() は、アプ
  // リ自身のトーストの隣では不具合のように見えてしまう。2回呼んでも安
  // 全。
  exit(onDone?: () => void): void {
    this.cancelAnnounce(); // 退場していく画面に、もう言うべきことは残っていない
    if (!this.el.isConnected || prefersReducedMotion()) {
      this.el.remove();
      onDone?.();
      return;
    }
    const [gone, here] = this.frames();
    const anim = this.el.animate([here, gone], { duration: motion.durationFast, easing: motion.easeIn });
    this.exitAnim = anim;
    const finish = () => {
      if (this.exitAnim !== anim) return; // 再入場がこのアニメーションを取り消した
      this.exitAnim = null;
      this.el.remove();
      onDone?.();
    };
    anim.onfinish = finish;
    anim.oncancel = () => {
      if (this.exitAnim === anim) this.exitAnim = null;
    };
  }

  // バナーは上端から降りてきて、ゾーンは下端から上がってくる。もうどち
  // らも恒常的なオフセットは持たない＝バナーは以前 translateX(-50%) で
  // 中央寄せしていて、それをどのキーフレームでも書き直さなければ、ポッ
  // プが横方向に幅の半分ずれて飛んでいってしまっていた。今は margin で
  // 中央寄せしている（理由は components.css を参照）ので、どちらの
  // variant も裸のオフセットからアニメーションできる。
  private frames(): [Keyframe, Keyframe] {
    return this.variant === 'banner'
      ? [
          { opacity: 0, transform: 'translateY(-14px) scale(0.96)' },
          { opacity: 1, transform: 'none' },
        ]
      : [
          { opacity: 0, transform: 'translateY(14px) scale(0.96)' },
          { opacity: 1, transform: 'none' },
        ];
  }

  // 保存が成立した瞬間のバッジの反転。ページから目を離さなくても視界の
  // 端で読み取れる程度に小さい。
  pop(): void {
    if (prefersReducedMotion()) return;
    this.badge.animate([{ transform: 'scale(0.6)' }, { transform: 'scale(1.12)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 300, easing: motion.easeOut });
  }

  show(): void {
    this.el.style.display = '';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  get hidden(): boolean {
    return this.el.style.display === 'none';
  }

  remove(): void {
    this.cancelAnnounce();
    this.exitAnim?.cancel();
    this.exitAnim = null;
    this.el.remove();
  }
}
