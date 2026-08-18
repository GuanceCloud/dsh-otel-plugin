import type { Attributes } from '@opentelemetry/api'
import type { ResolvedConfig } from './config.js'
import type { SpanModel, Turn } from './model.js'
import { captureValue, preview } from './redaction.js'

/** Remove undefined and unsupported OTel attribute values. */
export function attributes(values: Record<string, unknown>): Attributes {
  const result: Attributes = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    } else if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
      result[key] = value as string[]
    } else if (Array.isArray(value) && value.every(item => typeof item === 'number')) {
      result[key] = value as number[]
    } else if (Array.isArray(value) && value.every(item => typeof item === 'boolean')) {
      result[key] = value as boolean[]
    }
  }
  return result
}

function sum(turn: Turn, key: 'input' | 'output' | 'cacheRead' | 'reasoning'): number {
  return turn.llmCalls.reduce((total, call) => total + call.usage[key], 0)
}

/** Build a GTrace-compatible span tree without touching the OTel SDK. */
export function buildSpanModels(turn: Turn, config: ResolvedConfig): SpanModel[] {
  const spans: SpanModel[] = []
  const inputPreview = preview(turn.inputText, config.captureContent, config.maxAttributeLength)
  const finalOutput = turn.assistantOutputs.at(-1)
  const outputText = finalOutput?.text ?? ''
  const outputPreview = preview(outputText, config.captureContent, config.maxAttributeLength)
  const lastLlm = turn.llmCalls.at(-1)
  const rootId = 'root'
  const rootAttributes = attributes({
    'gen_ai.conversation.id': turn.session.id,
    session_id: turn.session.id,
    turn_id: String(turn.turnId),
    'gen_ai.operation.name': 'invoke_agent',
    'gen_ai.agent.name': config.agentName,
    'gen_ai.agent.version': config.agentVersion,
    'gen_ai.input.messages': captureValue(turn.input, config.captureContent, config.maxAttributeLength),
    'gen_ai.output.messages': captureValue(
      turn.assistantOutputs.map(output => ({ role: 'assistant', parts: output.content })),
      config.captureContent,
      config.maxAttributeLength,
    ),
    'gen_ai.output.type': finalOutput?.outputKind === 'text' ? 'text' : finalOutput?.outputKind,
    'gen_ai.provider.name': lastLlm?.provider,
    'gen_ai.request.model': lastLlm?.requestModel,
    'gen_ai.response.model': lastLlm?.responseModel,
    'gen_ai.response.finish_reasons': turn.llmCalls.flatMap(call => call.finishReason ? [call.finishReason] : []),
    'gen_ai.usage.input_tokens': sum(turn, 'input'),
    'gen_ai.usage.output_tokens': sum(turn, 'output'),
    'gen_ai.usage.cache_read.input_tokens': sum(turn, 'cacheRead'),
    'gen_ai.usage.reasoning.output_tokens': sum(turn, 'reasoning'),
    input_preview: inputPreview.value,
    input_length: inputPreview.length,
    output_preview: outputPreview.value,
    output_length: outputPreview.length,
    tool_count: turn.toolCalls.length,
    final_status: turn.finalStatus,
    reason: turn.reason,
    status: turn.status,
    'error.type': turn.errorType,
    'dsh.session.parent_id': turn.session.parentId,
    'dsh.session.seed_length': turn.session.seedLength,
  }) as SpanModel['attributes']
  spans.push({
    id: rootId,
    name: 'invoke_agent',
    startTime: turn.startTime,
    endTime: turn.endTime,
    status: turn.status,
    attributes: rootAttributes,
    kind: 'root',
  })

  for (const call of turn.llmCalls) {
    const inputText = call.input.map(item => JSON.stringify(item)).join('')
    const input = preview(inputText, config.captureContent, config.maxAttributeLength)
    const output = preview(call.outputText, config.captureContent, config.maxAttributeLength)
    spans.push({
      id: `llm:${call.step}`,
      parentId: rootId,
      name: 'llm',
      startTime: call.startTime,
      endTime: call.endTime,
      status: call.status,
      attributes: attributes({
        'gen_ai.conversation.id': turn.session.id,
        session_id: turn.session.id,
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': call.provider,
        'gen_ai.request.model': call.requestModel,
        'gen_ai.response.model': call.responseModel,
        'gen_ai.input.messages': captureValue(call.input, config.captureContent, config.maxAttributeLength),
        'gen_ai.output.messages': captureValue(
          [{ role: 'assistant', parts: call.output }],
          config.captureContent,
          config.maxAttributeLength,
        ),
        'gen_ai.output.type': call.finishReason === 'tool_call' ? 'tool_call' : 'text',
        'gen_ai.response.finish_reasons': call.finishReason ? [call.finishReason] : undefined,
        'gen_ai.usage.input_tokens': call.usage.input,
        'gen_ai.usage.output_tokens': call.usage.output,
        'gen_ai.usage.cache_read.input_tokens': call.usage.cacheRead,
        'gen_ai.usage.reasoning.output_tokens': call.usage.reasoning,
        input_preview: input.value,
        input_length: input.length,
        output_preview: output.value,
        output_length: output.length,
        output_kind: call.finishReason === 'tool_call' ? 'tool_call' : 'text',
        status: call.status,
        'error.type': call.errorType,
      }) as SpanModel['attributes'],
      kind: 'llm',
    })
  }

  for (const tool of turn.toolCalls) {
    const id = `tool:${tool.callId}`
    spans.push({
      id,
      parentId: rootId,
      name: `tool:${tool.name}`,
      startTime: tool.startTime,
      endTime: tool.endTime,
      status: tool.status,
      attributes: attributes({
        'gen_ai.conversation.id': turn.session.id,
        session_id: turn.session.id,
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': tool.name,
        'gen_ai.tool.call.id': tool.callId,
        'gen_ai.tool.call.arguments': captureValue(tool.arguments, config.captureContent, config.maxAttributeLength),
        'gen_ai.tool.call.result': captureValue(tool.result, config.captureContent, config.maxAttributeLength),
        tool_command: captureValue(
          typeof tool.arguments === 'object' && tool.arguments !== null
            ? (tool.arguments as Record<string, unknown>).cmd ?? (tool.arguments as Record<string, unknown>).command
            : undefined,
          config.captureContent,
          config.maxAttributeLength,
        ),
        tool_result_status: tool.status === 'ok' ? 'completed' : 'error',
        reason: tool.reason,
        'triggered_by.llm_span_id': `llm:${tool.step}`,
        status: tool.status,
        'error.type': tool.errorType,
        'gen_ai.skill.name': tool.skill?.name,
        'gen_ai.skill.path': tool.skill?.path,
        skill_call_id: tool.skill ? tool.callId : undefined,
      }) as SpanModel['attributes'],
      kind: 'tool',
    })
    if (tool.skill) {
      spans.push({
        id: `skill:${tool.callId}`,
        parentId: id,
        name: `skill:${tool.skill.name}`,
        startTime: tool.startTime,
        endTime: tool.endTime,
        status: tool.status,
        attributes: attributes({
          'gen_ai.conversation.id': turn.session.id,
          session_id: turn.session.id,
          'gen_ai.operation.name': 'skill',
          'gen_ai.skill.name': tool.skill.name,
          'gen_ai.skill.path': tool.skill.path,
          'gen_ai.skill.result.status': tool.status === 'ok' ? 'completed' : 'error',
          'skill.name': tool.skill.name,
          'skill.path': tool.skill.path,
          skill_call_id: tool.callId,
          status: tool.status,
        }) as SpanModel['attributes'],
        kind: 'skill',
      })
    }
  }

  for (const output of turn.assistantOutputs) {
    const startTime = Math.max(turn.startTime, Math.min(output.time, turn.endTime - 1))
    const text = preview(output.text, config.captureContent, config.maxAttributeLength)
    spans.push({
      id: `assistant:${output.step}`,
      parentId: rootId,
      name: 'assistant',
      startTime,
      endTime: startTime + 1,
      status: 'ok',
      attributes: attributes({
        'gen_ai.conversation.id': turn.session.id,
        session_id: turn.session.id,
        'gen_ai.output.type': output.outputKind === 'text' ? 'text' : output.outputKind,
        'gen_ai.provider.name': output.provider,
        'gen_ai.response.model': output.model,
        output_preview: text.value,
        output_length: text.length,
        output_kind: output.outputKind,
        status: 'ok',
      }) as SpanModel['attributes'],
      kind: 'assistant',
    })
  }

  return spans
}
