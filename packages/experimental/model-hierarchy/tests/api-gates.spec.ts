/** Feasibility gates against real Harness lifecycle, tool and persistence services. */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { onTestFinished } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import LlmRuntime, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Subagents, { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountLocalActivations, startTestActivation } from '../../../subagent/subagent/tests/local-activation.ts'
import { loadStoredSession } from '../../../subagent/subagent/tests/persistence-helpers.ts'
import * as Hierarchy from '../src/index.ts'

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'hierarchy-test/receipt': { approved: boolean; digest: string }
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function harness(script: ConstructorParameters<typeof MockAdapter>[0]) {
  const ctx = new Context()
  await ctx.plugin(Loader)
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await mountLocalActivations(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, { default: 'worker' })
  await ctx.agentPresets.register({ id: 'worker', plugins: [] })
  await ctx.plugin(Subagents)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['test'], adapter)
  const parent = await ctx.agentLoop.create(SessionId('hierarchy-root'), { provider: 'test', model: 'root-must-not-run' })
  return { ctx, adapter, parent }
}

async function composedHarness(script: ConstructorParameters<typeof MockAdapter>[0]) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-hierarchy-composition-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, {
    include: Include, llm: LlmRuntime, session: SessionStore, projection: SessionProjectionRegistry,
    prompt: SystemPrompt, fs: FsLocal, directory: WorkingDirectory, tools: ToolRuntime,
    agents: AgentRegistry, loop: AgentLoop, persistence: Persistence, presets: AgentPresets,
    subagents: Subagents, spawn: Spawn, hierarchy: Hierarchy,
  })
  const entries = [
    ...['llm', 'session', 'projection', 'prompt', 'fs', 'directory', 'tools', 'agents'].map(name => ({ name: `cordis:${name}` })),
    { name: 'cordis:loop', config: { agents: [] } },
    { name: 'cordis:persistence', config: { root: join(root, 'sessions') } },
    { name: 'cordis:presets', config: { default: 'worker' } },
    { name: 'cordis:subagents' },
    { name: 'cordis:spawn', config: { providerName: 'spawn' } },
    { name: 'cordis:hierarchy', config: {
      confirmed: true, workers: [{ provider: 'test', model: 'worker' }],
      supervisors: [{ provider: 'test', model: 'supervisor' }], chief: [{ provider: 'test', model: 'chief' }],
      workerPreset: 'worker', supervisorPreset: 'worker', chiefPreset: 'worker',
    } },
  ]
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify(entries))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  await ctx.agentPresets.register({ id: 'worker', plugins: [] })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['test'], adapter)
  const parent = await ctx.agentLoop.create(SessionId('composed-root'), { provider: 'test', model: 'root-must-not-run' }, { cwd: root })
  return { ctx, parent, adapter }
}

