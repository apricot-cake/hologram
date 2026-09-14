export interface SearchCandidate {
  id: string;
  title: string;
  keywords?: string;
  screenName?: string;
}

export function searchFields(p: any): Record<string, string> {
  const join = (values: unknown[]) => values.filter((v) => v != null && v !== '').join(' ');
  return {
    text: p.text || '',
    title: p.title || '',
    seriesTitle: p.seriesTitle || '',
    displayName: p.displayName || '',
    screenName: p.screenName || '',
    eagleName: p.eagleName || '',
    tag: join(p.tags || []),
    hashtag: join(p.hashtags || []),
    alt: join((p.media || []).map((m: any) => m.alt)),
    quoted: join([p.quotedPost, p.replyToPost].flatMap((q: any) => (q ? [q.text, q.displayName, ...(q.media || []).map((m: any) => m.alt)] : []))),
    quotedScreenName: join([p.quotedPost?.screenName, p.replyToPost?.screenName]),
    poll: join((p.poll?.choices || []).map((c: any) => c.text)),
    linkCard: join([p.linkCard?.title, p.linkCard?.description]),
  };
}
