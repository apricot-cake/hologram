import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { libraryFilePath } from './library-files.ts';

// OS 標準のファイル一覧を渡す。ファイル名はコードへ埋め込まず、標準入力で渡す。
// https://learn.microsoft.com/dotnet/api/system.windows.forms.clipboard.setfiledroplist
const windowsScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$files = [System.Collections.Specialized.StringCollection]::new()
$paths = ConvertFrom-Json ([Console]::In.ReadToEnd())
foreach ($file in $paths) { [void]$files.Add($file) }
[System.Windows.Forms.Clipboard]::SetFileDropList($files)
`;

// https://developer.apple.com/documentation/appkit/nspasteboard/writeobjects(_:)
const macScript = `
ObjC.import('AppKit');
const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
const input = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
const urls = JSON.parse(input).map(file => $.NSURL.fileURLWithPath(file));
const board = $.NSPasteboard.generalPasteboard;
board.clearContents;
if (!board.writeObjects($(urls))) throw new Error('File copy failed');
`;

export async function resolveClipboardFiles(files: unknown, saveFolder: string): Promise<string[] | null> {
  if (!Array.isArray(files) || !files.length) return null;
  const paths: string[] = [];
  for (const file of files) {
    const resolved = libraryFilePath(file, saveFolder);
    if (!resolved) return null;
    paths.push(resolved);
  }
  const unique = [...new Set(paths)];
  try {
    if (!(await Promise.all(unique.map(async (file) => (await stat(file)).isFile()))).every(Boolean)) return null;
    return unique;
  } catch {
    return null;
  }
}

export async function copyLibraryFiles(files: unknown, saveFolder: string): Promise<boolean> {
  const paths = await resolveClipboardFiles(files, saveFolder);
  if (!paths) return false;
  let command: string;
  let args: string[];
  if (process.platform === 'win32') {
    command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    args = ['-NoProfile', '-NonInteractive', '-STA', '-Command', windowsScript];
  } else if (process.platform === 'darwin') {
    command = '/usr/bin/osascript';
    args = ['-l', 'JavaScript', '-e', macScript];
  } else {
    return false;
  }
  return new Promise((resolve) => {
    const child = execFile(command, args, { windowsHide: true, timeout: 15000 }, (error) => resolve(!error));
    child.stdin?.on('error', () => resolve(false));
    child.stdin?.end(JSON.stringify(paths));
  });
}
