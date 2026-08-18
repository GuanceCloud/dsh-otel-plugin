import type { SessionTelemetryRecord } from '@deepseek-ai/dsh-session-telemetry'
import type {
  AssistantOutput,
  LlmCall,
  SessionIdentity,
  SkillUse,
  TokenUsage,
  ToolCall,
  Turn,
} from './model.js'

type JsonObject = Record<string, unknown>

interface StepState {
  step: number
  startTime: number
  endTime?: number
  provider?: string
  requestModel?: string
  responseModel?: string
  input: unknown[]
  output: unknown[]
  outputText: string
  hasToolCall: boolean
  usage: TokenUsage
  assistantTime?: number
}

interface ToolState extends ToolCall {
  complete: boolean
}

interface TurnState {
  session: SessionIdentity
  turnId: number
  startTime: number
  input: unknown[]
  inputText: string
  steps: Map<number, StepState>
  tools: Map<string, ToolState>
  assistants: AssistantOutput[]
}

interface SessionState {
  active: TurnState | undefined
  pendingUser: JsonObject[]
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function contentText(content: unknown): string {
  return array(content).flatMap((part) => {
    const item = object(part)
    if (!item) return []
    const direct = string(item.text)
    if (direct !== undefined && (item.type === 'text' || item.type === 'reasoning')) return [direct]
    if (Array.isArray(item.content)) return [contentText(item.content)]
    return []
  }).join('')
}

function zeroUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, reasoning: 0 }
}

function usage(value: unknown): TokenUsage {
  const item = object(value)
  return {
    input: number(item?.inputTokens) ?? number(item?.input_tokens) ?? 0,
    output: number(item?.outputTokens) ?? number(item?.output_tokens) ?? 0,
    cacheRead: number(item?.cacheReadTokens) ?? number(item?.cache_read_tokens) ?? 0,
    reasoning: number(item?.reasoningTokens) ?? number(item?.reasoning_tokens) ?? 0,
  }
}

