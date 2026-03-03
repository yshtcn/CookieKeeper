# Cookie Keeper - Icon Generator
# Draws a cookie-themed PNG icon at 16, 32, 48, 128 px using .NET System.Drawing

Add-Type -AssemblyName System.Drawing

$dir = Join-Path $PSScriptRoot "icons"
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

function Draw-Icon {
    param([int]$size, [string]$path)

    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode   = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = [int]($size * 0.04)
    $r   = $size - 2 * $pad   # diameter

    # ── Cookie body (warm amber gradient simulation via two ellipses) ──
    $bodyBrush = New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb(240, 163, 60))
    $g.FillEllipse($bodyBrush, $pad, $pad, $r, $r)

    # Lighter highlight circle (top-left quadrant)
    $hlBrush = New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb(60, 255, 220, 120))
    $g.FillEllipse($hlBrush, $pad, $pad, [int]($r * 0.6), [int]($r * 0.6))

    # ── Cookie border ──
    $borderPen = New-Object System.Drawing.Pen(
        [System.Drawing.Color]::FromArgb(185, 110, 20),
        [float][Math]::Max(1, $size / 20))
    $g.DrawEllipse($borderPen, $pad, $pad, $r, $r)

    # ── Chocolate chips ──
    $chipBrush = New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb(75, 35, 5))
    $cs = [int][Math]::Max(2, $size / 7)   # chip size

    # Chip positions (relative to size)
    $chips = @(
        @{ rx = 0.30; ry = 0.22 },
        @{ rx = 0.60; ry = 0.18 },
        @{ rx = 0.18; ry = 0.52 },
        @{ rx = 0.55; ry = 0.52 },
        @{ rx = 0.38; ry = 0.68 }
    )

    foreach ($c in $chips) {
        $cx = [int]($size * $c.rx) - [int]($cs / 2)
        $cy = [int]($size * $c.ry) - [int]($cs / 2)
        $g.FillEllipse($chipBrush, $cx, $cy, $cs, $cs)
    }

    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "  Created: $path"
}

Write-Host "Generating Cookie Keeper icons..."
Draw-Icon -size  16 -path (Join-Path $dir "icon16.png")
Draw-Icon -size  32 -path (Join-Path $dir "icon32.png")
Draw-Icon -size  48 -path (Join-Path $dir "icon48.png")
Draw-Icon -size 128 -path (Join-Path $dir "icon128.png")
Write-Host "Done."
