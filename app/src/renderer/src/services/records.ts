import type { Translate } from './translation.ts';
// レコードサービス＝レコード形状のヘルパー（media/artwork/density image）、
// 正規化（postKeyOf / stampPost）、グルーピング（groupRecords）、プラットフォーム別の
// いいね数パーセンタイル。viewer.js から1:1で抽出した、viewer 分解（最終形B）における
// 2番目の「純粋ロジック→サービス」切り出し。加えて（P4「IPC→service」ドメイン
// グルーピングの追加作業）manual-groups.json / ungrouped.json の読み込み・永続化の
// 一対も持つ。makeGroupRecords がすでに使っている2つのストアに対応する。
// 実体は本物の ES モジュール（named exports）で、viewer.ts / image-tab.ts と
// FloatingBar コンポーネント（postIdKey）から直接 import される。DOM には一切触れない。
// ランタイムの結合（manual groups / ungrouped の除外設定＝生きた viewer 状態）は
// makeGroupRecords(deps) を通して注入されるので、このファイルは Node 上でも読み込める
// （scripts/test-records-unit.cts が dynamic import で動かす）。下の読み込み・永続化の
// 一対は hologramIpc（services/ipc.ts）を経由する。postKeyOf は今はただの named export
// で、計画中の重複保存検知が実装されたら同じ URL→キー正規化を import できる。
import { isSortAscending, sortOption } from './sort-direction.ts';
import { hologramIpc } from './ipc.ts';
// URL→identity キーの正規化は native-host/ 側にある。ブリッジもこれを持つ必要があり
// （タイムラインの「保存済み」バッジが、パーマリンがすでにライブラリにあるかをこれに
// 問い合わせる、#54）、ここに2つ目の実装を置くと、バッジとグリッドが「どの投稿が
// 同じ投稿か」で食い違いかねない。ここでは re-export するだけで、レンダラー側の
// import 元はこのサービス経由のまま変えない。
import { postKeyOf } from '../../../../../native-host/post-key.mts';
export { postKeyOf };
import type { DisplayShape } from './display.ts';
import { localeDateTime } from './format.ts';
import { hasVisualMedia, userKey } from './query.ts';

// 投稿が持つ画像は、ダウンロードした原本だけ。テキストのみの投稿は画像を持たない。
// ダウンロード済みの media ファイルが静止画ではなく動画／アニメーションループで
// あるかどうか＝ギャラリーで <video> と Zoomable のどちらの分岐を選ぶか（下）にも、
// ここで生の動画ファイルを <img src> に入れないようにする判定にも使う（artworkFile は
// 代わりに poster を優先する）。
export const isVideoFile = (f: string | null | undefined) => /\.(mp4|webm|mov|m4v)$/i.test(f || '');
// pixiv の ugoira アーカイブか（#119 St3）。動画ファイルと同様に <img src> には
// 決してなれない＝静止画が必要な場面ではその poster が代わりを務める。
const isUgoiraFile = (f: string | null | undefined) => /\.zip$/i.test(f || '');
// メディアと切り抜き範囲の型は保存スキーマから導く。
export type CropRect = import('../../../../../native-host/post-schemas.mts').CropRectShape;
type HologramMediaItem = import('../../../../../native-host/post-schemas.mts').MediaItemShape;
const mediaItemsOf = (p: HologramPost): HologramMediaItem[] => (Array.isArray(p.media) ? (p.media as HologramMediaItem[]).filter((m) => m && m.file) : []);
export const mediaFilesOf = (p: HologramPost): string[] => mediaItemsOf(p).map((m) => m.file as string);
// 保存した原文は検索や再処理に使うため変更しない。カードとインスペクタで本文を
// 読むときだけ、同じ場所に画像が表示されていることを繰り返す添付 URL を隠す。
// X は通常の外部リンクを entities.urls から展開済みだが、添付画像を示す末尾の
// t.co は entities.media 側にあり短縮 URL のまま残る。そのため、画像を持つ X 投稿の
// 末尾だけを添付 URL とみなす。本文中の外部リンクは残す。
export function displayPostText(p: HologramPost): string {
  let text = String(p?.text || p?.title || '').trim();
  if (!text) return '';

  const media = Array.isArray(p?.media) ? (p.media as HologramMediaItem[]).filter(Boolean) : [];
  if (!media.length) return text;

  for (const item of media) {
    if (typeof item.url === 'string' && item.url) text = text.split(item.url).join('');
  }
  if (String(p.platform || '').toLowerCase() === 'x') {
    text = text.replace(/(?:\s*https?:\/\/t\.co\/[a-z0-9]+)+\s*$/i, '');
  }
  return text.trim();
}
// 先頭の media アイテムのサムネイル用ファイル＝動画/gif ならその poster（生の動画は
// <img src> になれない）、そうでなければファイル自体。動画に poster がなければ
// カード画像は空になる。
export const artworkFile = (p: HologramPost): string => {
  const items = mediaItemsOf(p);
  if (items.length) {
    const first = items[0];
    if (first.posterFile) return first.posterFile;
    return isVideoFile(first.file) || isUgoiraFile(first.file) ? '' : (first.file as string);
  }
  // `image` へのフォールバックは契約上つねに静止画のはず（normalizePostRecord が
  // 動画のファイル名を `video` へ移すため）だが、その規則ができる前に書かれた行は
  // いまだに動画名を持ちうる（#496）＝それを <img> に渡すと、空白ではなく壊れた
  // カードとして表示され、「顔のないレコード」ではなく「壊れたレコード」に見える。
  // ここから辿れる poster はないので、代わりに出せるものもない。
  return p.image && !isVideoFile(p.image) ? p.image : '';
};
export function densityImage(p: HologramPost): string {
  return artworkFile(p);
}

