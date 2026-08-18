import { describe, expect, it } from 'vitest'
import { captureValue, sanitize } from '../src/redaction.js'

describe('redaction', () => {
  it('recursively masks keys and common inline credentials', () => {
    const result = sanitize({
      authorization: 'Bearer abc.def',
      nested: { apiKey: 'sk-fixture1234567890', text: 'Bearer visible-secret' },
    }, { maxString: 100 })
    expect(result).toEqual({
      authorization: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', text: 'Bearer [REDACTED]' },
    })
  })

  it('can disable content and bounds preview strings', () => {
    expect(captureValue({ text: 'private' }, 'none', 100)).toBeUndefined()
    expect(captureValue('x'.repeat(2000), 'preview', 4096)?.length).toBeLessThan(1100)
  })
})
