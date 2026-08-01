// Pure unit tests for the selection-text right-click menu (#167).
//
// There are 4 things being checked:
//  ① Building the web-search URL — instead of adding a toggle setting, we decided to
//     consolidate into one seam (webSearchUrl), and that seam actually has escaping and
//     a length cap
//  ② Normalizing the selected term — a selection is prose, not a search term, so
//     newlines and runs of whitespace get collapsed
//  ③ Branching — a right-click that happens **outside** the selection returns empty
//     (same behavior as Chromium). Miss this and the row meant for text selected
//     elsewhere keeps showing up everywhere in the app
//  ④ Sorting rows — takes only its own 3 rows, and passes through rows belonging to
//     other menus (arriving already spliced into the card menu), returning false
//
// The DOM is driven with jsdom set on globalThis, using real Selection / MouseEvent
// (selectionTextAt reads the global window.getSelection()). IPC is swapped for a spy on
// window.hologram = it never touches an external site or the real clipboard.

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
  // A real right-click lands not on the text node but on **the element carrying it**.
  // Seen from the Range, that element is neither "contained" nor "partially contained",
  // so judging by containsNode kills the main path entirely (hit this during implementation).
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
    // only the normalized term is passed down every path
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
    // Set up a state where the card/tab/folder-side handler already claimed it first
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