// #365: original-aspect グリッドがテキストのみのカードに確保する高さ（測るべき
// 画像が無いので shotW/H は常に 0 で、学習済みアスペクト比のキャッシュ項目も無い）。
// 連続関数ではなく本文の長さから離散的な段階で選ぶ＝列幅が固定のグリッドでは、
// 段階制のほうが連続的な高さよりも、長さの近い投稿を眺めたときに「同じ種類の
// カード」として読める。短いテキストは横広に置く（キャプション付きタイルのように
// 読める）、長いテキストは縦長に置く（実際に見せる余地を作る）。境界としきい値は
// 最初の一案＝実際のライブラリで画面に出したら、この4つの数字は動くはず。
const TEXT_PLATE_ASPECT_STEPS: [max: number, ratio: string][] = [
  [80, '4/3'],
  [220, '1/1'],
  [420, '3/4'],
  [Infinity, '2/3'],
];
export function textPlateAspect(text: string | null | undefined): string {
  const len = (text || '').length;
  for (const [max, ratio] of TEXT_PLATE_ASPECT_STEPS) if (len <= max) return ratio;
  return TEXT_PLATE_ASPECT_STEPS[TEXT_PLATE_ASPECT_STEPS.length - 1][1];
}

// --- グルーピング（image-view から移植） ------------------------------------
// 投稿全体の保存は同じ投稿 URL ごとにまとめる。個別保存は captureId ごとのカードにする。
// 手動グループは自動より優先し、ungrouped は投稿 URL ごとの自動グループを解除する。
export const postIdKey = (p: HologramPost): string => p.captureId || (p.url || '') + '|' + (p.capturedAt || '');
// 1レコードの「artwork ページ」＝本来の media、なければローカル／移行された画像。
export const groupFilesOf = (p: HologramPost): string[] => {
  const m = mediaFilesOf(p);
  if (m.length) return m;
  const a = artworkFile(p);
  if (a) return [a];
  return [];
};

// image-view のレコード解決（#144: 'image' の履歴エントリは
// { recs:[captureId…], idx } を持つ）。recs は起動のたびに、注入された byId 検索を
// 通して生きたライブラリに照らして解決される＝削除は壊れた画像ではなく
// 「missing」の空状態に落ち着く。代表の選び方は groupRecords と同じ（本文を
// 持つレコードを優先する）。純粋関数＝byId は注入される（このため
// Node 上でも読み込める）。
export function imageTabGroup(view: { id?: string; recs: string[] | null | undefined }, byId: (id: string) => HologramPost | undefined): HologramPostGroup | null {
  const ids: string[] = Array.isArray(view.recs) ? view.recs : [];
  const records = ids.map((id) => byId(id)).filter(Boolean) as HologramPost[];
  if (!records.length) return null;
  const rep = records.find((r) => r.text) || records[0];
  return { key: 'imgtab:' + (view.id || ''), records, rep, files: records.flatMap(groupFilesOf) };
}
// image タブのタイトル＝代表レコードの title/text を24字以内に切ったもの、
// なければその投稿者、それも無ければ呼び出し元が渡す「Untitled」の既定値
// （i18n は呼び出し元が持つ）。
export function imageTabTitleOf(g: HologramPostGroup, fallback: string): string {
  const p = g.rep;
  const raw = (p.title || p.text || '').trim().replace(/\s+/g, ' ');
  const base = raw || p.displayName || fallback;
  return base.length > 24 ? base.slice(0, 24) + '…' : base;
}