describe('Harness hierarchy API feasibility gates', () => {
  it('G1 intercepts the first root step before any root model request', async () => {
    const { ctx, adapter, parent } = await harness([])
    ctx.on('agent/pre-step', async ({ agent }, next) => agent === parent ? { kind: 'enter', messages: [] } : next())
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'delegate this task' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    expect(adapter.requests).toEqual([])
    expect(parent.session.snapshotEvents().map(event => event.type)).toContain('turn/end')
    expect(parent.session.snapshotEvents().map(event => event.type)).not.toContain('step/start')
  })

  it('G2 preserves explicit child route, preset, depth and durable parent identity', async () => {
    const { ctx, adapter, parent } = await harness([textResponse('worker answer')])
    const run = await startTestActivation(ctx, 'spawn', {
      parent, prompt: [{ type: 'text', text: 'bounded task' }],
      agentOptions: { provider: 'test', model: 'worker-model' }, agentPreset: 'worker', maxDepth: 2,
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]).toMatchObject({ provider: 'test', model: 'worker-model' })
    expect(run.localAgent.options.subagentDepth).toBe(1)
    expect(run.localAgent.session.header).toMatchObject({ parentSession: parent.id, agentPreset: 'worker' })
    await run.dispose()
  })

  it('G3 denies direct execution of a tool even when it is registered inside the guarded agent scope', async () => {
    const { ctx, parent } = await harness([])
    let writes = 0
    parent.ctx.tools.guard(exec => exec.name === 'write_file' ? 'Workers must return a patch.' : undefined)
    parent.ctx.tools.register(defineContentToolFixture({
      name: 'write_file', description: 'mutating tool', parameters: {},
      execute: async () => { writes += 1; return [{ type: 'text', text: 'written' }] },
    }))
    const result = await ctx.tools.execute({ agent: parent, signal: new AbortController().signal,
      callId: ToolCallId('forbidden-write'), name: 'write_file', arguments: {},
    })
    expect(writes).toBe(0)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: Workers must return a patch.' }])
  })

  it('G4 root cancellation can dispose an active child and await its aborted settlement', async () => {
    const { ctx, parent, adapter } = await harness(['hang'])
    const started = deferred()
    let childResult: string | undefined
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      if (agent !== parent) return next()
      const run = await startTestActivation(ctx, 'spawn', {
        parent, signal, prompt: [{ type: 'text', text: 'wait' }],
        agentOptions: { provider: 'test', model: 'worker-model' }, agentPreset: 'worker', maxDepth: 2,
      })
      const cancelChild = () => { void run.dispose() }
      signal.addEventListener('abort', cancelChild, { once: true })
      try {
        started.resolve()
        childResult = (await run.result).stopReason
      } finally {
        signal.removeEventListener('abort', cancelChild)
        await run.dispose()
      }
      return { kind: 'enter', messages: [] }
    })
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'work' }], source: { kind: 'user' } }))
    await started.promise
    parent.cancel({ kind: 'user' })
    await parent.whenIdle()
    expect(childResult).toBe('aborted')
    expect(adapter.requests.every(request => request.model !== 'root-must-not-run')).toBe(true)
    expect(parent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data)
      .toMatchObject({ reason: { kind: 'aborted' } })
  })

  it('G5 the intercepted root stays open until awaited review state has been committed', async () => {
    const { ctx, parent, adapter } = await harness([])
    const entered = deferred()
    const receiptCommitted = deferred()
    let reviewCommitted = false
    ctx.on('agent/pre-step', async ({ agent }, next) => {
      if (agent !== parent) return next()
      entered.resolve()
      await receiptCommitted.promise
      parent.session.append('hierarchy-test/receipt', { approved: true, digest: 'fixture-digest' })
      await ctx.sessions.flush(parent.session)
      reviewCommitted = true
      return { kind: 'enter', messages: [] }
    })
    let completedAfterReview = false
    ctx.on('session/event', (session, event) => {
      if (session === parent.session && event.type === 'turn/end') completedAfterReview = reviewCommitted
    })
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'review task' }], source: { kind: 'user' } }))
    await entered.promise
    expect(parent.session.snapshotEvents().some(event => event.type === 'turn/end')).toBe(false)
    receiptCommitted.resolve()
    await parent.whenIdle()
    expect(completedAfterReview).toBe(true)
    expect(adapter.requests).toHaveLength(0)
    await ctx.sessions.flush(parent.session)
    const stored = await loadStoredSession(ctx.sessionPersistence, parent.id)
    const receiptIndex = stored.events.findIndex(event => event.type === 'hierarchy-test/receipt')
    const completedIndex = stored.events.findIndex(event => event.type === 'turn/end')
    expect(receiptIndex).toBeGreaterThan(-1)
    expect(completedIndex).toBeGreaterThan(receiptIndex)
  })
})

describe('hierarchy Host with real child activations', () => {
  it('runs supervisor, worker and review routes and persists receipts before publishing the answer', async () => {
    const scriptedResults = [
      { tasks: ['answer the question'], architecture: false, security: false, multipleSubsystems: false, finalReview: false, escalate: false },
      { proposal: 'The answer is 42.' },
      { selectedId: 'P1', approved: true, rationale: 'Only successful proposal is acceptable.', escalate: false },
      { approved: true, feedback: '', escalate: false },
      { completed: true, summary: 'The answer is 42.', verification: 'Checked the answer.' },
      { approved: true, feedback: '', escalate: false },
    ]
    const { ctx, parent, adapter } = await composedHarness(scriptedResults.map((result, index) => toolCallResponse(`result-${index}`, STRUCTURED_OUTPUT_TOOL, result)))
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'What is the answer?' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['supervisor', 'worker', 'supervisor', 'supervisor', 'supervisor', 'supervisor'])
    const events = parent.session.snapshotEvents()
    const answer = events.findIndex(event => event.type === 'assistant/message')
    const receipts = events.flatMap((event, index) => event.type === 'plugin:model-hierarchy/receipt' ? [index] : [])
    expect(receipts).toHaveLength(3)
    expect(receipts.every(index => index < answer)).toBe(true)
    await ctx.sessions.flush(parent.session)
    const stored = await loadStoredSession(ctx.sessionPersistence, parent.id)
    expect(stored.events.filter(event => event.type === 'plugin:model-hierarchy/receipt')).toHaveLength(3)
    expect(parent.session.deriveMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'The answer is 42.\n\nChecked the answer.' }])
  })
})
