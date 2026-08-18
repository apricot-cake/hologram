'use strict';

// ツールバーアクションのパネル（#124）＝「これは動いているか、保存し
// たものはちゃんと入ったか」に対する拡張機能の常設の答え。
//
// なぜアイコンはもう1回のクリックでは保存しなくなったか。Chrome は
// action にクリックイベントかポップアップのどちらかしか与えず、両方は
// 与えない。だからここにパネルを置くと、ツールバーからの1クリック保存
// を犠牲にする。この取引は意図して選んだ: デスクトップアプリへの接
// 続、host が落ちていた間の再試行キュー（#203）、そして直近の保存が入っ
// たか入らなかったかは、それまでまったく読む場所がなかった。一方で保
// 存の入口は今も3つある（Alt+S、ホバーボタン #94、画像のドラッグ）。パ
// ネル自身の最初の行は保存ボタンなので、以前保存していた押下は今も保
// 存する＝1クリック増えるが、できないときにはなぜかを言えるようになっ
// た。
//
// ここは意図してすべて素朴にしてある: フレームワークなし、設定/診断
// ページと同じ形。文字列は chrome.i18n 経由で _locales から来る（拡張
// 機能ページの標準的な経路）。popup.html の静的なテキストは、
// chrome.i18n がない file:// プレビュー向けの日本語フォールバックだ。
//
// diag.ts と options.ts と同じ理由で関数に包んでいる: tsc は拡張機能
// の全ファイルを1つのプログラムとしてコンパイルするため、トップレベ
// ルの名前はその全体で一意でなければならない。
import { escalationUrl } from './inject-failure.ts';
import type { InjectFailureKind } from './inject-failure.ts';
import { pingNativeHost, protocolReportOf } from './host-probe.ts';
import { servedLocale } from './locale.ts';
import type { PopupActivateReason, PopupActivateResponse, PopupSaveProfileResponse, QueueStatsResponse } from './messages.ts';
import { classifySaveFailure } from './native-error.ts';
import { SAVE_HISTORY_KEY, countOf, readSaveHistory, savedOn } from './save-history.ts';
import type { SaveHistoryEntry } from './save-history.ts';

