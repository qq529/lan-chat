$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$DistDir = Join-Path $ProjectRoot "dist"

Write-Host "=== LAN Chat SEA 打包 ===" -ForegroundColor Cyan
Write-Host ""

# 1. Bundle with esbuild
Write-Host "[1/6] 打包 JS 文件..." -ForegroundColor Yellow
$BundleFile = Join-Path $DistDir "bundle.js"
& npx esbuild server.js --bundle --platform=node --outfile=$BundleFile
if ($LASTEXITCODE -ne 0) { Write-Host "esbuild 打包失败" -ForegroundColor Red; exit 1 }

# 2. Copy assets
Write-Host "[2/6] 复制资源文件..." -ForegroundColor Yellow
Copy-Item (Join-Path $ProjectRoot "node_modules\sql.js\dist\sql-wasm.wasm") (Join-Path $DistDir "sql-wasm.wasm") -Force
if (Test-Path (Join-Path $DistDir "public")) { Remove-Item (Join-Path $DistDir "public") -Recurse -Force }
Copy-Item (Join-Path $ProjectRoot "public") (Join-Path $DistDir "public") -Recurse -Force

# 3. Create sea-config.json
Write-Host "[3/6] 创建 SEA 配置..." -ForegroundColor Yellow
$SeaConfig = @{
  main = $BundleFile
  output = Join-Path $DistDir "sea.blob"
  disableExperimentalSEAWarning = $true
}
$SeaConfig | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $DistDir "sea-config.json") -Encoding ASCII

# 4. Generate blob
Write-Host "[4/6] 生成 blob..." -ForegroundColor Yellow
Push-Location $DistDir
node --experimental-sea-config sea-config.json
if ($LASTEXITCODE -ne 0) { Write-Host "生成 blob 失败" -ForegroundColor Red; Pop-Location; exit 1 }
Pop-Location

# 5. Copy node.exe
Write-Host "[5/6] 生成 server-core.exe..." -ForegroundColor Yellow
$NodeExe = (Get-Command node).Source
$ServerExe = Join-Path $DistDir "server-core.exe"
Copy-Item $NodeExe $ServerExe -Force

# 6. Postject - remove signature and inject blob
Write-Host "[6/6] 注入 blob..." -ForegroundColor Yellow
npx postject $ServerExe NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
npx postject $ServerExe NODE_SEA_BLOB (Join-Path $DistDir "sea.blob") --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { Write-Host "注入 blob 失败" -ForegroundColor Red; exit 1 }

# Cleanup
Remove-Item (Join-Path $DistDir "bundle.js") -Force
Remove-Item (Join-Path $DistDir "sea-config.json") -Force
Remove-Item (Join-Path $DistDir "sea.blob") -Force

Write-Host ""
Write-Host "=== 打包完成! ===" -ForegroundColor Green
Write-Host "输出文件: $ServerExe" -ForegroundColor Cyan
Write-Host "依赖文件: $(Join-Path $DistDir 'sql-wasm.wasm'), $(Join-Path $DistDir 'public\')" -ForegroundColor Cyan
