export interface SelectedMediaContext {
  alt: string | null;
}

// chrome.scripting.executeScript の func としてそのまま直列化されるため、外側の変数や
// import した関数を参照しない。テストでは document を明示して同じ本体を動かす。
export function selectedMediaContextInPage(selectedUrl: string, doc: Document = document): SelectedMediaContext {
  const sameUrl = (candidate: string | null | undefined) => {
    if (!candidate) return false;
    try {
      return new URL(candidate, doc.baseURI).href === new URL(selectedUrl, doc.baseURI).href;
    } catch {
      return candidate === selectedUrl;
    }
  };
  const elements = Array.from(doc.querySelectorAll('img,video'));
  const selected = elements.find((element) => {
    if (element.tagName === 'IMG') {
      const image = element as HTMLImageElement;
      return sameUrl(image.currentSrc) || sameUrl(image.src);
    }
    if (element.tagName === 'VIDEO') {
      const video = element as HTMLVideoElement;
      return sameUrl(video.currentSrc) || sameUrl(video.src) || Array.from(video.querySelectorAll('source')).some((source) => sameUrl(source.src));
    }
    return false;
  });
  const alt = selected?.tagName === 'IMG' ? selected.getAttribute('alt')?.trim() || null : selected?.getAttribute('aria-label')?.trim() || null;

  return { alt };
}
