// ページコンテキスト (world: MAIN) で実行
// React fiber から tweet.user.id_str を読み、article 要素に属性としてセット
(() => {
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

  extractUserIds();
  new MutationObserver(() => extractUserIds())
    .observe(document.body, { childList: true, subtree: true });
})();
