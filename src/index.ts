import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  SessionTelemetryBackend,
  SessionTelemetryCoordinator,
  type SessionTelemetryRecord,
  type SessionTelemetrySharingStatus,
} from '@deepseek-ai/dsh-session-telemetry'
import { TurnCollector } from './collector.js'
import { resolveConfig, type Config, type ResolvedConfig } from './config.js'
import { createFileLogger, type FileLogger } from './file-log.js'
import { createTelemetry, type TelemetryRuntime } from './telemetry.js'

export { TurnCollector } from './collector.js'
export { resolveConfig, resolveSignalUrl, parseHeaders, type Config, type ResolvedConfig } from './config.js'
export { sanitize, stringifySanitized } from './redaction.js'
export { buildSpanModels } from './spans.js'
export type { Turn, SpanModel, LlmCall, ToolCall, AssistantOutput } from './model.js'

const require = createRequire(import.meta.url)

function detectDshVersion(): string {
  try {
    return (require('@deepseek-ai/dsh/package.json') as { version?: string }).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Runtime validator for Cordis configuration. Detailed bounds are resolved in `resolveConfig`. */
export const ConfigSchema: z<Config> = z.object({
  enabled: z.boolean(),
  endpoint: z.string(),
  tracePath: z.string(),
  metricsPath: z.string(),
  otelTracesUrl: z.string(),
  otelMetricsUrl: z.string(),
  headers: z.any(),
  publicKey: z.string(),
  secretKey: z.string(),
  metricsEnabled: z.boolean(),
  serviceName: z.string(),
  environment: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  agentVersion: z.string(),
  captureContent: z.union(['none', 'preview', 'full']),
  maxAttributeLength: z.number(),
  batchDelayMs: z.number(),
  exportTimeoutMs: z.number(),
  shutdownTimeoutMs: z.number(),
  resourceAttributes: z.any(),
  debug: z.boolean(),
})

/** Native DSH telemetry backend that exports one GTrace trace per terminal turn. */
export class DeepSeekHarnessOtelBackend extends SessionTelemetryBackend {
  static inject = ['sessions']
  static Config = ConfigSchema

  override readonly sharing: SessionTelemetrySharingStatus
  private readonly loggerCtx: Context
  private readonly fileLogger: FileLogger
  private readonly collector = new TurnCollector()
  private readonly runtime: TelemetryRuntime | undefined
  private readonly config: ResolvedConfig
  private pending: Promise<void> = Promise.resolve()
  private closed = false

  constructor(ctx: Context, options: Config = {}) {
    super(ctx)
    this.loggerCtx = ctx
    this.fileLogger = createFileLogger()
    const resolved = resolveConfig(options)
    if (resolved.agentVersion === 'unknown') {
      resolved.agentVersion = detectDshVersion()
    }
    this.config = resolved
    this.sharing = resolved.enabled ? 'full' : 'disabled'
    this.fileLogger.info(
      `plugin constructed; enabled=${resolved.enabled}; `
      + `config_files=${resolved.configSourceFiles.length}`,
    )
    for (const warning of resolved.configSourceWarnings) ctx.logger.warn(`dsh-otel-plugin: ${warning}`)
    for (const warning of resolved.configSourceWarnings) this.fileLogger.warn(warning)
    if (!resolved.enabled) {
      this.runtime = undefined
      ctx.logger.info('dsh-otel-plugin: disabled')
      this.fileLogger.info('disabled')
      return
    }
    this.runtime = createTelemetry(resolved)
    new SessionTelemetryCoordinator(ctx, this, 'live')
    ctx.logger.info(
      `dsh-otel-plugin: enabled; traces=${resolved.traceUrl}; `
      + `metrics=${resolved.metricsEnabled ? resolved.metricsUrl : 'disabled'}; `
      + `capture=${resolved.captureContent}`,
    )
    this.fileLogger.info(
      `enabled; trace_url=${safeUrl(resolved.traceUrl)}; `
      + `metrics_url=${resolved.metricsEnabled ? safeUrl(resolved.metricsUrl) : 'disabled'}; `
      + `capture=${resolved.captureContent}; log_path=${this.fileLogger.path}`,
    )
  }

  /** Collect synchronously and enqueue all network work off the session event path. */
  emit(record: SessionTelemetryRecord): void {
    if (!this.runtime || this.closed) return
    const turn = this.collector.accept(record)
    if (!turn) return
    this.pending = this.pending.then(async () => {
      try {
        const startedAt = Date.now()
        const models = await this.runtime?.exportTurn(turn)
        await this.runtime?.forceFlush()
        this.loggerCtx.logger.info(
          `dsh-otel-plugin: exported turn=${turn.turnId}; `
          + `spans=${models?.length ?? 0}; status=${turn.status}; `
          + `duration_ms=${Date.now() - startedAt}`,
        )
        this.fileLogger.info(
          `exported turn=${turn.turnId}; spans=${models?.length ?? 0}; `
          + `status=${turn.status}; duration_ms=${Date.now() - startedAt}`,
        )
      } catch (error) {
        const message = String(error)
        this.loggerCtx.logger.warn(`dsh-otel-plugin: export failed: ${message}`)
        this.fileLogger.error(`export failed; turn=${turn.turnId}; error=${message}`)
      }
    })
  }

  /** Drain queued terminal turns and stop both SDK providers within a fixed deadline. */
  async shutdown(): Promise<void> {
    if (!this.runtime || this.closed) return
    this.closed = true
    const work = this.pending.then(() => this.runtime?.shutdown())
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(
        `dsh-otel-plugin: shutdown exceeded ${this.config.shutdownTimeoutMs}ms`,
      )), this.config.shutdownTimeoutMs)
    })
    try {
      await Promise.race([work, deadline])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return '<invalid-url>'
  }
}

export default DeepSeekHarnessOtelBackend
