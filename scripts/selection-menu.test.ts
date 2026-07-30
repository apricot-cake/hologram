// 選択テキストの右クリックメニュー（#167）の純ユニットテスト。
//
// 見るのは4つ:
//  ① ウェブ検索 URL の組み立て — 切替設定を作らない代わりに「1箇所に寄せる」と決めた
//     seam（webSearchUrl）が、実際にエスケープと長さ上限を持っていること
//  ② 選択語の正規化 — 選択は文書であって検索語ではないので、改行・連続空白が潰れること
//  ③ 出し分け — 右クリックが選択の**外**で起きたら空を返す（Chromium と同じ挙動）。
//     ここが抜けると、別の場所で選択したテキスト向けの行が app 中どこでも出続ける
//  ④ 行の振り分け — 自分の3行だけ引き取り、他メニューの行（カードメニューに差し込まれた
//     状態で来る）は素通しして false を返すこと
//
// DOM は jsdom を globalThis に据えて本物の Selection / MouseEvent で駆動する
// （selectionTextAt はグローバルの window.getSelection() を読む）。IPC は
// window.hologram のスパイに差し替える＝外部サイトも実クリップボードも触らない。

import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { get as menuGet, close as menuClose } from '../app/src/renderer/src/services/menu';
import { makeSelectionMenu, searchTermOf, selectionTextAt, webSearchUrl } from '../app/src/renderer/src/services/selection-menu';

const HTML = '<!doctype html><html><body><p id="body">こんにちは 世界</p><p id="other">別の段落</p></body></html>';

let dom: JSDOM;
const ipc = { copyText: vi.fn(), openExternal: vi.fn() };
const searchInLibrary = vi.fn();
const menu = makeSelectionMenu({ t: (k) => k, searchInLibrary });

function selectNode(id: string) {
  const el = dom.window.document.getElementById(id) as HTMLElement;
  const sel = dom.window.getSelection() as Selection;
  const range = dom.window.document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
  return el;
}

beforeAll(() => {
  dom = new JSDOM(HTML);
  const g = globalThis as any;
  g.window = dom.window;
  g.document = dom.window.document;
  g.Node = dom.window.Node;
  g.MouseEvent = dom.window.MouseEvent;
  // services/ipc.ts reads window.hologram lazily, per call — a plain stub is enough.
  (dom.window as any).hologram = ipc;
});

afterAll(() => {
  const g = globalThis as any;
  g.window = undefined;
  g.document = undefined;
  g.Node = undefined;
  g.MouseEvent = undefined;
});

describe('webSearchUrl', () => {
  test('Google 固定・クエリはエスケープされる', () => {
    expect(webSearchUrl('a b&c')).toBe('https://www.google.com/search?q=a%20b%26c');
  });
  test('長すぎる選択は URL が壊れる前に切られる', () => {
    const url = webSearchUrl('x'.repeat(5000));
    expect(url).toBe('https://www.google.com/search?q=' + 'x'.repeat(1000));
  });
});

describe('searchTermOf', () => {
  test('改行と連続空白は1つの空白に潰れる', () => {
    expect(searchTermOf('  ある\n  投稿の\t本文  ')).toBe('ある 投稿の 本文');
  });
  test('空白だけなら空', () => {
    expect(searchTermOf(' \n\t ')).toBe('');
  });
});

