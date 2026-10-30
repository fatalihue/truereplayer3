# Sets TrueReplayer 3's preview version in the five version files (plan
# truereplayer3-paralelo-2026-10-30.md, decision 7): 3.0.0-preview.N where a SemVer fits,
# 3.0.0.N in the numeric fields (AssemblyVersion, FileVersion, the two manifests).
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\versao-preview.ps1 <N>
param([Parameter(Mandatory = $true)][int]$N)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$semver = "3.0.0-preview.$N"; $numeric = "3.0.0.$N"
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Set-Field([string]$file, [string]$pattern, [string]$replacement) {
    $path = Join-Path $repo $file
    $text = [IO.File]::ReadAllText($path)
    if ($text -notmatch $pattern) { throw "$file has no match for $pattern" }
    [IO.File]::WriteAllText($path, ([regex]::Replace($text, $pattern, $replacement)), $utf8)
}

Set-Field 'TrueReplayer.csproj' '<Version>[^<]+</Version>' "<Version>$semver</Version>"
Set-Field 'TrueReplayer.csproj' '<AssemblyVersion>[^<]+</AssemblyVersion>' "<AssemblyVersion>$numeric</AssemblyVersion>"
Set-Field 'TrueReplayer.csproj' '<FileVersion>[^<]+</FileVersion>' "<FileVersion>$numeric</FileVersion>"
Set-Field 'Package.appxmanifest' '(\r?\n\s*)Version="[0-9.]+"(\s*/>)' "`${1}Version=`"$numeric`"`${2}"
Set-Field 'app.manifest' '<assemblyIdentity version="[0-9.]+"' "<assemblyIdentity version=`"$numeric`""
Set-Field 'frontend\package.json' '"version": "[^"]+"' "`"version`": `"$semver`""
Push-Location (Join-Path $repo 'frontend'); npm install --package-lock-only | Out-Null; Pop-Location
"versao $semver ($numeric)"
