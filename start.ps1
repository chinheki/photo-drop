$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:PORT = '19091'
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { & $node.Source server/index.js --include-ws-fallback }
else { & 'C:/Users/heki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' server/index.js --include-ws-fallback }
