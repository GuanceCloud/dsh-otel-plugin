import { hostname } from 'node:os'
import {
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  AggregationType,
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
  type ViewOptions,
} from '@opentelemetry/sdk-metrics'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import type { ResolvedConfig } from './config.js'
import type { SpanModel, Turn } from './model.js'
import { buildSpanModels } from './spans.js'

/** Runtime surface kept small enough for deterministic tests. */
export interface TelemetryRuntime {
  exportTurn(turn: Turn): Promise<SpanModel[]>
  forceFlush(): Promise<void>
  shutdown(): Promise<void>
}

function histogramView(instrumentName: string, boundaries: number[]): ViewOptions {
  return {
    instrumentName,
    aggregation: {
      type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
      options: { boundaries, recordMinMax: true },
    },
  }
}

function metricAttributes(span: SpanModel, includeConversation: boolean): Attributes {
  const keys = span.kind === 'llm'
    ? ['gen_ai.operation.name', 'gen_ai.provider.name', 'gen_ai.request.model', 'gen_ai.response.model', 'status', 'error.type']
    : span.kind === 'tool'
      ? ['gen_ai.operation.name', 'gen_ai.tool.name', 'status', 'error.type']
      : ['gen_ai.operation.name', 'gen_ai.skill.name', 'status', 'error.type']
  if (includeConversation) keys.push('gen_ai.conversation.id', 'session_id')
  return Object.fromEntries(keys.flatMap(key => span.attributes[key] === undefined ? [] : [[key, span.attributes[key]]]))
}

