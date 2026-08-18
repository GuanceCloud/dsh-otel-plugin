import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { createTelemetry } from '../src/telemetry.js'
import { loadFixture } from './helpers.js'

describe('OTLP transport', () => {
  const servers: ReturnType<typeof createServer>[] = []
  afterEach(() => {
    for (const server of servers.splice(0)) server.closeAllConnections()
  })

  it('exports protobuf Trace and Metrics to independent endpoints', async () => {
    const captures: Array<{ path: string; contentType?: string; body: Buffer; token?: string }> = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const capture: { path: string; contentType?: string; body: Buffer; token?: string } = {
          path: request.url ?? '',
          body: Buffer.concat(chunks),
        }
        const contentType = request.headers['content-type']
        const token = request.headers['x-fixture-token']
        if (typeof contentType === 'string') capture.contentType = contentType
        if (typeof token === 'string') capture.token = token
        captures.push(capture)
        response.writeHead(200, { 'content-type': 'application/x-protobuf' }).end()
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server has no port')
    const endpoint = `http://127.0.0.1:${address.port}`
    const config = resolveConfig({
      endpoint,
      tracePath: 'v1/traces',
      metricsPath: 'v1/metrics',
      headers: { 'x-fixture-token': 'synthetic' },
      batchDelayMs: 50,
      exportTimeoutMs: 2000,
      agentVersion: 'fixture',
    }, {}, { home: '/nonexistent', cwd: '/nonexistent' })
    const runtime = createTelemetry(config)
    await runtime.exportTurn(loadFixture())
    await runtime.forceFlush()
    await runtime.shutdown()

    const trace = captures.find(capture => capture.path === '/v1/traces')
    const metrics = captures.find(capture => capture.path === '/v1/metrics')
    expect(trace?.contentType).toContain('application/x-protobuf')
    expect(metrics?.contentType).toContain('application/x-protobuf')
    expect(trace?.token).toBe('synthetic')
    expect(trace?.body.includes(Buffer.from('invoke_agent'))).toBe(true)
    expect(trace?.body.includes(Buffer.from('tool:read'))).toBe(true)
    expect(metrics?.body.includes(Buffer.from('gen_ai.workflow.duration'))).toBe(true)
    expect(metrics?.body.includes(Buffer.from('gen_ai.agent.operation.count'))).toBe(true)
    expect(metrics?.body.includes(Buffer.from('gen_ai.agent.operation.duration'))).toBe(true)
    expect(metrics?.body.includes(Buffer.from('gen_ai.client.token.usage'))).toBe(true)
  })
})
