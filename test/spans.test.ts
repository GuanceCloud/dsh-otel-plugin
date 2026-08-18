import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { buildSpanModels } from '../src/spans.js'
import { loadFixture } from './helpers.js'

describe('span construction', () => {
  it('builds the required hierarchy with bounded timestamps and usage', () => {
    const config = resolveConfig({ captureContent: 'preview', agentVersion: 'fixture' }, {}, {
      home: '/nonexistent', cwd: '/nonexistent',
    })
    const spans = buildSpanModels(loadFixture(), config)
    expect(spans.map(span => span.name)).toEqual([
      'invoke_agent', 'llm', 'llm', 'tool:read', 'skill:example', 'assistant', 'assistant',
    ])
    const root = spans[0]!
    expect(spans.slice(1).every(span => span.startTime >= root.startTime && span.endTime <= root.endTime)).toBe(true)
    expect(spans.every(span => span.endTime > span.startTime)).toBe(true)
    expect(spans.find(span => span.name === 'skill:example')?.parentId).toBe('tool:call-1')
    expect(spans.find(span => span.name === 'tool:read')?.parentId).toBe('root')
    expect(spans.find(span => span.name === 'assistant')?.attributes['gen_ai.usage.input_tokens']).toBeUndefined()
    expect(root.attributes).toMatchObject({
      'gen_ai.usage.input_tokens': 45,
      'gen_ai.usage.output_tokens': 9,
      tool_count: 1,
      final_status: 'completed',
    })
  })

  it('removes all content attributes in none mode', () => {
    const config = resolveConfig({ captureContent: 'none' }, {}, { home: '/nonexistent', cwd: '/nonexistent' })
    const spans = buildSpanModels(loadFixture(), config)
    const root = spans[0]!
    expect(root.attributes['gen_ai.input.messages']).toBeUndefined()
    expect(root.attributes.input_preview).toBeUndefined()
    expect(root.attributes.input_length).toBe(19)
  })
})
