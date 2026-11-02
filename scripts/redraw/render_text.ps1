# renders white text with a Poppins font to a tight transparent PNG: render_text.ps1 <ttf> <pxSize> <text> <out.png>
param([string]$ttf,[float]$size,[string]$text,[string]$out)
Add-Type -AssemblyName System.Drawing
$pfc = New-Object System.Drawing.Text.PrivateFontCollection
$pfc.AddFontFile($ttf)
$font = New-Object System.Drawing.Font($pfc.Families[0], $size, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$bmp = New-Object System.Drawing.Bitmap 2400, 400
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawString($text, $font, [System.Drawing.Brushes]::White, 20, 20)
$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
