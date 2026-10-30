# Builds TrueReplayer 3's icons from TrueReplayer 2's: the same mark, with a "3" in a dark circle in
# the bottom-right corner (plan truereplayer3-paralelo-2026-10-30.md, slice A2).
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\icones-3.ps1 <preview-folder>
# Writes TrueReplayer3.ico, TrueReplayer3Red.ico and TrueReplayer3Purple.ico at the repository root
# and frontend\public\app-icon.png, plus a PNG preview of every size in the given folder.
# app-icon.png is badged in place: run this once, on TrueReplayer 2's original.
param([string]$Previa = "$env:TEMP\tr3-icones")

Add-Type -AssemblyName System.Drawing
$repo = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force $Previa | Out-Null

function Add-Badge([System.Drawing.Bitmap]$bmp) {
    $s = $bmp.Width
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    # Small sizes get a bigger badge: at 16 px the circle is 10 px, or the "3" cannot be read.
    $frac = if ($s -le 24) { 0.64 } elseif ($s -le 48) { 0.52 } else { 0.46 }
    $d = [Math]::Round($s * $frac)
    $x = $s - $d; $y = $s - $d
    $ring = [Math]::Max(1, [Math]::Round($s / 32))
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))), $x - $ring, $y - $ring, $d + $ring, $d + $ring)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 17, 24, 39))), $x, $y, $d - 1, $d - 1)
    $font = New-Object System.Drawing.Font('Segoe UI', [single]($d * 0.82), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF ([single]$x), ([single]($y + $d * 0.04)), ([single]($d - 1)), ([single]($d - 1))
    $g.DrawString('3', $font, [System.Drawing.Brushes]::White, $rect, $fmt)
    $g.Dispose()
}

function Read-IcoSizes([string]$path) {
    $b = [IO.File]::ReadAllBytes($path)
    $n = [BitConverter]::ToUInt16($b, 4)
    $sizes = @()
    for ($i = 0; $i -lt $n; $i++) {
        $w = $b[6 + 16 * $i]; if ($w -eq 0) { $w = 256 }
        $sizes += [int]$w
    }
    return ($sizes | Sort-Object -Unique)
}

function Write-Ico([string]$src, [string]$dst, [string]$tag) {
    $sizes = Read-IcoSizes $src
    $frames = @()
    foreach ($s in $sizes) {
        $ico = New-Object System.Drawing.Icon($src, (New-Object System.Drawing.Size($s, $s)))
        $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.DrawIcon($ico, (New-Object System.Drawing.Rectangle(0, 0, $s, $s)))
        $g.Dispose(); $ico.Dispose()
        Add-Badge $bmp
        $ms = New-Object IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Save((Join-Path $Previa "$tag-$s.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        $frames += ,@($s, $ms.ToArray())
    }
    $out = New-Object IO.MemoryStream
    $w = New-Object IO.BinaryWriter($out)
    $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($f in $frames) {
        $s = $f[0]; $data = $f[1]
        $dim = if ($s -ge 256) { 0 } else { $s }
        $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
        $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$data.Length); $w.Write([uint32]$offset)
        $offset += $data.Length
    }
    foreach ($f in $frames) { $w.Write([byte[]]$f[1]) }
    $w.Flush()
    [IO.File]::WriteAllBytes($dst, $out.ToArray())
    "$dst <- $src ($($sizes -join ', ') px)"
}

Write-Ico (Join-Path $repo 'TrueReplayer.ico') (Join-Path $repo 'TrueReplayer3.ico') 'verde'
Write-Ico (Join-Path $repo 'TrueReplayerRed.ico') (Join-Path $repo 'TrueReplayer3Red.ico') 'vermelho'
Write-Ico (Join-Path $repo 'TrueReplayerPurple.ico') (Join-Path $repo 'TrueReplayer3Purple.ico') 'roxo'

$appIcon = Join-Path $repo 'frontend\public\app-icon.png'
$orig = [System.Drawing.Image]::FromFile($appIcon)
$bmp = New-Object System.Drawing.Bitmap($orig.Width, $orig.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.DrawImage($orig, 0, 0, $orig.Width, $orig.Height); $g.Dispose(); $orig.Dispose()
Add-Badge $bmp
$bmp.Save((Join-Path $Previa 'app-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save($appIcon, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"$appIcon (badged)"