/** Create official OTel SDK pipelines for Trace and Metrics. */
export function createTelemetry(config: ResolvedConfig): TelemetryRuntime {
  const resource = resourceFromAttributes({
    'service.name': config.serviceName,
    'telemetry.sdk.language': 'nodejs',
    'telemetry.sdk.name': 'gtrace',
    'telemetry.sdk.version': '0.1.0',
    host: hostname(),
    env: config.environment,
    agent_id: config.agentId,
    agent_name: config.agentName,
    agent_runtime: 'deepseek-harness',
    agent_version: config.agentVersion,
    'gen_ai.agent.name': config.agentName,
    'gen_ai.agent.version': config.agentVersion,
    ...config.resourceAttributes,
  })
  const traceExporter = new OTLPTraceExporter({
    url: config.traceUrl,
    headers: config.headers,
    timeoutMillis: config.exportTimeoutMs,
  })
  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter, {
      scheduledDelayMillis: config.batchDelayMs,
      exportTimeoutMillis: config.exportTimeoutMs,
      maxQueueSize: 2048,
      maxExportBatchSize: 512,
    })],
    forceFlushTimeoutMillis: config.exportTimeoutMs,
    spanLimits: {
      attributeValueLengthLimit: config.maxAttributeLength,
      attributeCountLimit: 128,
      eventCountLimit: 32,
    },
  })
  const tracer = tracerProvider.getTracer('dsh-otel-plugin', '0.1.0')

  let meterProvider: MeterProvider | undefined
  let workflowDuration: ReturnType<ReturnType<MeterProvider['getMeter']>['createHistogram']> | undefined
  let operationCount: ReturnType<ReturnType<MeterProvider['getMeter']>['createCounter']> | undefined
  let operationDuration: ReturnType<ReturnType<MeterProvider['getMeter']>['createHistogram']> | undefined
  let tokenUsage: ReturnType<ReturnType<MeterProvider['getMeter']>['createHistogram']> | undefined
  if (config.metricsEnabled) {
    const reader = new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: config.metricsUrl,
        headers: config.headers,
        timeoutMillis: config.exportTimeoutMs,
        temporalityPreference: AggregationTemporality.DELTA,
      }),
      exportIntervalMillis: Math.max(60_000, config.exportTimeoutMs + 1_000),
      exportTimeoutMillis: config.exportTimeoutMs,
    })
    meterProvider = new MeterProvider({
      resource,
      readers: [reader],
      views: [
        histogramView('gen_ai.workflow.duration', [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200]),
        histogramView('gen_ai.agent.operation.duration', [10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480, 40960, 81920]),
        histogramView('gen_ai.client.token.usage', [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864]),
      ],
    })
    const meter = meterProvider.getMeter('dsh-otel-plugin', '0.1.0')
    workflowDuration = meter.createHistogram('gen_ai.workflow.duration', { unit: 's' })
    operationCount = meter.createCounter('gen_ai.agent.operation.count', { unit: '-' })
    operationDuration = meter.createHistogram('gen_ai.agent.operation.duration', { unit: 'ms' })
    tokenUsage = meter.createHistogram('gen_ai.client.token.usage', { unit: '{token}' })
  }

  function emitSpanModels(models: SpanModel[]): void {
    const root = models.find(model => model.kind === 'root')
    if (!root) return
    const rootSpan = tracer.startSpan(root.name, {
      startTime: root.startTime,
      attributes: root.attributes,
    }, ROOT_CONTEXT)
    const spans = new Map<string, Span>([[root.id, rootSpan]])
    const contexts = new Map<string, Context>([[root.id, trace.setSpan(ROOT_CONTEXT, rootSpan)]])
    for (const model of models.filter(item => item.kind !== 'root')) {
      const parentContext = model.parentId ? contexts.get(model.parentId) : undefined
      if (!parentContext) continue
      const attrs = { ...model.attributes }
      const triggered = attrs['triggered_by.llm_span_id']
      if (typeof triggered === 'string') {
        const triggerSpan = spans.get(triggered)
        if (triggerSpan) attrs['triggered_by.llm_span_id'] = triggerSpan.spanContext().spanId
        else delete attrs['triggered_by.llm_span_id']
      }
      const span = tracer.startSpan(model.name, { startTime: model.startTime, attributes: attrs }, parentContext)
      if (model.status === 'error') span.setStatus({ code: SpanStatusCode.ERROR })
      span.end(model.endTime)
      spans.set(model.id, span)
      contexts.set(model.id, trace.setSpan(parentContext, span))
    }
    if (root.status === 'error') rootSpan.setStatus({ code: SpanStatusCode.ERROR })
    rootSpan.end(root.endTime)
  }

  function emitMetrics(models: SpanModel[]): void {
    const root = models.find(model => model.kind === 'root')
    if (root) {
      const duration = root.endTime - root.startTime
      workflowDuration?.record(duration / 1000, {
        'gen_ai.conversation.id': root.attributes['gen_ai.conversation.id'] as string,
        session_id: root.attributes.session_id as string,
        final_status: root.attributes.final_status as string,
        status: root.status === 'error' || root.attributes.final_status !== 'completed' ? 'error' : 'completed',
      })
    }
    for (const model of models) {
      if (model.kind !== 'llm' && model.kind !== 'tool' && model.kind !== 'skill') continue
      operationCount?.add(1, metricAttributes(model, false))
      operationDuration?.record(model.endTime - model.startTime, metricAttributes(model, true))
      if (model.kind !== 'llm') continue
      for (const [type, key] of [
        ['input', 'gen_ai.usage.input_tokens'],
        ['output', 'gen_ai.usage.output_tokens'],
      ] as const) {
        const value = model.attributes[key]
        if (typeof value !== 'number' || value <= 0) continue
        tokenUsage?.record(value, {
          ...metricAttributes(model, true),
          'gen_ai.token.type': type,
        })
      }
    }
  }

  return {
    async exportTurn(turn) {
      const models = buildSpanModels(turn, config)
      emitSpanModels(models)
      emitMetrics(models)
      return models
    },
    async forceFlush() {
      await Promise.all([tracerProvider.forceFlush(), meterProvider?.forceFlush()])
    },
    async shutdown() {
      await Promise.all([tracerProvider.shutdown(), meterProvider?.shutdown()])
    },
  }
}