function skillFromArguments(value: unknown): SkillUse | undefined {
  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const item = pending.pop()
    if (typeof item === 'string') {
      const match = /(?:^|[\s"'])([^\s"']*[\\/]([^/\\\s"']+)[\\/]SKILL\.md)(?:$|[\s"'])/i.exec(item)
      if (match?.[1] && match[2]) return { path: match[1], name: match[2] }
    } else if (Array.isArray(item)) {
      pending.push(...item)
    } else if (item && typeof item === 'object') {
      pending.push(...Object.values(item as JsonObject))
    }
  }
  return undefined
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function sessionIdentity(record: SessionTelemetryRecord): SessionIdentity | undefined {
  const id = record.attributes['session.id']
  if (typeof id !== 'string' || !id) return undefined
  const identity: SessionIdentity = { id }
  const cwd = record.attributes['session.cwd']
  const parentId = record.attributes['session.parent_id']
  const seedLength = record.attributes['session.seed_length']
  if (typeof cwd === 'string') identity.cwd = cwd
  if (typeof parentId === 'string') identity.parentId = parentId
  if (typeof seedLength === 'number') identity.seedLength = seedLength
  return identity
}

function stepFor(turn: TurnState, stepNumber: number, fallbackTime: number): StepState {
  let step = turn.steps.get(stepNumber)
  if (!step) {
    step = {
      step: stepNumber,
      startTime: fallbackTime,
      input: turn.steps.size === 0
        ? turn.input
        : [...turn.tools.values()].filter(tool => tool.complete).map(tool => ({
            role: 'tool',
            tool_call_id: tool.callId,
            content: tool.result,
          })),
      output: [],
      outputText: '',
      hasToolCall: false,
      usage: zeroUsage(),
    }
    turn.steps.set(stepNumber, step)
  }
  return step
}

function terminal(reason: JsonObject | undefined): {
  finalStatus: 'completed' | 'cancelled'
  status: 'ok' | 'error'
  kind: string
  errorType?: string
} {
  const kind = string(reason?.kind) ?? 'unknown'
  if (kind === 'completed' || kind === 'max-tokens') {
    return { finalStatus: 'completed', status: 'ok', kind }
  }
  if (kind === 'error') {
    const error = object(reason?.error)
    return {
      finalStatus: 'completed',
      status: 'error',
      kind,
      errorType: string(error?.code) ?? string(error?.name) ?? 'LlmError',
    }
  }
  return { finalStatus: 'cancelled', status: kind === 'blocked' ? 'error' : 'ok', kind }
}

/** Incrementally normalize the DSH session telemetry stream into terminal turns. */
export class TurnCollector {
  private readonly sessions = new Map<string, SessionState>()
  private readonly completed = new Set<string>()

  /** Accept one non-blocking telemetry record and return a turn only at `turn/end`. */
  accept(record: SessionTelemetryRecord): Turn | undefined {
    if (record.channel !== 'ledger') return undefined
    const session = sessionIdentity(record)
    const eventType = record.attributes['event.type']
    const body = object(record.body)
    if (!session || typeof eventType !== 'string' || !body) return undefined
    let state = this.sessions.get(session.id)
    if (!state) {
      state = { active: undefined, pendingUser: [] }
      this.sessions.set(session.id, state)
    }

    switch (eventType) {
      case 'turn/start': {
        const turnId = number(body.turn)
        if (turnId === undefined) return undefined
        const active: TurnState = {
          session,
          turnId,
          startTime: record.time,
          input: [],
          inputText: '',
          steps: new Map(),
          tools: new Map(),
          assistants: [],
        }
        state.active = active
        for (const message of state.pendingUser.splice(0)) this.addUser(active, message)
        return undefined
      }
      case 'user/message': {
        const source = object(body.source)
        if (source?.kind !== 'user') return undefined
        if (state.active) this.addUser(state.active, body)
        else state.pendingUser.push(body)
        return undefined
      }
      case 'step/start': {
        if (!state.active || number(body.turn) !== state.active.turnId) return undefined
        const step = number(body.step)
        if (step !== undefined) stepFor(state.active, step, record.time).startTime = record.time
        return undefined
      }
      case 'request/header': {
        if (!state.active) return undefined
        const latest = [...state.active.steps.values()].at(-1)
        if (!latest) return undefined
        const header = object(body.header)
        const config = object(header?.config)
        const provider = string(config?.provider)
        const model = string(config?.model)
        if (provider !== undefined) latest.provider = provider
        if (model !== undefined) latest.requestModel = model
        if (latest.step === 1) latest.input = state.active.input
        return undefined
      }
      case 'request/context': {
        if (!state.active) return undefined
        const latest = [...state.active.steps.values()].at(-1)
        if (!latest) return undefined
        const provider = string(body.provider)
        const model = string(body.model)
        if (provider !== undefined) latest.provider = provider
        if (model !== undefined) latest.requestModel = model
        return undefined
      }
      case 'assistant/message': {
        if (!state.active || number(body.turn) !== state.active.turnId) return undefined
        const stepNumber = number(body.step)
        if (stepNumber === undefined) return undefined
        const step = stepFor(state.active, stepNumber, record.time)
        const message = object(body.message) ?? body
        const content = array(message.content)
        const source = object(message.source) ?? object(message.provenance)
        const provider = string(source?.provider)
        const model = string(source?.model)
        const accounting = usage(body.usage ?? message.usage)
        step.endTime = record.time
        step.assistantTime = record.time
        step.output = content
        step.outputText = contentText(content)
        step.hasToolCall = content.some(part => object(part)?.type === 'tool-call')
        step.usage = accounting
        if (provider !== undefined) step.provider = provider
        if (model !== undefined) step.responseModel = model
        const assistant: AssistantOutput = {
          step: stepNumber,
          time: record.time,
          content,
          text: step.outputText,
          outputKind: step.hasToolCall ? 'tool_call' : step.outputText ? 'text' : 'empty',
        }
        if (provider !== undefined) assistant.provider = provider
        if (model !== undefined) assistant.model = model
        state.active.assistants.push(assistant)
        return undefined
      }
      case 'tool/call':
      case 'tool/code-dispatch-start': {
        if (!state.active || number(body.turn) !== undefined && number(body.turn) !== state.active.turnId) return undefined
        const callId = string(body.callId) ?? string(body.subCallId)
        const name = string(body.name)
        if (!callId || !name) return undefined
        const args = parseArguments(body.arguments)
        const tool: ToolState = {
          callId,
          name,
          startTime: record.time,
          endTime: record.time,
          arguments: args,
          status: 'ok',
          step: number(body.step) ?? [...state.active.steps.keys()].at(-1) ?? 1,
          complete: false,
        }
        const skill = skillFromArguments(args)
        if (skill !== undefined) tool.skill = skill
        state.active.tools.set(callId, tool)
        return undefined
      }
      case 'tool/result':
      case 'tool/code-dispatch': {
        if (!state.active || number(body.turn) !== undefined && number(body.turn) !== state.active.turnId) return undefined
        const callId = string(body.callId) ?? string(body.subCallId) ?? string(object(body.message)?.source && object(object(body.message)?.source)?.callId)
        if (!callId) return undefined
        let tool = state.active.tools.get(callId)
        if (!tool) {
          const name = string(body.name) ?? 'unknown'
          tool = {
            callId,
            name,
            startTime: record.time,
            endTime: record.time,
            arguments: body.arguments,
            status: 'ok',
            step: number(body.step) ?? 1,
            complete: false,
          }
          state.active.tools.set(callId, tool)
        }
        const message = object(body.message)
        const resultBlock = object(array(message?.content)[0])
        const isError = body.isError === true || resultBlock?.isError === true
        tool.endTime = record.time
        tool.result = resultBlock?.content ?? body.content ?? message?.content
        tool.status = isError ? 'error' : 'ok'
        tool.complete = true
        const error = object(body.error)
        const errorType = string(error?.code) ?? string(error?.name)
        if (errorType !== undefined) tool.errorType = errorType
        return undefined
      }
      case 'step/end': {
        if (!state.active || number(body.turn) !== state.active.turnId) return undefined
        const stepNumber = number(body.step)
        if (stepNumber !== undefined) stepFor(state.active, stepNumber, record.time).endTime = record.time
        return undefined
      }
      case 'turn/end': {
        const turnId = number(body.turn)
        if (!state.active || turnId === undefined || turnId !== state.active.turnId) return undefined
        const key = `${session.id}:${turnId}`
        if (this.completed.has(key)) return undefined
        const outcome = terminal(object(body.reason))
        const turn = this.finishTurn(state.active, record.time, outcome)
        state.active = undefined
        if (!turn) return undefined
        this.completed.add(key)
        if (this.completed.size > 8192) {
          const oldest = this.completed.values().next().value
          if (oldest !== undefined) this.completed.delete(oldest)
        }
        return turn
      }
      default:
        return undefined
    }
  }

  private addUser(turn: TurnState, message: JsonObject): void {
    turn.input.push(message)
    turn.inputText += contentText(message.content)
  }

  private finishTurn(
    state: TurnState,
    endTime: number,
    outcome: ReturnType<typeof terminal>,
  ): Turn | undefined {
    const llmCalls: LlmCall[] = [...state.steps.values()].flatMap((step) => {
      if (step.assistantTime === undefined && Object.values(step.usage).every(value => value === 0)) return []
      const end = Math.max(step.startTime + 1, Math.min(step.endTime ?? step.assistantTime ?? endTime, endTime))
      const call: LlmCall = {
        step: step.step,
        startTime: Math.max(state.startTime, Math.min(step.startTime, end - 1)),
        endTime: end,
        input: step.input,
        output: step.output,
        outputText: step.outputText,
        finishReason: step.hasToolCall ? 'tool_call' : outcome.kind === 'completed' ? 'stop' : outcome.kind,
        usage: step.usage,
        status: outcome.status === 'error' && step.step === state.steps.size ? 'error' : 'ok',
      }
      if (step.provider !== undefined) call.provider = step.provider
      if (step.requestModel !== undefined) call.requestModel = step.requestModel
      if (step.responseModel !== undefined) call.responseModel = step.responseModel
      if (call.status === 'error' && outcome.errorType !== undefined) call.errorType = outcome.errorType
      return [call]
    })
    const tools = [...state.tools.values()].flatMap((tool): ToolCall[] => {
      if (!tool.complete) return []
      const end = Math.max(tool.startTime + 1, Math.min(tool.endTime, endTime))
      return [{ ...tool, startTime: Math.max(state.startTime, Math.min(tool.startTime, end - 1)), endTime: end }]
    })
    const hasMeaningfulWork = state.inputText.trim() !== '' || llmCalls.length > 0 || tools.length > 0
      || state.assistants.some(output => output.text.trim() !== '')
    if (!hasMeaningfulWork) return undefined
    const turn: Turn = {
      session: state.session,
      turnId: state.turnId,
      startTime: state.startTime,
      endTime: Math.max(state.startTime + 1, endTime),
      finalStatus: outcome.finalStatus,
      status: outcome.status,
      reason: outcome.kind,
      input: state.input,
      inputText: state.inputText,
      llmCalls,
      toolCalls: tools,
      assistantOutputs: state.assistants,
    }
    if (outcome.errorType !== undefined) turn.errorType = outcome.errorType
    return turn
  }
}
