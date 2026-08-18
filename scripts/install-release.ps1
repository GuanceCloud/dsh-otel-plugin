param(
  [string]$Version = "latest",
  [string]$Profile = "web",
  [string]$Source = "",
  [string]$Endpoint = "",
  [string]$XToken = "",
  [string[]]$Tag = @(),
  [switch]$NoConfig
)

$ErrorActionPreference = "Stop"
$Repository = if ($env:DSH_OTEL_REPOSITORY) { $env:DSH_OTEL_REPOSITORY } else { "GuanceCloud/dsh-otel-plugin" }
$ToolDir = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-otel-" + [guid]::NewGuid())
$Archive = Join-Path $ToolDir "dsh-otel-plugin.tar.gz"
$DshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME ".dsh" }
$ConfigFile = if ($env:DSH_OTEL_CONFIG_FILE) { $env:DSH_OTEL_CONFIG_FILE } else { Join-Path $DshRoot "gtrace.json" }

function Log([string]$Message) { Write-Host "[install] $Message" }
function Fail([string]$Message) { throw "[install] $Message" }
function Hash([string]$Path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }

New-Item -ItemType Directory -Path $ToolDir -Force | Out-Null
try {
  if ([string]::IsNullOrWhiteSpace($Source)) {
    if ($Version -eq "latest") {
      $Url = "https://github.com/$Repository/releases/latest/download/dsh-otel-plugin.tar.gz"
    } else {
      $Normalized = $Version.TrimStart("v")
      $Url = "https://github.com/$Repository/releases/download/v$Normalized/dsh-otel-plugin-v$Normalized.tar.gz"
    }
    Log "downloading $Url"
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Archive
    try {
      $Expected = (Invoke-WebRequest -UseBasicParsing -Uri "$Url.sha256").Content.Trim().Split()[0].ToLowerInvariant()
    } catch {
      $Sums = (Invoke-WebRequest -UseBasicParsing -Uri ((Split-Path $Url -Parent) + "/SHA256SUMS")).Content
      $Name = Split-Path $Url -Leaf
      $Line = $Sums -split "\`n" | Where-Object { $_ -match "\s\*?$([regex]::Escape($Name))\s*$" } | Select-Object -First 1
      $Expected = $Line.Trim().Split()[0].ToLowerInvariant()
    }
    if ((Hash $Archive) -ne $Expected) { Fail "sha256 verification failed" }
    Log "sha256 verified"
  } elseif ($Source -match '^https?://') {
    Invoke-WebRequest -UseBasicParsing -Uri $Source -OutFile $Archive
  } else {
    Copy-Item -LiteralPath $Source -Destination $Archive
  }

  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    $BinDir = Join-Path $ToolDir "bin"
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
    if (Get-Command corepack -ErrorAction SilentlyContinue) {
      corepack enable --install-directory $BinDir | Out-Null
      $env:PATH = "$BinDir$([System.IO.Path]::PathSeparator)$env:PATH"
    } else {
      npm install --prefix $ToolDir pnpm | Out-Null
      $PnpmBin = Join-Path $ToolDir "node_modules/.bin"
      $env:PATH = "$PnpmBin$([System.IO.Path]::PathSeparator)$env:PATH"
    }
  }
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Fail "unable to provide pnpm through corepack or npm" }
  $ProfileRoot = Join-Path $DshRoot (Join-Path "profiles" $Profile)
  New-Item -ItemType Directory -Path $ProfileRoot -Force | Out-Null
  $ProfilePackage = Join-Path $ProfileRoot "package.json"
  if (Test-Path -LiteralPath $ProfilePackage) {
    $Package = Get-Content -Raw -LiteralPath $ProfilePackage | ConvertFrom-Json
    foreach ($Section in @('dependencies', 'devDependencies', 'optionalDependencies')) {
      $Values = $Package.$Section
      if ($Values -and $Values.PSObject.Properties['dsh-otel-plugin']) {
        $Values.PSObject.Properties.Remove('dsh-otel-plugin')
      }
    }
    $Package | ConvertTo-Json -Depth 30 | Set-Content -Encoding UTF8 -LiteralPath $ProfilePackage
  }
  Remove-Item -Force -LiteralPath (Join-Path $ProfileRoot "pnpm-lock.yaml") -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force -LiteralPath (Join-Path $ProfileRoot "node_modules/dsh-otel-plugin") -ErrorAction SilentlyContinue
  Get-ChildItem -LiteralPath $ProfileRoot -Filter ".dsh-otel-plugin-install-*.tar.gz" -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  $StableArchive = Join-Path $ProfileRoot (".dsh-otel-plugin-install-" + $PID + ".tar.gz")
  Copy-Item -LiteralPath $Archive -Destination $StableArchive -Force
  if (Get-Command dsh -ErrorAction SilentlyContinue) {
    & dsh plugin --profile $Profile add $StableArchive
  } else {
    & npx --yes @deepseek-ai/dsh plugin --profile $Profile add $StableArchive
  }

  if (-not $NoConfig) {
    $Config = if (Test-Path -LiteralPath $ConfigFile) { Get-Content -Raw -LiteralPath $ConfigFile | ConvertFrom-Json } else { [pscustomobject]@{} }
    if ($null -eq $Config.enabled) { $Config | Add-Member enabled $true }
    if ($Endpoint) { if ($Config.PSObject.Properties['endpoint']) { $Config.endpoint = $Endpoint } else { $Config | Add-Member endpoint $Endpoint } }
    if ($null -eq $Config.headers) { $Config | Add-Member headers ([pscustomobject]@{}) }
    if ($XToken) { if ($Config.headers.PSObject.Properties['X-Token']) { $Config.headers.'X-Token' = $XToken } else { $Config.headers | Add-Member 'X-Token' $XToken } }
    if ($null -eq $Config.tracePath) { $Config | Add-Member tracePath 'v1/write/otel-llm' }
    if ($null -eq $Config.metricsPath) { $Config | Add-Member metricsPath 'v1/write/otel-metrics' }
    if ($null -eq $Config.resourceAttributes) { $Config | Add-Member resourceAttributes ([pscustomobject]@{}) }
    foreach ($Item in $Tag) {
      $Parts = $Item -split '=', 2
      if ($Parts.Count -ne 2) { Fail "invalid -Tag: $Item" }
      $Config.resourceAttributes | Add-Member -Force $Parts[0] $Parts[1]
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $ConfigFile) -Force | Out-Null
    $Config | ConvertTo-Json -Depth 30 | Set-Content -Encoding UTF8 -LiteralPath $ConfigFile
    Log "updated $ConfigFile"
  }
  Log "installed dsh-otel-plugin into profile $Profile"
  Log "restart the DSH process before starting a new session"
} finally {
  Remove-Item -Recurse -Force $ToolDir -ErrorAction SilentlyContinue
}
