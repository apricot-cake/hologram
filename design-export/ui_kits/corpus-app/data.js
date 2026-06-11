// Sample archive data for the Corpus UI kit — fake posts/illustrations.
// Images are the abstract placeholder set in assets/sample/.
(function () {
  const img = (n) => `../../assets/sample/art-${String(n).padStart(2, '0')}.jpg`;

  const POSTS = [
    { id:1, platform:'bluesky', displayName:'青空スケッチ', screenName:'sora_sketch', text:'夕方の光がきれいだったので描きました。空のグラデーションを意識しています。', image:img(3), likes:12480, reposts:321, replies:42, date:'2026-06-08', capturedAt:'2026-06-08', tags:['イラスト','風景'], mediaType:'image', folder:true },
    { id:2, platform:'x', displayName:'machi', screenName:'machi_draws', text:'ラフ。あとで清書する。色のあたりだけ置いた状態。', image:img(7), likes:842, reposts:18, replies:3, date:'2026-06-06', tags:['ラフ'], isReply:true, mediaType:'image' },
    { id:3, platform:'pixiv', displayName:'灯と影', screenName:'akari_kage', text:'連作「街の明かり」3枚目。夜のシリーズが続きます。', image:img(1), likes:5300, reposts:210, replies:31, date:'2026-06-05', tags:['イラスト','夜景','連作'], mediaType:'image', folder:true },
    { id:4, platform:'misskey', displayName:'haru', screenName:'haru_m', text:'走り描きGIF。動きの練習。', image:img(9), likes:128, reposts:6, replies:1, date:'2026-06-03', tags:['練習'], mediaType:'gif' },
    { id:5, platform:'mastodon', displayName:'よる', screenName:'yoru', text:'静物。質感の検証。布の落ち方が難しい。', image:img(4), likes:64, reposts:2, replies:0, date:'2026-06-01', tags:['習作'], mediaType:'image' },
    { id:6, platform:'x', displayName:'くも', screenName:'kumo_art', text:'引用元の構図がよかったので自分でも。', image:img(11), likes:2100, reposts:88, replies:12, date:'2026-05-29', tags:['イラスト'], isQuote:true, mediaType:'image' },
    { id:7, platform:'bluesky', displayName:'もり', screenName:'mori_zzz', text:'森の中の小さな家。背景の練習を続けています。', image:img(2), likes:910, reposts:40, replies:7, date:'2026-05-27', tags:['風景','背景'], mediaType:'image', folder:true },
    { id:8, platform:'pixiv', displayName:'なみ', screenName:'nami_draw', text:'海シリーズ。波の表現を変えてみた。', image:img(6), likes:430, reposts:14, replies:2, date:'2026-05-24', tags:['イラスト','海'], mediaType:'image' },
    { id:9, platform:'x', displayName:'そら', screenName:'sora_v', text:'タイムラプス動画。制作過程です。', image:img(10), likes:3400, reposts:156, replies:23, date:'2026-05-22', tags:['過程'], mediaType:'video' },
    { id:10, platform:'misskey', displayName:'つき', screenName:'tsuki', text:'月と猫。今日のらくがき。', image:img(8), likes:220, reposts:9, replies:4, date:'2026-05-20', tags:['らくがき','猫'], mediaType:'image' },
    { id:11, platform:'bluesky', displayName:'あめ', screenName:'ame_ame', text:'雨の日の窓。にじみの表現が気に入っている。', image:img(5), likes:1580, reposts:62, replies:9, date:'2026-05-18', tags:['イラスト','雨'], mediaType:'image' },
    { id:12, platform:'pixiv', displayName:'ひかり', screenName:'hikari_p', text:'光の差し込む部屋。逆光の練習。', image:img(12), likes:7200, reposts:298, replies:51, date:'2026-05-15', tags:['イラスト','光'], mediaType:'image', folder:true },
  ];

  const PLATFORMS = [
    { id:'x', label:'X' }, { id:'bluesky', label:'Bluesky' },
    { id:'misskey', label:'Misskey' }, { id:'mastodon', label:'Mastodon' },
    { id:'pixiv', label:'pixiv' },
  ];
  const TAGS = [
    { label:'イラスト', count:128 }, { label:'風景', count:64 }, { label:'夜景', count:21 },
    { label:'習作', count:18 }, { label:'らくがき', count:15 }, { label:'海', count:12 },
    { label:'背景', count:11 }, { label:'猫', count:9 },
  ];
  const FOLDERS = [
    { id:'fav', label:'お気に入り', count:42, default:true },
    { id:'ref', label:'資料', count:88 },
    { id:'wip', label:'制作中', count:13 },
  ];

  window.CorpusData = { POSTS, PLATFORMS, TAGS, FOLDERS };
})();
