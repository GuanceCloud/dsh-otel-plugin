param(
  [string]$Profile = "web",
  [string]$Source = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ToolDir = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-otel-pnpm-" + [guid]::NewGuid())
if ([string]::IsNullOrWhiteSpace($Source)) {
  $Candidate = Join-Path $ScriptDir "dsh-otel-plugin.tar.gz"
  if (-not (Test-Path $Candidate)) {
    throw "missing release archive; place dsh-otel-plugin.tar.gz beside this installer or pass -Source"
  }
  $Source = $Candidate
}
try {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    New-Item -ItemType Directory -Path $ToolDir | Out-Null
    $BinDir = Join-Path $ToolDir "bin"
    New-Item -ItemType Directory -Path $BinDir | Out-Null
    if (Get-Command corepack -ErrorAction SilentlyContinue) {
      corepack enable --install-directory $BinDir | Out-Null
      $env:PATH = "$BinDir$([System.IO.Path]::PathSeparator)$env:PATH"
    } else {
      npm install --prefix $ToolDir pnpm | Out-Null
      $PnpmBin = Join-Path $ToolDir "node_modules/.bin"
      $env:PATH = "$PnpmBin$([System.IO.Path]::PathSeparator)$env:PATH"
    }
  }
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw "unable to provide pnpm through corepack or npm"
  }
  if (Get-Command dsh -ErrorAction SilentlyContinue) {
    dsh plugin --profile $Profile add $Source
  } else {
    npx --yes @deepseek-ai/dsh plugin --profile $Profile add $Source
  }
  Write-Host "installed dsh-otel-plugin into profile $Profile"
} finally {
  Remove-Item -Recurse -Force $ToolDir -ErrorAction SilentlyContinue
}
