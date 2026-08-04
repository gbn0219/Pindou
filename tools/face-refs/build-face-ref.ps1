# 把 5 张五官示例图合成一张 3+2 拼图 face-ref.jpg（服务端固定随请求发送，作为五官表达参考）
# 用法：powershell -ExecutionPolicy Bypass -File tools/face-refs/build-face-ref.ps1
Add-Type -AssemblyName System.Drawing

$srcDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $srcDir 'face-ref.jpg'
$names = @(
  'face-mickey.png',
  'face-bears.png',
  'face-anime-girl.png',
  'face-christmas-bear.png',
  'face-girl.png'
)
$cell = 800
$gap = 20
$cols = 3
$rows = 2
$w = $cols * $cell + ($cols - 1) * $gap
$h = $rows * $cell + ($rows - 1) * $gap

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

for ($i = 0; $i -lt $names.Count; $i++) {
  $img = [System.Drawing.Image]::FromFile((Join-Path $srcDir $names[$i]))
  $col = $i % $cols
  $row = [Math]::Floor($i / $cols)
  $x = $col * ($cell + $gap)
  $y = $row * ($cell + $gap)
  $scale = [Math]::Min($cell / $img.Width, $cell / $img.Height)
  $dw = [int]($img.Width * $scale)
  $dh = [int]($img.Height * $scale)
  $dx = $x + [int](($cell - $dw) / 2)
  $dy = $y + [int](($cell - $dh) / 2)
  $g.DrawImage($img, $dx, $dy, $dw, $dh)
  $img.Dispose()
}
$g.Dispose()

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]88)
$bmp.Save($out, $codec, $ep)
$bmp.Dispose()
Write-Output ("face-ref.jpg -> " + (Get-Item $out).Length + " bytes, " + $w + "x" + $h)