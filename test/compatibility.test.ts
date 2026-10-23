import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import semver from 'semver'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const ranges = {
  engine: manifest.engines.dsh,
  telemetry: manifest.peerDependencies['@deepseek-ai/dsh-session-telemetry'],
}

describe.each(Object.entries(ranges))('%s compatibility', (_name, range) => {
  it.each(['0.1.0-rc.7', '0.1.0', '0.1.7-rc.2', '0.2.1-rc.2', '0.2.1'])('accepts dsh %s', (version) => {
    // DSH preflight includes prereleases; npm peer resolution must also accept the tested RCs.
    expect(semver.satisfies(version, range, { includePrerelease: true })).toBe(true)
  })

  it.each(['0.1.0-rc.7', '0.2.1-rc.2'])('accepts npm peer %s without an exemption', (version) => {
    expect(semver.satisfies(version, range)).toBe(true)
  })

  it.each(['0.1.0-rc.6', '0.2.0-rc.1', '0.2.0', '0.2.1-rc.1', '0.3.0-alpha.1', '0.3.0', '1.0.0'])('rejects unverified dsh %s', (version) => {
    expect(semver.satisfies(version, range, { includePrerelease: true })).toBe(false)
  })
})
