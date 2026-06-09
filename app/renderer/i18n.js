// i18n helper for the Electron viewer (renderer) only.
// Language resolves from the app's saved preference (config.json `language`, via
// window.corpus.getPrefs); 'auto' follows navigator.language (the OS/app
// locale). The viewer reloads on change so the new language takes effect.
//
// Consumers do: const { getMessage, lang, resolved } = await window.corpusI18n;
// then call getMessage('key', [sub1, sub2]).
//
// Note: the extension's capture banner keeps its OWN copy of strings in the root
// i18n.js (the extension can't read this file or the app's config), so banner /
// content-script strings deliberately do NOT live here.
(function () {
  const MESSAGES = {
    ja: {
      // viewer: tabs / search / sort
      tabPosts: '投稿',
      tabTags: 'ハッシュタグ',
      emptyHashtags: 'ハッシュタグがありません',
      tabSettings: '設定',
      searchPlaceholder: 'テキスト・ユーザー名で検索',
      searchExact: '通常',
      searchFuzzy: 'あいまい',
      searchModeTitle: '検索方式を切替（通常 / あいまい）',
      searchHashtags: 'ハッシュタグを絞り込み',
      searchTags: 'タグを絞り込み',
      tabUsers: 'ユーザー',
      searchUsers: 'ユーザー名で絞り込み',
      emptyUsers: 'ユーザーがいません',
      sidebarAuthors: '作者',
      searchAuthors: '作者を絞り込み',
      kindTitle: '種別',
      kindPost: 'SNS投稿',
      kindImage: '画像',
      multiOnly: '複数画像のみ',
      sortDateDesc: '新しい順',
      sortDateAsc: '古い順',
      sortLikes: 'いいね順',
      sortReposts: 'リポスト順',
      sortReplies: '返信順',
      sortCaptured: 'キャプチャ日時順',
      sortLikesPct: '人気順（SNS内）',
      filterAll: 'すべて',
      postCount: '$1 件',

      // viewer: empty states
      emptyTitle: '投稿がありません',
      emptyDesc: 'SNSで投稿を保存すると、ここに表示されます。',
      emptySearchTitle: '見つかりませんでした',
      emptySearchDesc: '検索条件を変更してください。',

      // viewer: common
      save: '保存',
      saved: '保存しました',

      // settings > save folder (app)
      saveFolderTitle: '保存先フォルダ',
      chooseFolder: 'フォルダを選択',
      hintSaveFolder: 'キャプチャした画像とメタデータの保存先。変更すると次回キャプチャ分から新しい場所に保存されます。',

      // viewer: settings > language / shortcut
      langTitle: '言語',
      langAuto: '自動（OSの言語設定に従う）',
      hintLang: 'ビューアの表示言語を変更します。変更後に再読み込みされます。',
      themeTitle: '外観',
      themeMode: 'テーマ',
      themeAuto: 'システムに合わせる',
      themeLight: 'ライト',
      themeDark: 'ダーク',
      hintTheme: 'システムに合わせると、OSの設定に追従します。',
      shortcutTitle: 'キーボードショートカット',
      shortcutLink: 'ショートカットを変更',
      hintShortcut: '拡張機能のショートカット設定ページを開きます。初期値: Alt+S（保存）。ショートカットが反応しない場合は、再インストール時にアサインが外れている可能性があります。上のリンクから再設定してください。',

      // viewer: settings > data / danger
      dataTitle: 'データ',
      exportZip: 'ZIP エクスポート',
      importZip: 'ZIP から復元',
      importImages: '画像を取り込み',
      hintExport: 'ZIP: 画像＋メタデータをまとめて書き出し／復元。画像を取り込み: 手持ちの画像（任意）をライブラリに追加。',
      // viewer: settings > backup（指定フォルダへの増分エクスポート）
      backupTitle: 'バックアップ / 自動エクスポート',
      hintBackup: '保存先を直接クラウド同期すると壊れやすいので、選んだ場所の Corpus-backup フォルダへ安全に増分コピーします。',
      backupDirNone: '（出力先が未設定）',
      backupChoose: '出力先を選択',
      backupClear: '解除',
      backupContentTitle: 'エクスポートする内容',
      backupContentMeta: 'メタデータ込み',
      backupContentMedia: 'メディアのみ',
      backupScheduleTitle: '自動エクスポート',
      backupOnStart: 'アプリ起動時に毎回',
      backupInterval: '一定間隔：',
      backupIntervalUnit: '時間ごと',
      backupOnChange: '変更時',
      backupRunNow: '今すぐエクスポート',
      backupRestore: 'フォルダから復元',
      backupRunning: 'エクスポート中…',
      backupNotSet: '先に出力先フォルダを選んでください',
      backupOverlap: '保存先フォルダと重なる場所は選べません',
      backupLastLabel: '前回',
      backupItemsUnit: '件',
      backupSkipLabel: '据置',
      dangerTitle: '危険な操作',
      labelResetDeleteConfirm: '投稿削除時に確認を表示する',
      hintResetDeleteConfirm: '「今後表示しない」を選んだ場合にここで戻せます',
      clearData: '全データを削除',
      confirmClear: '保存先フォルダ内のすべての投稿（画像とメタデータ）を削除しますか？この操作は元に戻せません。',
      confirmOk: '削除する',
      confirmCancel: 'キャンセル',
      cleared: 'データを削除しました',

      // viewer: export / import toasts
      exporting: 'エクスポート中...',
      exported: 'エクスポートしました',
      importing: 'インポート中...',
      imported: '$1 件インポートしました',
      importSkipped: '$1 件インポート（$2 件は既存のためスキップ）',
      noData: 'エクスポートするデータがありません',
      importFailed: 'インポートに失敗しました',

      // viewer: engagement labels (legacy, still referenced)
      engagementLikes: 'いいね（全SNS）',
      engagementReposts: 'リポスト（全SNS）',
      engagementReplies: '返信（全SNS）',
      engagementBookmarks: 'ブックマーク（Xのみ）',
      engagementViews: '閲覧数（Xのみ）',
      engagementSuffix: '以上',

      // viewer: view toggle + selection
      viewCard: 'カード',
      viewTile: 'タイル',
      viewList: 'リスト',
      selectAll: 'すべて選択',
      deselectAll: '選択解除',
      cancelSelect: 'キャンセル',
      deleteSelected: '投稿を削除',
      selectedCount: '$1 件選択中',
      confirmDeleteSelected: '$1 件の投稿を削除しますか？',
      deletedN: '$1 件削除しました',
      confirmDeletePost: 'この投稿を削除しますか？',
      confirmSkip: '今後表示しない',
      deleted: '削除しました',

      // viewer: post card
      dateTypePost: '投稿日',
      dateTypeCaptured: 'キャプチャ日',
      clickToExpand: 'クリックで全文表示',
      tipOpen: '投稿を開く',
      lbPrev: '前へ',
      lbNext: '次へ',
      tipEdit: 'タグを編集',
      tipDelete: '削除',
      postedOn: '$1 に投稿',
      captured: '$1 にキャプチャ',
      statsNote: 'エンゲージメントはキャプチャ時点の値です',

      // viewer: edit overlay
      tagsLabel: 'タグ',
      addTag: '追加',
      tagPlaceholder: 'タグを入力',
      applyToSelected: '選択に適用',

      // viewer: query/sidebar filters
      qfPlatform: 'プラットフォーム',
      qfPostType: '投稿タイプ',
      qfDate: '日付',
      qfEngagement: 'エンゲージメント',
      qfTag: 'タグ',
      qfMedia: 'メディア',
      qfInstance: 'インスタンス',
      qfPost: 'ポスト',
      qfReply: 'リプライ',
      qfQuote: '引用',
      qfThread: 'セルフリプ',
      qfImage: '画像',
      qfVideo: '動画',
      qfGif: 'GIF',
      qfApply: '適用',
      qfDelete: '削除',
      qfDatePost: '投稿日',
      qfDateCaptured: 'キャプチャ日',
      qfDateFrom: '開始日',
      qfDateTo: '終了日',
      qfEngLikes: 'いいね（全SNS）',
      qfEngReposts: 'リポスト（全SNS）',
      qfEngReplies: '返信（全SNS）',
      qfEngBookmarks: 'ブックマーク（Xのみ）',
      qfEngViews: '閲覧数（Xのみ）',
      qfEngSuffix: '以上',
      qfEngGte: '以上',
      qfEngLte: '以下',
      sbActiveTitle: 'アクティブフィルタ'
    },

    en: {
      tabPosts: 'Posts',
      tabTags: 'Hashtags',
      emptyHashtags: 'No hashtags yet',
      tabSettings: 'Settings',
      searchPlaceholder: 'Search by text or username',
      searchExact: 'Exact',
      searchFuzzy: 'Fuzzy',
      searchModeTitle: 'Toggle search mode (exact / fuzzy)',
      searchHashtags: 'Filter hashtags',
      searchTags: 'Filter tags',
      tabUsers: 'Users',
      searchUsers: 'Filter users',
      emptyUsers: 'No users yet',
      sidebarAuthors: 'Authors',
      searchAuthors: 'Filter authors',
      kindTitle: 'Kind',
      kindPost: 'Posts',
      kindImage: 'Images',
      multiOnly: 'Multi-image only',
      sortDateDesc: 'Newest first',
      sortDateAsc: 'Oldest first',
      sortLikes: 'Most liked',
      sortReposts: 'Most reposted',
      sortReplies: 'Most replied',
      sortCaptured: 'Captured date',
      sortLikesPct: 'Top (within SNS)',
      filterAll: 'All',
      postCount: '$1 posts',

      emptyTitle: 'No posts yet',
      emptyDesc: 'Save a post from SNS and it will appear here.',
      emptySearchTitle: 'No results found',
      emptySearchDesc: 'Try changing your search terms.',

      save: 'Save',
      saved: 'Saved',

      // settings > save folder (app)
      saveFolderTitle: 'Save folder',
      chooseFolder: 'Choose folder',
      hintSaveFolder: 'Where captured images and metadata are stored. Changing it affects future captures.',

      langTitle: 'Language',
      langAuto: 'Auto (follow system language)',
      hintLang: 'Changes the viewer display language. The app reloads after the change.',
      themeTitle: 'Appearance',
      themeMode: 'Theme',
      themeAuto: 'Match system',
      themeLight: 'Light',
      themeDark: 'Dark',
      hintTheme: 'Match system follows your OS appearance setting.',
      shortcutTitle: 'Keyboard Shortcut',
      shortcutLink: 'Change keyboard shortcut',
      hintShortcut: 'Opens the extension shortcuts page. Default: Alt+S (capture). If shortcuts stop working after reinstall, they may have been unassigned. Use the link above to reassign them.',

      dataTitle: 'Data',
      exportZip: 'Export ZIP',
      importZip: 'Restore from ZIP',
      importImages: 'Import images',
      hintExport: 'ZIP: export/restore images + metadata together. Import images: add your own images to the library.',
      // viewer: settings > backup (incremental export to a chosen folder)
      backupTitle: 'Backup / auto-export',
      hintBackup: 'Syncing the live save folder directly risks corruption, so this incrementally copies into a "Corpus-backup" folder at the place you choose.',
      backupDirNone: '(no output folder set)',
      backupChoose: 'Choose folder',
      backupClear: 'Clear',
      backupContentTitle: 'What to export',
      backupContentMeta: 'With metadata',
      backupContentMedia: 'Media only',
      backupScheduleTitle: 'Auto-export',
      backupOnStart: 'On every app start',
      backupInterval: 'Every',
      backupIntervalUnit: 'hours',
      backupOnChange: 'On changes',
      backupRunNow: 'Export now',
      backupRestore: 'Restore from folder',
      backupRunning: 'Exporting…',
      backupNotSet: 'Choose an output folder first',
      backupOverlap: 'Cannot pick a folder overlapping the save folder',
      backupLastLabel: 'Last',
      backupItemsUnit: '',
      backupSkipLabel: 'kept ',
      dangerTitle: 'Danger Zone',
      labelResetDeleteConfirm: 'Show confirmation when deleting posts',
      hintResetDeleteConfirm: 'Re-enables the confirmation dialog if you chose "Don\'t ask again"',
      clearData: 'Delete all data',
      confirmClear: 'Delete every post (image and metadata) in the save folder? This cannot be undone.',
      confirmOk: 'Delete',
      confirmCancel: 'Cancel',
      cleared: 'Data deleted',

      exporting: 'Exporting...',
      exported: 'Exported',
      importing: 'Importing...',
      imported: '$1 posts imported',
      importSkipped: '$1 imported ($2 skipped as duplicates)',
      noData: 'No data to export',
      importFailed: 'Import failed',

      engagementLikes: 'Likes (all)',
      engagementReposts: 'Reposts (all)',
      engagementReplies: 'Replies (all)',
      engagementBookmarks: 'Bookmarks (X only)',
      engagementViews: 'Views (X only)',
      engagementSuffix: 'or more',

      viewCard: 'Cards',
      viewTile: 'Tiles',
      viewList: 'List',
      selectAll: 'Select all',
      deselectAll: 'Deselect all',
      cancelSelect: 'Cancel',
      deleteSelected: 'Delete posts',
      selectedCount: '$1 selected',
      confirmDeleteSelected: 'Delete $1 posts?',
      deletedN: '$1 posts deleted',
      confirmDeletePost: 'Delete this post?',
      confirmSkip: 'Don\'t ask again',
      deleted: 'Deleted',

      dateTypePost: 'Post date',
      dateTypeCaptured: 'Captured',
      clickToExpand: 'Click to expand',
      tipOpen: 'Open post',
      lbPrev: 'Previous',
      lbNext: 'Next',
      tipEdit: 'Edit tags',
      tipDelete: 'Delete',
      postedOn: 'Posted $1',
      captured: 'Captured $1',
      statsNote: 'Engagement counts are from the time of capture',

      tagsLabel: 'Tags',
      addTag: 'Add',
      tagPlaceholder: 'Enter tag',
      applyToSelected: 'Apply to selected',

      qfPlatform: 'Platform',
      qfPostType: 'Post type',
      qfDate: 'Date',
      qfEngagement: 'Engagement',
      qfTag: 'Tags',
      qfMedia: 'Media',
      qfInstance: 'Instances',
      qfPost: 'Post',
      qfReply: 'Reply',
      qfQuote: 'Quote',
      qfThread: 'Self-reply',
      qfImage: 'Image',
      qfVideo: 'Video',
      qfGif: 'GIF',
      qfApply: 'Apply',
      qfDelete: 'Delete',
      qfDatePost: 'Post date',
      qfDateCaptured: 'Captured',
      qfDateFrom: 'From',
      qfDateTo: 'To',
      qfEngLikes: 'Likes (all)',
      qfEngReposts: 'Reposts (all)',
      qfEngReplies: 'Replies (all)',
      qfEngBookmarks: 'Bookmarks (X only)',
      qfEngViews: 'Views (X only)',
      qfEngSuffix: 'or more',
      qfEngGte: '\u2265',
      qfEngLte: '\u2264',
      sbActiveTitle: 'Active Filters'
    }
  };

  window.corpusI18n = (async () => {
    let lang = 'auto';
    try {
      const prefs = await window.corpus.getPrefs();
      lang = prefs.language || 'auto';
    } catch {
      // prefs unavailable — fall back to auto
    }
    const resolved = lang === 'auto'
      ? (navigator.language && navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en')
      : (lang === 'ja' ? 'ja' : 'en');
    const table = MESSAGES[resolved] || MESSAGES.en;

    const getMessage = (key, subs) => {
      let text = table[key];
      if (text == null) return key;
      if (subs && subs.length) {
        for (let i = 0; i < subs.length; i++) {
          text = text.split('$' + (i + 1)).join(subs[i] == null ? '' : String(subs[i]));
        }
      }
      return text;
    };

    return { lang, resolved, getMessage };
  })();
})();
