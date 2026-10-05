// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { controlPointIsOwned } from './positioning.ts';
import type { Anchor } from './types.ts';

const rect = { left: 10, top: 10, right: 50, bottom: 50, width: 40, height: 40, x: 10, y: 10, toJSON() {} } as DOMRect;

function textAnchor(unit: HTMLElement, avatar: HTMLElement): Anchor {
  unit.getBoundingClientRect = () => rect;
  avatar.getBoundingClientRect = () => rect;
  return {
    box: unit,
    hitBoxes: [unit],
    kind: 'text',
    el: null,
    root: null,
    control: null,
    host: null,
    hostInlinePosition: null,
    hostInlinePriority: '',
    face: null,
    accessibleName: null,
    phase: 'idle',
    timer: null,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, 'elementFromPoint');
  vi.restoreAllMocks();
});

describe('テキスト投稿の操作面の所有判定', () => {
  test.each([false, true])('role=link の profile 土台を所有する（外側リンク: %s）', (outerLink) => {
    const unit = document.createElement('article');
    const container = document.createElement('div');
    const profile = document.createElement('a');
    profile.href = '/profile';
    profile.setAttribute('role', 'link');
    const avatar = document.createElement('img');
    if (outerLink) {
      container.append(avatar);
      profile.append(container);
      unit.append(profile);
    } else {
      profile.append(avatar);
      container.append(profile);
      unit.append(container);
    }
    document.body.append(unit);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => avatar) });
    expect(controlPointIsOwned(textAnchor(unit, container), 20, 20, undefined, container)).toBe(true);
  });

  test('メディア内に置かれた独立したページリンクは奪わない', () => {
    const media = document.createElement('div');
    const link = document.createElement('a');
    link.href = '/unrelated';
    media.append(link);
    document.body.append(media);
    const anchor = { ...textAnchor(media, media), kind: 'media' as const };
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => link) });
    expect(controlPointIsOwned(anchor, 20, 20)).toBe(false);
  });

  test('profile link 内の avatar は配置と同じランドマークとして所有する', () => {
    const unit = document.createElement('article');
    const container = document.createElement('div');
    const profile = document.createElement('a');
    profile.href = '/profile';
    const avatar = document.createElement('img');
    profile.append(avatar);
    container.append(profile);
    unit.append(container);
    document.body.append(unit);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => avatar) });

    expect(controlPointIsOwned(textAnchor(unit, container), 20, 20, undefined, container)).toBe(true);
  });

  test('avatar の前面に重なったページ button は奪わない', () => {
    const unit = document.createElement('article');
    const avatar = document.createElement('img');
    const button = document.createElement('button');
    unit.append(avatar, button);
    document.body.append(unit);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => button) });

    expect(controlPointIsOwned(textAnchor(unit, avatar), 20, 20, undefined, avatar)).toBe(false);
  });

  for (const [name, wrapper] of [
    ['button', () => document.createElement('button')],
    [
      'role=button',
      () => {
        const el = document.createElement('div');
        el.setAttribute('role', 'button');
        return el;
      },
    ],
  ] as const) {
    test(`${name} 内の avatar はページ操作として拒否する`, () => {
      const unit = document.createElement('article');
      const container = document.createElement('div');
      const interactive = wrapper();
      const avatar = document.createElement('img');
      interactive.append(avatar);
      container.append(interactive);
      unit.append(container);
      document.body.append(unit);
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => avatar) });

      expect(controlPointIsOwned(textAnchor(unit, container), 20, 20, undefined, container)).toBe(false);
    });
  }
});
