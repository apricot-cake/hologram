'use strict';

// アイコンから開く設定ポップアップ。表示に関する2項目を即時保存する。
import { servedLocale } from './locale.ts';

export function startOptions(): void {
  // どちらも overlay.js（content script）が読み、書き込むのはここだけ。
  // 未設定 = overlay.js が最初から持つ既定値＝印は常に表示（#309）、保存ボ
  // タンはオン（#94）。このチェックはローカル限定なので、オプトインすべき
  // ものは何もない。
  const MARK_MODE_KEY = 'savedBadgeMode';
  const HOVER_SAVE_KEY = 'hoverSaveButton';
  const MARK_MODES = ['always', 'hover', 'off'];

  // 文字列は chrome.i18n 経由で _locales から来る（拡張機能ページの標準的
  // な経路）。静的な HTML のテキストは、chrome.i18n がない file:// プレ
  // ビュー向けの日本語フォールバックだ。
  try {
    const title = chrome.i18n && chrome.i18n.getMessage('optionsTitle');
    if (title) document.title = title;
    // 以下の文字列はすべてこれから置き換わるので、document はフォール
    // バック用マークアップの言語を名乗り続けるのをやめなければならない
    // （#1057、WCAG 2.2 SC 3.1.1）。getUILanguage() をそのまま使わず
    // servedLocale を使う＝`_locales` は対応2言語だけを持つので、
    // fr-FR の Chrome は英語のテーブルを読んでいることになる。詳細は
    // locale.ts を参照。
    if (chrome.i18n) document.documentElement.lang = servedLocale(chrome.i18n.getUILanguage());
    const setText = (id: string, key: string) => {
      const el = document.getElementById(id);
      const text = chrome.i18n && chrome.i18n.getMessage(key);
      if (el && text) el.textContent = text;
    };
    setText('pageTitle', 'optionsTitle');
    setText('diagLink', 'optionsOpenDiag');
    setText('savedBadgeLabel', 'optionsSavedBadge');
    setText('savedBadgeDesc', 'optionsSavedBadgeDesc');
    setText('savedBadgeModeHoverLabel', 'optionsSavedBadgeHover');
    setText('savedBadgeModeAlwaysLabel', 'optionsSavedBadgeAlways');
    setText('savedBadgeModeOffLabel', 'optionsSavedBadgeOff');
    setText('hoverSaveLabel', 'optionsHoverSave');
    setText('hoverSaveDesc', 'optionsHoverSaveDesc');
  } catch {
    /* 拡張機能のページとして動いていない＝静的なフォールバックのテキストを残す */
  }

  // overlay.js は chrome.storage.onChanged を listen しているので、開い
  // ているタイムラインはリロードなしでこの2つの両方に追従する。
  const radios = MARK_MODES.map((mode) => document.getElementById(`savedBadgeMode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`)).filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
  if (radios.length === MARK_MODES.length) {
    chrome.storage.local.get(MARK_MODE_KEY, (got) => {
      if (chrome.runtime.lastError) return;
      const stored = got[MARK_MODE_KEY];
      const current = typeof stored === 'string' && MARK_MODES.includes(stored) ? stored : 'always';
      for (const radio of radios) radio.checked = radio.value === current;
    });
    for (const radio of radios) {
      radio.addEventListener('change', () => {
        if (radio.checked) chrome.storage.local.set({ [MARK_MODE_KEY]: radio.value });
      });
    }
  }

  const hoverSave = document.getElementById(HOVER_SAVE_KEY);
  if (hoverSave instanceof HTMLInputElement) {
    chrome.storage.local.get(HOVER_SAVE_KEY, (got) => {
      if (chrome.runtime.lastError) return;
      hoverSave.checked = got[HOVER_SAVE_KEY] !== false;
    });
    hoverSave.addEventListener('change', () => chrome.storage.local.set({ [HOVER_SAVE_KEY]: hoverSave.checked }));
  }
}
