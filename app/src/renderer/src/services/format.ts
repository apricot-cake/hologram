// 表示整形サービス――純粋な件数／日付の表示整形。viewer.js から1:1で抽出
// した、viewer 分解（最終形B）における次の「純粋ロジック→サービス」
// 切り出し。engagement の件数、カード／インスペクタの日付、バックアップ
// レールの相対時刻は、それぞれ viewer.js のあちこちに散らばった専用関数で
// 整形されていて、その多くは呼ぶたびに Intl のフォーマッタを作り直して
// いた。このモジュールが唯一の持ち主で、フォーマッタを一度だけキャッシュ
// する。実体は本物の ES モジュール（named exports）で、利用側
// （viewer.ts / BackupStatus.tsx）から直接 import される。DOM には触れず、
// i18n の状態も持たない（相対時刻のラベルは渡される）。

// engagement の件数: 1.2K / 3.4M 式の省略表記。null/undefined → ''。
export function formatCount(n: number | null | undefined): string {
  if (n == null) return '';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 10000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// 日付フィルタのチップが使う数値の短縮日付（今年なら M/D、それ以外は Y/M/D）。
export function formatShortDate(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const thisYear = new Date().getFullYear().toString();
  return y === thisYear ? `${Number.parseInt(m, 10)}/${Number.parseInt(d, 10)}` : `${y}/${Number.parseInt(m, 10)}/${Number.parseInt(d, 10)}`;
}

// カードフッターの日付: 1つのコンパクトな月名付き日付（例:「Jun 13」／
// 「6月13日」）――ただの「6/13」は ×N の画像バッジの隣では分数のように
// 読めてしまう。フォーマッタはキャッシュ済み: compactDate はカード1枚に
// つき1回、最大150枚まで走る。
const _compactFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const _compactFmtY = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export function compactDate(ds: string | number | Date): string {
  if (!ds) return '';
  const d = new Date(ds);
  if (Number.isNaN(d.getTime())) return '';
  return d.getFullYear() === new Date().getFullYear() ? _compactFmt.format(d) : _compactFmtY.format(d);
}

// 月セクションの見出し（#47）:「July 2026」／「2026年7月」――ロケールが
// 言語ごとの語順をただで与えてくれる。compactDate の日単位の形式（年を
// 一切含まず、月全体にわたるセクションには合わない形）とは違う。ms は
// 対象の月の中の任意のタイムスタンプで、読むのは年＋月だけ。
const _monthFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' });
export function monthLabel(ms: number): string {
  return _monthFmt.format(new Date(ms));
}

// カードのホバーツールチップ向けの日付＋時刻の完全な形。Intl のフォーマッタは
// キャッシュ済み: 呼ぶたびに新しい toLocaleDateString/TimeString を作ると
// 描画時間の大半を占めていた（1カードにつき2回×150枚）。
const _dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' });
const _timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
export function formatDate(isoStr: string | number | Date): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  return _dateFmt.format(d) + ' ' + _timeFmt.format(d);
}

// バックアップのツールチップ: 絶対表記の Y/M/D HH:MM（ゼロ埋め、ロケールに依存しない）。
export function fmtTime(iso: string | number | Date): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// バックアップレール: コンパクトな相対時刻（今日／昨日 HH:MM、それ以外は
// M/D または Y/M/D）。「今日」「昨日」の語は呼び出し側が i18n として持ち、
// ラベルとして渡す。
export function fmtBackupTime(iso: string | number | Date, labels: { today: string; yesterday: string }): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const hhmm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `${labels.today} ${hhmm}`;
  if (sameDay(d, yest)) return `${labels.yesterday} ${hhmm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// インスペクタの欄（登録日／投稿日／保存日／更新日）向けのロケール既定値。
// プラットフォームの既定のまま（明示的なオプション無し）にしているのは、
// これが置き換えたインラインの `new Date(x).toLocale*()` 呼び出しと出力が
// バイト単位で一致するように。falsy な値には ''。
export const localeDate = (x: string | number | Date | null | undefined) => (x ? new Date(x).toLocaleDateString() : '');
export const localeDateTime = (x: string | number | Date | null | undefined) => (x ? new Date(x).toLocaleString() : '');
