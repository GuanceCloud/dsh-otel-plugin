import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Content stored in trace attributes. */
export type ContentCaptureMode = 'none' | 'preview' | 'full'

/** Values accepted from a Cordis entry before environment and file resolution. */
export interface Config {
  enabled?: boolean
  endpoint?: string
  tracePath?: string
  metricsPath?: string
  otelTracesUrl?: string
  otelMetricsUrl?: string
  headers?: Record<string, string> | string
  publicKey?: string
  secretKey?: string
  metricsEnabled?: boolean
  serviceName?: string
  environment?: string
  agentId?: string
  agentName?: string
  agentVersion?: string
  captureContent?: ContentCaptureMode
  maxAttributeLength?: number
  batchDelayMs?: number
  exportTimeoutMs?: number
  shutdownTimeoutMs?: number
  resourceAttributes?: Record<string, string | number | boolean> | string
  debug?: boolean
}

/** Fully resolved runtime configuration. */
export interface ResolvedConfig {
  enabled: boolean
  traceUrl: string
  metricsUrl: string
  headers: Record<string, string>
  metricsEnabled: boolean
  serviceName: string
  environment: string
  agentId: string
  agentName: string
  agentVersion: string
  captureContent: ContentCaptureMode
  maxAttributeLength: number
  batchDelayMs: number
  exportTimeoutMs: number
  shutdownTimeoutMs: number
  resourceAttributes: Record<string, string | number | boolean>
  debug: boolean
  configSourceFiles: string[]
  configSourceWarnings: string[]
}

export interface ResolveConfigContext {
  cwd?: string
  home?: string
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:9529'
const DEFAULT_TRACE_PATH = 'otel/v1/traces'
const DEFAULT_METRICS_PATH = 'otel/v1/metrics'

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function integerValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)))
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function pathValue(value: unknown, fallback: string): string {
  return stringValue(value, fallback).replace(/^\/+|\/+$/g, '')
}

function captureMode(value: unknown): ContentCaptureMode {
  return value === 'none' || value === 'full' ? value : 'preview'
}

function readJsonIfExists(file: string): {
  values: Record<string, unknown>
  loaded: boolean
  warning?: string
} {
  try {
    const content = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (!content.trim()) return { values: {}, loaded: true }
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { values: {}, loaded: true, warning: `config file is not a JSON object: ${file}` }
    }
    return { values: parsed as Record<string, unknown>, loaded: true }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { values: {}, loaded: false }
    }
    return { values: {}, loaded: true, warning: `failed to read config file: ${file}` }
  }
}

function resolveFileConfig(context: ResolveConfigContext, env: NodeJS.ProcessEnv): {
  values: Record<string, unknown>
  files: string[]
  warnings: string[]
} {
  const home = context.home ?? homedir()
  const cwd = context.cwd ?? process.cwd()
  const dshHome = stringValue(env.DSH_HOME, join(home, '.dsh'))
  const globalFile = join(dshHome, 'gtrace.json')
  const localFile = join(cwd, '.dsh', 'gtrace.json')
  const global = readJsonIfExists(globalFile)
  const local = readJsonIfExists(localFile)
  return {
    values: { ...global.values, ...local.values },
    files: [global.loaded ? globalFile : '', local.loaded ? localFile : ''].filter(Boolean),
    warnings: [global.warning, local.warning].filter((item): item is string => Boolean(item)),
  }
}

/** Parse OTLP headers from an object, JSON object, or comma-delimited pairs. */
export function parseHeaders(value: unknown): Record<string, string> {
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, item]) => [key.trim(), item.trim()] as const)
      .filter(([key]) => key.length > 0))
  }
  if (typeof value !== 'string') return {}
  const trimmed = value.trim()
  if (trimmed.startsWith('{')) {
    try {
      return parseHeaders(JSON.parse(trimmed))
    } catch {
      return {}
    }
  }
  return Object.fromEntries(trimmed.split(',')
    .map(item => item.split('=', 2))
    .filter((item): item is [string, string] => item.length === 2)
    .map(([key, item]) => [key.trim(), item.trim()] as const)
    .filter(([key]) => key.length > 0))
}

function parseResourceAttributes(value: unknown): Record<string, string | number | boolean> {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{')) {
      try {
        return parseResourceAttributes(JSON.parse(trimmed))
      } catch {
        return {}
      }
    }
    return Object.fromEntries(trimmed.split(',')
      .map(item => item.split('=', 2))
      .filter((item): item is [string, string] => item.length === 2)
      .map(([key, item]) => [key.trim(), item.trim()] as const)
      .filter(([key]) => key.length > 0))
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string | number | boolean] =>
      Boolean(entry[0].trim()) && ['string', 'number', 'boolean'].includes(typeof entry[1]),
  ))
}

