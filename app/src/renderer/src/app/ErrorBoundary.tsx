import log from 'electron-log/renderer';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { t } from '../_shared/i18n.ts';

// 単一の React ルートの最後の受け皿（#324）。上に境界の無いところで描画が例外を投げると、
// React は木を丸ごと外す。このアプリのルートはちょうど1つ（root.tsx）なので、どこかの
// 値が1つ壊れているだけで、グリッド・サイドバー・詳細パネル・設定・ゴミ箱まで巻き添えに
// なり、戻る手立ての無い白いウィンドウだけが残っていた。アプリの外から形が来るデータは、
// 今はそれぞれの境界で正規化している（DB へ入る途中の normalizePostRecord、ゴミ箱の
// 一覧の listTrashRecords）。それでも境界は、正規化では見越せない失敗への保険＝まだ誰も
// 考えていない欄や、コンポーネントの単なる不具合。
//
// 意図して素の要素だけで組んである。受け止めている相手のコンポーネントライブラリを通して
// 描く代替表示は二度目の例外を投げうるし、React は境界自身の描画の中で投げられた例外を
// 再び未処理のエラーとして扱う。差し出す動作を読み込み直しだけにしているのは、レンダラー
// が未保存の状態を持たないから＝DB への書き込みは main を通る。原因が一時的なものであれば、
// 載せ直すだけで完全に復帰する。
//
// クラスコンポーネントなのは、getDerivedStateFromError と componentDidCatch に相当する
// フックが無いため（React のドキュメント）。レンダラー唯一のクラスコンポーネント。
interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // log.errorHandler.startCatching()（app/log.ts）にはこれが届かない。例外は React
    // 自身が受け止めるので、window.onerror にも未処理の rejection にも届かないため。
    // この1行が無いと、ウィンドウを空にした失敗の痕跡が診断ログに何も残らない。
    log.error('[error-boundary] renderer render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // z-[14000]: 旧来の z の目盛りのどの層よりも上、そしてそれに合わせた shadcn の portal
    // （ダイアログ z-[13000]、ポップオーバー z-[13500]）よりも上。木が死んだ時に画面に出て
    // いたものが、唯一残る画面を透けて見えてはいけない。
    return (
      <div className="bg-background/95 fixed inset-0 z-[14000] flex flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-base font-medium">{t('renderErrorTitle')}</div>
        <div className="text-muted-foreground max-w-md text-sm">{t('renderErrorBody')}</div>
        <button type="button" className="bg-primary text-primary-foreground hover:opacity-90 rounded-md px-3 py-1.5 text-sm" onClick={() => location.reload()}>
          {t('renderErrorReload')}
        </button>
      </div>
    );
  }
}
