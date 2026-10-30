# Lists the TrueReplayer 2 commits TrueReplayer 3 has not taken yet (plan
# truereplayer3-paralelo-2026-10-30.md, rule 2). TrueReplayer 3 forked from 2's main at 1361d23
# (2.50.0). Every 2 commit after that is either cherry-picked here with -x, which leaves its hash
# in a "(cherry picked from commit ...)" line, or written down in pendentes-do-2.pulados.txt with
# the reason it was skipped (old interface, version bump, release). Run after `git fetch tr2`.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\pendentes-do-2.ps1
param([string]$Base = '1361d23', [string]$Ref = 'tr2/main')

$repo = Split-Path -Parent $PSScriptRoot
$taken = @{}
$log = git -C $repo log --format=%B HEAD
foreach ($m in [regex]::Matches(($log -join "`n"), 'cherry picked from commit ([0-9a-f]{7,40})')) {
    $taken[$m.Groups[1].Value.Substring(0, 7)] = $true
}
$skipFile = Join-Path $PSScriptRoot 'pendentes-do-2.pulados.txt'
if (Test-Path $skipFile) {
    foreach ($line in Get-Content $skipFile) {
        if ($line -match '^([0-9a-f]{7,40})\b') { $taken[$Matches[1].Substring(0, 7)] = $true }
    }
}

$pending = @(git -C $repo log --reverse --format='%h %ad %s' --date=short "$Base..$Ref" |
    Where-Object { -not $taken[$_.Substring(0, 7)] })
if ($pending.Count -eq 0) { "Nothing pending from $Ref since $Base." }
else { "Pending from $Ref since ${Base} ($($pending.Count)):"; $pending }
