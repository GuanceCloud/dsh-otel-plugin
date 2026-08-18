/** Token accounting reported for one model step. */
export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  reasoning: number
}

/** One normalized model call derived from a DSH step. */
export interface LlmCall {
  step: number
  startTime: number
  endTime: number
  provider?: string
  requestModel?: string
  responseModel?: string
  input: unknown[]
  output: unknown[]
  outputText: string
  finishReason?: string
  usage: TokenUsage
  status: 'ok' | 'error'
  errorType?: string
}

/** High-confidence Skill evidence found in one tool's arguments. */
export interface SkillUse {
  name: string
  path: string
}

/** One normalized tool execution. */
export interface ToolCall {
  callId: string
  name: string
  startTime: number
  endTime: number
  arguments: unknown
  result?: unknown
  status: 'ok' | 'error'
  errorType?: string
  reason?: string
  step: number
  skill?: SkillUse
}

/** One local assistant output event. */
export interface AssistantOutput {
  step: number
  time: number
  provider?: string
  model?: string
  content: unknown[]
  text: string
  outputKind: 'text' | 'tool_call' | 'empty'
}

/** Stable session facts copied from DSH telemetry identity attributes. */
export interface SessionIdentity {
  id: string
  cwd?: string
  parentId?: string
  seedLength?: number
}

/** One terminal DSH turn ready for span construction. */
export interface Turn {
  session: SessionIdentity
  turnId: number
  startTime: number
  endTime: number
  finalStatus: 'completed' | 'cancelled'
  status: 'ok' | 'error'
  reason: string
  errorType?: string
  input: unknown[]
  inputText: string
  llmCalls: LlmCall[]
  toolCalls: ToolCall[]
  assistantOutputs: AssistantOutput[]
}

/** Product-neutral span representation used before writing to the OTel SDK. */
export interface SpanModel {
  id: string
  parentId?: string
  name: string
  startTime: number
  endTime: number
  status: 'ok' | 'error'
  attributes: Record<string, string | number | boolean | string[] | number[] | boolean[]>
  kind: 'root' | 'llm' | 'tool' | 'skill' | 'assistant'
}