describe('selectionTextAt', () => {
  test('選択の中で右クリックすれば選択語が返る', () => {
    const el = selectNode('body');
    expect(selectionTextAt(el)).toBe('こんにちは 世界');
  });
  test('選択の外で右クリックしたら空＝従来どおり何も出さない', () => {
    selectNode('body');
    expect(selectionTextAt(dom.window.document.getElementById('other'))).toBe('');
  });
  test('選択が無ければ空', () => {
    dom.window.getSelection()?.removeAllRanges();
    expect(selectionTextAt(dom.window.document.getElementById('body'))).toBe('');
  });
  // 実際の右クリックはテキストノードでなく**それを載せている要素**に落ちる。
  // Range から見るとその要素は「含まれても部分的に含まれてもいない」ので、
  // containsNode で判定すると主経路がまるごと死ぬ（実装時に踏んだ）。
  test('文中を部分選択して、その段落を右クリックしても拾える', () => {
    const el = dom.window.document.getElementById('body') as HTMLElement;
    const sel = dom.window.getSelection() as Selection;
    const range = dom.window.document.createRange();
    range.setStart(el.firstChild as Node, 1);
    range.setEnd(el.firstChild as Node, 4);
    sel.removeAllRanges();
    sel.addRange(range);
    expect(selectionTextAt(el)).toBe('んにち');
  });
});

describe('rows', () => {
  test('3行・順番はコピー→ウェブ検索→ライブラリ内検索', () => {
    expect(menu.items().map((it) => it.act)).toEqual(['selCopy', 'selWeb', 'selLibrary']);
    expect(menu.items().map((it) => it.label)).toEqual(['ctxCopyText', 'ctxSearchWeb', 'ctxSearchLibrary']);
  });

  test('自分の行だけ引き取る（カードメニューの行は素通し）', () => {
    expect(menu.pick('語', { act: 'delete' })).toBe(false);
    expect(menu.pick('語', { act: 'selCopy' })).toBe(true);
  });

  test('コピーはクリップボード IPC へ、検索は既定ブラウザへ、ライブラリは検索ボックスへ', () => {
    ipc.copyText.mockClear();
    ipc.openExternal.mockClear();
    searchInLibrary.mockClear();
    menu.pick('ある\n本文', { act: 'selCopy' });
    menu.pick('ある\n本文', { act: 'selWeb' });
    menu.pick('ある\n本文', { act: 'selLibrary' });
    // どの経路にも正規化後の語だけが渡る
    expect(ipc.copyText).toHaveBeenCalledWith('ある 本文');
    expect(ipc.openExternal).toHaveBeenCalledWith('https://www.google.com/search?q=' + encodeURIComponent('ある 本文'));
    expect(searchInLibrary).toHaveBeenCalledWith('ある 本文');
  });
});

describe('handleContextmenu', () => {
  test('選択があってまだ誰も引き取っていなければ、その場にメニューを開く', () => {
    menuClose();
    const el = selectNode('body');
    dom.window.document.addEventListener('contextmenu', menu.handleContextmenu as EventListener);
    const ev = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 34 });
    el.dispatchEvent(ev);
    dom.window.document.removeEventListener('contextmenu', menu.handleContextmenu as EventListener);
    expect(ev.defaultPrevented).toBe(true);
    const model = menuGet();
    expect(model?.items.map((it) => it.act)).toEqual(['selCopy', 'selWeb', 'selLibrary']);
    expect([model?.x, model?.y]).toEqual([12, 34]);
    menuClose();
  });

  test('他のメニューが preventDefault 済みなら何もしない', () => {
    menuClose();
    const el = selectNode('body');
    dom.window.document.addEventListener('contextmenu', menu.handleContextmenu as EventListener);
    const ev = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    // カード/タブ/フォルダ側のハンドラが先に引き取った状態を作る
    el.addEventListener('contextmenu', (e) => e.preventDefault(), { once: true });
    el.dispatchEvent(ev);
    dom.window.document.removeEventListener('contextmenu', menu.handleContextmenu as EventListener);
    expect(menuGet()).toBe(null);
  });

  test('選択が無ければメニューは出ない', () => {
    menuClose();
    dom.window.getSelection()?.removeAllRanges();
    dom.window.document.addEventListener('contextmenu', menu.handleContextmenu as EventListener);
    const ev = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    (dom.window.document.getElementById('body') as HTMLElement).dispatchEvent(ev);
    dom.window.document.removeEventListener('contextmenu', menu.handleContextmenu as EventListener);
    expect(ev.defaultPrevented).toBe(false);
    expect(menuGet()).toBe(null);
  });
});
