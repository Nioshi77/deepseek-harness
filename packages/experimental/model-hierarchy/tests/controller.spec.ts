import { describe, expect, it } from 'vitest'
import { hierarchyConfig } from '../src/config.ts'
import { orchestrate, RouteUnavailable } from '../src/controller.ts'
import type { Invocation, Receipt } from '../src/controller.ts'

const plan = { tasks: ['inspect change'], architecture: false, security: false, multipleSubsystems: false, finalReview: false, escalate: false }
const approved = { approved: true, feedback: '', escalate: false }
const config = () => {
  const live = hierarchyConfig({
    confirmed: true,
    workers: [{ provider: 'free', model: 'worker', free: true }],
    supervisors: [{ provider: 'paid', model: 'manager' }],
    chief: [{ provider: 'paid', model: 'chief' }],
  })
  return {
    ...live,
    enabled: live.enabled.get(),
    confirmed: live.confirmed.get(),
    workers: [...live.workers.get()],
    supervisors: [...live.supervisors.get()],
    chief: [...live.chief.get()],
    disabledProjects: [...live.disabledProjects.get()],
  }
}

describe('hierarchy controller', () => {
  it('plans, delegates and reviews before integration', async () => {
    const calls: Invocation[] = [], receipts: Receipt[] = []
    const values = [plan, { proposal: 'patch' }, approved, { completed: true, summary: 'done', verification: 'tests pass' }, approved]
    expect(await orchestrate(config(), 'fix', { signal: new AbortController().signal, receipt: async (r) => { receipts.push(r) }, invoke: async (r) => { calls.push(r); return values.shift() } })).toContain('done')
    expect(calls.map(c => [c.role, c.integrate])).toEqual([['supervisor', false], ['worker', false], ['supervisor', false], ['supervisor', true], ['supervisor', false]])
    expect(receipts[0]?.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('falls back from unavailable free worker to paid supervisor route without a budget cap', async () => {
    const calls: Invocation[] = []
    const values = [plan, { proposal: 'patch' }, approved, { completed: true, summary: 'done', verification: 'pass' }, approved]
    await orchestrate(config(), 'fix', { signal: new AbortController().signal, receipt: async () => {}, invoke: async (r) => {
      calls.push(r)
      if (r.route.provider === 'free') throw new RouteUnavailable('quota')
      return values.shift()
    } })
    expect(calls.filter(c => c.role === 'worker').map(c => c.route.provider)).toEqual(['free', 'paid'])
  })

  it('escalates two quality rejections to the chief and stops at the attempt limit', async () => {
    const calls: Invocation[] = []
    const rejected = { approved: false, feedback: 'incorrect', escalate: false }
    const values = [plan, { proposal: 'first' }, rejected, { proposal: 'second' }, rejected, approved, { proposal: 'third' }, rejected, approved]
    await expect(orchestrate(config(), 'fix', { signal: new AbortController().signal, receipt: async () => {}, invoke: async (r) => { calls.push(r); return values.shift() } })).rejects.toThrow('attempt limit')
    expect(calls[5]?.role).toBe('chief')
    expect(calls.some(c => c.integrate)).toBe(false)
  })

  it('never interprets malformed structured output as a provider fallback', async () => {
    let count = 0
    await expect(orchestrate(config(), 'fix', { signal: new AbortController().signal, receipt: async () => {}, invoke: async () => { count++; return {} } })).rejects.toThrow()
    expect(count).toBe(1)
  })

  it('does not retry integration after an uncertain provider failure', async () => {
    const settings = config()
    settings.supervisors.push({ provider: 'paid', model: 'second-manager' })
    let integrations = 0
    const values = [plan, { proposal: 'patch' }, approved]
    await expect(orchestrate(settings, 'fix', { signal: new AbortController().signal, receipt: async () => {}, invoke: async (request) => {
      if (request.integrate) { integrations++; throw new RouteUnavailable('connection lost after possible write') }
      return values.shift()
    } })).rejects.toThrow('connection lost')
    expect(integrations).toBe(1)
  })

  it('checks architectural plans with the chief before starting workers', async () => {
    const calls: Invocation[] = []
    const values = [{ ...plan, architecture: true }, { approved: false, feedback: 'revise architecture', escalate: false }]
    await expect(orchestrate(config(), 'redesign', { signal: new AbortController().signal, receipt: async () => {}, invoke: async (request) => { calls.push(request); return values.shift() } })).rejects.toThrow('Chief rejected plan')
    expect(calls.map(call => call.role)).toEqual(['supervisor', 'chief'])
  })
})
