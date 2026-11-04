param([string]$Source)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../extension/icons'))
$logoPath = Join-Path $iconDirectory 'logo.png'
if ($Source) {
  $sourcePath = (Resolve-Path -LiteralPath $Source).Path
  if ($sourcePath -ne $logoPath) { Copy-Item -LiteralPath $sourcePath -Destination $logoPath -Force }
}
$sourceImage = [Drawing.Image]::FromFile($logoPath)
try {
  if ($sourceImage.Width -ne $sourceImage.Height) { throw 'The logo must be square.' }
  foreach ($size in @(16, 32, 48, 128, 256)) {
    $bitmap = New-Object Drawing.Bitmap($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $attributes = New-Object Drawing.Imaging.ImageAttributes
    try {
      $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $attributes.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
      $destination = New-Object Drawing.Rectangle(0, 0, $size, $size)
      $graphics.DrawImage($sourceImage, $destination, 0, 0, $sourceImage.Width, $sourceImage.Height, [Drawing.GraphicsUnit]::Pixel, $attributes)
      $bitmap.Save((Join-Path $iconDirectory "icon$size.png"), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $attributes.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
  }
} finally { $sourceImage.Dispose() }
