$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

function New-Color {
  param(
    [Parameter(Mandatory)]
    [string]$Hex,
    [int]$Alpha = 255
  )

  $base = [System.Drawing.ColorTranslator]::FromHtml($Hex)
  return [System.Drawing.Color]::FromArgb($Alpha, $base.R, $base.G, $base.B)
}

function New-RoundedRectPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()

  if ($Radius -le 0) {
    $path.AddRectangle([System.Drawing.RectangleF]::new($X, $Y, $Width, $Height))
    return $path
  }

  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Fill-RoundedRect {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Brush]$Brush,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = New-RoundedRectPath -X $X -Y $Y -Width $Width -Height $Height -Radius $Radius
  try {
    $Graphics.FillPath($Brush, $path)
  } finally {
    $path.Dispose()
  }
}

function Draw-Corner {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Pen]$Pen,
    [float]$X,
    [float]$Y,
    [float]$Length,
    [ValidateSet('tl', 'tr', 'bl', 'br')]
    [string]$Corner
  )

  switch ($Corner) {
    'tl' {
      $Graphics.DrawLine($Pen, $X, $Y + $Length, $X, $Y)
      $Graphics.DrawLine($Pen, $X, $Y, $X + $Length, $Y)
    }
    'tr' {
      $Graphics.DrawLine($Pen, $X, $Y, $X + $Length, $Y)
      $Graphics.DrawLine($Pen, $X + $Length, $Y, $X + $Length, $Y + $Length)
    }
    'bl' {
      $Graphics.DrawLine($Pen, $X, $Y, $X, $Y + $Length)
      $Graphics.DrawLine($Pen, $X, $Y + $Length, $X + $Length, $Y + $Length)
    }
    'br' {
      $Graphics.DrawLine($Pen, $X, $Y + $Length, $X + $Length, $Y + $Length)
      $Graphics.DrawLine($Pen, $X + $Length, $Y, $X + $Length, $Y + $Length)
    }
  }
}

$outputDir = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$sizes = 16, 32, 48, 128

foreach ($size in $sizes) {
  $unit = $size / 128.0
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $backgroundPath = New-RoundedRectPath -X (4 * $unit) -Y (4 * $unit) -Width (120 * $unit) -Height (120 * $unit) -Radius (22 * $unit)
    $backgroundBrush = [System.Drawing.SolidBrush]::new((New-Color '#93c5fd'))
    $quotePen = [System.Drawing.Pen]::new((New-Color '#ffffff' 248), [Math]::Max(7.0 * $unit, 2.4))
    $quotePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $quotePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    $graphics.FillPath($backgroundBrush, $backgroundPath)
    Draw-Corner -Graphics $graphics -Pen $quotePen -X (34 * $unit) -Y (28 * $unit) -Length (26 * $unit) -Corner 'tl'
    Draw-Corner -Graphics $graphics -Pen $quotePen -X (68 * $unit) -Y (74 * $unit) -Length (26 * $unit) -Corner 'br'

    $bitmap.Save((Join-Path $outputDir "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)

    $backgroundPath.Dispose()
    $backgroundBrush.Dispose()
    $quotePen.Dispose()
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}
