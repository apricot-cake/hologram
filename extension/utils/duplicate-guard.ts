// Duplicate-save warning (#34): "this post is already saved — copy, replace or
// skip?", asked BEFORE the save starts.
//
// Why before rather than after: the extension writes through the native host,
// which runs whether or not the desktop app does. A save made with the app
// closed has no in-app surface to resolve afterwards, so an after-the-fact
// detector would simply never get to ask. The host answers the lookup from its
// own read-only index (background.ts's checkDuplicate → the bridge's `query`),
// so the question can be asked at any time.
//
// Both on-page save paths use this — capture.ts (Alt+S post capture) and
// drag.ts (drag an image into the drop zone) — so the wording, the choices and
// the "don't ask again" setting cannot drift between them. The hover save
// button (overlay.ts) is deliberately NOT wired up: it is only ever drawn on a
// picture the library has answered "not saved" for, so pressing it is not a
// duplicate by construction (#334).
//
// Everything here fails OPEN. A missing permalink, an unreachable host, a
// storage read that errors — each answers "no warning" and the save proceeds
// exactly as it did before this feature existed. The cost of a missed warning
// is one extra record; the cost of a blocked save is the post.
import { DUPLICATE_ASK_TIMEOUT_MS } from './deadline.ts';
import { collectImageUrls, getMediaIdentitySite } from './extractor/index.ts';
import { userOnly } from './user-gesture.ts';
import type { PostMediaElement } from './extractor/types.ts';

// chrome.storage.local, boolean. Absent = on: the warning is the point of the
// feature, and a user who finds it noisy turns it off (options page, or the
// checkbox on the warning itself).
export const DUPLICATE_WARNING_KEY = 'duplicateWarning';

export type DuplicateChoice = 'copy' | 'replace' | 'skip';

// Which question the row is answering. 'duplicate' is #34's (the post is in the
// library); 'trashed' is #158's (the post is in the library's trash).
//
// One parameter rather than two, because the variant decides BOTH the answers
// offered and how `copy` describes itself, and those two must move together: a
// shortened row with the library wording would say "save it again as a second
// record" about a record the library does not have, and the full row with the
// trash wording would offer a `replace` whose target is gone.
export type ChoiceVariant = 'duplicate' | 'trashed';

// Least to most destructive, with the reversible answer first. A trashed post
// drops `replace`: it needs a live record to retire, and a trashed post has none.
const CHOICES: Record<ChoiceVariant, readonly DuplicateChoice[]> = {
  duplicate: ['copy', 'replace', 'skip'],
  trashed: ['copy', 'skip'],
};

export interface DuplicateHit {
  // The record the re-saved picture is already in — what a "replace" answer
  // names as the record to retire. Null when the library could say "this post
  // is saved" but not which capture holds the picture.
  captureId: string | null;
  // Set instead of a live match when the post is in the library's TRASH (#158):
  // not saved, but its record and files are still there and still restorable, so
  // saving again would quietly make a second copy of a post the user deleted.
  // `deletedAt` is the ISO time it was trashed, or null when the record carries
  // no stamp — the notice then drops the date rather than inventing one.
  //
  // Restoring is NOT offered here: the native host is read-only over the library
  // (#34's design), so no on-page control can carry it out. The notice says where
  // the post is; putting it back is done in the app.
  trashed?: { deletedAt: string | null } | null;
}

type Messages = (key: string, subs?: ReadonlyArray<unknown>) => string;

function readSetting(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(DUPLICATE_WARNING_KEY, (got) => {
        if (chrome.runtime.lastError) resolve(true);
        else resolve(got[DUPLICATE_WARNING_KEY] !== false);
      });
    } catch {
      resolve(true);
    }
  });
}

export function suppressWarning(): void {
  try {
    chrome.storage.local.set({ [DUPLICATE_WARNING_KEY]: false });
  } catch {
    /* the choice already made still stands — only the preference is lost */
  }
}

// Every picture URL the page offers for one post, as picture-identity keys can
// be derived from (the site's own extractor owns that rule — the same one the
// timeline overlay compares the library's saved pictures with).
//
// Returns [] on a platform with no picture-identity rule (Misskey / Mastodon
// instances). The check then rests on the post URL alone, which is #34's
// confirmed fallback: it can warn about a picture that is not actually in the
// library, and "copy" answers that harmlessly.
export function pagePictureUrls(post: Element | PostMediaElement | null): string[] {
  const site = getMediaIdentitySite();
  if (!site || !post) return [];
  const els: PostMediaElement[] = post.tagName === 'IMG' || post.tagName === 'VIDEO' ? [post as PostMediaElement] : Array.from(post.querySelectorAll<PostMediaElement>('img, video'));
  const urls = new Set<string>();
  for (const el of els) {
    // isPostMedia keeps avatars and link-card previews out: an avatar's URL
    // would never match a saved picture, but the same gate is what the overlay
    // and the hover save button already judge "is this the post's own media"
    // with, and one rule is the point.
    if (!site.isPostMedia(el)) continue;
    for (const url of collectImageUrls(el, site.platform)) urls.add(url);
  }
  return [...urls];
}

