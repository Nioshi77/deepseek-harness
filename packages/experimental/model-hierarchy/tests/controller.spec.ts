import { describe, expect, it } from 'vitest'
import { hierarchyConfig } from '../src/config.ts'
import { orchestrate, RouteUnavailable } from '../src/controller.ts'
import type { Invocation, Receipt } from '../src/controller.ts'

const plan = {
  tasks: ['inspect change'], architecture: false, security: false, multipleSubsystems: false,
  finalReview: false, escalate: false, needsClarification: false, clarificationQuestion: '',
}
const approved = { approved: true, feedback: '', escalate: false }
const agreed = (selectedId = 'P1', safetyRisk = '') => ({ selectedId, agreed: true, rationale: 'best production choice', objections: [], safetyRisk })

const config = (workerCount = 2) => {
  const live = hierarchyConfig({
    confirmed: true,
    workers: Array.from({ length: workerCount }, (_, index) => ({ provider: 'free', model: `worker-${index + 1}`, free: true })),
    supervisors: [{ provider: 'paid', model: 'manager' }],
    chief: [{ provider: 'paid', model: 'chief' }],
  })
  return {
    ...live,
    enabled: live.enabled.get(), confirmed: live.confirmed.get(), workers: [...live.workers.get()],
    supervisors: [...live.supervisors.get()], chief: [...live.chief.get()], disabledProjects: [...live.disabledProjects.get()],
  }
}
function normalResponse(request: Invocation): unknown {
  if (request.prompt.startsWith('Plan this task')) return plan
  if (request.prompt.startsWith('Independently inspect the actual')) return approved
  if (request.prompt.startsWith('Independently inspect this assignment')) return { proposal: `proposal from ${request.route.model}` }
  if (request.prompt.startsWith('Compare every candidate')) return agreed()
  if (request.prompt.startsWith('Workers require a supervisor decision')) return { selectedId: 'P1', approved: true, rationale: 'safe fallback', escalate: false }
  if (request.prompt.startsWith('Review these worker proposals')) return approved
  if (request.prompt.startsWith('Integrate only')) return { completed: true, summary: 'done', verification: 'tests pass' }
  if (request.role === 'chief') return approved
  throw new Error(`Unexpected prompt: ${request.prompt}`)
}

