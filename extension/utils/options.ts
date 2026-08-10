'use strict';

// 設定ページ（マニフェストの options_ui＝拡張機能の設定が住む唯一の場所。
// 将来のツールバーポップアップは、自前で持たずあえてここへリンクする）。
// テーマの設定は削除した＝拡張機能のどの面も prefers-color-scheme 経由で
// ブラウザに追従するため（#270）。よってここに残っているのはタイムライン
// オーバーレイの2つの設定、重複警告、診断へのリンクだ。見た目は
// utils/page.css で、診断ページと共有している（#44）。
//
// diag.ts と同じ理由で IIFE に包んでいる: tsc は拡張機能の全ファイルを1つ
// のプログラムとしてコンパイルするため、トップレベルの名前は一意でなけれ
// ばならない。
import { servedLocale } from './locale.ts';

export function startOptions(): void {
  // どちらも overlay.js（content script）が読み、書き込むのはここだけ。
  // 未設定 = overlay.js が最初から持つ既定値＝印は常に表示（#309）、保存ボ
  // タンはオン（#94）。このチェックはローカル限定なので、オプトインすべき
  // ものは何もない。
  const MARK_MODE_KEY = 'savedBadgeMode';
  const HOVER_SAVE_KEY = 'hoverSaveButton';
  // duplicate-guard.ts（#34）を通して capture.ts/drag.ts が読む。警告自体
  // も同じオプトアウトを備えているので、この行は元に戻す手段になる。
  const DUPLICATE_WARNING_KEY = 'duplicateWarning';
  const MARK_MODES = ['always', 'hover', 'off'];

  // 文字列は chrome.i18n 経由で _locales から来る（拡張機能ページの標準的
  // な経路）。静的な HTML のテキストは、chrome.i18n がない file:// プレ
  // ビュー向けの日本語フォールバックだ。
  try {
    // このページはタブとして開く（マニフェストの options_ui
    // open_in_tab）ため、自分の名前と自分が何であるかを説明する行を持つ
    // ＝chrome://extensions やコンテキストメニューから何もない状態で開か
    // れることがあり、素の3個のチェックボックスの並びだけでは、読み手に
    // これが誰の設定なのか伝わらない（#44）。
    const title = chrome.i18n && chrome.i18n.getMessage('optionsTitle');
    if (title) document.title = title;
    // 以下の文字列はすべてこれから置き換わるので、document はフォール
    // バック用マークアップの言語を名乗り続けるのをやめなければならない
    // （#1057、WCAG 2.2 SC 3.1.1）。getUILanguage() をそのまま使わず
    // servedLocale を使う＝`_locales` は ja と en しか持たないので、
    // fr-FR の Chrome は英語のテーブルを読んでいることになる。詳細は
    // locale.ts を参照。
    if (chrome.i18n) document.documentElement.lang = servedLocale(chrome.i18n.getUILanguage());
    const setText = (id: string, key: string) => {
      const el = document.getElementById(id);
      const text = chrome.i18n && chrome.i18n.getMessage(key);
      if (el && text) el.textContent = text;
    };
    setText('pageTitle', 'optionsTitle');
    setText('pageLede', 'optionsLede');
    setText('sectionTimeline', 'optionsSectionTimeline');
    setText('sectionSaving', 'optionsSectionSaving');
    setText('diagLink', 'optionsOpenDiag');
    setText('savedBadgeLabel', 'optionsSavedBadge');
    setText('savedBadgeDesc', 'optionsSavedBadgeDesc');
    setText('savedBadgeModeHoverLabel', 'optionsSavedBadgeHover');
    setText('savedBadgeModeAlwaysLabel', 'optionsSavedBadgeAlways');
    setText('savedBadgeModeOffLabel', 'optionsSavedBadgeOff');
    setText('hoverSaveLabel', 'optionsHoverSave');
    setText('hoverSaveDesc', 'optionsHoverSaveDesc');
    setText('duplicateWarningLabel', 'optionsDuplicateWarning');
    setText('duplicateWarningDesc', 'optionsDuplicateWarningDesc');
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

  // 残る2つの設定はどちらも同じ形＝未設定が「オン」を意味するチェックボッ
  // クスで、ページ内で持つ id の下に保存する。
  for (const key of [HOVER_SAVE_KEY, DUPLICATE_WARNING_KEY]) {
    const box = document.getElementById(key);
    if (!(box instanceof HTMLInputElement)) continue;
    chrome.storage.local.get(key, (got) => {
      if (chrome.runtime.lastError) return;
      box.checked = got[key] !== false;
    });
    box.addEventListener('change', () => {
      chrome.storage.local.set({ [key]: box.checked });
    });
  }
}
