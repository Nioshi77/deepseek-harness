import { describe, expect, it } from 'vitest'
import { childFailureCategory, startupFailureCategory } from '../src/diagnostics.ts'

describe('content-free invocation diagnostics', () => {
  it('does not mislabel generic child failures or refusals as unavailable routes', () => {
    expect(childFailureCategory('error', undefined)).toBe('child_error')
    expect(childFailureCategory('refusal', undefined)).toBe('refusal')
    expect(childFailureCategory('max-tokens', undefined)).toBe('token_limit')
    expect(childFailureCategory('aborted', undefined)).toBe('cancelled')
  })

  it('requires a structured result before reporting completion', () => {
    expect(childFailureCategory('completed', undefined)).toBe('invalid_output')
    expect(childFailureCategory('completed', { proposal: 'answer' })).toBeUndefined()
  })

  it('classifies explicit provider status without copying error content', () => {
    expect(startupFailureCategory({ status: 401, message: 'secret' })).toBe('authentication')
    expect(startupFailureCategory({ statusCode: 429 })).toBe('rate_limit')
    expect(startupFailureCategory({ status: 503 })).toBe('route_unavailable')
    expect(startupFailureCategory(new Error('quota secret 429'))).toBe('startup_error')
    expect(startupFailureCategory({ name: 'AbortError' })).toBe('cancelled')
  })
})
