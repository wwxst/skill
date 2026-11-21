param(
  [string]$Profile = "web"
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "找不到命令：$Name。请先安装并配置 PATH。"
  }
}

Require-Command "node"
Require-Command "ffmpeg"
Require-Command "ffprobe"
Require-Command "dsh"

$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeParts = $nodeVersion.Split('.') | ForEach-Object { [int]$_ }
if (($nodeParts[0] -lt 24) -or ($nodeParts[0] -eq 24 -and $nodeParts[1] -lt 9)) {
  throw "需要 Node.js 24.9 或更新版本，当前版本：$nodeVersion"
}

$ffmpegVersion = (& ffmpeg -version | Select-Object -First 1).Trim()
$ffprobeVersion = (& ffprobe -version | Select-Object -First 1).Trim()
if ($ffmpegVersion -match 'version\s+(\d+)\.' -and [int]$Matches[1] -lt 7) { throw "需要 FFmpeg 7+，当前版本：$ffmpegVersion" }
if ($ffprobeVersion -match 'version\s+(\d+)\.' -and [int]$Matches[1] -lt 7) { throw "需要 FFprobe 7+，当前版本：$ffprobeVersion" }

Write-Host "Node.js: $nodeVersion"
Write-Host $ffmpegVersion
Write-Host $ffprobeVersion

$packagePath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$spec = "link:$packagePath"
Write-Host "正在安装到 DeepSeek Harness profile '$Profile' ..."
& dsh plugin --profile $Profile add $spec
if ($LASTEXITCODE -ne 0) {
  throw "插件安装失败，退出码：$LASTEXITCODE"
}
Write-Host "安装命令已完成。请在 Harness 的 Plugins 页面确认 Video Studio 已启用，然后调用 video_studio_status。"
