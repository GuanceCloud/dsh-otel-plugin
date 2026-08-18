#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { TurnCollector } from '../dist/collector.js'
import { resolveConfig } from '../dist/config.js'
import { createTelemetry } from '../dist/telemetry.js'

const captures = []
const server = createServer((request, response) => {
  const chunks = []
  request.on('data', chunk => chunks.push(Buffer.from(chunk)))
  request.on('end', () => {
    captures.push({
      path: request.url,
      contentType: request.headers['content-type'],
      body: Buffer.concat(chunks),
    })
    response.writeHead(200, { 'content-type': 'application/x-protobuf' }).end()
  })
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
if (!address || typeof address === 'string') throw new Error('collector has no TCP port')

const collector = new TurnCollector()
let turn
const fixture = readFileSync(new URL('../fixtures/normal-turn.jsonl', import.meta.url), 'utf8').trim().split('\n')
for (const line of fixture) turn = collector.accept(JSON.parse(line)) ?? turn
if (!turn) throw new Error('fixture did not produce a terminal turn')

const endpoint = `http://127.0.0.1:${address.port}`
const runtime = createTelemetry(resolveConfig({
  endpoint,
  tracePath: 'v1/traces',
  metricsPath: 'v1/metrics',
  exportTimeoutMs: 2000,
  batchDelayMs: 50,
  agentVersion: 'smoke',
}, {}, { home: '/nonexistent', cwd: '/nonexistent' }))
try {
  await runtime.exportTurn(turn)
  await runtime.forceFlush()
} finally {
  await runtime.shutdown()
  server.close()
  server.closeAllConnections()
}

const trace = captures.find(capture => capture.path === '/v1/traces')
const metrics = captures.find(capture => capture.path === '/v1/metrics')
if (!trace?.body.includes(Buffer.from('invoke_agent'))) throw new Error('trace payload is missing invoke_agent')
if (!metrics?.body.includes(Buffer.from('gen_ai.workflow.duration'))) throw new Error('metrics payload is missing workflow duration')
if (trace.contentType !== 'application/x-protobuf' || metrics.contentType !== 'application/x-protobuf') {
  throw new Error('OTLP payload did not use protobuf content type')
}
console.log(`OTLP smoke passed: ${trace.body.length} trace bytes, ${metrics.body.length} metric bytes`)
