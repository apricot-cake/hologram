// 重複保存の警告（#34）:「この投稿はすでに保存されています。コピー・置き
// 換え・スキップのどれにしますか」を、保存が始まる前に尋ねる。
//
// なぜ後ではなく前か。拡張機能は native host 経由で書き込み、これはデスク
// トップアプリが動いていようがいまいが動く。アプリを閉じた状態での保存に
// は後から解決するアプリ内の面がないので、事後検出では問い合わせる機会が
// そもそも来ない。host は自身の読み取り専用の索引（background.ts の
// checkDuplicate → ブリッジの `query`）からこの問い合わせに答えるので、こ
// の質問はいつでも尋ねられる。
//
// ページ上の2つの保存経路（capture.ts の Alt+S 投稿キャプチャと drag.ts の
// 画像をドロップゾーンへドラッグ）はどちらもこれを使うため、文言・選択
// 肢・「次から確認しない」設定がこの2つの間でずれることはない。ホバー保存
// ボタン（overlay.ts）は意図してここに繋いでいない＝これはライブラリが
// 「未保存」と答えた画像にしか描かれないので、押すことが構造上そもそも重
// 複にならない（#334）。
//
// ここは全体が fail-open だ。パーマリンクが取れない、host に届かない、
// storage の読み取りがエラーになる。どれも「警告なし」と答え、保存はこの
// 機能が存在しなかったときとまったく同じに進む。警告を見逃すコストはレ
// コードが1件増えることで、保存をブロックするコストは投稿そのものを失う
// こと。
import { DUPLICATE_ASK_TIMEOUT_MS } from './deadline.ts';
import { collectImageUrls, getMediaIdentitySite } from './extractor/index.ts';
import { userOnly } from './user-gesture.ts';
import type { PostMediaElement } from './extractor/types.ts';

// chrome.storage.local、真偽値。未設定＝オン＝この警告が機能の目的そのも
// のであり、うるさいと感じたユーザーはオフにする（設定ページ、または警告
// 自体のチェックボックス）。
export const DUPLICATE_WARNING_KEY = 'duplicateWarning';

export type DuplicateChoice = 'copy' | 'replace' | 'skip';

// この行がどの質問に答えているか。'duplicate' は #34 のもの（投稿がライブ
// ラリにある）、'trashed' は #158 のもの（投稿がライブラリのゴミ箱にあ
// る）。
//
// 2つではなく1つのパラメータにしているのは、variant が提示する選択肢と
// `copy` の説明文の両方を決め、この2つが必ず一緒に動かなければならないか
// らだ＝短縮した行にライブラリ用の文言を組み合わせると、ライブラリが持っ
// ていないレコードについて「2件目のレコードとして再保存する」と言ってし
// まうし、フルの行にゴミ箱用の文言を組み合わせると、対象がもう存在しない
// `replace` を提示してしまう。
export type ChoiceVariant = 'duplicate' | 'trashed';

// 破壊的でない方から破壊的な方へ、取り消せる答えを先頭に。ゴミ箱にある投
// 稿は `replace` を落とす＝引退させるべき生きたレコードが必要だが、ゴミ箱
// 行きの投稿にはそれがない。
const CHOICES: Record<ChoiceVariant, readonly DuplicateChoice[]> = {
  duplicate: ['copy', 'replace', 'skip'],
  trashed: ['copy', 'skip'],
};

export interface DuplicateHit {
  // 再保存しようとしている画像がすでに入っているレコード＝「replace」の答
  // えが引退させるレコードとして名指しするもの。ライブラリが「この投稿は
  // 保存済み」とは言えても、どのキャプチャがその画像を持つかまでは言えな
  // いときは null。
  captureId: string | null;
  // 投稿がライブラリのゴミ箱にあるとき（#158）、生きたマッチの代わりにこ
  // ちらをセットする＝保存はされていないが、レコードとファイルはまだそこ
  // にあって復元可能なので、もう一度保存すると、ユーザーが削除した投稿の
  // 2件目のコピーを黙って作ってしまうことになる。`deletedAt` はゴミ箱行き
  // になった ISO 時刻で、レコードにスタンプがなければ null＝その場合、通
  // 知は日付をでっちあげずに省略する。
  //
  // 復元はここでは提供しない＝native host はライブラリに対して読み取り専
  // 用（#34 の設計）なので、ページ上のどの操作もそれを実行できない。通知
  // は投稿がどこにあるかを言うだけで、元に戻す操作はアプリ側で行う。
  trashed?: { deletedAt: string | null } | null;
}

type Messages = (key: string, subs?: ReadonlyArray<unknown>) => string;

