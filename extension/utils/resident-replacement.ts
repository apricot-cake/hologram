// 更新で分離ワールドが切り替わっても、document のイベントは両世代へ届く。
// 通知にはデータを載せず、失効した世代だけが自分の UI を撤去する。
const REPLACED = 'hologram:resident-replaced';

export function watchResidentReplacement(target: Document, runtime: { readonly id?: string }, dispose: () => void): () => void {
  target.dispatchEvent(new Event(REPLACED));
  const onReplacement = () => {
    // ページも同じイベントを送れるため、生きている世代は終了させない。
    if (!runtime.id) dispose();
  };
  target.addEventListener(REPLACED, onReplacement);
  return () => target.removeEventListener(REPLACED, onReplacement);
}
