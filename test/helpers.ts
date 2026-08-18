import { readFileSync } from 'node:fs'
import type { SessionTelemetryRecord } from '@deepseek-ai/dsh-session-telemetry'
import type { Turn } from '../src/model.js'
import { TurnCollector } from '../src/collector.js'

export function loadFixture(): Turn {
  const collector = new TurnCollector()
  const lines = readFileSync(new URL('../fixtures/normal-turn.jsonl', import.meta.url), 'utf8').trim().split('\n')
  let turn: Turn | undefined
  for (const line of lines) {
    turn = collector.accept(JSON.parse(line) as SessionTelemetryRecord) ?? turn
  }
  if (!turn) throw new Error('fixture did not produce a turn')
  return turn
}

export function record(
  type: string,
  time: number,
  body: unknown,
  sessionId = 'session-test',
): SessionTelemetryRecord {
  return {
    channel: 'ledger',
    time,
    severity: type === 'turn/end' ? 'error' : 'info',
    attributes: { 'session.id': sessionId, 'event.type': type, 'event.seq': time },
    body,
  }
}
