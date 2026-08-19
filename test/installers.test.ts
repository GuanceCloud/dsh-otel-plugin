import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')

function readScript(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('installer scripts', () => {
  it('keeps install.sh OSS-only and plugin-root aware', () => {
    const script = readScript('scripts/install.sh')
    expect(script).toContain('OSS_ENDPOINT="${OSS_ENDPOINT:-}"')
    expect(script).toContain('OSS_ENDPOINT is required for install.sh')
    expect(script).toContain('download_and_verify "${DOWNLOAD_BASE_URL%/}/${PLUGIN_NAME}.tar.gz"')
    expect(script).toContain('download_and_verify "${DOWNLOAD_BASE_URL%/}/${PLUGIN_NAME}-v${version}.tar.gz"')
    expect(script).not.toContain('https://github.com/${repo}/releases/latest/download')
  })

  it('keeps install-release.sh dual-mode for GitHub Release and OSS', () => {
    const script = readScript('scripts/install-release.sh')
    expect(script).toContain('OSS_ENDPOINT="${OSS_ENDPOINT:-}"')
    expect(script).toContain('optional OSS root endpoint')
    expect(script).toContain('DOWNLOAD_BASE_URL="$(resolve_download_base_url)"')
    expect(script).toContain('https://github.com/${repo}/releases/latest/download/${PLUGIN_NAME}.tar.gz')
    expect(script).toContain('https://github.com/${repo}/releases/download/v${version}/${PLUGIN_NAME}-v${version}.tar.gz')
  })

  it('keeps install-release.ps1 OSS-aware for connector downloads', () => {
    const script = readScript('scripts/install-release.ps1')
    expect(script).toContain('$OssEndpoint = if ($OssEndpoint) { $OssEndpoint } elseif ($env:OSS_ENDPOINT) { $env:OSS_ENDPOINT } else { "" }')
    expect(script).toContain('function Resolve-OssDownloadBase')
    expect(script).toContain('$Url = "$DownloadBase/$PluginName.tar.gz"')
    expect(script).toContain('$Url = "https://github.com/$Repository/releases/latest/download/$PluginName.tar.gz"')
  })
})
