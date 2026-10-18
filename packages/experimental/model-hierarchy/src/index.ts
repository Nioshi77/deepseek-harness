/** Harness Host carrier for confirmed adaptive model hierarchies. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { hierarchyConfig } from './config.ts'
import type { HierarchyConfig } from './config.ts'
import { orchestrate, RouteUnavailable } from './controller.ts'
import type { Receipt, Role } from './controller.ts'
import { childFailureCategory, startupFailureCategory } from './diagnostics.ts'
import type { FailureCategory, InvocationOutcome } from './diagnostics.ts'

declare module '@deepseek-ai/dsh-agent' {
  interface AgentOptions {
    hierarchyRole?: Role
    hierarchyIntegrate?: boolean
  }
}
declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap {
    /** Ignorable controller evidence bound to one turn and proposal digest. */
    'plugin:model-hierarchy/receipt': Receipt & { turn: number }
    'plugin:model-hierarchy/invocation': InvocationOutcome
    'plugin:model-hierarchy/configured': { turn: number; routes: Array<{ role: Role; provider: string; model: string }> }
  }
}

/** Loader plugin identity. */
export const name = 'model-hierarchy'
/** Services required before the hierarchy can intercept a turn. */
export const inject = ['agents', 'sessions', 'subagents', 'tools']
/** Editable hierarchy settings. */
export interface Config extends Omit<HierarchyConfig,
  'enabled' | 'confirmed' | 'workers' | 'supervisors' | 'chief' | 'disabledProjects'> {
  enabled: Volatile<boolean>
  confirmed: Volatile<boolean>
  workers: Volatile<HierarchyConfig['workers']>
  supervisors: Volatile<HierarchyConfig['supervisors']>
  chief: Volatile<HierarchyConfig['chief']>
  disabledProjects: Volatile<string[]>
}
/** Loader settings schema. */
export const Config = hierarchyConfig

/** Register root interception and enforced child tool restrictions.
 * @param ctx - Harness plugin context.
 * @param config - validated hierarchy settings.
 */
