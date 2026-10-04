'use strict';

// ライブラリの移設エンジン（保存先フォルダの移動）。クラッシュに耐える手順の全体を Electron 抜き
// で単体テストできるよう、main.js / ipc-transfer.js から切り出した（lib-archive / lib-index と
// 同じやり方）。ここのすべてが守る不変条件は、どの瞬間にも完全なライブラリがディスク上に存在し、
// 設定がそのどれかを指していること＝2026-06-23 のライブラリ喪失の事故を招いたのは、まさにこの
// 不変条件の破れ。
//
// 手順（relocateLibrary）: コピー＋追いつき → 設定の切り替え → src のエントリごとに検証してから
// 削除 → 空になった src の殻を消す →（取り残しが残っていれば）遅らせた掃き寄せを1回。
//
// 追いつきの周回がある理由: native host は Chrome が起動するプロセスで、保存のたびに config.json
// を読み直す＝アプリにはそれを止める経路が無い。最初のコピー（大きなライブラリでは数分）が走って
// いる間に src へ着地した保存は、そのままでは古いフォルダの中で見えないまま取り残される。新しい
// 名前が出なくなるまで src を列挙し直すことで、その窓を「コピー全体の所要時間」から「切り替えの
// 瞬間に飛行中だったもの」まで縮められる。その最後の取り残しは、下の遅らせた掃き寄せが片付ける。

import fs from 'node:fs';
import path from 'node:path';

// 書き込みの一時的な残り物（lib-atomic.ts の tmp の名前）。コピーはしない。捨てられた src の中に
// ある冷えたものは、中断された書き込みのごみで、掃き寄せてよい。
const TMP_RE = /\.tmp(-\d+)?$/i;

// mtime を比べるときの許容幅。preserveTimestamps は mtime を持ち越すが、FAT 系のファイル
// システムは2秒の粒度に丸めるので、厳密な一致を求めると誤って不一致になる。
const MTIME_TOLERANCE_MS = 2000;

// 追いつきの周回の上限。各周回は前の周回が新しい名前を見つけたときだけ走るので、上限に達したなら
// 何かが src へ書き続けているということ。
const MAX_CATCHUP_ROUNDS = 5;

// これより新しい src のファイルは、まだ書き込みの途中かもしれない（メディアのダウンロードは
// 数秒かけて書く）＝掃き寄せは、それを引き裂かずに後で人が見るために残す。
const SWEEP_MIN_AGE_MS = 15000;

async function listNonTmp(dir) {
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    names = [];
  }
  return names.filter((f) => !TMP_RE.test(f));
}

