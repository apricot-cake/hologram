Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class HologramChromeArguments {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
    public static string[] Parse(string commandLine) {
        if (String.IsNullOrWhiteSpace(commandLine)) return new string[0];
        int count;
        IntPtr memory = CommandLineToArgvW(commandLine.Trim(), out count);
        if (memory == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            var args = new string[count];
            for (int i = 0; i < count; i++) {
                args[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, i * IntPtr.Size));
            }
            return args;
        } finally {
            LocalFree(memory);
        }
    }
}
'@

if ($MyInvocation.InvocationName -ne '.') {
    $chromeProcesses = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ForEach-Object {
        [PSCustomObject]@{ ProcessId = $_.ProcessId; Args = @([HologramChromeArguments]::Parse($_.CommandLine)) }
    })
    ConvertTo-Json -InputObject $chromeProcesses -Depth 4 -Compress
}
