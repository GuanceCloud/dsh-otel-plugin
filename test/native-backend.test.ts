import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DeepSeekHarnessOtelBackend from '../src/index.js'

const require = createRequire(import.meta.url)
const { version } = require('@deepseek-ai/dsh-session-telemetry/package.json') as { version: string }

describe(`native backend on DSH telemetry ${version}`, () => {
  afterEach(() => vi.unstubAllEnvs())

  it('captures live session events and drains Trace and Metrics on Cordis disposal', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-native-'))
    vi.stubEnv('HOME', home)
    vi.stubEnv('DSH_HOME', home)
    const captures: Array<{ path: string; body: Buffer }> = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        captures.push({ path: request.url ?? '', body: Buffer.concat(chunks) })
        response.writeHead(200, { 'content-type': 'application/x-protobuf' }).end()
      })
    })
    const ctx = new Context()
    try {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('collector has no port')
      await ctx.plugin(SessionStore)
      await ctx.plugin(DeepSeekHarnessOtelBackend, {
        endpoint: `http://127.0.0.1:${address.port}`,
        tracePath: 'v1/traces', metricsPath: 'v1/metrics', exportTimeoutMs: 1000,
      })
      expect(ctx.sessionTelemetry.sharing).toBe('full')
      const session = ctx.sessions.create(SessionId('native-fixture'), { meta: {} })
      const filename = version.startsWith('0.2.') ? 'normal-turn-v0.2.jsonl' : 'normal-turn.jsonl'
      const records = readFileSync(new URL(`../fixtures/${filename}`, import.meta.url), 'utf8').trim().split('\n')
      for (const line of records) {
        const record = JSON.parse(line)
        const type = record.attributes['event.type']
        if (type === 'turn/end') expect(captures).toHaveLength(0)
        const surface = ['user/message', 'assistant/message', 'tool/result'].includes(type)
        session.append(type, record.body, surface ? { surfaceOp: 'append' } : undefined)
      }
      await ctx.fiber.dispose()
      const trace = captures.find(item => item.path === '/v1/traces')?.body
      const metrics = captures.find(item => item.path === '/v1/metrics')?.body
      for (const name of ['invoke_agent', 'llm', 'tool:read', 'assistant']) {
        expect(trace?.includes(Buffer.from(name))).toBe(true)
      }
      expect(metrics?.includes(Buffer.from('gen_ai.workflow.duration'))).toBe(true)
      expect(metrics?.includes(Buffer.from('gen_ai.client.token.usage'))).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      rmSync(home, { recursive: true, force: true })
    }
  })
})