// deps はグルーピングが自前で持ってはいけない、生きた viewer 状態を運ぶ:
//   manualGroups() → [[captureId,…],…] ＝利用者が組んだグループ（自動より優先）
//   ungrouped()    → 自動グルーピングから外された post key の Set
// どちらも getter 関数にしているのは、viewer.js が読み込み／編集のたびに元の
// 束縛を再代入するから＝値渡しのスナップショットでは古くなってしまう。
export function makeGroupRecords(deps: { manualGroups(): string[][]; ungrouped(): Set<string>; joinReplies?: boolean }) {
  return function groupRecords(list: HologramPost[]): HologramPostGroup[] {
    const manualGroups = deps.manualGroups();
    const ungrouped = deps.ungrouped();
    // URL 由来のグループキー。stampPost がレコードごとに一度だけ前計算する
    // （_postKey）。何らかの理由でスタンプより古いレコードには、その場でのパース
    // にフォールバックする。
    const pk = (p: HologramPost) => (p._postKey !== undefined ? p._postKey : postKeyOf(p.url));
    const manualOf = new Map<string, string>(); // captureId → 'manual:idx'（手動グループが優先）
    manualGroups.forEach((members, idx) => members.forEach((cid) => manualOf.set(cid, 'manual:' + idx)));
    let solo = 0;
    const base = list.map((p) => {
      let key: any;
      const mg = manualOf.get(p.captureId);
      if (mg) key = mg;
      else {
        const k = pk(p);
        key = p.saveScope === 'media' ? 'media:' + postIdKey(p) : k && !ungrouped.has(k) ? k : '__solo' + solo++;
      }
      return { p, key };
    });
    const pidOf = (p: HologramPost) => {
      const k = pk(p);
      return k ? k.split(/[/:]/).pop() : null;
    };
    const idIndex = new Map<string, (typeof base)[number]>(); // userId + '|' + ownPostId → entry
    for (const e of base) {
      const id = pidOf(e.p);
      if (e.p.saveScope !== 'media' && id && e.p.userId) idIndex.set(pk(e.p)?.split(':')[0] + '|' + e.p.userId + '|' + id, e);
    }
    const alias = new Map<any, any>(); // 子グループのキー → 親グループのキー
    for (const e of base) {
      const p = e.p;
      if (!deps.joinReplies || p.saveScope === 'media' || !p.replyToId || !p.userId) continue;
      const ownKey = pk(p);
      if (!ownKey || ungrouped.has(ownKey)) continue;
      const parent = idIndex.get(pk(p)?.split(':')[0] + '|' + p.userId + '|' + String(p.replyToId));
      if (!parent || parent.key === e.key) continue;
      if (String(parent.key).indexOf('__solo') === 0) continue; // 親が opt-out 済み、またはキー無し
      alias.set(e.key, parent.key);
    }
    // alias の連鎖を根まで辿る。深さをあえて無制限にしているのは、各自己リプライは
    // 直近の親のキーへだけ alias するので、連鎖の長さがスレッドの長さと一致し、
    // 固定の上限を設けると長いスレッドが複数のカードに分かれてしまうから。
    // 一度通った経路は根へ圧縮する。これがないと、末尾側から並んだ長い
    // 自己リプライで各投稿が同じ祖先を根まで辿り直し、二次時間になる。
    // 循環上のキーは開始点ごとに従来の解決結果が異なるためキャッシュせず、
    // 循環へ入る前の経路だけを圧縮する。
    const resolvedKeys = new Map<any, any>();
    const resolveKey = (k: any) => {
      const cached = resolvedKeys.get(k);
      if (cached !== undefined) return cached;
      const path: any[] = [];
      const positions = new Map<any, number>();
      let root = k;
      while (alias.has(root)) {
        const known = resolvedKeys.get(root);
        if (known !== undefined) {
          root = known;
          break;
        }
        const cycleStart = positions.get(root);
        if (cycleStart !== undefined) {
          for (let i = 0; i < cycleStart; i++) resolvedKeys.set(path[i], root);
          return root;
        }
        positions.set(root, path.length);
        path.push(root);
        root = alias.get(root);
      }
      resolvedKeys.set(root, root);
      for (const key of path) resolvedKeys.set(key, root);
      return root;
    };
    const map = new Map<string, any>();
    const order: HologramPostGroup[] = [];
    for (const e of base) {
      const key = resolveKey(e.key);
      let g: any = map.get(key);
      if (!g) {
        g = { key, records: [] };
        map.set(key, g);
        order.push(g);
      }
      g.records.push(e.p);
    }
    // グループ内のメンバー順＝image タブ／ギャラリーがページをめくる読み順。まず
    // リプライ連鎖の構造（root→leaf の順にすることで、投稿が保存順とずれていても
    // 自己リプライのスレッドが上から下へ読める）、次に投稿日時の昇順、最後に
    // captureId を安定した同順位判定に使う。以前の単純な captureId ソートは
    // 自己リプライと再取得を保存順に並べていて、それは読むべき順序と逆になることが
    // 多かった（#89 のページめくり順序バグ）。インポートしたレコードは replyToId を
    // 持たないので、日時／captureId 側に落ちる（既知の v1 の限界）。
    for (const g of order) {
      // リプライ連鎖の深さ＝同じ投稿者によるグループ内の祖先まで replyToId を
      // 遡ったホップ数（上の合流で使う idIndex のキー付けと同じ考え方）。byOwnId は
      // グループごとに作るので、複数の投稿者が混ざる手動グループでは単に連鎖が
      // できない＝そのメンバーは日時／captureId で並ぶ、それがそこでは望ましい。
      const byOwnId = new Map<string, HologramPost>();
      for (const p of g.records) {
        const id = pidOf(p);
        if (id && p.userId) byOwnId.set(pk(p)?.split(':')[0] + '|' + p.userId + '|' + id, p);
      }
      const depthCache = new Map<HologramPost, number>();
      const depthOf = (start: HologramPost): number => {
        const cached = depthCache.get(start);
        if (cached !== undefined) return cached;
        let cur: HologramPost | undefined = start;
        const path: HologramPost[] = [];
        const positions = new Map<HologramPost, number>();
        let parentDepth: number | undefined;
        while (cur) {
          const known = depthCache.get(cur);
          if (known !== undefined) {
            parentDepth = known;
            break;
          }
          // 壊れた相互リプライでは、従来どおり開始点から循環を
          // 一周したホップ数だけを返し、循環内の祖先は共有キャッシュしない。
          const cycleStart = positions.get(cur);
          if (cycleStart !== undefined) {
            // start 自身が循環上にある場合は、他の開始点の深さを
            // その値から導けないので保存しない。
            if (cycleStart > 0) depthCache.set(start, path.length);
            return path.length;
          }
          positions.set(cur, path.length);
          path.push(cur);
          if (cur.replyToId == null || !cur.userId) {
            parentDepth = -1;
            break;
          }
          const parent: HologramPost | undefined = byOwnId.get(pk(cur)?.split(':')[0] + '|' + cur.userId + '|' + String(cur.replyToId));
          if (!parent || parent === cur) {
            parentDepth = -1;
            break;
          }
          cur = parent;
        }
        let depth = parentDepth ?? -1;
        for (let i = path.length - 1; i >= 0; i--) {
          depth++;
          depthCache.set(path[i], depth);
        }
        return depthCache.get(start) ?? 0;
      };
      g.records.sort((a, b) => {
        const dd = depthOf(a) - depthOf(b);
        if (dd) return dd;
        const md = (a._dateMs || 0) - (b._dateMs || 0);
        if (md) return md;
        return String(a.captureId || '').localeCompare(String(b.captureId || ''));
      });
      // カードの代表レコード: 本文を持つレコードを優先し、最後に最も古いもの。
      // 上のメンバー順とは独立している。
      g.rep = g.records.find((r) => r.text) || g.records[0];
      g.files = g.records.flatMap(groupFilesOf);
    }
    return order;
  };
}

