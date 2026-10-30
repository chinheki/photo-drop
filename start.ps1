$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:PORT = '19091'
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { & $node.Source server/index.js --include-ws-fallback }
else { throw '请先安装 Node.js 22 或更新版本，并将 node 加入 PATH 后重新运行。' }
