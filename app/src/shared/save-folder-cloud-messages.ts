// 保存先のクラウド同期警告は main 所有のネイティブダイアログと renderer の
// 翻訳カタログで共有する。renderer から文言や locale を IPC で受け取ると、承認 UI の
// 根拠を信頼できない入力へ戻してしまうため、main は保存済み設定からこの表を選ぶ。
export const saveFolderCloudMessages = {
  en: {
    saveFolderCloudWarn: 'This folder looks like it syncs with {name}',
    saveFolderCloudWarnDesc: 'The library is rewritten while you use it, so a sync client can race those writes and corrupt it. Choose a folder outside sync. For a cloud copy, save a manually created backup file in a synced folder instead.',
    saveFolderCloudWarnOk: 'Change anyway',
    confirmCancel: 'Cancel',
  },
  ja: {
    saveFolderCloudWarn: 'このフォルダは {name} の同期対象のようです',
    saveFolderCloudWarnDesc: 'ライブラリは使用中に書き換わります。同期ツールと競合すると壊れる場合があります。同期対象外の場所を選んでください。クラウドへ控えを置く場合は、手動で作成したバックアップファイルを同期対象へ保存してください。',
    saveFolderCloudWarnOk: 'このまま変更',
    confirmCancel: 'キャンセル',
  },
} as const;
