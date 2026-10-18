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
    if (attachments.length === 0 && !/[\p{L}\p{N}]/u.test(taskText)) return next()
    const task = taskText.trim() === '' ? 'Analyze the attached user content.' : taskText
    const summary = await orchestrate(settings, task, {
      signal,
      async receipt(receipt) {
        appendPluginRecord(agent.session, 'plugin:model-hierarchy/receipt', { ...receipt, turn })
        await ctx.sessions.flush(agent.session)
      },
      async invoke(request) {
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
              ...(request.route.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(request.route.reasoningEffort) }),
              hierarchyRole: request.role, hierarchyIntegrate: request.integrate,
            },
          },
        })
        const cancel = () => { void activation.dispose().catch(() => { /* Result/disposal below owns reporting. */ }) }
        signal.addEventListener('abort', cancel, { once: true })
        try {
          if (signal.aborted) { await activation.dispose(); signal.throwIfAborted() }
          const result = await activation.result
          signal.throwIfAborted()
          if (result.stopReason !== 'completed') throw new RouteUnavailable(`Route ${request.route.provider}/${request.route.model}: ${result.stopReason}`)
          if (result.structured === undefined) throw new Error('Hierarchy child completed without its required structured result')
          return result.structured
        } finally {
          signal.removeEventListener('abort', cancel)
          await activation.dispose()
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
