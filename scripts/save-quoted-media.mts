import Database from 'better-sqlite3';
import path from 'node:path';
import { downloadQuotedPost } from '../native-host/quoted-storage.mts';
import { createByteBudget } from '../native-host/media-download.mts';

const file = process.argv[2];
if (!file) throw new Error('Pass hologram.db path');
const db = new Database(file);
try {
  if (Number(db.pragma('user_version', { simple: true })) !== 48) throw new Error('Expected schema 48');
  const quotes = db.prepare('SELECT DISTINCT q.captureId,q.url,q.text FROM posts q JOIN posts p ON p.quotedPostId=q.captureId WHERE q.isContext=1').all() as Array<{ captureId: string; url: string; text: string }>;
  let saved = 0,
    missing = 0;
  for (const quote of quotes) {
    const media = db.prepare('SELECT seq,url,alt,width,height,file,type,posterFile FROM media WHERE postId=? ORDER BY seq').all(quote.captureId) as Array<{ seq: number; url: string; file: string; type: string }>;
    if (!media.some((m) => m.url && !m.file)) continue;
    const result = await downloadQuotedPost({ ...quote, media: media.map((m) => ({ ...m, referer: quote.url })) }, path.dirname(file), createByteBudget());
    for (const [i, m] of (result?.media || []).entries()) {
      if (!media[i] || media[i].file) continue;
      if (!m.file) {
        missing++;
        continue;
      }
      db.prepare('UPDATE media SET file=?,posterFile=?,type=?,width=?,height=? WHERE postId=? AND seq=?').run(m.file, m.posterFile, m.type, m.width, m.height, quote.captureId, media[i].seq);
      saved++;
    }
  }
  console.log(JSON.stringify({ saved, missing }));
} finally {
  db.close();
}
