using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

// 私用ショートカットの入口。コンソールを持たない実行ファイルとして生成する。
internal static class LocalAppLauncher
{
    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            if (args.Length != 1 || !File.Exists(args[0]))
                throw new ArgumentException("起動用スクリプトが見つかりません。");
            Process.Start(new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Path.GetFullPath(args[0]) + "\"",
                UseShellExecute = false,
                CreateNoWindow = true
            });
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Hologram");
        }
    }
}
