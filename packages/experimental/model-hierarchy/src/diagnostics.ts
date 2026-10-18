/** Content-free invocation evidence. Completion means a structured child result, not approval. */
export interface InvocationOutcome {
  turn: number
  invocation: number
  role: 'worker' | 'supervisor' | 'chief'
  provider: string
  model: string
  state: 'attempted' | 'completed' | 'failed'
  durationMs?: number
  errorCategory?: FailureCategory
}

/** Stable categories deliberately exclude raw provider errors and child content. */
export type FailureCategory = 'authentication' | 'rate_limit' | 'route_unavailable' | 'cancelled' | 'timeout' | 'token_limit' | 'refusal' | 'invalid_output' | 'child_error' | 'startup_error'

/** Only explicit HTTP status evidence establishes provider unavailability. */
export function startupFailureCategory(error: unknown): FailureCategory {
  if (error !== null && typeof error === 'object') {
    const value = error as { status?: unknown; statusCode?: unknown; name?: unknown }
    const status = value.status ?? value.statusCode
    if (status === 401 || status === 403) return 'authentication'
    if (status === 429) return 'rate_limit'
    if (status === 404 || status === 502 || status === 503 || status === 504) return 'route_unavailable'
    if (value.name === 'AbortError') return 'cancelled'
  }
  return 'startup_error'
}

/** A generic child failure is not evidence that its model route is unavailable. */
export function childFailureCategory(stopReason: string, structured: unknown, diagnostic = ''): FailureCategory | undefined {
  if (stopReason === 'completed') return structured === undefined ? 'invalid_output' : undefined
  if (stopReason === 'aborted') return 'cancelled'
  if (stopReason === 'max-tokens') return 'token_limit'
  if (stopReason === 'refusal') return 'refusal'
  // Providers report accepted-run failures through a bounded diagnostic rather
  // than throwing at startup. Use only stable status markers for fallback;
  // never persist or expose the diagnostic text itself.
  if (/\b(?:401|403)\b|unauthori[sz]ed|forbidden/i.test(diagnostic)) return 'authentication'
  if (/\b429\b|rate.?limit|quota/i.test(diagnostic)) return 'rate_limit'
  if (/\b(?:404|502|503|504)\b|not.?found|bad.?gateway|service.?unavailable|unsupported|not supported|cannot be disabled|invalid_argument|invalid_request|failed to render|incomplete json|unexpected message role/i.test(diagnostic)) return 'route_unavailable'
  return 'child_error'
}