function readSetting(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(DUPLICATE_WARNING_KEY, (got) => {
        if (chrome.runtime.lastError) resolve(true);
        else resolve(got[DUPLICATE_WARNING_KEY] !== false);
      });
    } catch {
      resolve(true);
    }
  });
}

export function suppressWarning(): void {
  try {
    chrome.storage.local.set({ [DUPLICATE_WARNING_KEY]: false });
  } catch {
    /* すでに行った選択はそのまま有効＝失われるのは設定の記録だけ */
  }
}

// このページが1件の投稿について提示する画像 URL のすべてを、画像アイデン
// ティティのキーを導出できる形で返す（そのルールはサイト自身の
// extractor が持つ。タイムラインのオーバーレイがライブラリの保存済み画像
// と比較するのに使うのと同じルール）。
//
// 画像アイデンティティのルールを持たないプラットフォーム（Misskey・
// Mastodon のインスタンス）では [] を返す。その場合チェックは投稿 URL だ
// けに頼ることになるが、これは #34 で確認済みのフォールバックだ＝実際に
// はライブラリにない画像について警告してしまうことがあるが、「copy」がそ
// れに無害に答える。
export function pagePictureUrls(post: Element | PostMediaElement | null): string[] {
  const site = getMediaIdentitySite();
  if (!site || !post) return [];
  const els: PostMediaElement[] = post.tagName === 'IMG' || post.tagName === 'VIDEO' ? [post as PostMediaElement] : Array.from(post.querySelectorAll<PostMediaElement>('img, video'));
  const urls = new Set<string>();
  for (const el of els) {
    // isPostMedia はアバターやリンクカードのプレビューを除外する＝アバ
    // ターの URL が保存済み画像とマッチすることはそもそもないが、この
    // ゲートはオーバーレイとホバー保存ボタンがすでに「これは投稿自身のメ
    // ディアか」を判定するのに使っているもので、ルールを1つにすることに
    // 意味がある。
    if (!site.isPostMedia(el)) continue;
    for (const url of collectImageUrls(el, site.platform)) urls.add(url);
  }
  return [...urls];
}

// null = 確認なしで保存する（設定がオフ、投稿がライブラリにない、または問
// い合わせに答えが得られなかった場合）。
export async function checkDuplicate(platform: string, url: string | null, imageUrls: string[]): Promise<DuplicateHit | null> {
  if (!url || !chrome.runtime?.id) return null;
  if (!(await readSetting())) return null;
  // エラーだけでなくデッドラインでも fail-open する（#507）。この問い合わ
  // せは picker がクリックリスナーをすでに手放した後に行われるので、以前
  // は background が沈黙すると「投稿をクリックして保存」というキャプチャ
  // 全体が固まってしまっていた＝誰も聞いていないのにまだクリックを誘うバ
  // ナーが残る形で。遅れて「警告なし」と答えるのは、このモジュールの他の
  // すべての答えられないケースで行っているのとまったく同じことだ。
  const res = await new Promise<any>((resolve) => {
    let settled = false;
    const answer = (r: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => answer(null), DUPLICATE_ASK_TIMEOUT_MS);
    try {
      chrome.runtime.sendMessage({ type: 'checkDuplicate', platform, url, imageUrls }, (r: any) => {
        void chrome.runtime.lastError; // background に届かないのは「答えなし」であって表に出すエラーではない
        answer(r);
      });
    } catch {
      answer(null);
    }
  });
  if (!res || !res.ok) return null;
  // 生きたマッチが1件もないとき、ゴミ箱の通知がその答えになる（#158）。
  // `duplicate` のゲートより先に読んでいるのは、これ自体が独立したヒット
  // だからだ＝background は両方を同時にセットすることは絶対になく、ここで
  // null を返すと通知が丸ごと落ちてしまう。
  if (!res.duplicate) {
    const trashed = res.trashed;
    if (!trashed || typeof trashed !== 'object') return null;
    return { captureId: null, trashed: { deletedAt: typeof trashed.deletedAt === 'string' && trashed.deletedAt ? trashed.deletedAt : null } };
  }
  return { captureId: typeof res.captureId === 'string' && res.captureId ? res.captureId : null };
}

// 通知が表示する削除日＝レコード自身のカレンダー上の日を、閲覧者のロケー
// ルで表す。レコードにスタンプがなければ ''（呼び出し側は日付なしの文言
// を使う）。時刻は意図して落としている＝「いつこれを不要だと決めたか」は
// 日単位の問いであって、時刻を出すと実際には持っていない精度があるかのよ
// うに読めてしまう。
export function formatDeletedAt(deletedAt: string | null | undefined): string {
  if (!deletedAt) return '';
  const t = Date.parse(deletedAt);
  if (!Number.isFinite(t)) return '';
  try {
    return new Date(t).toLocaleDateString();
  } catch {
    return '';
  }
}

