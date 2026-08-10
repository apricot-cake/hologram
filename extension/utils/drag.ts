// 常駐する content script（manifest の content_scripts、対象は x / bsky /
// pixiv）。ドラッグして保存: ユーザーが画像のドラッグを始めるとドロップ
// ゾーンが現れ、そのゾーンにドロップした場合だけ Hologram へ保存する。それ
// 以外の場所（ディスクへ、並べ替えのため、など）へのドラッグは何もしない
// ＝うっかり保存を防ぐ。ドロップすると background が投稿のメタデータを取
// 得し、ドラッグされたイラスト自体（スクリーンショットではない）を native
// host 経由で保存する。ある画像がどの投稿に属するかは media-identity.js か
// ら得ていて、これは overlay.js のホバー保存ボタンとも共有しているため、2
// つの経路が保存の記録内容について食い違うことは絶対にない。
import { logSaveEvent, newSaveId, reportSaveTimeout } from './capture-log.ts';
import { extensionAlive, noteExtensionGone, onExtensionGone } from './extension-context.ts';
import { startSaveDeadline } from './save-deadline.ts';
import { buildChoiceRow, checkDuplicate, formatDeletedAt } from './duplicate-guard.ts';
import { collectImageUrls, getMediaIdentitySite } from './extractor/index.ts';
import { ICONS } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { createI18n } from './i18n.ts';
import { userOnly } from './user-gesture.ts';
import type { ImageDraggedMessage, SaveResponse } from './messages.ts';

