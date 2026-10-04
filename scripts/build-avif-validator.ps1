param(
    [string]$BuildDirectory = '.sandbox/avif-native-build',
    [string]$OutputDirectory = 'app/vendor/avif'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot

# 既存の開発ツールを使う。ツールのシステム導入はこのスクリプトでは行わない。
$cmakeCommand = Get-Command cmake -ErrorAction SilentlyContinue
$cmakePath = if ($cmakeCommand) { $cmakeCommand.Source } else { $null }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$developerCommand = $null
if (Test-Path -LiteralPath $vswhere) {
    $installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($installation) {
        $developerCommand = Join-Path $installation 'Common7/Tools/VsDevCmd.bat'
        if (!$cmakePath) { $cmakePath = Join-Path $installation 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe' }
    }
}
if (!$cmakePath -or !(Test-Path -LiteralPath $cmakePath)) { throw 'CMake 3.22 以降が必要です。' }
foreach ($tool in @('meson', 'nasm')) {
    if (!(Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool が PATH に必要です。既存環境または隔離したビルド環境を指定してください。" }
}
$taskBuildPath = [System.IO.Path]::GetFullPath((Join-Path $taskRoot $BuildDirectory))
$taskOutputPath = [System.IO.Path]::GetFullPath((Join-Path $taskRoot $OutputDirectory))
if (!$taskBuildPath.StartsWith($taskRoot + [System.IO.Path]::DirectorySeparatorChar) -or !$taskOutputPath.StartsWith($taskRoot + [System.IO.Path]::DirectorySeparatorChar)) {
    throw 'ビルド先と配布先は主作業ツリー内に指定してください。'
}
$taskSourcePath = Join-Path $taskRoot 'native-image'
$ctestPath = Join-Path (Split-Path -Parent $cmakePath) 'ctest.exe'
if ($developerCommand) {
    # cmd.exe は Visual Studio が提供する環境設定とビルドにだけ使う。
    $command = 'call "{0}" -arch=x64 -host_arch=x64 >nul && "{1}" -S "{2}" -B "{3}" -G Ninja -DCMAKE_BUILD_TYPE=Release && "{1}" --build "{3}" --config Release && "{4}" --test-dir "{3}" -C Release --output-on-failure' -f $developerCommand, $cmakePath, $taskSourcePath, $taskBuildPath, $ctestPath
    & $env:ComSpec /d /s /c $command
} else {
    & $cmakePath -S $taskSourcePath -B $taskBuildPath -DCMAKE_BUILD_TYPE=Release
    if ($LASTEXITCODE -ne 0) { throw 'AVIF 検査器の構成に失敗しました。' }
    & $cmakePath --build $taskBuildPath --config Release
    if ($LASTEXITCODE -ne 0) { throw 'AVIF 検査器のビルドに失敗しました。' }
    & $ctestPath --test-dir $taskBuildPath -C Release --output-on-failure
}
if ($LASTEXITCODE -ne 0) { throw 'AVIF 検査器のビルドに失敗しました。' }
$executable = Join-Path $taskBuildPath 'hologram-avif-validator.exe'
if (!(Test-Path -LiteralPath $executable)) { $executable = Join-Path $taskBuildPath 'Release/hologram-avif-validator.exe' }
if (!(Test-Path -LiteralPath $executable)) { throw '検査器の実行ファイルがありません。' }
$libavifSource = Join-Path $taskBuildPath '_deps/libavif-src'
$dav1dSource = Join-Path $taskBuildPath '_deps/dav1d-src'
$avifRevision = & git -C $libavifSource rev-parse HEAD
$dav1dRevision = & git -C $dav1dSource rev-parse HEAD
if ($avifRevision -ne 'c5240fc79fe5c2407e10afd35f5505ef6333ea49' -or $dav1dRevision -ne 'b546257f770768b2c88258c533da38b91a06f737') { throw '固定した decoder のソース revision と一致しません。' }
$decoderVersion = & $executable --version
if ($LASTEXITCODE -ne 0 -or $decoderVersion -notmatch '^libavif 1\.4\.2; dav1d \[dec\]:1\.5\.3') { throw '検査器の decoder version と一致しません。' }
New-Item -ItemType Directory -Force -Path $taskOutputPath | Out-Null
Copy-Item -LiteralPath $executable -Destination (Join-Path $taskOutputPath 'avif-validator.exe') -Force
Copy-Item -LiteralPath (Join-Path $libavifSource 'LICENSE') -Destination (Join-Path $taskOutputPath 'libavif-LICENSE') -Force
Copy-Item -LiteralPath (Join-Path $dav1dSource 'COPYING') -Destination (Join-Path $taskOutputPath 'dav1d-COPYING') -Force
$hash = (Get-FileHash -LiteralPath (Join-Path $taskOutputPath 'avif-validator.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
@{ libavif = '1.4.2'; dav1d = '1.5.3'; libavifRevision = $avifRevision; dav1dRevision = $dav1dRevision; sha256 = $hash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskOutputPath 'build.json') -Encoding utf8
Write-Output "AVIF 検査器: libavif 1.4.2 / dav1d 1.5.3 / SHA256 $hash"