/** Resolve a signal URL without appending the same OTLP path twice. */
export function resolveSignalUrl(endpoint: string, signalPath: string, explicitUrl?: string): string {
  if (explicitUrl?.trim()) return explicitUrl.trim()
  const base = endpoint.trim().replace(/\/+$/, '')
  const path = signalPath.trim().replace(/^\/+|\/+$/g, '')
  if (!path || base.endsWith(`/${path}`)) return base
  return `${base}/${path}`
}

/** Resolve Cordis options over DSH/OTEL environment variables and two JSON files. */
export function resolveConfig(
  options: Config = {},
  env: NodeJS.ProcessEnv = process.env,
  context: ResolveConfigContext = {},
): ResolvedConfig {
  const file = resolveFileConfig(context, env)
  const values = file.values
  const endpoint = stringValue(
    options.endpoint ?? env.DSH_OTEL_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_ENDPOINT
      ?? values.endpoint ?? values.base_url,
    DEFAULT_ENDPOINT,
  ).replace(/\/+$/, '')
  const tracePath = pathValue(options.tracePath ?? env.DSH_OTEL_TRACE_PATH ?? values.tracePath, DEFAULT_TRACE_PATH)
  const metricsPath = pathValue(options.metricsPath ?? env.DSH_OTEL_METRICS_PATH ?? values.metricsPath, DEFAULT_METRICS_PATH)
  const publicKey = stringValue(options.publicKey ?? env.DSH_OTEL_PUBLIC_KEY ?? values.public_key)
  const secretKey = stringValue(options.secretKey ?? env.DSH_OTEL_SECRET_KEY ?? values.secret_key)
  const headers = parseHeaders(options.headers ?? env.DSH_OTEL_HEADERS
    ?? env.OTEL_EXPORTER_OTLP_HEADERS ?? values.headers)
  if ((publicKey || secretKey) && headers.Authorization === undefined && headers.authorization === undefined) {
    headers.Authorization = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`
  }
  const resourceAttributes = {
    ...parseResourceAttributes(values.tags),
    ...parseResourceAttributes(values.resourceAttributes),
    ...parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES),
    ...parseResourceAttributes(env.DSH_OTEL_RESOURCE_ATTRIBUTES),
    ...parseResourceAttributes(options.resourceAttributes),
  }

  return {
    enabled: booleanValue(options.enabled ?? env.DSH_OTEL_ENABLED ?? values.enabled, true),
    traceUrl: resolveSignalUrl(endpoint, tracePath, stringValue(
      options.otelTracesUrl ?? env.DSH_OTEL_TRACES_URL ?? env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
        ?? values.otel_traces_url,
    )),
    metricsUrl: resolveSignalUrl(endpoint, metricsPath, stringValue(
      options.otelMetricsUrl ?? env.DSH_OTEL_METRICS_URL ?? env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
        ?? values.otel_metrics_url,
    )),
    headers,
    metricsEnabled: booleanValue(options.metricsEnabled ?? env.DSH_OTEL_METRICS_ENABLED ?? values.metricsEnabled, true),
    serviceName: stringValue(options.serviceName ?? env.DSH_OTEL_SERVICE_NAME ?? env.OTEL_SERVICE_NAME, 'gtrace-dsh'),
    environment: stringValue(options.environment ?? env.DSH_OTEL_ENV ?? values.environment, 'dev'),
    agentId: stringValue(options.agentId ?? env.DSH_OTEL_AGENT_ID, 'deepseek-harness'),
    agentName: stringValue(options.agentName ?? env.DSH_OTEL_AGENT_NAME, 'DeepSeek Harness'),
    agentVersion: stringValue(options.agentVersion ?? env.DSH_OTEL_AGENT_VERSION, 'unknown'),
    captureContent: captureMode(options.captureContent ?? env.DSH_OTEL_CAPTURE_CONTENT ?? values.captureContent),
    maxAttributeLength: integerValue(options.maxAttributeLength ?? env.DSH_OTEL_MAX_ATTRIBUTE_LENGTH
      ?? values.maxAttributeLength, 4096, 128, 65_536),
    batchDelayMs: integerValue(options.batchDelayMs ?? env.DSH_OTEL_BATCH_DELAY_MS, 500, 50, 60_000),
    exportTimeoutMs: integerValue(options.exportTimeoutMs ?? env.DSH_OTEL_EXPORT_TIMEOUT_MS
      ?? values.timeout_ms, 10_000, 1_000, 120_000),
    shutdownTimeoutMs: integerValue(options.shutdownTimeoutMs ?? env.DSH_OTEL_SHUTDOWN_TIMEOUT_MS,
      4_000, 1_000, 120_000),
    resourceAttributes,
    debug: booleanValue(options.debug ?? env.DSH_OTEL_DEBUG ?? values.debug, false),
    configSourceFiles: file.files,
    configSourceWarnings: file.warnings,
  }
}