export async function startDrag(): Promise<() => void> {
  type PendingDrag = ImageDraggedMessage;

  const siteConfig = getMediaIdentitySite();
  if (!siteConfig) return () => undefined;

  let pending: PendingDrag | null = null;
  let zone: StatusSurface | null = null;
  let savingViaDrop = false; // ゾーンへのドロップからその結果までの間だけ true にし、dragend が早くゾーンを隠さないようにする

  const { getMessage: t, partialSaveText, saveFailureText, skewSaveText } = await createI18n();

  // ドロップゾーンは、ページ上のすべての保存経路が描画に使う画面の
  // `zone` の面だ（#44 — status-surface.ts）。以前はここに状態→色→絵文字の
  // 対応表の専用コピーがあったが、今このファイルが決めるのはどの状態にい
  // るかだけで、それがどう見えるかは共有コンポーネントとそのスタイルシー
  // トが決める。
  function ensureOverlay(): StatusSurface {
    if (zone) return zone;
    const z = new StatusSurface({ variant: 'zone', resting: ICONS.drop });
    zone = z;
    z.el.id = '__hologramDropZone';
    z.el.addEventListener('dragenter', (e) => {
      e.preventDefault();
      z.setState('active');
    });
    z.el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    z.el.addEventListener('dragleave', () => {
      z.setState('idle');
    });
    // ドロップが保存そのものだ。ゾーンは拡張機能が共有する shadow root の
    // 中にあり、これが `open` なのはページを締め出すためではない別の理由
    // による（ui-root.ts）＝そのためページはこの要素を見つけて `drop` を投
    // げつけられる。信頼された（trusted）イベントであることが、それとユー
    // ザーが実際にポインタを離した動作とを区別する手段になる（#323）。
    z.el.addEventListener('drop', userOnly(onDrop), true);
    return z;
  }

  function showOverlay() {
    const z = ensureOverlay();
    const wasHidden = !z.el.isConnected;
    z.setState('idle', t('dragDropHint'));
    z.mount();
    // 要素が存在すること自体が「開いている」状態そのものなので、既に終わっ
    // た退場アニメーションの後の再表示は入場アニメーションを再生し直す必
    // 要がある。まだフェード中のものは enter() がそれを取り消すことで途中
    // で捕まえる。
    if (wasHidden) z.enter();
  }

  function hideOverlay(fade = false) {
    const z = zone;
    if (!z || !z.el.isConnected) return;
    if (!fade) {
      z.remove();
      return;
    }
    z.exit();
  }

  // 名前を付けて保持しておき、teardown が再び document から外せるようにす
  // る（#594）。
  const onDragStart = userOnly<DragEvent>((e) => {
    // 以前はここにインラインで書かれていたのと同じ probe で、今は下の
    // cleanup の引き金も兼ねる。何も表示しない＝ドラッグを始めることは何
    // かを保存してくれという要求ではない（画像はデスクトップへ向かってい
    // る途中かもしれない）ので、孤児になったタブは拡張機能がインストールされ
    // ていないタブとまったく同じに振る舞う＝つまりドロップゾーンが現れな
    // い。
    if (!extensionAlive()) return;
    const target = e.target as Element | null;
    const img = (target?.closest?.('img') as HTMLImageElement | null) || (target?.tagName === 'IMG' ? (target as HTMLImageElement) : null);
    if (!img) return;
    const identity = siteConfig.extractIdentity(img);
    if (!identity || !identity.link) return;
    // id はドロップ時ではなく保留中のドラッグを作る時点で発行する＝ドロッ
    // プされずに終わるドラッグは1行も書かない（そうしないとページ上の画像
    // ドラッグすべてが1行残してしまう）し、実際にドロップされるドラッグは
    // 重複を尋ねる前に id が必要になる（#519）。
    pending = { type: 'imageDragged', platform: siteConfig.platform, postUrl: identity.link, imageUrls: collectImageUrls(img, siteConfig.platform), saveId: newSaveId() };
    showOverlay();
  });

  // ゾーンにドロップされずにドラッグが終わった（他の場所へドロップされた、
  // またはキャンセルされた）。これも信頼されたイベント限定にしていて、保
  // 存のためというより対になる dragstart と辻褄を合わせるためだ＝ユーザー
  // の本物のドラッグの最中に合成された `dragend` が発生すると、まだ運んで
  // いる画像の下からゾーンが消えてしまう。
  const onDragEnd = userOnly(() => {
    if (savingViaDrop) return; // ゾーンへのドロップが自分自身のフィードバック／非表示を処理中
    pending = null;
    hideOverlay(true);
  });

  document.addEventListener('dragstart', onDragStart, true);
  document.addEventListener('dragend', onDragEnd, true);

  // このタブの下で拡張機能が消えた（#594）。ドロップゾーンはこのモジュー
  // ルがページ上に残す唯一のもので、2つの document リスナーがこのモジュー
  // ルが動かし続ける唯一の仕事だ。
  //
  // ドロップへの応答中はゾーンを残す。まさにそのときに、これが表示すべき
  // 中身を持って発火するからだ＝下の onDrop がリロードの通知をゾーン自身
  // のエラー状態として出し、その画面は通常の滞留時間で自分からフェー
  // ドアウトする。ドロップが進行中でなければ表示すべきものは何もなく、ゾー
  // ンは単純に消える。
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('dragstart', onDragStart, true);
    document.removeEventListener('dragend', onDragEnd, true);
    pending = null;
    if (!savingViaDrop) hideOverlay();
  };
  const stopWatchingContext = onExtensionGone(cleanup);

  // ユーザーがすでに見ている surface にリロードの通知を出し（#594）、この
  // ドロップを終える。再試行は提供しない＝このタブでもう一度押しても、同
  // じ切断された接続に届くだけだから。
  function orphaned(z: StatusSurface) {
    z.setState('error', t('bannerExtensionReloaded'));
    setTimeout(() => {
      hideOverlay(true);
      savingViaDrop = false;
    }, 2600);
  }

  function onDrop(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    const p = pending;
    pending = null;
    if (!p) {
      hideOverlay();
      return;
    }
    savingViaDrop = true;
    const z = ensureOverlay();
    // ドロップすることが保存の要求そのものなので、上の dragstart とは違い
    // こちらには知らせる。ドラッグが始まってから画像が離されるまでの間に
    // context が失われることがある＝その時点ではもうゾーンが画面上にある
    // ので、通知には表示先がある。
    if (!extensionAlive()) {
      orphaned(z);
      return;
    }
    z.setState('busy', t('bannerSaving'));
    // #34: ポインタが運んできた画像がこの経路が保存するものの全てなので、
    // 比較に使う画像集合はその画像自身の URL＝これによって、漫画の次のペー
    // ジ（同じ投稿の、ライブラリが持っていない画像）が重複扱いされずに済
    // む。
    checkDuplicate(p.platform, p.postUrl, p.imageUrls)
      .catch(() => null)
      .then((hit) => {
        if (!hit) {
          send(z, p, null);
          return;
        }
        // #158: 同じ問いを、ライブラリではなくゴミ箱にある投稿について行う。
        const deletedOn = hit.trashed ? formatDeletedAt(hit.trashed.deletedAt) : '';
        z.setState('ask', hit.trashed ? (deletedOn ? t('trashedTitleOn', [deletedOn]) : t('trashedTitle')) : t('dupTitle'));
        z.slot(
          buildChoiceRow(
            t,
            (choice) => {
              if (choice === 'skip') {
                // ハングではなく決定として扱う＝capture.ts 自身の skip の行を参照（#519）。
                logSaveEvent({ stage: 'duplicate', phase: 'skip', saveId: p.saveId, platform: p.platform, url: p.postUrl });
                z.setState('success', t('dupSkipped'));
                setTimeout(() => {
                  hideOverlay(true);
                  savingViaDrop = false;
                }, 1400);
                return;
              }
              z.setState('busy', t('bannerSaving'));
              send(z, p, choice === 'replace' ? hit.captureId : null);
            },
            hit.trashed ? 'trashed' : 'duplicate',
          ),
        );
      });
  }

  function send(z: StatusSurface, p: PendingDrag, replaces: string | null) {
    // ドロップゾーンはこれが答えるまでスピナーを出し続けるので、キャプ
    // チャバナーと同じように終わりが必要だ（#507）＝しかも同じ終わり方な
    // ので、待機そのものはここではなく save-deadline.ts にある。
    const deadline = startSaveDeadline(p.saveId, (error) => {
      // ホバーボタンと同じ理由で記録する＝この画面の裏にも
      // service-worker の行が控えているわけではないので、ここでタイムアウ
      // トを記録しなければ capture.log は保存が試みられたことすら言えなく
      // なる（#507）。
      reportSaveTimeout('drop-zone', p.platform, p.postUrl, error, p.saveId);
      done(z, undefined, replaces, true);
    });
    try {
      chrome.runtime.sendMessage({ ...p, replaces } satisfies ImageDraggedMessage, (res?: SaveResponse) => {
        if (!deadline.settle()) return; // すでに諦めたドロップへの遅れてきた応答
        done(z, res, replaces, false);
      });
    } catch {
      // onDrop の probe とこの呼び出しの間で拡張機能が無効化された（#594）。
      // 上のデッドラインへの保険＝これがなければ上のデッドラインだけが動
      // き続け、ドロップは尽きるまでスピナーの下に居座った末に、単に消え
      // ただけの拡張機能をタイムアウトのせいにしてしまう。
      noteExtensionGone();
      deadline.settle();
      orphaned(z);
    }
  }

  // ドロップの結果を画面に出す唯一の場所。background から返ってきたもので
  // あれ、時間切れになったものであれ。
  function done(z: StatusSurface, res: SaveResponse | undefined, replaces: string | null, timedOut: boolean) {
    const ok = res?.ok === true;
    let partial = false;
    let grouped = false;
    // 古いキャプチャはゴミ箱へ向かう途中なので、これは統合ではない＝
    // 「grouped」ではなくこちらを言う（#34）。
    const replaced = ok && !!replaces;
    // 半端に更新されたインストール（#205）＝これが他の成功時の文言より優
    // 先され、緑ではなく琥珀色で出る理由は capture.ts の注記を参照。
    const skewText = res?.ok ? skewSaveText(res.hostSkew) : null;
    let text: string;
    if (res?.ok) {
      partial = res.metaOk === false; // 保存はしたが投稿のメタデータがない
      grouped = !partial && !replaced && res.grouped > 0; // 同じ投稿を以前にも保存済み → アプリでは1枚のカードに統合される
      text = skewText ?? (partial ? partialSaveText(res.metaReason) : replaced ? t('dupReplaced') : grouped ? t('bannerSavedGrouped', [res.grouped + 1]) : t('bannerSaved'));
    } else {
      text = timedOut ? saveFailureText('timeout') : saveFailureText(res?.errorKind, res?.metaReason, res?.queued);
    }
    const attention = partial || !!skewText;
    z.setState(attention ? 'partial' : ok ? 'success' : 'error', text);
    // 状態の切り替わりが視界の端でも分かるよう、小さなバッジのポップを入
    // れる（アプリの hologramBadgePop: 共有の ease-out カーブで0.3秒）。
    if (ok) z.pop();
    setTimeout(
      () => {
        hideOverlay(true);
        savingViaDrop = false;
      },
      // grouped/replaced: もう一拍長く表示する＝どちらも画像が「どこへ行ったか」を説明するものだから
      attention ? 2600 : grouped || replaced ? 2200 : 1400,
    );
  }

  return () => {
    stopWatchingContext();
    cleanup();
  };
}
