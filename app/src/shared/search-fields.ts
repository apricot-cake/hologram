export interface SearchCandidate {
  id: string;
  title: string;
  keywords?: string;
  screenName?: string;
}

// Keep any one value from monopolizing the local full-text index. These values can
// originate in page metadata (notably image ALT text), so their stored/displayed
// form remains untouched while only the derived search document is bounded.
export const SEARCH_FIELD_MAX_LENGTH = 32_768;

export function boundedSearchField(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, SEARCH_FIELD_MAX_LENGTH) : '';
}

export function searchFields(p: any): Record<string, string> {
  const join = (values: Iterable<unknown>) => {
    let result = '';
    for (const value of values) {
      if (typeof value !== 'string' || value === '') continue;
      const separator = result ? ' ' : '';
      result += separator + value.slice(0, SEARCH_FIELD_MAX_LENGTH - result.length - separator.length);
      if (result.length >= SEARCH_FIELD_MAX_LENGTH) break;
    }
    return result;
  };
  const quotedValues = function* () {
    for (const quoted of [p.quotedPost, p.replyToPost]) {
      if (!quoted) continue;
      yield quoted.text;
      yield quoted.displayName;
      for (const media of quoted.media || []) yield media?.alt;
    }
  };
  return {
    text: boundedSearchField(p.text),
    title: boundedSearchField(p.title),
    seriesTitle: boundedSearchField(p.seriesTitle),
    displayName: boundedSearchField(p.displayName),
    screenName: boundedSearchField(p.screenName),
    eagleName: boundedSearchField(p.eagleName),
    tag: join(p.tags || []),
    hashtag: join(p.hashtags || []),
    alt: join((p.media || []).map((m: any) => m.alt)),
    quoted: join(quotedValues()),
    quotedScreenName: join([p.quotedPost?.screenName, p.replyToPost?.screenName]),
    poll: join((p.poll?.choices || []).map((c: any) => c.text)),
    linkCard: join([p.linkCard?.title, p.linkCard?.description]),
  };
}
