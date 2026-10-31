# Builds the tray icons for the states that are not the app's own icon (plan truereplayer3-paralelo,
# slice D2; Tray board, "O ícone muda de forma e de cor"): the same mark as tools/icones-3.ps1, with a
# badge in the bottom-right corner that says the state where the "3" would be.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\icones-estado.ps1 <preview-folder>
# Writes TrueReplayer3Recording.ico (red, a record dot), TrueReplayer3Replaying.ico (a play triangle),
# TrueReplayer3Off.ico (grey, the pause bars: Shortcuts off) and TrueReplayer3Alert.ico (an amber "!":
# needs a look) at the repository root, plus a PNG preview of every size in the given folder.
# Ready is TrueReplayer3.ico and Clicker TrueReplayer3Purple.ico, from tools/icones-3.ps1.
param([string]$Previa = "$env:TEMP\tr3-icones-estado")

Add-Type -AssemblyName System.Drawing
$repo = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force $Previa | Out-Null

# The badge's circle, the same size and place as the "3" of tools/icones-3.ps1, filled with $fill and
# ringed in white; $draw paints the symbol inside the circle's box.
function Add-StateBadge([System.Drawing.Bitmap]$bmp, [System.Drawing.Color]$fill, [scriptblock]$draw) {
    $s = $bmp.Width
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $frac = if ($s -le 24) { 0.64 } elseif ($s -le 48) { 0.52 } else { 0.46 }
    $d = [Math]::Round($s * $frac)
    $x = $s - $d; $y = $s - $d
    $ring = [Math]::Max(1, [Math]::Round($s / 32))
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)), $x - $ring, $y - $ring, $d + $ring, $d + $ring)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $fill), $x, $y, $d - 1, $d - 1)
    & $draw $g ([single]$x) ([single]$y) ([single]($d - 1))
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

# A desaturated, lighter copy of the mark: Shortcuts off reads as "not working right now".
function Set-Grey([System.Drawing.Bitmap]$bmp) {
    for ($yy = 0; $yy -lt $bmp.Height; $yy++) {
        for ($xx = 0; $xx -lt $bmp.Width; $xx++) {
            $c = $bmp.GetPixel($xx, $yy)
            if ($c.A -eq 0) { continue }
            $l = [int](0.3 * $c.R + 0.59 * $c.G + 0.11 * $c.B)
            $l = [Math]::Min(255, [int]($l * 0.75 + 70))
            $bmp.SetPixel($xx, $yy, [System.Drawing.Color]::FromArgb($c.A, $l, $l, $l))
        }
    }
}

function Write-StateIco([string]$src, [string]$dst, [string]$tag, [System.Drawing.Color]$fill, [scriptblock]$draw, [bool]$grey = $false) {
    $sizes = Read-IcoSizes $src
    $frames = @()
    foreach ($s in $sizes) {
        $ico = New-Object System.Drawing.Icon($src, (New-Object System.Drawing.Size($s, $s)))
        $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.DrawIcon($ico, (New-Object System.Drawing.Rectangle(0, 0, $s, $s)))
        $g.Dispose(); $ico.Dispose()
        if ($grey) { Set-Grey $bmp }
        Add-StateBadge $bmp $fill $draw
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

$dark = [System.Drawing.Color]::FromArgb(255, 17, 24, 39)

# Recording: the red mark, a red record dot in the dark circle.
$dot = {
    param($g, $x, $y, $d)
    $r = $d * 0.56
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 239, 68, 68))), $x + ($d - $r) / 2, $y + ($d - $r) / 2, $r, $r)
}
# Replaying: a green play triangle, nudged right so it looks centred.
$play = {
    param($g, $x, $y, $d)
    $h = $d * 0.52; $w = $h * 0.9
    $cx = $x + $d / 2 + $w * 0.1; $cy = $y + $d / 2
    $pts = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF ([single]($cx - $w / 2)), ([single]($cy - $h / 2))),
        (New-Object System.Drawing.PointF ([single]($cx + $w / 2)), ([single]$cy)),
        (New-Object System.Drawing.PointF ([single]($cx - $w / 2)), ([single]($cy + $h / 2))))
    $g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 34, 197, 94))), $pts)
}
# Shortcuts off: two white pause bars.
$pause = {
    param($g, $x, $y, $d)
    $bh = $d * 0.5; $bw = [Math]::Max(1.0, $d * 0.15); $gap = [Math]::Max(1.0, $d * 0.13)
    $by = $y + ($d - $bh) / 2; $bx = $x + ($d - (2 * $bw + $gap)) / 2
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.FillRectangle($brush, [single]$bx, [single]$by, [single]$bw, [single]$bh)
    $g.FillRectangle($brush, [single]($bx + $bw + $gap), [single]$by, [single]$bw, [single]$bh)
}
# Needs a look: a dark "!" on amber.
$bang = {
    param($g, $x, $y, $d)
    $font = New-Object System.Drawing.Font('Segoe UI', [single]($d * 0.82), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF ([single]$x), ([single]($y + $d * 0.03)), ([single]$d), ([single]$d)
    $g.DrawString('!', $font, (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 17, 24, 39))), $rect, $fmt)
}

Write-StateIco (Join-Path $repo 'TrueReplayerRed.ico') (Join-Path $repo 'TrueReplayer3Recording.ico') 'gravando' $dark $dot
Write-StateIco (Join-Path $repo 'TrueReplayer.ico') (Join-Path $repo 'TrueReplayer3Replaying.ico') 'executando' $dark $play
Write-StateIco (Join-Path $repo 'TrueReplayer.ico') (Join-Path $repo 'TrueReplayer3Off.ico') 'desligado' $dark $pause $true
Write-StateIco (Join-Path $repo 'TrueReplayer.ico') (Join-Path $repo 'TrueReplayer3Alert.ico') 'atencao' ([System.Drawing.Color]::FromArgb(255, 245, 158, 11)) $bang