export function apply(ctx: Context, config: Config): void {
  const currentConfig = (): HierarchyConfig => ({
    ...config,
    enabled: config.enabled.get(),
    confirmed: config.confirmed.get(),
    workers: config.workers.get(),
    supervisors: config.supervisors.get(),
    chief: config.chief.get(),
    disabledProjects: config.disabledProjects.get(),
  })
  const initial = currentConfig()
  if (initial.confirmed && (!initial.workers.length || !initial.supervisors.length || !initial.chief.length)) {
    throw new Error('A confirmed hierarchy requires worker, supervisor and chief routes')
  }
  ctx.effect(() => ctx.tools.guard((exec) => {
    const options = exec.agent?.options
    if (options?.hierarchyRole === undefined) return undefined
    if (['subagent', 'spawn_teammate', 'run_code', 'plugin_manager'].includes(exec.name)) return 'Hierarchy delegation and runtime configuration are controller-owned.'
    if (options.hierarchyIntegrate) return undefined
    return config.readTools.includes(exec.name) ? undefined : 'This hierarchy role is read-only. Return a proposal for supervisor integration.'
  }))
  ctx.on('agent/pre-step', async ({ agent, messages, step, turn, signal }, next) => {
    const settings = currentConfig()
    if (!settings.enabled || agent.session.header.parentSession !== undefined || agent.options.hierarchyRole !== undefined
      // Harness numbers the first proposed model step as 1. Later steps belong to
      // an already-entered root turn and must not start a second hierarchy.
      || step !== 1 || settings.disabledProjects.includes(agent.session.header.cwd ?? '')) return next()
    if (!settings.confirmed) throw new Error('Confirm model assignments in the hierarchy header before starting a task')
    for (const message of messages) agent.session.append('user/message', message, { surfaceOp: 'append' })
    const taskText = messages.flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n')
    const attachments = messages.flatMap(message => message.content.filter(block => block.type !== 'text'))
    const meaningfulText = taskText.match(/[\p{L}\p{N}]/gu)?.join('') ?? ''
    if (attachments.length === 0 && meaningfulText.length < 2) return next()
    const task = taskText.trim() === '' ? 'Analyze the attached user content.' : taskText
    appendPluginRecord(agent.session, 'plugin:model-hierarchy/configured', {
      turn,
      routes: (['worker', 'supervisor', 'chief'] as const).flatMap(role => (
        role === 'worker' ? settings.workers : role === 'supervisor' ? settings.supervisors : settings.chief
      ).map(route => ({ role, provider: route.provider, model: route.model }))),
    })
    let invocation = 0
    const summary = await orchestrate(settings, task, {
      signal,
      async receipt(receipt) {
        appendPluginRecord(agent.session, 'plugin:model-hierarchy/receipt', { ...receipt, turn })
        await ctx.sessions.flush(agent.session)
      },
      async invoke(request) {
        const evidence = {
          turn, invocation: ++invocation, role: request.role, provider: request.route.provider, model: request.route.model,
        }
        const started = performance.now()
        appendPluginRecord(agent.session, 'plugin:model-hierarchy/invocation', { ...evidence, state: 'attempted' })
        let errorCategory: FailureCategory | undefined
        let accepted = false
        try {
          const preset = request.role === 'worker'
            ? settings.workerPreset
            : request.role === 'chief' ? settings.chiefPreset : settings.supervisorPreset
          const activation = await ctx.subagents.startActivation({
            provider: 'spawn', label: `Hierarchy: ${request.role}`, delivery: 'caller', signal,
            request: {
              parent: agent, agentPreset: preset, maxDepth: 1,
              prompt: [{ type: 'text', text: request.prompt }, ...attachments],
              outputSchema: request.schema as ObjectJsonSchema,
              agentOptions: {
                provider: request.route.provider, model: request.route.model,
                ...(request.route.reasoningEffort === undefined ? {} : {
                  reasoningEffort: ReasoningEffortId(request.route.reasoningEffort),
                }),
                hierarchyRole: request.role, hierarchyIntegrate: request.integrate,
              },
            },
          })
          accepted = true
          const cancel = () => { void activation.dispose().catch(() => { /* Result/disposal below owns reporting. */ }) }
          signal.addEventListener('abort', cancel, { once: true })
          let timeout: ReturnType<typeof setTimeout> | undefined
          try {
            if (signal.aborted) { await activation.dispose(); signal.throwIfAborted() }
            const deadline = new Promise<never>((_, reject) => {
              timeout = setTimeout(() => reject(Object.assign(new Error('Hierarchy child deadline exceeded'), { name: 'HierarchyTimeout' })), settings.invocationTimeoutMs)
            })
            const result = await Promise.race([activation.result, deadline])
            signal.throwIfAborted()
            errorCategory = childFailureCategory(result.stopReason, result.structured, result.diagnostic)
            if (errorCategory !== undefined) throw new Error(`Hierarchy child ${request.role} failed: ${errorCategory}`)
            return result.structured
          } finally {
            if (timeout !== undefined) clearTimeout(timeout)
            signal.removeEventListener('abort', cancel)
            await activation.dispose()
          }
        } catch (error) {
          errorCategory ??= signal.aborted ? 'cancelled' : error instanceof Error && error.name === 'HierarchyTimeout' ? 'timeout' : accepted ? 'child_error' : startupFailureCategory(error)
          if (['authentication', 'rate_limit', 'route_unavailable'].includes(errorCategory)) {
            throw new RouteUnavailable(`Route ${request.route.provider}/${request.route.model}: ${errorCategory}`)
          }
          throw error
        } finally {
          appendPluginRecord(agent.session, 'plugin:model-hierarchy/invocation', {
            ...evidence, state: errorCategory === undefined ? 'completed' : 'failed',
            durationMs: Math.round(performance.now() - started),
            ...(errorCategory === undefined ? {} : { errorCategory }),
          })
          await ctx.sessions.flush(agent.session)
        }
      },
    })
    signal.throwIfAborted()
    const route = settings.supervisors[0]
    if (route === undefined) throw new Error('Hierarchy completed without a supervisor route')
    agent.session.append('assistant/message', {
      turn, step, stream: [],
      message: createAssistantMessage({ content: [{ type: 'text', text: summary }], source: { provider: route.provider, model: route.model } }),
    }, { surfaceOp: 'append' })
    await ctx.sessions.flush(agent.session)
    return { kind: 'enter', messages: [] }
  })
}