// ライブラリを丸ごと（サイドカー、画像、メディア、内部のメタデータ、.trash）src から dest へ、
// src を消さずにコピーする。その後、周回が新しいものを見つけなくなるまで src を列挙し直し、その間
// に現れた名前（コピーの途中で着地した保存）をコピーし続ける。dest に既にある名前が1つでもあれば、
// 何もコピーしないうちに中断する（利用者のファイルを踏み潰すことは一切しない）。失敗したら途中
// までのコピーを巻き戻す（src には触れない）。{ ok, entries } を返し、entries はコピーした名前の
// 全部。返り値の型を明示しているので `ok` はリテラルの判別子になり、呼び出し箇所で
// `if (!cp.ok) return` が成功側の分岐（entries がある）へ絞り込める。（.mts の下では JSDoc の
// @returns は決め手にならない＝TS は `ok` を boolean へ広げてしまい、絞り込みが効かない。）
async function copyLibraryInto(src, dest, onProgress): Promise<{ ok: false; error: string; name?: string; detail?: string } | { ok: true; entries: string[] }> {
  let entries = await listNonTmp(src);
  await fs.promises.mkdir(dest, { recursive: true });
  for (const f of entries) {
    if (fs.existsSync(path.join(dest, f))) return { ok: false, error: 'collision', name: f };
  }
  let total = entries.length;
  if (onProgress) onProgress(0, total);
  const copied: string[] = [];
  const copiedSet = new Set();
  try {
    let queue = entries;
    for (let round = 0; queue.length > 0 && round < MAX_CATCHUP_ROUNDS; round++) {
      for (const f of queue) {
        // errorOnExist は追いつきで拾った名前も守る。そこでの衝突は、移動の途中で誰かが無関係な
        // 同名のファイルを dest へ置いたということ＝推測せず中断して巻き戻す（前もっての衝突での
        // 中断と、利用者から見て同じ振る舞い）。
        await fs.promises.cp(path.join(src, f), path.join(dest, f), { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
        copied.push(f);
        copiedSet.add(f);
        if (onProgress) onProgress(copied.length, total);
      }
      queue = (await listNonTmp(src)).filter((f) => !copiedSet.has(f));
      total += queue.length;
    }
    entries = copied.slice();
  } catch (e) {
    for (const c of copied) {
      try {
        await fs.promises.rm(path.join(dest, c), { recursive: true, force: true });
      } catch {
        /* できる範囲で */
      }
    }
    return { ok: false, error: 'copy-failed', detail: e && e.message };
  }
  return { ok: true, entries };
}

// コピーしたエントリを1つ歩き、その下のすべてのファイルが同じ大きさと（±2秒の）mtime で dest に
// あることを示す。片方向（src ⊆ dest）。dest に余分なファイルがあっても損は無い。効くのは
//「src を消してもバイトを1つも失わない」という性質。
async function verifyEntry(srcPath, destPath) {
  let st: any;
  try {
    st = await fs.promises.lstat(srcPath);
  } catch {
    return true; // src から消えた（既に無いなど）＝失うものは残っていない
  }
  let dt: any;
  try {
    dt = await fs.promises.lstat(destPath);
  } catch {
    return false;
  }
  if (st.isDirectory()) {
    if (!dt.isDirectory()) return false;
    const children = await fs.promises.readdir(srcPath);
    for (const c of children) {
      if (!(await verifyEntry(path.join(srcPath, c), path.join(destPath, c)))) return false;
    }
    return true;
  }
  return st.size === dt.size && Math.abs(st.mtimeMs - dt.mtimeMs) <= MTIME_TOLERANCE_MS;
}

// 切り替えの後の後始末。コピーしたエントリごとに dest で検証し、それができてから初めて src から
// 消す（「整合性チェック」＝ほかの場所に存在すると示せていないものは決して消さない）。不一致は、
// コピーの後に src が変わった（移動の途中で着地した保存）か、コピーが悪いかのどちらか＝force を
// 付けてコピーし直し（dest の中身はこちら自身のコピーなので、上書きすれば src の最新の状態へ
// 寄っていくし、利用者のデータを踏み潰すことは無い）、検証し直す。それでも駄目なら、そのエントリ
// は src に残り、報告される。保存先フォルダの中身はすべて検証する。#302 以降、このフォルダが持つ
// のはメディアと取込キューだけで、作り直せる派生ファイルは除外する対象として1つも残っていない。
async function verifyAndCleanup(src, dest, entries) {
  let removed = 0;
  for (const f of entries) {
    const s = path.join(src, f);
    const d = path.join(dest, f);
    let ok = await verifyEntry(s, d);
    if (!ok) {
      try {
        await fs.promises.cp(s, d, { recursive: true, force: true, preserveTimestamps: true });
        ok = await verifyEntry(s, d);
      } catch {
        ok = false;
      }
    }
    if (!ok) continue;
    try {
      await fs.promises.rm(s, { recursive: true, force: true });
      removed++;
    } catch {
      /* ロックされている（ウイルス対策の走査など）＝取り残しとして残り、後で掃き寄せる */
    }
  }
  // src にまだ残っているものは、検証に失敗したか、rm に失敗したか、最後の追いつきの周回より後に
  // 着地したか（切り替えの瞬間に飛行中だった保存）のいずれか。
  const leftover = await listNonTmp(src);
  let emptied = false;
  if (leftover.length === 0) {
    try {
      // 再帰しない rmdir こそが安全弁。本当に空のフォルダでしか成功しないので、割り込んできた
      // 取り残し（や熱い tmp）があれば殻は生き残る。
      await fs.promises.rmdir(src);
      emptied = true;
    } catch {
      /* tmp ファイルや割り込みの書き込みがあると残る＝掃き寄せが再試行する */
    }
  }
  return { removed, leftover, emptied };
}

// 遅らせた取り残しの掃き寄せ。切り替えの後、捨てられた src へ書き終わったもの（移動の最中に飛行
// 中だった保存）を移す。触るのは冷えたファイル（mtime が minAgeMs より古いもの）だけ＝熱い
// ファイルはまだダウンロードの途中かもしれず、コピーや削除はそれを引き裂く。冷えた tmp ファイルは
// 中断された書き込みのごみなので削除する。{ moved, left, emptied } を返す。
async function sweepStragglers(src, dest, opts) {
  const minAgeMs = opts && typeof opts.minAgeMs === 'number' ? opts.minAgeMs : SWEEP_MIN_AGE_MS;
  const now = Date.now();
  let names: string[];
  try {
    names = await fs.promises.readdir(src);
  } catch {
    return { moved: 0, left: 0, emptied: true }; // src はもう無い
  }
  let moved = 0;
  let left = 0;
  for (const f of names) {
    const s = path.join(src, f);
    let st: any;
    try {
      st = await fs.promises.lstat(s);
    } catch {
      continue;
    }
    if (now - st.mtimeMs < minAgeMs) {
      left++;
      continue;
    }
    if (TMP_RE.test(f)) {
      try {
        await fs.promises.rm(s, { recursive: true, force: true });
      } catch {
        left++;
      }
      continue;
    }
    const d = path.join(dest, f);
    try {
      try {
        await fs.promises.cp(s, d, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
      } catch (e) {
        // 既に dest にある（前の rm が失敗した）。検証が通るなら src を消して安全。同名でも中身
        // が違うファイルは判断が付かない＝そのままにして、踏み潰すことは一切しない。
        if (!(e && e.code === 'ERR_FS_CP_EEXIST') || !(await verifyEntry(s, d))) {
          left++;
          continue;
        }
      }
      if (await verifyEntry(s, d)) {
        await fs.promises.rm(s, { recursive: true, force: true });
        moved++;
      } else {
        left++;
      }
    } catch {
      left++;
    }
  }
  let emptied = false;
  if (left === 0) {
    try {
      await fs.promises.rmdir(src);
      emptied = true;
    } catch {
      /* 競合した＝害は無い */
    }
  }
  return { moved, left, emptied };
}

// 既定ライブラリだけは、アプリが作った親フォルダも所有している。src 自体の撤去と同じく
// 非再帰の rmdir に任せ、別のファイルがあれば何もしない。任意のライブラリの親は利用者の
// フォルダなので、パスが既定位置と一致しない限り触れない。
async function removeEmptyDefaultLibraryParent(src, defaultLibraryDir) {
  if (!defaultLibraryDir || path.relative(path.resolve(defaultLibraryDir), path.resolve(src)) !== '') return false;
  const parent = path.dirname(defaultLibraryDir);
  if (parent === path.parse(parent).root) return false;
  try {
    await fs.promises.rmdir(parent);
    return true;
  } catch {
    return false;
  }
}

// 移設全体の取りまとめ（フォルダのダイアログと検証より後の全部）。deps は readConfig /
// writeConfig（設定の切り替え）、emit（save-folder-progress のペイロード）、afterFlip（監視の
// 指し直しと差分のリセット）、stillCurrent（掃き寄せの時点の番人＝設定がまだ dest を指している
// こと。その間に2回目の移動があれば掃き寄せは古くなる）、sweepDelayMs（テスト用の差し込み口。
// 既定は60秒）、closeDb / openDb（#176。どちらも任意＝このモジュール自身の単体テストのように、
// 生きたデータベースを持たない呼び出し元は省く）。
async function relocateLibrary(src, dest, deps) {
  const { readConfig, writeConfig, emit, afterFlip, stillCurrent, closeDb, openDb, defaultLibraryDir } = deps;
  const sweepDelayMs = typeof deps.sweepDelayMs === 'number' ? deps.sweepDelayMs : 60000;

  // 0) #176: hologram.db は今やライブラリフォルダの中にあるので、copyLibraryInto がこれから
  //    コピーするファイルの1つ。先に閉じる＝まだ書き込まれているデータベースをファイル単位で
  //    コピーしたものは、作りからして整合しない。閉じると WAL のチェック
  //    ポイントが打たれるので、コピーされるもの（本体のファイルと、まだ何か残っていれば
  //    -wal/-shm）は互いに噛み合った、開ける一式になる。
  if (closeDb) closeDb();

  // 1) ライブラリを丸ごと dest へコピーする（＋追いつきの周回）。src は完全に無傷のまま。
  //    コピーの進捗は約100ms に間引く。1万8千件のファイルの移動が IPC を溢れさせないように。
  let lastEmit = 0;
  const cp = await copyLibraryInto(src, dest, (done, total) => {
    const now = Date.now();
    if (done === 0 || done === total || now - lastEmit >= 100) {
      lastEmit = now;
      emit({ phase: 'copy', done, total, percent: total ? Math.floor((done / total) * 100) : 100 });
    }
  });
  if (!cp.ok) {
    emit({ phase: 'error', error: cp.error });
    return { ok: false, error: cp.error, name: cp.name };
  }

  // 2) 設定を dest へ切り替える＝これで dest が正であり、かつ完全になる。
  emit({ phase: 'switch' });
  const cfg = readConfig();
  cfg.saveFolder = dest;
  writeConfig(cfg);

  // 2.5) #176: 下で src から何かが消される前に、データベースを dest で開き直す＝この時点の src は
  //      まだライブラリの完全で無傷なコピーなので、開けないデータベース（壊れたコピー）が
  //      あればポインタをそのまま戻せる。どちらの側が正なのかはっきりしないまま、移動の途中で
  //      ライブラリを立ち往生させずに済む。
  if (openDb) {
    try {
      openDb();
    } catch {
      cfg.saveFolder = src;
      writeConfig(cfg);
      if (closeDb) closeDb();
      try {
        openDb();
      } catch {
        /* DB は閉じたまま＝ライブラリが無いときと空状態の UI が引き継ぐ */
      }
      emit({ phase: 'error', error: 'db-open-failed' });
      return { ok: false, error: 'db-open-failed' };
    }
  }

  // 3) コピーしたエントリを dest で検証し、示せたものだけ src から消し、空になった殻のフォルダを
  //    落とす。ここから先、アプリの書き込みの経路はすべて切り替え後の設定を読むので、src は
  //    ファイルが増えることしかない（飛行中の native host の保存）。
  emit({ phase: 'cleanup' });
  const cl = await verifyAndCleanup(src, dest, cp.entries);
  if (cl.emptied) await removeEmptyDefaultLibraryParent(src, defaultLibraryDir);

  afterFlip();

  emit({ phase: 'done', moved: cp.entries.length, leftover: cl.leftover.length });

  // 4) 飛行中の保存は、切り替えから数秒後に src への書き込みを終える（host はその前に古い設定を
  //    読んでいた）。冷えたところで、遅らせた掃き寄せが1回それを回収する。
  if (!cl.emptied) {
    setTimeout(() => {
      const sweep = async () => {
        // 保留後にも設定を確認する。先行移動の遅延処理を次の移動と並走させない。
        if (!stillCurrent()) return;
        const sw = await sweepStragglers(src, dest, {});
        if (sw.emptied) await removeEmptyDefaultLibraryParent(src, defaultLibraryDir);
        if (sw.moved > 0) emit({ phase: 'straggler', moved: sw.moved, left: sw.left });
      };
      Promise.resolve(deps.runBackground ? deps.runBackground(sweep) : sweep()).catch(() => {});
    }, sweepDelayMs);
  }

  return { ok: true, saveFolder: dest, moved: cp.entries.length, leftover: cl.leftover.length };
}

export { copyLibraryInto, verifyAndCleanup, sweepStragglers, removeEmptyDefaultLibraryParent, relocateLibrary };
