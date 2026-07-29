// Legacy ZIP import (metadata.json + images/), the pre-#300 export shape.
//
// This is the ONE remaining place the renderer opens an archive itself, and it is
// deliberately quarantined here: the complete format moved to main (#485), where
// yauzl streams it off disk under the zip-bomb / zip-slip guards, so nothing else
// in the renderer needs a ZIP reader. What happens to this path — dropped, moved
// to main, or given its own limits — is #322's call, not this module's; keeping it
// in one file is what makes that decision a deletion instead of a hunt.
//
// The bytes arrive from main (which already ran the entry-count / declared-size
// tally while deciding the archive wasn't a complete export), so the renderer no
// longer reads the file. It still expands every referenced image into a data: URL
// in memory, which is the unbounded part #322 names.
import JSZip from 'jszip';
import { importPosts } from './posts.ts';

export async function importLegacyZip(bytes: Uint8Array): Promise<{ imported: number; skipped: number } | null> {
  const zip = await JSZip.loadAsync(bytes);
  const metaEntry = zip.file('metadata.json');
  if (!metaEntry) return null; // not a legacy export either — the caller reports a failed import
  const meta = JSON.parse(await metaEntry.async('string'));
  const posts: any[] = [];
  for (const m of Array.isArray(meta) ? meta : []) {
    const f = m.imageFile && zip.file(m.imageFile);
    if (!f) continue;
    const b64 = await f.async('base64');
    posts.push(Object.assign({}, m, { image: 'data:image/jpeg;base64,' + b64 }));
  }
  return importPosts(posts);
}
