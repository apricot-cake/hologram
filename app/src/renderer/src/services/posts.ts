// 投稿サービス――投稿レコードの CRUD、インポート／エクスポート、保存フォルダ
// の移動フロー（list/listDelta/recordPostView/imageDataUrl/deletePost/updateTags/
// importImages/clearAll/exportSave/exportComplete/
// importComplete/pickSaveFolder/onPostsChanged/onSaveFolderProgress）を、
// 平坦な hologramIpc 呼び出しをラップして提供する。今では本物の ES
// モジュール（named exports）で、このドメインを共有する利用側から直接
// import される: viewer.ts（list/delete/tags/import/clearAll/change-watch）、
// App.tsx（onPostsChanged）、設定 > データコンポーネント（保存フォルダの
// 移動＋ZIP のエクスポート／インポート＋メディアのインポート）――純粋に
// 1:1 で転送するだけで、ラップするロジックは無い（trash/backup と同じ。
// レコード形状／グルーピングの純粋ロジックを持つ services/records.ts とは
// 違い、IPC 呼び出しは持たない）。
import { hologramIpc } from './ipc.ts';
import type { DroppedFile } from '../../../main/ipc-payloads.ts';

export function listPosts() {
  return hologramIpc.listPosts();
}
export function listPostsDelta(haveBaseline: boolean) {
  return hologramIpc.listPostsDelta(haveBaseline);
}
export function recordPostView(captureId: string) {
  return hologramIpc.recordPostView(captureId);
}
export function setMediaCrop(postId: string, seq: number, crop: import('./records.ts').CropRect | null) {
  return hologramIpc.setMediaCrop(postId, seq, crop);
}
export function imageDataUrl(image: string) {
  return hologramIpc.imageDataUrl(image);
}
// pixiv ugoira の再生（#506）。アーカイブは main 側に留まる――これらは
// プレイヤーにフレームテーブルの有無を渡し、その後1フレームずつバイト列を
// 渡す。
export function ugoiraFramesPresent(file: string, names: string[]) {
  return hologramIpc.ugoiraFramesPresent(file, names);
}
export function ugoiraFrame(file: string, name: string) {
  return hologramIpc.ugoiraFrame(file, name);
}
export function deletePost(image: string) {
  return hologramIpc.deletePost(image);
}
export function updateTags(...args: Parameters<typeof hologramIpc.updateTags>) {
  return hologramIpc.updateTags(...args);
}
// #774: タグ編集の結果を、読み込み済みのレコードへ書き込む。すべての
// タグ変更経路（インスペクタ／一括／undo）はライブラリを
// 読み直すのではなく allPosts をその場で編集する。#5 以来、レコードは
// 名前だけでは組み立て直せない id キー付きのタグ配列を持つ――たった今
// 入力されたタグは、書き込みがそれを作るまで id を持たず、1つの名前が
// 2つの実体に属することもある。だから id は書き込み（updateTags の
// UpdateTagsResult）から返ってきて、4つの配列が並行するよう一緒にここへ
// 着地する。
//
// 書き込みがそれらを持たずに答えたとき（失敗した、または DB が開いて
// いない）、古いものは残すのではなく「落とす」: tagIds[] ともう対応しない
// tags[] は、無いよりも悪い――id が見つからない読み手は名前一致へ
// フォールバックする。それが、id がわからないレコードにとってまさに
// 正しい答え。
export function applyTagWrite(rec: HologramPost, next: string[], res: { tags?: string[]; tagIds?: number[] } | null | undefined) {
  rec.tags = res?.tags ? res.tags.slice() : next.slice();
  rec.tagIds = res?.tagIds?.slice();
}
export function importImages() {
  return hologramIpc.importImages();
}
// ウィンドウへのドロップでインポート（#234）。2ステップ: collect が
// 走査＋件数を数える（まだ何も書き込まない）。import は、呼び出し側が
// 「はい」を得たら同じ一覧を書き戻す――その間に配線された確認は
// services/drop-intake.ts を参照。
export function collectDroppedPaths(paths: string[]) {
  return hologramIpc.collectDroppedPaths(paths);
}
export function importDroppedPaths(files: DroppedFile[]) {
  return hologramIpc.importDroppedPaths(files);
}
// OS からウィンドウへドラッグされた File の裏にある実際の fs パス（#234）。
export function getPathForFile(file: File): string {
  return hologramIpc.getPathForFile(file);
}
// Ctrl+V（#85）。`title` はレコードが得るカードのラベル――ローカライズ済みの
// テキストで main はメッセージ表を持たないため、呼び出し側が組み立てる。
export function importClipboard(title: string) {
  return hologramIpc.importClipboard(title);
}
export function clearAll() {
  return hologramIpc.clearAll();
}
export function exportSave(...args: Parameters<typeof hologramIpc.exportSave>) {
  return hologramIpc.exportSave(...args);
}
export function exportComplete(mode?: string, includeTrash?: boolean) {
  return hologramIpc.exportComplete(mode, includeTrash);
}
// main がファイルピッカーと読み取りの両方を持つ（#485）――これはインポート
// 結果または { canceled:true } を返す。
// 対応外のアーカイブは失敗として返す。
export function importComplete() {
  return hologramIpc.importComplete();
}
export function pickSaveFolder() {
  return hologramIpc.pickSaveFolder();
}
// 選択フローの後半――pick-save-folder が警告と共に返してきて、利用者が
// それを受け入れた行き先へ移動する（#95）。
export function moveSaveFolder(dest: string) {
  return hologramIpc.moveSaveFolder(dest);
}
export function onSaveFolderProgress(cb: (p: any) => void) {
  return hologramIpc.onSaveFolderProgress(cb);
}
// エクスポートのストリーミング進捗: 購読解除関数を返す。ペイロード: 実行中は
// {written,total,pct}、その後 {done:true}。
export function onExportProgress(cb: (p: any) => void): () => void {
  return hologramIpc.onExportProgress(cb);
}
export function onPostsChanged(cb: () => void) {
  return hologramIpc.onPostsChanged(cb);
}
