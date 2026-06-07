// JSON file ベースのサイドカーストア。
// fs/path はコンストラクタ経由で注入する (Node テストと Eagle Plugin 両対応)。

const SCHEMA_VERSION = 1;
const FILE_NAME = 'engagement-browser.json';

export class EngagementStore {
  constructor({ libraryPath, fs, path }) {
    if (!libraryPath) throw new Error('libraryPath required');
    if (!fs || !path) throw new Error('fs and path required');
    this.fs = fs;
    this.path = path;
    this.dir = path.join(libraryPath, 'plugin-data');
    this.file = path.join(this.dir, FILE_NAME);
    this.data = { version: SCHEMA_VERSION, lastSync: null, items: {} };
  }

  load() {
    if (!this.fs.existsSync(this.file)) return false;
    try {
      const parsed = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
      if (parsed.version === SCHEMA_VERSION) {
        this.data = parsed;
        if (!this.data.items) this.data.items = {};
        return true;
      }
      // 将来の version は ここでマイグレーション。今は読み捨てて空から開始。
    } catch {
      // 壊れた JSON は破棄。バックアップ等は将来検討。
    }
    this.data = { version: SCHEMA_VERSION, lastSync: null, items: {} };
    return false;
  }

  save() {
    this.fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    this.fs.writeFileSync(tmp, JSON.stringify(this.data));
    this.fs.renameSync(tmp, this.file);
  }

  get(id) {
    return this.data.items[id] || null;
  }

  upsert(id, partial) {
    const existing = this.data.items[id] || {};
    this.data.items[id] = { ...existing, ...partial, lastSyncedAt: Date.now() };
  }

  delete(id) {
    delete this.data.items[id];
  }

  setLastSync(timestamp = Date.now()) {
    this.data.lastSync = timestamp;
  }

  // Eagle 側の (id, modifiedAt) 一覧と DB を比較し、変更分を抽出。
  diff(idsModifiedAt) {
    const eagleMap = new Map();
    for (const { id, modifiedAt } of idsModifiedAt) eagleMap.set(id, modifiedAt);

    const newIds = [];
    const changedIds = [];
    const deletedIds = [];

    for (const [id, mt] of eagleMap) {
      const stored = this.data.items[id];
      if (!stored) newIds.push(id);
      else if (stored.modifiedAt !== mt) changedIds.push(id);
    }
    for (const id of Object.keys(this.data.items)) {
      if (!eagleMap.has(id)) deletedIds.push(id);
    }
    return { newIds, changedIds, deletedIds };
  }

  // フィルタ + ソート。9000 件規模なら全スキャンで数 ms。
  query({ platform, minLikes, minViews, status } = {}, sort = null) {
    let arr = Object.entries(this.data.items).map(([id, v]) => ({ id, ...v }));
    if (platform) arr = arr.filter(it => it.platform === platform);
    if (minLikes != null) arr = arr.filter(it => (it.likes ?? 0) >= minLikes);
    if (minViews != null) arr = arr.filter(it => (it.views ?? 0) >= minViews);
    if (status) arr = arr.filter(it => it.status === status);

    if (sort) {
      const { field, order = 'desc' } = sort;
      if (field === 'likesPercentile') {
        // platform 内で likes 順ランク → 0〜1 の percentile を全 platform 共通 score に。
        // 各 platform の top が同じ高さで並ぶので、likes 数の絶対値が違う SNS を横断的に比較できる。
        const groups = new Map();
        for (const it of arr) {
          const p = it.platform || '_';
          if (!groups.has(p)) groups.set(p, []);
          groups.get(p).push(it);
        }
        for (const g of groups.values()) {
          g.sort((a, b) => (b.likes ?? -Infinity) - (a.likes ?? -Infinity));
          const n = g.length;
          g.forEach((it, i) => {
            it._likesPercentile = n > 1 ? 1 - i / (n - 1) : 1;
          });
        }
        arr.sort((a, b) => (order === 'desc' ? 1 : -1) * (b._likesPercentile - a._likesPercentile));
      } else {
        arr.sort((a, b) => {
          const av = a[field] ?? -Infinity;
          const bv = b[field] ?? -Infinity;
          return order === 'desc' ? bv - av : av - bv;
        });
      }
    }
    return arr;
  }
}
