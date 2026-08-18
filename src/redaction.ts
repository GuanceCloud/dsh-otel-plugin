import type { ContentCaptureMode } from './config.js'

const SECRET_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)/i
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const COMMON_KEY = /\b(?:sk|pk|ak)-[A-Za-z0-9_-]{12,}\b/g

/** Recursively redact secret-like keys and bound hostile values. */
export function sanitize(
  value: unknown,
  limits: { maxString: number; maxDepth?: number; maxArray?: number },
  depth = 0,
): unknown {
  const maxDepth = limits.maxDepth ?? 8
  const maxArray = limits.maxArray ?? 100
  if (depth > maxDepth) return '[truncated-depth]'
  if (typeof value === 'string') {
    const scrubbed = value.replace(BEARER, 'Bearer [REDACTED]').replace(COMMON_KEY, '[REDACTED]')
    return scrubbed.length <= limits.maxString ? scrubbed : `${scrubbed.slice(0, limits.maxString)}...[truncated]`
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    const items = value.slice(0, maxArray).map(item => sanitize(item, limits, depth + 1))
    if (value.length > maxArray) items.push(`[${value.length - maxArray} items truncated]`)
    return items
  }
  if (!value || typeof value !== 'object') return String(value)
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = SECRET_KEY.test(key) ? '[REDACTED]' : sanitize(item, limits, depth + 1)
  }
  return result
}

/** Serialize sanitized content for an OTEL string attribute. */
export function stringifySanitized(value: unknown, maxLength: number): string {
  const serialized = JSON.stringify(sanitize(value, { maxString: maxLength }))
  return serialized.length <= maxLength ? serialized : `${serialized.slice(0, maxLength)}...[truncated]`
}

/** Apply the configured trace-content capture policy. */
export function captureValue(value: unknown, mode: ContentCaptureMode, maxLength: number): string | undefined {
  if (mode === 'none' || value === undefined) return undefined
  const limit = mode === 'preview' ? Math.min(maxLength, 1024) : maxLength
  return stringifySanitized(value, limit)
}

/** Produce a redacted text preview and the original character count. */
export function preview(text: string, mode: ContentCaptureMode, maxLength: number): {
  value?: string
  length: number
} {
  if (mode === 'none') return { length: text.length }
  const limit = mode === 'preview' ? Math.min(maxLength, 1024) : maxLength
  const value = sanitize(text, { maxString: limit })
  return { value: typeof value === 'string' ? value : String(value), length: text.length }
}
