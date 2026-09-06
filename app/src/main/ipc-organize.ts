'use strict';

// 整理情報層の IPC ハンドラ。これらの get/set チャネルはライブラリごとの整理状態
// （タグの種別、未グループ化の集合、手動グループ、フォルダ、投稿者フォルダ／
// タグ）を永続化する——すべて getDbWriter 経由で DB に保持される（#298/St5 の
// 正本切り替えで、以前住んでいた整理情報 JSON ファイルから移した。
// lib-db-write.ts 参照）。どのハンドラも getSaveFolder + getDbWriter だけを
// 必要とし、両方とも ctx 経由で届く。
//
// #32 St2: 下の set-* が成功するたびに、他の「すべての」ウィンドウへ
// `org-changed` イベントを中継する（ctx.sendExcept）——送信元自身のメモリ上の
// ストアは（この呼び出しの前に楽観的に書いているので）既に最新であり、自分
// 自身の書き込みを送り返すのは、良くて無駄な往復、悪くすると書き込み自体が
// 触れていない進行中のローカル UI 状態のリセットになってしまう。`kind` は
// チャネル自身のドメイン名と一致する（renderer/services/*.ts の org-changed の
// 購読側はこれをキーにして、実際に変わったストアだけを再読み込みする）。
import { ipcMain } from './activity-ipc.ts';
import type { IpcContext } from './ipc-context.ts';
import type { FoldersState, ManualGroupsState, OkResult, PosterAliasesState, PosterTagsState, TagTypesState, UngroupedState } from './ipc-payloads.ts';

function register(ctx: IpcContext) {
  const { getSaveFolder, getDbWriter, sendExcept } = ctx;

  // タグの「語彙帳」: タグの種別は「タグ」自身の属性であって、どの投稿の属性でも
  // ない——だから数百の異なるタグを分類するのに投稿側の移行は一切要らない。
  // #810 はこれをタグの「エンティティ」でキーにした（`types` は種別付きタグごとに
  // 1行であって、名前の map ではない）: `kind` は tags 行の1列なので、同じ名前の
  // 2つのタグが異なる種別を持つことができ、名前をキーにしたペイロードでは
  // 往復のたびにどちらかが失われていた。一覧に無いタグは暗黙に「一般」。改名
  // 可能な work⊃character のペアが著作物／キャラクターの節を支え、`labels` は
  // その2つの種別「名」の改名表（#810 の影響を受けない）。
  ipcMain.handle('get-tag-types', (): TagTypesState => {
    return getSaveFolder() ? getDbWriter().getTagTypes() : { types: [], labels: null };
  });

  ipcMain.handle('set-tag-types', (_e, types, labels): OkResult => {
    const folder = getSaveFolder();
    if (!folder || !Array.isArray(types)) return { ok: false };
    try {
      getDbWriter().setTagTypes(types, labels);
      sendExcept(_e.sender.id, 'org-changed', 'tag-types');
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // 永続化された、投稿ごとの「グループ化しない」集合（画像ビュー）。画像を
  // 個別のタイルのまま保つべき投稿のキー（例: 1つの投稿の複数枚の写真で、
  // 複数ページの作品ではないもの）。<saveFolder>/ungrouped.json として住む:
  // { keys: [...] }。
  ipcMain.handle('get-ungrouped', (): UngroupedState => {
    return getSaveFolder() ? getDbWriter().getUngrouped() : { keys: [] };
  });
  ipcMain.handle('set-ungrouped', (_e, keys): OkResult => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false };
    try {
      getDbWriter().setUngrouped(keys);
      sendExcept(_e.sender.id, 'org-changed', 'ungrouped');
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // 投稿者ごとのタグ（投稿者ビュー）。
  // 投稿のタグ語彙（同じ tags テーブル）を共有するが、投稿者をキーにし、投稿には
  // 保存されない。#810 以降は非対称: 「読み取り」はタグのエンティティを返す
  // （名前 + id + #774 の effective 集合。だから投稿者の絞り込みは id で一致し、
  // 親子関係も投稿者に届く）。「書き込み」は今もエディタが作る単純な
  // { tags: { "<posterKey>": ["tag", …] } } という名前の map のまま。
  ipcMain.handle('get-poster-tags', (): PosterTagsState => {
    return getSaveFolder() ? getDbWriter().getPosterTags() : { tags: {} };
  });
  ipcMain.handle('set-poster-tags', (_e, data): OkResult => {
    const folder = getSaveFolder();
    if (!folder || !data || typeof data.tags !== 'object' || !data.tags) return { ok: false };
    try {
      getDbWriter().setPosterTags(data);
      sendExcept(_e.sender.id, 'org-changed', 'poster-tags');
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // 投稿者の名寄せ（#23 St1）: 現実世界の同じ作者／アカウントを指す posterKey の、
  // 破壊しない・可逆なグループ。{ groups: [{ id, primary, members:[posterKey] }] }
  // ——すべての読み手（buildUsers、'user' クエリの葉、poster-tag/-folder の
  // 和集合読み取り）が、メンバーのキーをそのグループの primary へ畳み込む。
  // ここが投稿レコードに触れることは一切無い。グループにはメンバーが2人以上
  // 必要。lib-db-write.ts の replacePosterAliases は、resolve() が有効に使えない
  // 値を受け入れるのではなく、それより小さいものはすべて捨てる。
  ipcMain.handle('get-poster-aliases', (): PosterAliasesState => {
    return getSaveFolder() ? getDbWriter().getPosterAliases() : { groups: [] };
  });
  ipcMain.handle('set-poster-aliases', (_e, data): OkResult => {
    const folder = getSaveFolder();
    if (!folder || !data || !Array.isArray(data.groups)) return { ok: false };
    try {
      getDbWriter().setPosterAliases(data);
      sendExcept(_e.sender.id, 'org-changed', 'poster-aliases');
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // 手動の画像グループ（画像ビュー）: 1つのタイルへまとめるべき、利用者定義の
  // captureId のグループ（投稿 URL で自動グループ化されない画像向け）。
  // <saveFolder>/manual-groups.json として住む: { groups: [ [captureId, …], … ] }。
  ipcMain.handle('get-manual-groups', (): ManualGroupsState => {
    return getSaveFolder() ? getDbWriter().getManualGroups() : { groups: [] };
  });
  ipcMain.handle('set-manual-groups', (_e, groups): OkResult => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false };
    try {
      getDbWriter().setManualGroups(groups);
      sendExcept(_e.sender.id, 'org-changed', 'manual-groups');
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // `folders` ——名前付きフォルダ（旧称「コレクション」）を統一したコンテナ。
  // 各フォルダは { id, name, kind:'static'|'dynamic', created, parentId,
  // items:[captureId] }。動的フォルダはさらに保存された検索（`tree`）を持ち、
  // アイテムは持たない。`activeId` は legacy（旧 🔖 ワンクリックの対象）で、
  // レンダラーはもうこれを書かないので null に落ち着く。
  ipcMain.handle('get-folders', (): FoldersState => {
    const empty = { folders: [], activeId: null };
    return getSaveFolder() ? getDbWriter().getFolders() : empty;
  });
  ipcMain.handle('set-folders', (_e, data): OkResult => {
    if (!getSaveFolder()) return { ok: false };
    try {
      getDbWriter().setFolders(data);
      sendExcept(_e.sender.id, 'org-changed', 'folders');
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

export { register };