describe('hierarchy controller', () => {
  it('asks every worker for an independent proposal and accepts unanimous peer consensus', async () => {
    const calls: Invocation[] = [], receipts: Receipt[] = []
    expect(await orchestrate(config(), 'fix', {
      signal: new AbortController().signal,
      receipt: async (receipt) => { receipts.push(receipt) },
      invoke: async (request) => { calls.push(request); return normalResponse(request) },
    })).toContain('done')

    expect(calls.filter(call => call.prompt.startsWith('Independently inspect this assignment')).map(call => call.route.model)).toEqual(['worker-1', 'worker-2'])
    expect(calls.filter(call => call.prompt.startsWith('Compare every candidate'))).toHaveLength(2)
    expect(calls.some(call => call.prompt.startsWith('Workers require a supervisor decision'))).toBe(false)
    expect(JSON.stringify(calls.map(call => call.schema))).not.toMatch(/\$schema|minItems|maxItems|minLength/)
    expect(receipts.filter(receipt => receipt.role === 'worker')).toHaveLength(2)
    expect(receipts.every(receipt => /^[a-f0-9]{64}$/.test(receipt.digest))).toBe(true)
  })

  it('uses two deliberation rounds, then lets the supervisor resolve disagreement', async () => {
    const calls: Invocation[] = []
    await orchestrate(config(), 'fix', {
      signal: new AbortController().signal, receipt: async () => {},
      invoke: async (request) => {
        calls.push(request)
        if (request.prompt.startsWith('Compare every candidate')) return agreed(request.route.model === 'worker-1' ? 'P1' : 'P2')
        return normalResponse(request)
      },
    })

    expect(calls.filter(call => call.prompt.startsWith('Compare every candidate'))).toHaveLength(4)
    expect(calls.filter(call => call.prompt.startsWith('Workers require a supervisor decision'))).toHaveLength(1)
  })

  it('tries the next supervisor when a route returns an empty plan', async () => {
    const settings = config()
    settings.supervisors.push({ provider: 'paid', model: 'manager-2' })
    const planCalls: string[] = []
    await orchestrate(settings, 'fix', {
      signal: new AbortController().signal, receipt: async () => {},
      invoke: async (request) => {
        if (request.prompt.startsWith('Plan this task')) {
          planCalls.push(request.route.model)
          return request.route.model === 'manager' ? { ...plan, tasks: [] } : plan
        }
        return normalResponse(request)
      },
    })
    expect(planCalls).toEqual(['manager', 'manager-2'])
  })

  it('returns a supervisor clarification without dispatching workers or integration', async () => {
    const calls: Invocation[] = []
    const result = await orchestrate(config(), 'unclear request', {
      signal: new AbortController().signal, receipt: async () => {},
      invoke: async (request) => {
        calls.push(request)
        return { ...plan, tasks: [], needsClarification: true, clarificationQuestion: 'Что именно нужно сделать?' }
      },
    })
    expect(result).toBe('Что именно нужно сделать?')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.role).toBe('supervisor')
  })

  it('routes a reported safety risk to the supervisor even with unanimous agreement', async () => {
    const calls: Invocation[] = []
    let assessments = 0
    await orchestrate(config(), 'fix', {
      signal: new AbortController().signal, receipt: async () => {},
      invoke: async (request) => {
        calls.push(request)
        if (request.prompt.startsWith('Compare every candidate')) {
          assessments++
          if (assessments <= 2) return agreed(request.route.model === 'worker-1' ? 'P1' : 'P2', request.route.model === 'worker-2' ? 'possible data loss' : '')
          return agreed('P1')
        }
        return normalResponse(request)
      },
    })
    const escalation = calls.find(call => call.prompt.startsWith('Workers require a supervisor decision'))
    expect(escalation?.prompt).toContain('possible data loss')
  })

  it('continues after a worker failure and sends a single successful proposal to the supervisor', async () => {
    const calls: Invocation[] = []
    await orchestrate(config(), 'fix', {
      signal: new AbortController().signal, receipt: async () => {},
      invoke: async (request) => {
        calls.push(request)
        if (request.prompt.startsWith('Independently inspect this assignment') && request.route.model === 'worker-2') throw new RouteUnavailable('quota')
        return normalResponse(request)
      },
    })
    expect(calls.some(call => call.prompt.includes('only one worker proposal succeeded'))).toBe(true)
  })

  it('falls back to a paid supervisor route when every worker is unavailable', async () => {
    const calls: Invocation[] = []
    await orchestrate(config(1), 'fix', {
      signal: new AbortController().signal, receipt: async () => {},
      invoke: async (request) => {
        calls.push(request)
        if (request.role === 'worker' && request.route.provider === 'free') throw new RouteUnavailable('quota')
        if (request.prompt.startsWith('All configured worker routes failed')) return { proposal: 'paid fallback' }
        return normalResponse(request)
      },
    })
    expect(calls.filter(call => call.role === 'worker').map(call => call.route.provider)).toContain('paid')
  })

  it('escalates two quality rejections to the chief and stops at the attempt limit', async () => {
    const calls: Invocation[] = []
    const rejected = { approved: false, feedback: 'incorrect', escalate: false }
    await expect(orchestrate(config(), 'fix', {
      signal: new AbortController().signal, receipt: async () => {},
      invoke: async (request) => {
        calls.push(request)
        if (request.prompt.startsWith('Review these worker proposals')) return rejected
        return normalResponse(request)
      },
    })).rejects.toThrow('attempt limit')
    expect(calls.some(call => call.role === 'chief')).toBe(true)
    expect(calls.some(call => call.integrate)).toBe(false)
  })

  it('records malformed worker output as a failed worker and continues with the valid worker', async () => {
    const receipts: Receipt[] = []
    await orchestrate(config(), 'fix', {
      signal: new AbortController().signal, receipt: async (receipt) => { receipts.push(receipt) },
      invoke: async (request) => {
        if (request.prompt.startsWith('Independently inspect this assignment') && request.route.model === 'worker-1') return {}
        if (request.prompt.startsWith('Workers require a supervisor decision')) return { selectedId: 'P2', approved: true, rationale: 'valid worker remains', escalate: false }
        return normalResponse(request)
      },
    })
    expect(receipts.some(receipt => !receipt.approved && receipt.feedback.includes('Proposal failed'))).toBe(true)
  })

  it('does not retry integration after an uncertain provider failure', async () => {
    const settings = config()
    settings.supervisors.push({ provider: 'paid', model: 'second-manager' })
    let integrations = 0
    await expect(orchestrate(settings, 'fix', {
      signal: new AbortController().signal, receipt: async () => {},
      invoke: async (request) => {
        if (request.integrate) { integrations++; throw new RouteUnavailable('connection lost after possible write') }
        return normalResponse(request)
      },
    })).rejects.toThrow('connection lost')
    expect(integrations).toBe(1)
  })

  it('checks architectural plans with the chief before starting workers', async () => {
    const calls: Invocation[] = []
    await expect(orchestrate(config(), 'redesign', {
      signal: new AbortController().signal, receipt: async () => {},
      invoke: async (request) => {
        calls.push(request)
        if (request.prompt.startsWith('Plan this task')) return { ...plan, architecture: true }
        if (request.role === 'chief') return { approved: false, feedback: 'revise architecture', escalate: false }
        return normalResponse(request)
      },
    })).rejects.toThrow('Chief rejected plan')
    expect(calls.map(call => call.role)).toEqual(['supervisor', 'chief'])
  })
})
