import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseHeaders, resolveConfig, resolveSignalUrl } from '../src/config.js'

describe('configuration', () => {
  it('resolves options over environment, project, and user files', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-otel-config-'))
    const home = join(root, 'home')
    const cwd = join(root, 'work')
    mkdirSync(join(home, '.dsh'), { recursive: true })
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(home, '.dsh', 'gtrace.json'), JSON.stringify({ endpoint: 'http://global', environment: 'global' }))
    writeFileSync(join(cwd, '.dsh', 'gtrace.json'), JSON.stringify({ endpoint: 'http://local', environment: 'local' }))
    const config = resolveConfig(
      { endpoint: 'http://option', publicKey: 'public', secretKey: 'secret' },
      { DSH_OTEL_ENDPOINT: 'http://env' },
      { home, cwd },
    )
    expect(config.traceUrl).toBe('http://option/otel/v1/traces')
    expect(config.metricsUrl).toBe('http://option/otel/v1/metrics')
    expect(config.environment).toBe('local')
    expect(config.headers.Authorization).toBe(`Basic ${Buffer.from('public:secret').toString('base64')}`)
    expect(config.configSourceFiles).toHaveLength(2)
  })

  it('supports standard OTEL endpoints and does not duplicate paths', () => {
    const config = resolveConfig({}, {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://trace/v1/traces',
      OTEL_EXPORTER_OTLP_HEADERS: 'x-token=fixture,to-headless=true',
    }, { home: '/nonexistent', cwd: '/nonexistent' })
    expect(config.traceUrl).toBe('http://trace/v1/traces')
    expect(config.metricsUrl).toBe('http://collector:4318/otel/v1/metrics')
    expect(config.headers).toEqual({ 'x-token': 'fixture', 'to-headless': 'true' })
    expect(resolveSignalUrl('http://x/otel/v1/traces', 'otel/v1/traces')).toBe('http://x/otel/v1/traces')
    expect(parseHeaders('{"a":"b"}')).toEqual({ a: 'b' })
  })

  it('honors DSH_HOME for the global config file', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-otel-home-'))
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'gtrace.json'), JSON.stringify({ endpoint: 'http://dsh-home' }))
    const config = resolveConfig({}, { DSH_HOME: root }, { home: '/ignored', cwd: '/nonexistent' })
    expect(config.traceUrl).toBe('http://dsh-home/otel/v1/traces')
    expect(config.configSourceFiles).toEqual([join(root, 'gtrace.json')])
  })
})
