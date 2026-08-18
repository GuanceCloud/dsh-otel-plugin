import { describe, expect, it } from 'vitest'
import { TurnCollector } from '../src/collector.js'
import { loadFixture, record } from './helpers.js'

describe('TurnCollector', () => {
  it('normalizes a terminal multi-step tool turn', () => {
    const turn = loadFixture()
    expect(turn.session).toMatchObject({ id: 'session-fixture', parentId: 'parent-fixture', seedLength: 4 })
    expect(turn.finalStatus).toBe('completed')
    expect(turn.llmCalls).toHaveLength(2)
    expect(turn.llmCalls[0]?.usage).toEqual({ input: 20, output: 5, cacheRead: 3, reasoning: 2 })
    expect(turn.llmCalls[1]?.input).toEqual([{
      role: 'tool',
      tool_call_id: 'call-1',
      content: [{ type: 'text', text: 'fixture result' }],
    }])
    expect(turn.toolCalls).toHaveLength(1)
    expect(turn.toolCalls[0]).toMatchObject({ callId: 'call-1', name: 'read', status: 'ok' })
    expect(turn.toolCalls[0]?.skill).toEqual({ name: 'example', path: '/opt/dsh/skills/example/SKILL.md' })
    expect(turn.assistantOutputs.at(-1)?.text).toBe('Done')
  })

  it('maps error and cancellation terminal reasons', () => {
    const errorCollector = new TurnCollector()
    errorCollector.accept(record('turn/start', 1, { turn: 1 }))
    errorCollector.accept(record('user/message', 2, { content: [{ type: 'text', text: 'fail' }], source: { kind: 'user' } }))
    const failed = errorCollector.accept(record('turn/end', 3, {
      turn: 1,
      reason: { kind: 'error', error: { code: 'RATE_LIMITED', message: 'synthetic' } },
    }))
    expect(failed).toMatchObject({ finalStatus: 'completed', status: 'error', errorType: 'RATE_LIMITED' })

    const cancelledCollector = new TurnCollector()
    cancelledCollector.accept(record('turn/start', 10, { turn: 1 }))
    cancelledCollector.accept(record('user/message', 11, { content: [{ type: 'text', text: 'stop' }], source: { kind: 'user' } }))
    const cancelled = cancelledCollector.accept(record('turn/end', 12, {
      turn: 1,
      reason: { kind: 'aborted', reason: { kind: 'user' } },
    }))
    expect(cancelled).toMatchObject({ finalStatus: 'cancelled', status: 'ok', reason: 'aborted' })
  })

  it('drops blank turns, incomplete tools, duplicates, and plugin context', () => {
    const collector = new TurnCollector()
    collector.accept(record('turn/start', 1, { turn: 1 }))
    collector.accept(record('user/message', 2, { content: [{ type: 'text', text: 'internal' }], source: { kind: 'plugin' } }))
    collector.accept(record('tool/call', 3, { turn: 1, step: 1, callId: 'open', name: 'bash', arguments: '{}' }))
    expect(collector.accept(record('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }))).toBeUndefined()

    collector.accept(record('turn/start', 5, { turn: 2 }))
    collector.accept(record('user/message', 6, { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
    expect(collector.accept(record('turn/end', 7, { turn: 2, reason: { kind: 'completed' } }))).toBeDefined()
    expect(collector.accept(record('turn/end', 8, { turn: 2, reason: { kind: 'completed' } }))).toBeUndefined()
  })

  it('recognizes a Windows SKILL.md path only from tool arguments', () => {
    const collector = new TurnCollector()
    collector.accept(record('turn/start', 1, { turn: 1 }))
    collector.accept(record('user/message', 2, { content: [{ type: 'text', text: 'read skill' }], source: { kind: 'user' } }))
    collector.accept(record('tool/call', 3, {
      turn: 1,
      step: 1,
      callId: 'skill-win',
      name: 'read',
      arguments: JSON.stringify({ path: 'C:\\Users\\fixture\\skills\\review\\SKILL.md' }),
    }))
    collector.accept(record('tool/result', 4, {
      turn: 1,
      step: 1,
      callId: 'skill-win',
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    }))
    const turn = collector.accept(record('turn/end', 5, { turn: 1, reason: { kind: 'completed' } }))
    expect(turn?.toolCalls[0]?.skill).toMatchObject({ name: 'review' })
  })
})