function makeChoiceButton(label: string, title: string, primary: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'choice';
  if (primary) b.dataset.primary = '';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', `${label} — ${title}`);
  // 押下の両フェーズを止める＝この操作は document でリッスンしているホス
  // トページ（x.com と bsky.app はライトボックスを開く）の上に重ねて配置
  // されていて、押下がそちらまで届くと、質問の裏にある投稿に対して何か動
  // 作してしまう。
  b.onpointerdown = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return b;
}

// 3つの答えと「次から確認しない」のオプトアウトを、呼び出し側が自分の
// 画面（キャプチャバナーのピル、ドロップゾーンのカード）の中に mount す
// る、独立した1個の要素として返す。onChoose はちょうど1回だけ発火する。
//
// 並び順は copy / replace / skip＝破壊的でない方から破壊的な方へ、取り消
// せる答えを先頭に。「Copy」が先頭にあってアクセントを持つのは、それが警
// 告なしでも保存が行っていたはずの動作だからだ＝この質問は選択肢を追加す
// るのであって、既定の動作を変えるものではない。
//
// `variant` はどの質問に答えているか（#158）＝どの答えが現れ、`copy` がど
// う自分を説明するかを選ぶ。2本目の行を組み立てるのではなく1本の行を絞り
// 込む形にしているのは、各答えの呼び名・スタイル・実際のユーザー操作から
// 来ていなければならないという定義を1つに保つためだ。ボタンの名前はあえて
// variant 間で共有している＝状況ごとに名前を変える操作は2度学習させる羽目
// になるが、その下のヒントはその場で読むものなので状況依存で構わない。
export function buildChoiceRow(t: Messages, onChoose: (choice: DuplicateChoice) => void, variant: ChoiceVariant = 'duplicate'): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'choices';

  const row = document.createElement('div');
  row.className = 'choice-row';
  let answered = false;
  const answer = (choice: DuplicateChoice) => {
    if (answered) return;
    answered = true;
    onChoose(choice);
  };
  const choices = CHOICES[variant];
  const buttons: Array<[DuplicateChoice, string, string, boolean]> = [
    // ゴミ箱側の variant のヒントは、コピーがゴミ箱にある方に何が起きるか
    // を言う。ライブラリ用の文言はこれに触れる理由がないが、こちらは触れ
    // なければならない＝この答えは2件のレコードを残し、そのうち1件はまだ
    // 削除されたままだから。
    ['copy', t('dupCopy'), t(variant === 'trashed' ? 'dupCopyHintTrashed' : 'dupCopyHint'), true],
    ['replace', t('dupReplace'), t('dupReplaceHint'), false],
    ['skip', t('dupSkip'), t('dupSkipHint'), false],
  ];
  for (const [choice, label, hint, primary] of buttons.filter(([c]) => choices.includes(c))) {
    const b = makeChoiceButton(label, hint, primary);
    // ブラウザの E2E ハーネスのために名前を付けている。ハーネスはローカラ
    // イズされたラベルを読めない（バナーはブラウザのロケールに従うため）
    // ＝キャプチャ時の非表示に対して overlay の data-hologram-overlay 属性
    // が果たすのと同じ役割。
    b.setAttribute('data-hologram-choice', choice);
    // 答えは必ずユーザー自身のものでなければならない（#323）。これらのボ
    // タンは共有 shadow root の中にあり、ページはそこへ手を伸ばせる。そし
    // て「replace」はページ上のどの操作よりも破壊的だ＝既存のレコードを名
    // 指しして引退させる。これを押せるページは、ライブラリのどのキャプ
    // チャをゴミ箱行きにするか選べてしまうことになる。
    b.onclick = userOnly<MouseEvent>((e) => {
      e.preventDefault();
      e.stopPropagation();
      answer(choice);
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);

  // 設定ページが持つのと同じオプトアウトを、実際にユーザーが中断されてい
  // るその場で提示する。チェックしても設定を記録するだけ＝画面上の質問は
  // それでも答えを待ち続ける。警告をオフにすることは、この保存についての
  // 決定そのものではないからだ。
  const optOut = document.createElement('label');
  optOut.className = 'opt-out';
  const box = document.createElement('input');
  box.type = 'checkbox';
  // これも信頼されたイベント限定＝このチェックボックスは永続的な設定を書
  // き込むので、ページがこれをチェックできてしまうと、以降すべてのサイト
  // でのすべての保存について警告をオフにできてしまう（#323）。
  box.onchange = userOnly(() => {
    if (box.checked) suppressWarning();
  });
  optOut.appendChild(box);
  const optOutText = document.createElement('span');
  optOutText.textContent = t('dupSuppress');
  optOut.appendChild(optOutText);
  wrap.appendChild(optOut);

  return wrap;
}
