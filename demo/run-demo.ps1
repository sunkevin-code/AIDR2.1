$ErrorActionPreference = "Stop"
$server = Join-Path $PSScriptRoot "server.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found in PATH."
}
node $server
