(() => {
  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.log('[Eagle Info+]', ...args); };

  const siteConfig = getSiteConfig();
  if (!siteConfig) return;

  // dragstart を監視し、最小限の identity (postId 等) と画像 URL のみを background に送る。
  // 表示名・本文・ハッシュタグ等の取得は background 側でプラットフォーム公式 API から行う。
  document.addEventListener('dragstart', (e) => {
    if (!chrome.runtime?.id) return;
    const img = e.target.closest('img') || (e.target.tagName === 'IMG' ? e.target : null);
    if (!img) return;

    const identity = siteConfig.extractIdentity(img);
    log('identity:', identity);
    if (!identity) return;

    chrome.runtime.sendMessage({
      type: 'imageDragged',
      platform: siteConfig.platform,
      pageUrl: location.href,
      imageUrls: collectImageUrls(img, siteConfig.platform),
      identity
    });
  }, true);

  function collectImageUrls(img, platform) {
    const urls = new Set();
    if (img.src) urls.add(img.src);
    if (img.currentSrc) urls.add(img.currentSrc);

    const highRes = getHighResImageUrl(img, platform);
    if (highRes) urls.add(highRes);

    const srcset = img.getAttribute('srcset');
    if (srcset) {
      for (const entry of srcset.split(',')) {
        const url = entry.trim().split(/\s+/)[0];
        if (url) urls.add(url);
      }
    }
    return [...urls];
  }

  function getHighResImageUrl(img, platform) {
    const src = img.src || '';
    if (platform === 'x' && src.includes('pbs.twimg.com/media/')) {
      try {
        const url = new URL(src);
        url.searchParams.set('name', 'orig');
        return url.href;
      } catch {}
    }
    if (platform === 'bluesky' && src.includes('cdn.bsky.app')) {
      return src.replace(/@jpeg$/, '');
    }
    return null;
  }

  // === サイト設定 ===

  function getSiteConfig() {
    if (hostnameMatches('x.com') || hostnameMatches('twitter.com')) return xConfig();
    if (hostnameMatches('bsky.app')) return blueskyConfig();
    if (hostnameMatches('pixiv.net')) return pixivConfig();
    return null;
  }

  function hostnameMatches(host) {
    return location.hostname === host || location.hostname.endsWith(`.${host}`);
  }

  // --- X (Twitter) ---
  function xConfig() {
    return {
      platform: 'x',
      extractIdentity(img) {
        const link = img.closest('a[href*="/status/"]')
          || findAncestorContainerLink(img, 'a[href*="/status/"]');
        const parsed = link ? parseUrlPath(link.href, /^\/([^/]+)\/status\/([^/?#]+)/) : null;
        if (!parsed) return null;
        const [, screenName, postId] = parsed.match;
        const sn = decodeURIComponent(screenName);
        const pid = decodeURIComponent(postId);
        // 素の permalink を組み立てる。アンカーが /photo/N や /analytics でも postId は同じなので、
        // 末尾を引きずらず常に <origin>/<user>/status/<id> に正規化する (同一投稿で url が揃う)。
        let origin = 'https://x.com';
        try { origin = new URL(parsed.url).origin; } catch {}
        return {
          screenName: sn,
          postId: pid,
          link: `${origin}/${sn}/status/${pid}`
        };
      }
    };
  }

  // --- Bluesky ---
  function blueskyConfig() {
    return {
      platform: 'bluesky',
      extractIdentity(img) {
        const link = img.closest('a[href*="/post/"]')
          || findAncestorContainerLink(img, 'a[href*="/post/"]');
        const parsed = link ? parseUrlPath(link.href, /^\/profile\/([^/]+)\/post\/([^/?#]+)/) : null;
        if (!parsed) return null;
        const [, handle, postId] = parsed.match;
        return {
          screenName: decodeURIComponent(handle),
          postId: decodeURIComponent(postId),
          link: parsed.url
        };
      }
    };
  }

  // --- pixiv ---
  function pixivConfig() {
    const ARTWORK_PATH = /^\/(?:[a-z]+\/)?artworks\/(\d+)/;
    // pximg URL のファイル名: <postId>_p<N>_<size>.<ext>
    const PXIMG_FILENAME = /\/(\d+)_p\d+(?:_|\.)/;
    return {
      platform: 'pixiv',
      extractIdentity(img) {
        let postId = null;

        // 1. 画像 URL から postId 抽出 (最優先)。
        //    pximg URL には作品 ID が直接含まれてるので DOM 探索より確実。
        //    ユーザーページ・検索結果でドラッグしても正しい作品を一意に特定できる。
        for (const src of [img.src, img.currentSrc]) {
          if (!src) continue;
          const m = src.match(PXIMG_FILENAME);
          if (m) { postId = m[1]; break; }
        }

        // 2. 画像 URL に postId が無い場合のみ DOM を見る (data: URI 等の防御)
        if (!postId) {
          const link = img.closest('a[href*="/artworks/"]')
            || findAncestorContainerLink(img, 'a[href*="/artworks/"]');
          if (link) {
            const parsed = parseUrlPath(link.href, ARTWORK_PATH);
            if (parsed) postId = parsed.match[1];
          }
        }

        // 3. それでも無ければ作品ページに居る前提で location.pathname から
        if (!postId) {
          const m = location.pathname.match(ARTWORK_PATH);
          if (m) postId = m[1];
        }
        if (!postId) return null;
        return {
          screenName: null,
          postId: decodeURIComponent(postId),
          link: `https://www.pixiv.net/artworks/${postId}`
        };
      }
    };
  }

  // === ヘルパ ===

  // closest() で見つからない (img と link が祖先関係でない) ときに、
  // 画像と DOM 距離が最も近い候補リンクを返す。
  //
  // 過去の実装は document order の最初を返してたため、X タイムラインや pixiv の
  // ユーザーページのように同じ祖先内に複数の候補が並ぶレイアウトで、ページ最上部の
  // (= 最新の) 別投稿のリンクを誤って拾う不具合があった。
  function findAncestorContainerLink(img, selector) {
    let el = img.parentElement;
    while (el && el !== document.body) {
      const candidates = el.querySelectorAll(selector);
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) {
        // この階層に複数ある = 上に行きすぎた。img と最も近いものを選ぶ。
        let best = null;
        let bestDist = Infinity;
        for (const link of candidates) {
          const d = treeDistance(img, link);
          if (d < bestDist) { bestDist = d; best = link; }
        }
        return best;
      }
      el = el.parentElement;
    }
    return null;
  }

  // 2 ノード間の DOM ツリー距離 (LCA を経由したエッジ数)。
  function treeDistance(a, b) {
    const ancestorsA = [];
    for (let n = a; n; n = n.parentElement) ancestorsA.push(n);
    const indexInA = new Map(ancestorsA.map((n, i) => [n, i]));
    let depthB = 0;
    for (let n = b; n; n = n.parentElement) {
      if (indexInA.has(n)) return indexInA.get(n) + depthB;
      depthB++;
    }
    return Infinity;
  }

  function parseUrlPath(href, pathRegex) {
    try {
      const url = new URL(href, location.origin);
      const match = url.pathname.match(pathRegex);
      if (!match) return null;
      return { match, url: url.href };
    } catch {
      return null;
    }
  }
})();