// null = save without asking (the setting is off, the post is not in the
// library, or the question could not be answered).
export async function checkDuplicate(platform: string, url: string | null, imageUrls: string[]): Promise<DuplicateHit | null> {
  if (!url || !chrome.runtime?.id) return null;
  if (!(await readSetting())) return null;
  // Fails open on a DEADLINE too, not just on an error (#507). This question is
  // asked after the picker has already let go of its click listeners, so a
  // silent background used to freeze the whole capture on "click a post to
  // save" — a banner still inviting a click that nothing was listening for.
  // Answering "no warning" late is exactly what the rest of this module does
  // for every other unanswerable case.
  const res = await new Promise<any>((resolve) => {
    let settled = false;
    const answer = (r: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => answer(null), DUPLICATE_ASK_TIMEOUT_MS);
    try {
      chrome.runtime.sendMessage({ type: 'checkDuplicate', platform, url, imageUrls }, (r: any) => {
        void chrome.runtime.lastError; // an unreachable background is "no answer", not an error to surface
        answer(r);
      });
    } catch {
      answer(null);
    }
  });
  if (!res || !res.ok) return null;
  // A trash notice is the answer when nothing live matched (#158). Read before
  // the `duplicate` gate because it is a hit in its own right: the background
  // never sets both, and returning null here would drop the notice entirely.
  if (!res.duplicate) {
    const trashed = res.trashed;
    if (!trashed || typeof trashed !== 'object') return null;
    return { captureId: null, trashed: { deletedAt: typeof trashed.deletedAt === 'string' && trashed.deletedAt ? trashed.deletedAt : null } };
  }
  return { captureId: typeof res.captureId === 'string' && res.captureId ? res.captureId : null };
}

// The deletion date as the notice shows it: the record's own calendar day in the
// viewer's locale, or '' when the record carried no stamp (the caller then uses
// the dateless wording). Time of day is deliberately dropped — "when did I decide
// I didn't want this" is a day-scale question, and a timestamp reads as precision
// the answer does not have.
export function formatDeletedAt(deletedAt: string | null | undefined): string {
  if (!deletedAt) return '';
  const t = Date.parse(deletedAt);
  if (!Number.isFinite(t)) return '';
  try {
    return new Date(t).toLocaleDateString();
  } catch {
    return '';
  }
}

function makeChoiceButton(label: string, title: string, primary: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'choice';
  if (primary) b.dataset.primary = '';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', `${label} — ${title}`);
  // Both press phases are stopped: this control is layered over host pages that
  // listen on the document (x.com and bsky.app open a lightbox), and a press
  // that reached them would act on the post behind the question.
  b.onpointerdown = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return b;
}

// The three answers plus the "don't ask again" opt-out, as one detached
// element the caller mounts inside its own surface (the capture banner's pill,
// the drop zone's card). onChoose fires exactly once.
//
// Order is copy / replace / skip — least to most destructive, with the
// reversible answer first. "Copy" leads and carries the accent because it is
// what the save would have done without the warning: the question adds
// choices, it does not change the default.
//
// `variant` picks the question being answered (#158) — which answers appear and
// how `copy` describes itself. Narrowing one row rather than building a second
// keeps ONE definition of what each answer is called, how it is styled, and that
// it must come from a real user gesture. The BUTTON NAMES are deliberately shared
// across variants: a control that renames itself per situation has to be learned
// twice, while the hint beneath it is read in the moment and can be situational.
export function buildChoiceRow(t: Messages, onChoose: (choice: DuplicateChoice) => void, variant: ChoiceVariant = 'duplicate'): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'choices';

  const row = document.createElement('div');
  row.className = 'choice-row';
  let answered = false;
  const answer = (choice: DuplicateChoice) => {
    if (answered) return;
    answered = true;
    onChoose(choice);
  };
  const choices = CHOICES[variant];
  const buttons: Array<[DuplicateChoice, string, string, boolean]> = [
    // The trash variant's hint says what happens to the copy in the trash, which
    // the library wording has no reason to mention and this one must: the answer
    // leaves TWO records behind, one of them still deleted.
    ['copy', t('dupCopy'), t(variant === 'trashed' ? 'dupCopyHintTrashed' : 'dupCopyHint'), true],
    ['replace', t('dupReplace'), t('dupReplaceHint'), false],
    ['skip', t('dupSkip'), t('dupSkipHint'), false],
  ];
  for (const [choice, label, hint, primary] of buttons.filter(([c]) => choices.includes(c))) {
    const b = makeChoiceButton(label, hint, primary);
    // Named for the browser E2E harness, which cannot read the localized label
    // (the banner follows the browser locale) — same role the overlay's
    // data-hologram-overlay attribute plays for the capture-time hide.
    b.setAttribute('data-hologram-choice', choice);
    // The answer must be the USER's (#323). These buttons live in the shared
    // shadow root, which the page can reach into, and "replace" is the most
    // destructive thing any on-page control does — it names an existing record
    // to retire. A page that could press it could pick which of the library's
    // captures goes to the trash.
    b.onclick = userOnly<MouseEvent>((e) => {
      e.preventDefault();
      e.stopPropagation();
      answer(choice);
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);

  // The same opt-out the options page carries, offered where the user is
  // actually being interrupted. Ticking it only records the preference — the
  // question on screen still waits for an answer, because turning the warning
  // off is not itself a decision about THIS save.
  const optOut = document.createElement('label');
  optOut.className = 'opt-out';
  const box = document.createElement('input');
  box.type = 'checkbox';
  // Trusted as well: this box writes a PERSISTENT setting, so a page that could
  // tick it would turn the warning off for every later save on every site (#323).
  box.onchange = userOnly(() => {
    if (box.checked) suppressWarning();
  });
  optOut.appendChild(box);
  const optOutText = document.createElement('span');
  optOutText.textContent = t('dupSuppress');
  optOut.appendChild(optOutText);
  wrap.appendChild(optOut);

  return wrap;
}
