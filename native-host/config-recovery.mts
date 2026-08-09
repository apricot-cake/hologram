// 保存フォルダの復旧と、破壊的な操作の関門（2026-06-23 のライブラリ喪失の一件のあとに
// 追加）。saveFolder の写しが config.json にしか無いということは、1回の切り詰めで
// ライブラリが黙って空の既定に落ちうるということだった。そこで config の隣に冗長な
// ポインタファイルを持ち、既定に落ちる前にそれを通して解決する。判断は純関数にしてある
// ので、Electron 無しで単体テストできる。

interface ResolveSaveFolderArgs {
  configSaveFolder: string | null | undefined;
  pointer: string | null | undefined;
  pointerExists: boolean;
  defaultDir: string;
}
interface ResolveSaveFolderResult {
  folder: string;
  source: 'config' | 'pointer' | 'default';
}

// どの保存フォルダを使うかを解決する。
//   configSaveFolder ＝config.json から読んだ saveFolder（無いことも空のこともある）
//   pointer          ＝冗長な saveFolder.path から読んだパス（または null）
//   pointerExists     ＝`pointer` がディスク上の実在のディレクトリに解決するか
//   defaultDir        ＝共有の既定のライブラリのディレクトリ（最後の手段）
export function resolveSaveFolder({ configSaveFolder, pointer, pointerExists, defaultDir }: ResolveSaveFolderArgs): ResolveSaveFolderResult {
  if (typeof configSaveFolder === 'string' && configSaveFolder.trim()) {
    return { folder: configSaveFolder, source: 'config' };
  }
  if (pointer && typeof pointer === 'string' && pointer.trim() && pointerExists) {
    return { folder: pointer, source: 'pointer' }; // config が失った → 復旧する
  }
  return { folder: defaultDir, source: 'default' };
}

interface ClearAllBlockReasonArgs {
  configCorrupt: boolean;
  hasExplicitSaveFolder: boolean;
  hasPointer: boolean;
  // #37: 明示された saveFolder が、今この瞬間は実在のディレクトリに解決しない
  // （アプリの外から移動・改名・取り外しがあった）。`lost` とは別物だ。config はまだ値を
  // 持っていて、ただそれがディスク上に存在しない＝libraryIsMissing を参照。
  libraryMissing: boolean;
}

// 破壊的な「すべて削除」を拒まなければならないか。ユーザーが選んだフォルダではなく、
// 復旧したフォルダや既定のフォルダを指している可能性があるときは拒む。
//   configCorrupt         ＝config.json は存在したが、今回の読みで解析に失敗した
//   hasExplicitSaveFolder ＝config が今、空でない saveFolder を持っている
//   hasPointer            ＝冗長なポインタファイルが存在する（以前フォルダが選ばれた）
//   libraryMissing        ＝下の libraryIsMissing を参照
export function clearAllBlockReason({ configCorrupt, hasExplicitSaveFolder, hasPointer, libraryMissing }: ClearAllBlockReasonArgs): 'corrupt' | 'missing' | 'lost' | null {
  if (configCorrupt) return 'corrupt';
  // 設定されたフォルダ自体が消えている。そこに実際に何が在るのか見えない間は、決して
  // 消さないし、必要になった時に作り直すこともしない（#37）。
  if (libraryMissing) return 'missing';
  // 明示のフォルダは無いが、ポインタが以前は在ったことを示している → config が落とした。
  if (!hasExplicitSaveFolder && hasPointer) return 'lost';
  return null; // 新規インストール（フォルダもポインタも無い）か、健全な明示のフォルダ
}

interface LibraryIsMissingArgs {
  hasExplicitSaveFolder: boolean;
  folderExists: boolean;
}

// #37: config.json がまだ明示的に名を挙げているのに、保存フォルダがアプリの外で消えた
// （移動、改名、ドライブの取り外し）。意図して狭くしてある＝明示された saveFolder に
// ついてしか成立しない。新規インストール（明示のフォルダが無く、既定のディレクトリを
// 通して解決する）は決して「消えた」にならない。まだ何も保存していないだけであり、
// 既定のディレクトリは必要になった時に作られる。
export function libraryIsMissing({ hasExplicitSaveFolder, folderExists }: LibraryIsMissingArgs): boolean {
  return hasExplicitSaveFolder && !folderExists;
}
