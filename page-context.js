// ページコンテキスト (world: MAIN) で実行
// React fiber から tweet.user.id_str を読み、article 要素に属性としてセット
(() => {
  let pending = false;

  function extractUserIds() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]:not([__x-user-id])');
    for (const article of articles) {
      const fiberKey = Object.keys(article).find((k) => k.startsWith('__reactFiber$'));
      if (!fiberKey) continue;

      let fiber = article[fiberKey];
      for (let depth = 0; fiber && depth < 20; depth++) {
        const tweet = fiber.memoizedProps?.tweet;
        if (tweet?.user?.id_str) {
          article.setAttribute('__x-user-id', tweet.user.id_str);
          break;
        }
        fiber = fiber.return;
      }
    }
  }

  function scheduleExtract() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      extractUserIds();
    });
  }

  extractUserIds();
  new MutationObserver(scheduleExtract)
    .observe(document.body, { childList: true, subtree: true });

  // content.js (ISOLATED world) からのオンデマンド抽出リクエスト
  document.addEventListener('__postSnap_extractUserIds', () => {
    extractUserIds();
  });
})();