// プラットフォームごとのいいね数パーセンタイル＝「その SNS の中でどれだけ伸びたか」
// を順位付けし、X の生の件数が支配的にならないようにする。欠損値、SNS を特定
// できない投稿、比較不能な母集団には null を返す。同値には平均順位を割り当てる。
// （image-view から移植）
export function percentileFn(list: HologramPost[]): (p: HologramPost) => number | null {
  const byPlat: Record<string, number[]> = {};
  list.forEach((p) => {
    const k = typeof p.platform === 'string' ? p.platform.trim() : '';
    const likes = p.likes;
    if (!k || typeof likes !== 'number' || !Number.isFinite(likes) || likes < 0) return;
    (byPlat[k] || (byPlat[k] = [])).push(likes);
  });
  Object.values(byPlat).forEach((a) => a.sort((x, y) => x - y));
  return (p) => {
    const k = typeof p.platform === 'string' ? p.platform.trim() : '';
    const v = p.likes;
    if (!k || typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    const arr = byPlat[k] || [];
    if (arr.length <= 1 || arr[0] === arr[arr.length - 1]) return null;

    let lower = 0;
    let upper = arr.length;
    while (lower < upper) {
      const m = (lower + upper) >> 1;
      if (arr[m] < v) lower = m + 1;
      else upper = m;
    }
    const first = lower;
    upper = arr.length;
    while (lower < upper) {
      const m = (lower + upper) >> 1;
      if (arr[m] <= v) lower = m + 1;
      else upper = m;
    }
    const last = lower - 1;
    return (first + last) / 2 / (arr.length - 1);
  };
}

// --- ライトボックスのギャラリー項目（12番目の抽出切り出し） -----------------
// URL スキーム（asset://）は viewer 側の所有のまま＝fileSrc を注入することで
// プロトコルの知識をここで重複させない。
// `ugoira` はアーカイブのライブラリ上のファイル名とフレームテーブルの組
// （#119 St3）＝アーカイブはこのテーブルがあって初めて再生でき、プレイヤーは
// `src` からではなく IPC 経由でこれを読む（レンダラーは app://bundle で、
// asset:// とはオリジンが異なり、asset:// は意図して corsEnabled 無しで登録されて
// いる）。`poster` はアーカイブが開くまでの代役。どちらも無ければ
// どちらも無いまま。
export type GalleryItem = { src: string; alt: string; video: boolean; postId?: string; mediaSeq?: number; crop?: CropRect | null; rotation?: 0 | 90 | 180 | 270; flipped?: boolean; width?: number; height?: number; ugoira?: { file: string; frames: { file: string; delay: number }[] }; poster?: string };
// deps: fileSrc(file) ＝レンダラー側のメディア URL 生成器（viewer.js）。
export function makeGallery(deps: { fileSrc(file: string): string }) {
  const { fileSrc } = deps;
  // 1投稿分のギャラリー項目。p.image / p.video と media[] はいずれも原本。
  function buildGalleryItems(p: HologramPost): GalleryItem[] {
    const items: GalleryItem[] = [];
    const postId = typeof p.captureId === 'string' && p.captureId ? p.captureId : undefined;
    // artworkFile のフォールバックと同じ注意点: `image` が動画名を持つことは
    // 本来ないはず（normalizePostRecord が動画を移す）だが、その規則より前に
    // 書かれた行はそうでない場合があり、そのままだと詳細ビューが
    // <img src="…mp4"> を開いてしまう＝本来は問題なく再生できるファイルの上に
    // 空白ページが出る（#496）。ファイル名で判断する。
    const media = Array.isArray(p.media) ? (p.media as HologramMediaItem[]) : [];
    const primaryMedia = media.findIndex((m) => !!m?.file && m.file === p.image);
    if (p.image) {
      const m = primaryMedia >= 0 ? media[primaryMedia] : null;
      items.push({
        src: fileSrc(p.image),
        alt: m?.alt || '',
        video: isVideoFile(p.image),
        postId,
        mediaSeq: primaryMedia >= 0 ? primaryMedia : media.length,
        crop: m?.crop ?? null,
        ...(m?.rotation ? { rotation: m.rotation } : {}),
        ...(m?.flipped ? { flipped: true } : {}),
        width: m?.width ?? undefined,
        height: m?.height ?? undefined,
      });
    }
    if (p.video) items.push({ src: fileSrc(p.video), alt: '', video: true, postId });
    if (Array.isArray(p.media)) {
      for (const [mediaSeq, m] of (p.media as HologramMediaItem[]).entries()) {
        if (!m || !m.file) continue;
        if (m.file === p.image || m.file === p.video) continue;
        const ugoira = m.type === 'ugoira' && Array.isArray(m.frames) && m.frames.length ? { file: m.file, frames: m.frames } : undefined;
        // フレームテーブルが失われた ugoira は再生できない＝代わりに、カードが
        // すでに表示しているのと同じ静止画である poster を使う。
        if (isUgoiraFile(m.file) && !ugoira) {
          if (m.posterFile) items.push({ src: fileSrc(m.posterFile), alt: m.alt || '', video: false, postId, mediaSeq, crop: m.crop ?? null, ...(m.rotation ? { rotation: m.rotation } : {}), ...(m.flipped ? { flipped: true } : {}), width: m.width ?? undefined, height: m.height ?? undefined });
          continue;
        }
        items.push({
          src: fileSrc(m.file),
          alt: m.alt || '',
          video: isVideoFile(m.file),
          postId,
          mediaSeq,
          crop: m.crop ?? null,
          ...(m.rotation ? { rotation: m.rotation } : {}),
          ...(m.flipped ? { flipped: true } : {}),
          width: m.width ?? undefined,
          height: m.height ?? undefined,
          ugoira,
          poster: ugoira && m.posterFile ? fileSrc(m.posterFile) : undefined,
        });
      }
    }
    return items;
  }
  // グループ全体のギャラリー: 全レコードの原本を src でまとめて重複除去する。
  function buildGroupGalleryItems(g: HologramPostGroup): GalleryItem[] {
    if (g.records.length === 1) return buildGalleryItems(g.rep);
    const seen = new Set<string>();
    const items: GalleryItem[] = [];
    for (const r of g.records) {
      for (const it of buildGalleryItems(r)) {
        if (seen.has(it.src)) continue;
        seen.add(it.src);
        items.push(it);
      }
    }
    return items;
  }
  return { buildGalleryItems, buildGroupGalleryItems };
}

// フォールバック用アバターの色合い（#107）: identity ごとに安定した色相を持たせ、
// GitHub / Google のフォールバックアバターのように、アバターの無いカードでも
// 一目で見分けられるようにする。色相のみを決める＝彩度・明度はセル側が選ぶので、
// 1つの数字からライト／ダークがそれぞれ自分の階調域を持てる。identity のキー
// （表示名は途中で変わりうるので使わない）に対して FNV-1a を掛けるので、
// 文字＋色の組み合わせは再描画や再起動をまたいでも安定する。post-grid-builder.ts
// から移動して export している（#658）＝ポストグリッドのカードとポスターグリッドが
// 実装を1つ共有するため。同じ identity には両方の場所で同じシード（userKey）・
// 同じ色になる。
export function monoHue(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 360;
}

// #180/#183: 埋め込まれた quote／reply-to カードのモデル＝保存済みサイドカーの
// サブレコード（p.quotedPost / p.replyToPost）から inspector/QuotedPostCard.tsx が
// 描画するものへの純粋な写像。保存済み投稿への移動はインスペクタ側で追加する。
export function quotedCardModelOf(sub: any, kind: 'quote' | 'reply', t: Translate): HologramQuotedCardModel | null {
  if (!sub) return null;
  const displayName = sub.displayName || sub.screenName || '';
  const media = Array.isArray(sub.media) ? sub.media : [];
  return {
    kind,
    label: kind === 'reply' ? t('quotedCardReply') : t('quotedCardQuote'),
    displayName,
    screenNameLabel: sub.screenName ? '@' + sub.screenName : '',
    // #290/#181 の線引きを、#180 への 2026-07-27 の設計コメントが quote についても
    // 再確認している: ライブラリの閲覧はリモート URL を一切読まないので、
    // サブレコード自身のアバター URL（sub.avatar）を src として使うことは決してない
    // ＝ quote／reply 先の投稿者が得るアバターは、モノグラムのフォールバック
    // （Avatar、_shared/PostCard.tsx）だけ。
    avatarSrc: null,
    monogram: displayName ? displayName[0].toUpperCase() : '?',
    monoHue: monoHue(sub.userId ? String(sub.userId) : sub.screenName || displayName || 'quoted'),
    dateLabel: localeDateTime(sub.date),
    cw: sub.cw || '',
    text: sub.text || '',
    mediaCountLabel: media.length ? t('imagesCount', { count: media.length }) : '',
  };
}

export function makeCardModel(deps: {
  t: Translate;
  formatCount(n: number): string;
  formatDate(d: string): string;
  compactDate(d: string): string;
  fileSrc(file: string, w?: number): string;
  smokeCapture: boolean;
  shape(): DisplayShape;
  imgAspect(): Record<string, string>;
  gridThumbW(): number;
  /** 並び替え項目。件数のソートは、その項目だけをカードに出す。 */
  sortMetric(): string;
  /** SNS 内人気順のパーセンタイル。0 が最下位、1 が最上位。 */
  likesPercentile(p: HologramPost): number | null;
  /** 反応数の絞り込み時だけ、非ゼロの反応数を併記する。 */
}) {
  const { t, formatCount, formatDate, compactDate, fileSrc, smokeCapture, shape, imgAspect, gridThumbW, sortMetric, likesPercentile } = deps;
  return function cardModel(g: HologramPostGroup, i: number): Record<string, any> {
    const p = g.rep;
    const view = shape();
    const aspectCache = imgAspect();
    // ソート後に同一投稿の複数保存を1枚にまとめるため、グループの位置を
    // 決めたのは代表レコードとは限らない。カードには昇順なら最小値、降順なら最大値を出す。
    const ascending = isSortAscending(sortMetric());
    const localViewCountOf = () =>
      g.records.reduce(
        (extreme, record) => {
          const value = Number(record.localViewCount) || 0;
          return ascending ? Math.min(extreme, value) : Math.max(extreme, value);
        },
        ascending ? Number.POSITIVE_INFINITY : 0,
      );
    // 件数は実数を表示する。いいね順のサイト内補正は並べ替えだけに使う。
    let stats: Partial<Record<string, string | number | null>>;
    switch (sortOption(sortMetric())) {
      case 'local-views-desc':
        stats = { localViews: formatCount(localViewCountOf()) };
        break;
      case 'likes-pct': {
        const ranked = g.records.filter((record) => likesPercentile(record) !== null).sort((a, b) => (ascending ? 1 : -1) * (likesPercentile(a)! - likesPercentile(b)!));
        const likes = (ranked[0] || p).likes;
        stats = { likes: likes == null ? '—' : formatCount(likes) };
        break;
      }
      default:
        stats = {};
    }
    const dateField = ({ 'date-desc': 'date', 'captured-desc': 'capturedAt', 'last-viewed-desc': 'lastViewedAt', 'trashed-desc': 'trashedAt' } as const)[sortOption(sortMetric())];
    const dates = dateField
      ? g.records
          .map((record) => record[dateField])
          .filter((date): date is string => !!date)
          .sort()
      : [];
    const date = ascending ? dates[0] : dates.at(-1);
    const dateLabel = date ? compactDate(date) : '—';
    const footDates = {
      post: dateField === 'date' ? { label: dateLabel } : null,
      cap: dateField === 'capturedAt' ? { label: dateLabel } : null,
      viewed: dateField === 'lastViewedAt' ? { label: dateLabel } : null,
      trashed: dateField === 'trashedAt' ? { label: dateLabel } : null,
    };
    const userName = p.displayName || p.screenName || p.title || '';
    const avatarSrc = p.avatarFile ? fileSrc(p.avatarFile) : null;
    const monogram = p.avatarFile ? null : userName ? userName[0].toUpperCase() : '?';
    const cardMonoHue = p.avatarFile ? null : monoHue(userKey(p) || userName);
    const handle = p.screenName ? `@${p.screenName}` : '';
    // ライブラリの画像はファイル名を title と text の両方に持つ＝投稿者行と
    // 一致するときは重複する本文を落とす。
    const textRaw = displayPostText(p);
    const text = textRaw === userName ? '' : textRaw;
    const imgFile = densityImage(p); // artwork。capture はその代役でしかない
    // GIF とアニメーション WebP は、静止画へ変換されないよう元ファイルを使う。
    // shotAnimated は densityImage() が選ぶカード画像に対応する。
    const cellW = gridThumbW();
    const imgW = !/\.gif$/i.test(imgFile || '') && !p.shotAnimated ? cellW : 0;
    const leadMedia = mediaItemsOf(p)[0];
    const crop = leadMedia?.crop ?? null;
    const leadWidth = Number(leadMedia?.width) || 0;
    const leadHeight = Number(leadMedia?.height) || 0;
    const cropRatio = crop && leadWidth > 0 && leadHeight > 0 ? `${leadWidth * crop.width}/${leadHeight * crop.height}` : '';
    const aspRatio = cropRatio || (p.shotW != null && p.shotH != null && p.shotW > 0 && p.shotH > 0 ? p.shotW + '/' + p.shotH : p.captureId && aspectCache[p.captureId] ? aspectCache[p.captureId] : !hasVisualMedia(p) && !view.info ? textPlateAspect(text) : '');
    const flags: string[] = [];
    if (p.isReply) flags.push(t('qfReply'));
    if (p.isQuote) flags.push(t('qfQuote'));
    // 'image' は大多数のカードにとって既定の media type＝常時「Image」ラベルを
    // 出すのは純粋なノイズになる（#110: 例外だけに印を付ける）。
    const mediaLabel = p.mediaType === 'video' ? t('qfVideo') : p.mediaType === 'gif' ? t('qfGif') : '';
    const gifVideo = leadMedia && leadMedia.type === 'gif' && leadMedia.file ? leadMedia : null;
    // 常に原寸＝サムネイル生成器は使わない。使うと平坦化された1フレームだけが返る。
    const videoSrc = gifVideo ? fileSrc(gifVideo.file as string) : '';
    // 最初のフレームがデコードされるまで表示しておく＝セルが一瞬空白にならないように。
    const videoPoster = gifVideo?.posterFile ? fileSrc(gifVideo.posterFile, cellW) : '';
    // サムネイル上の ▶ バッジ: 先頭の media アイテムのダウンロード形式が動画
    // （type が 'video'／'gif'＝mp4 を積んだ X の animated_gif の
    // gifv）のときだけ付く。本物の .gif ファイルはアイテムごとの type を持たず
    // （静止画形式、#119 St1）、読み込めばすでにアニメとして見えるのでバッジは
    // 付かない。すでに再生中の何かにも付かない＝動いている絵の上に ▶ を出すのは、
    // 読み手にいま見ているものを「始めろ」と言っているようなものになる。
    const videoBadge = !videoSrc && !!leadMedia && (leadMedia.type === 'video' || leadMedia.type === 'gif' || leadMedia.type === 'ugoira');
    const postKey = postIdKey(p);
    // 複数画像のスタック: 2枚目・3枚目の画像は背面のシートに乗る（本物の
    // サムネイル＝2026-07-05 の動作検証 canvas）。前面の画像と同じく縮小する
    // （GIF も同様＝背面シートには静止した平坦化サムネイルがふさわしい）。
    const stackSrcs = g.files.length > 1 ? g.files.slice(1, 3).map((f) => fileSrc(f, cellW)) : [];
    return {
      index: i,
      postKey,
      // videoSrc も数える: poster のダウンロードに失敗し、かつ投稿に capture も
      // 無い gif には表示できる静止画は無いが、再生できるものはまだある。
      hasThumb: !!(imgFile || p.video || videoSrc),
      imgSrc: imgFile ? fileSrc(imgFile, imgW) : '',
      videoSrc,
      videoPoster,
      videoBadge,
      captureId: p.captureId || '',
      aspRatio,
      cropPosition: crop ? `${(crop.x + crop.width / 2) * 100}% ${(crop.y + crop.height / 2) * 100}%` : '',
      eager: !!smokeCapture,
      nImg: g.files.length,
      stackSrcs,
      userName,
      avatarSrc,
      monogram,
      monoHue: cardMonoHue,
      handle,
      flags,
      mediaLabel,
      text,
      stats,
      footDates,
      tags: p.tags || [],
    };
  };
}

// ソート用のタイムスタンプを事前計算する＝getFilteredPosts() が比較のたびに
// new Date() を呼ばずに済むように（描画のたびではなく、レコードの到着時に
// 一度だけ行う）。
export function stampPost(p: HologramPost): HologramPost {
  p._dateMs = p.date ? +new Date(p.date) : 0;
  p._capturedMs = p.capturedAt ? +new Date(p.capturedAt) : 0;
  p._postKey = postKeyOf(p.url); // URL 由来のグループキー。無ければ groupRecords がレコードごとに3回パースし直すことになる
  p._quotedKey = postKeyOf(p.quotedUrl); // quote 先投稿のキー＝テキスト検索の URL 照合がキー入力のたびにこれと突き合わせる
  return p;
}

// manual-groups.json / ungrouped.json の読み込み・永続化（P4「IPC→service」の
// ドメイングルーピング切り出し＝生の hologramIpc 呼び出しを viewer.js から
// ここへ移した。これら2つのストアをすでに注入 deps として使っている
// makeGroupRecords/makeGallery の隣に置く）。ブラウザ側（viewer.js）からだけ
// 呼ばれ、Node の単体テストからは一切呼ばれない。
//
// #32 St2 / #803: main はこの2つ（'manual-groups' / 'ungrouped' の kind）についても
// 他の organize 層のチャンネルと同様に `org-changed` イベントを中継するが、
// ここではまだそれを受けて再読み込みする処理は無い。folders.ts/tags.ts
// と違い、これらが供給する生きた状態（post-grid-builder.ts の
// manualGroups/ungrouped）は独立した購読可能モジュールではなく post-grid の
// 閉包が持っているため。その閉包を通してウィンドウをまたいだ
// 再読み込みを配線する設計は #803 にある。それが実装されるまで、別ウィンドウでの
// 手動グルーピングの編集はライブでは同期しない。
export async function loadManualGroups() {
  try {
    const r = await hologramIpc.getManualGroups();
    return (r && r.groups) || [];
  } catch {
    return [];
  }
}
export async function loadUngrouped() {
  try {
    const r = await hologramIpc.getUngrouped();
    return new Set<string>((r && r.keys) || []);
  } catch {
    return new Set<string>();
  }
}