export function startPopup(): void {
  const byId = (id: string) => document.getElementById(id);

  // 設定ページと同じ綴り方にしている。
  // scripts/ext-consistency.test.ts がこの呼び出しの形を読んでどの
  // _locales キーが使われているか判定するからだ＝別のやり方でキーを
  // セットすると、パリティチェックを黙ってすり抜けてしまう。
  const setText = (id: string, key: string) => {
    const el = byId(id);
    const text = chrome.i18n && chrome.i18n.getMessage(key);
    if (el && text) el.textContent = text;
  };

  const show = (id: string, visible: boolean) => byId(id)?.toggleAttribute('hidden', !visible);

  try {
    const title = chrome.i18n && chrome.i18n.getMessage('popupTitle');
    if (title) document.title = title;
    // 設定ページと同じ（#1057）: popup.html の静的なテキストは日本語
    // のフォールバックで、それが置き換わる瞬間、document 自身の申告も
    // 一緒に動かなければならない。getUILanguage() をそのまま使わず
    // servedLocale を使う＝ブラウザの UI 言語がなぜ間違った答えなのか
    // は locale.ts を参照。
    if (chrome.i18n) document.documentElement.lang = servedLocale(chrome.i18n.getUILanguage());
    setText('save', 'popupSave');
    setText('saveProfile', 'popupSaveProfile');
    setText('bulk', 'popupBulk');
    setText('statusText', 'popupStatusChecking');
    setText('statusDiag', 'popupOpenDiag');
    setText('historyTitle', 'popupHistoryTitle');
    setText('historyEmpty', 'popupHistoryEmpty');
    setText('openOptions', 'popupOpenOptions');
    setText('openDiag', 'popupOpenDiag');
  } catch {
    /* 拡張機能のページとして動いていない＝静的なフォールバックのテキストを残す */
  }

  // --- the save button -------------------------------------------------------

  const saveButton = byId('save') as HTMLButtonElement | null;
  let repairUrl: string | null = null;

  // なぜ押下が保存を始められなかったかを、すでに開いているパネルの中
  // で言う（#124 §3）。#269 のエスカレーション（連続2回目の失敗で修
  // 復ページを開く）はキーボードの経路にだけ残し、ここではあえて行わ
  // ない: ユーザーが読んでいるパネルの裏でタブを開くと、画面と選択の
  // 両方を一度に奪ってしまう。同じページはボタンとして提示する。
  function refuse(reason: PopupActivateReason) {
    const el = byId('saveReason');
    const message = chrome.i18n && chrome.i18n.getMessage(reason === 'package-unreadable' ? 'popupRefusedUnreadable' : reason === 'page-refused' ? 'popupRefusedPage' : reason === 'not-http' ? 'popupRefusedNotHttp' : 'popupRefusedNoTab');
    if (el && message) el.textContent = message;
    show('saveReason', true);
    if (saveButton) saveButton.disabled = true;

    // 行き先があるのは2つの注入失敗だけだ: そもそもスクリプトを実行で
    // きないページは壊れているわけではなく、直すものが何もない。
    const kind: InjectFailureKind | null = reason === 'package-unreadable' || reason === 'page-refused' ? reason : null;
    const repair = byId('saveRepair');
    if (!kind || !repair) return;
    repairUrl = escalationUrl(kind);
    const label = chrome.i18n && chrome.i18n.getMessage(kind === 'package-unreadable' ? 'popupOpenExtensions' : 'popupOpenDiag');
    if (label) repair.textContent = label;
    show('saveRepair', true);
  }

  byId('saveRepair')?.addEventListener('click', () => {
    // リンクではなく chrome.tabs.create にしている: 読めない場合の分
    // 岐の行き先は chrome://extensions で、ページからはリンクできない
    // ことがある。
    if (repairUrl) chrome.tabs.create({ url: repairUrl }).catch(() => {});
    window.close();
  });

  saveButton?.addEventListener('click', () => {
    saveButton.disabled = true;
    chrome.runtime.sendMessage({ type: 'popupActivate' }, (res?: PopupActivateResponse) => {
      void chrome.runtime.lastError;
      // キャプチャ UI がこのパネルの裏のページに立ち上がっている＝パ
      // ネルにはもう見せるものが残っておらず、開いたままにすると
      // ユーザーがこれからクリックするものを覆ってしまう。
      if (res?.ok) {
        window.close();
        return;
      }
      refuse(res?.reason ?? 'no-tab');
    });
  });

  // 答えがすでに分かるときは、押される前に答える: アクティブなタブが
  // 保存の対象になるので、何も注入できないタブには、失敗するとわかっ
  // ているボタンを提示すべきではない。
  //
  // このテストは worker 自身のもの（activateOnTab の
  // `/^https?:/`、欠けているかもしれない url に対して）を意図して同
  // じ綴りで使っていて、パネルと押下が食い違うことがないようにしてあ
  // る。url が欠けていることは、どちらの場所でも同じことを意味する:
  // chrome.tabs は拡張機能がアクセス権を持つタブについてしか url を明
  // かさず、このポップアップを開いたジェスチャーはアクティブなタブに
  // activeTab を与えている＝それでもまだ url が欠けているなら、その
  // タブには権限を与えられなかった（chrome://、他の拡張機能のペー
  // ジ）ということで、それはまさに何も注入できないタブそのものだ。
  chrome.tabs
    ?.query({ active: true, currentWindow: true })
    .then(([tab]) => {
      if (tab && !/^https?:/i.test(tab.url || '')) refuse('not-http');
    })
    .catch(() => {});

  // ショートカットのヒント。下の一括用のヒント（#851）と同じやり方で
  // 読む: Alt+S だと直接名指しするのではなく実際の割り当てを読むの
  // で、割り当てを変えたユーザーに、もう何もしない組み合わせを表示す
  // ることは絶対にない。Chrome がショートカット未割り当てと報告すれば
  // 完全に非表示にする。
  chrome.commands
    ?.getAll()
    .then((commands) => {
      const shortcut = commands.find((c) => c.name === 'activate')?.shortcut;
      if (!shortcut) return;
      const el = byId('saveHint');
      const text = chrome.i18n && chrome.i18n.getMessage('popupSaveHint', [shortcut]);
      if (el && text) {
        el.textContent = text;
        show('saveHint', true);
      }
    })
    .catch(() => {});

  // --- プロフィールページの投稿者保存 --------------------------------------

  const profileButton = byId('saveProfile') as HTMLButtonElement | null;
  profileButton?.addEventListener('click', () => {
    profileButton.disabled = true;
    chrome.runtime.sendMessage({ type: 'popupSaveProfile' }, (res?: PopupSaveProfileResponse) => {
      void chrome.runtime.lastError;
      if (res?.ok) {
        window.close();
        return;
      }
      const reason = byId('profileReason');
      const message = chrome.i18n && chrome.i18n.getMessage('popupSaveProfileFailed');
      if (reason && message) reason.textContent = message;
      show('profileReason', true);
      profileButton.disabled = false;
    });
  });

  chrome.runtime?.sendMessage({ type: 'popupCheckProfile' }, (res?: { supported: boolean }) => {
    void chrome.runtime.lastError;
    if (res?.supported) show('saveProfile', true);
  });

  // --- the bulk-import item (#793) --------------------------------------------

  const bulkButton = byId('bulk') as HTMLButtonElement | null;

  // なぜこれが saveButton の refuse と同じ読み方をするか:
  // activateOnTab はどちらのボタンが求めるのも同じ注入で、違うのは
  // auto フラグだけだ（#793 の設計 §2 ＝ショートカットに1つの入口、
  // ここでもう1つ）。この時点での失敗はまれな競合（下のチェックとこ
  // の押下の間に拡張機能がリロードされた）であって、ページが非対応の
  // ケースではない。それは checkBulkSupport() が「はい」を聞くまでボ
  // タンを無効のままにしているので、ここまで来ることはない。
  function refuseBulk(reason: PopupActivateReason) {
    const el = byId('bulkReason');
    const message = chrome.i18n && chrome.i18n.getMessage(reason === 'package-unreadable' ? 'popupRefusedUnreadable' : reason === 'page-refused' ? 'popupRefusedPage' : reason === 'not-http' ? 'popupRefusedNotHttp' : 'popupRefusedNoTab');
    if (el && message) el.textContent = message;
    show('bulkReason', true);
    if (bulkButton) bulkButton.disabled = true;
  }

  bulkButton?.addEventListener('click', () => {
    bulkButton.disabled = true;
    chrome.runtime.sendMessage({ type: 'popupActivate', auto: true }, (res?: PopupActivateResponse) => {
      void chrome.runtime.lastError;
      // 保存ボタンと同じ理由: #795 の「開始を待つ」バナーが今ページ上
      // に立ち上がっているので、パネルには付け加えるものがもう残って
      // いない。
      if (res?.ok) {
        window.close();
        return;
      }
      refuseBulk(res?.reason ?? 'no-tab');
    });
  });

  // popup.html の既定で無効な状態が、これが進行中の間の安全な答えだ。
  // ページに直接ではなく background へ尋ねる（ポップアップには判断材
  // 料にできる自前の DOM がない）＝background 自身の窓口がページ上に
  // すでにある常駐 content script へ転送するので、質問に答えるためだ
  // けに activeTab の注入が起きることはない（#793 設計 §1）。
  chrome.runtime?.sendMessage({ type: 'popupCheckBulk' }, (res?: { supported: boolean }) => {
    void chrome.runtime.lastError;
    if (!bulkButton) return;
    if (res?.supported) {
      bulkButton.disabled = false;
      return;
    }
    const el = byId('bulkReason');
    const message = chrome.i18n && chrome.i18n.getMessage('popupBulkUnsupported');
    if (el && message) el.textContent = message;
    show('bulkReason', true);
  });

  // ショートカットのヒント（#793 設計 §4）: Alt+Shift+S だと直接名指
  // しするのではなく実際の割り当てを読むので、割り当てを変えたユー
  // ザーに、もう何もしない組み合わせを表示することは絶対にない。
  // Chrome がショートカット未割り当てと報告すれば、推測するのではな
  // く完全に非表示にする＝新規インストールでは普通の状態だ。
  // suggested_key は他の拡張機能に割り当てを奪われうるから（#793 の
  // Why を参照）。
  chrome.commands
    ?.getAll()
    .then((commands) => {
      const shortcut = commands.find((c) => c.name === 'activate-auto')?.shortcut;
      if (!shortcut) return;
      const el = byId('bulkHint');
      const text = chrome.i18n && chrome.i18n.getMessage('popupBulkHint', [shortcut]);
      if (el && text) {
        el.textContent = text;
        show('bulkHint', true);
      }
    })
    .catch(() => {});

  // --- connection, versions, queue -------------------------------------------

  // メッセージのキーではなく解決済みの文を受け取る。それによってすべ
  // てのキーは、リテラルな chrome.i18n.getMessage(...) 呼び出しの中に
  // 綴られたままになる＝これが scripts/ext-consistency.test.ts が走査
  // する形で、キーが変数としてここへ届くと、誰も気付かないまま
  // _locales のパリティチェックをすり抜けてしまう。
  function paintStatus(state: 'ok' | 'warn' | 'bad', text: string | null, detail: string | null) {
    byId('statusDot')?.setAttribute('data-state', state);
    const el = byId('statusText');
    if (el && text) el.textContent = text;
    const detailEl = byId('statusDetail');
    if (detailEl && detail) detailEl.textContent = detail;
    show('statusDetail', !!detail);
    // 診断ページを次のステップにするのは、問題が接続そのものであると
    // きだけだ。バージョンの不一致には更新で答えるのであって、診断で
    // はない。
    show('statusDiag', state === 'bad');
  }

  async function checkConnection() {
    const ping = await pingNativeHost();
    const protocol = protocolReportOf(ping);
    if (!ping.ok) {
      // なぜかを、native-error.ts が保存バナーですでに使っている語彙
      // で。実測済み（2026-08-03）: 未登録の host は connectNative に
      // 例外を投げさせない＝Chrome は接続を受け入れてから
      // 「Specified native messaging host not found」で切断する。だか
      // ら `where` だけで分類すると、あらゆる失敗の中で最もありふれた
      // もの（デスクトップアプリが未インストール）を「接続が切れた」
      // と報告してしまう。文言から見分けられない `where` はタイムアウ
      // トで、これはエラーを一切持たないので、最初に尋ねる。
      const kind = ping.where === 'timeout' ? 'timeout' : classifySaveFailure(ping.error);
      const detail = chrome.i18n && chrome.i18n.getMessage(kind === 'host-missing' ? 'popupHostNotRegistered' : kind === 'origin-rejected' ? 'popupHostRejected' : kind === 'timeout' ? 'popupHostNoAnswer' : 'popupHostDisconnected');
      paintStatus('bad', (chrome.i18n && chrome.i18n.getMessage('popupStatusDisconnected')) || null, detail || null);
      return;
    }
    // #205 の継続的な状態に、ようやく読まれる定位置ができた。保存バ
    // ナーもブラウザのセッションにつき1回はそれを言い続ける
    // （background.ts の skewNoteForBanner）。このパネルを一度も開か
    // ない人が置き去りにされないためだが、その文の本来の住処はここ
    // だ。
    if (protocol.skew === 'host-old') paintStatus('warn', (chrome.i18n && chrome.i18n.getMessage('popupStatusHostOld')) || null, null);
    else if (protocol.skew === 'host-new') paintStatus('warn', (chrome.i18n && chrome.i18n.getMessage('popupStatusExtensionOld')) || null, null);
    else paintStatus('ok', (chrome.i18n && chrome.i18n.getMessage('popupStatusConnected')) || null, null);
  }

  // #203: そこにいなかった host のために退避された保存。読み取り専
  // 用＝それを空にする sweep は診断ページのボタンの仕事で、アイコン
  // を押すたびに開くパネルから host の起動を引き起こすのはそれとは別
  // の話だ。
  function checkQueue() {
    try {
      chrome.runtime.sendMessage({ type: 'queueStats' }, (res?: QueueStatsResponse) => {
        void chrome.runtime.lastError;
        const count = res?.ok ? res.stats.count : 0;
        const el = byId('queueRow');
        const text = count > 0 && chrome.i18n && chrome.i18n.getMessage('popupQueued', [String(count)]);
        if (el && text) el.textContent = text;
        show('queueRow', count > 0);
      });
    } catch {
      /* extension context がない＝このパネルにできることは何もない */
    }
  }

  // --- 最近の保存 ----------------------------------------------------------

  // 投稿を見分けるのに十分な URL の分量（投稿者名はどのプラットフォー
  // ムでもパーマリンクの先頭部分にある）を、前から取る。だから落ちる
  // のは誰も読まない数字の id の方だ。
  function shortUrl(url: string): string {
    const bare = url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    return bare.length > 44 ? `${bare.slice(0, 43)}…` : bare;
  }

  // 今日の保存には時刻を、それより古いものには日付を出す＝両方は絶対
  // に出さない。保存が入った「分」が問題になるのは「今それ入った？」
  // がまだ問いであるうちだけで、1日経てば日付だけが問題になる。時刻ま
  // で運ぶと、この列が投稿を特定する URL の部分を食うほど広がってし
  // まう。
  function whenOf(ts: number, now: Date): string {
    const at = new Date(ts);
    const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
    return sameDay ? at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : at.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  }

  function rowOf(entry: SaveHistoryEntry, now: Date): HTMLLIElement {
    const li = document.createElement('li');
    li.className = entry.ok ? 'entry' : 'entry failed';

    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = whenOf(entry.ts, now);
    li.append(when);

    // クリックハンドラではなく本物のリンクにする: キーボードで到達で
    // き、ホバーで行き先を言い、permission も要らない。#125 は、アプ
    // リが captureId で宛先指定できるようになったら、隣に「アプリで開
    // く」操作を追加する。
    const label = shortUrl(entry.url || '');
    const target = entry.url ? document.createElement('a') : document.createElement('span');
    target.className = 'where';
    target.textContent = label;
    target.title = entry.url || '';
    if (target instanceof HTMLAnchorElement && entry.url) {
      target.href = entry.url;
      target.target = '_blank';
      target.rel = 'noreferrer';
    }
    li.append(target);

    const count = countOf(entry);
    if (count > 1) {
      const many = document.createElement('span');
      many.className = 'count';
      const text = chrome.i18n && chrome.i18n.getMessage('popupRunCount', [String(count)]);
      if (text) many.textContent = text;
      li.append(many);
    }
    if (!entry.ok) {
      const mark = document.createElement('span');
      mark.className = 'mark';
      const text = chrome.i18n && chrome.i18n.getMessage('popupSaveFailed');
      if (text) mark.textContent = text;
      mark.title = entry.error || '';
      li.append(mark);
    }
    return li;
  }

  async function renderHistory() {
    const rows = await readSaveHistory();
    const list = byId('history');
    if (!list) return;
    const now = new Date();
    list.replaceChildren(...rows.map((entry) => rowOf(entry, now)));
    show('historyEmpty', rows.length === 0);
    const today = byId('todayRow');
    const text = chrome.i18n && chrome.i18n.getMessage('popupToday', [String(savedOn(rows, now))]);
    if (today && text) today.textContent = text;
  }

  // パネルが開いている間、リングを追う。これが報われるのは、パネルが
  // たまたま開いている間に別の方法（Alt+S、ホバーボタン）で保存が始
  // まったという狭いケースだけだが、コストは listener 1個で済む＝古
  // くなった件数を見せるパネルこそ、これが存在しないための唯一の目的
  // だ。
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && SAVE_HISTORY_KEY in changes) void renderHistory();
  });

  // 設定ページは専用の開き方を優先する: すでに開いている設定タブを再
  // 利用し、別のものを積み重ねない。href は拡張機能の外でのプレビュー
  // 用のフォールバックとして HTML に残す。
  byId('openOptions')?.addEventListener('click', (event) => {
    if (!chrome.runtime?.openOptionsPage) return;
    event.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });

  byId('statusDiag')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('diag.html') }).catch(() => {});
    window.close();
  });

  void renderHistory();
  void checkConnection();
  checkQueue();
}
