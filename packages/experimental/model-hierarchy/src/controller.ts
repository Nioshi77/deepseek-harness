/** Bounded supervisor/worker/reviewer scheduling independent of the Harness carrier. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { HierarchyConfig, Route } from './config.ts'

const planSchema = z.object({
  tasks: z.array(z.string().min(1)).min(1).max(32),
  architecture: z.boolean(),
  security: z.boolean(),
  multipleSubsystems: z.boolean(),
  finalReview: z.boolean(),
  escalate: z.boolean(),
})
const reviewSchema = z.object({ approved: z.boolean(), feedback: z.string(), escalate: z.boolean() })
const proposalSchema = z.object({ proposal: z.string().min(1) })
const integrationSchema = z.object({ completed: z.boolean(), summary: z.string(), verification: z.string() })

/** Roles are fixed; model names are deployment data. */
export type Role = 'worker' | 'supervisor' | 'chief'
/** One invocation with an exact route and expected structured result. */
export interface Invocation {
  role: Role
  route: Route
  prompt: string
  schema: { type: 'object' } & Record<string, unknown>
  integrate: boolean
}
/** Durable review record bound to the exact reviewed proposal text. */
export interface Receipt { role: Role; digest: string; approved: boolean; feedback: string }
/** The carrier owns child lifecycle, cancellation and durable evidence. */
export interface ControllerIO {
  invoke(request: Invocation): Promise<unknown>
  receipt(receipt: Receipt): Promise<void>
  signal: AbortSignal
}

/** Provider failure eligible for the next confirmed route, never a quality rejection. */
export class RouteUnavailable extends Error {}

/** Execute a bounded hierarchy and return the reviewed final summary.
 * @param config - confirmed routes and limits.
 * @param task - complete user request.
 * @param io - child execution and durable evidence owner.
 * @returns verified integration summary, or rejects without claiming completion.
 */
export async function orchestrate(config: HierarchyConfig, task: string, io: ControllerIO): Promise<string> {
  async function call<T>(role: Role, prompt: string, schema: z.ZodType<T>, integrate = false): Promise<T> {
    const routes = role === 'worker'
      ? [...config.workers.filter(r => r.free !== false), ...config.workers.filter(r => r.free === false), ...config.supervisors]
      : role === 'supervisor' ? config.supervisors : config.chief
    let lastFailure: Error = new Error(`No confirmed ${role} routes`)
    for (const route of routes) {
      io.signal.throwIfAborted()
      try {
        const outputSchema = z.toJSONSchema(schema)
        if (outputSchema.type !== 'object') throw new Error(`Hierarchy ${role} output schema must be an object`)
        return schema.parse(await io.invoke({ role, route, prompt, schema: { ...outputSchema, type: 'object' }, integrate }))
      } catch (error) {
        if (integrate) throw error
        if (!(error instanceof RouteUnavailable)) throw error
        lastFailure = error
      }
    }
    throw lastFailure
  }
  const plan = await call('supervisor', `Plan this task. Return independent read-only worker assignments. Flag architecture, security, multiple subsystems, final project/milestone review, or discretionary escalation. User request:\n${task}`, planSchema)
  let chiefRequired = plan.architecture || plan.security || plan.multipleSubsystems || plan.finalReview || plan.escalate
  if (chiefRequired) {
    const architecture = await call('chief', `Review the proposed plan before execution. Task:\n${task}\nPlan:\n${JSON.stringify(plan)}`, reviewSchema)
    await io.receipt({ role: 'chief', digest: digest(JSON.stringify(plan)), approved: architecture.approved, feedback: architecture.feedback })
    if (!architecture.approved) throw new Error(`Chief rejected plan: ${architecture.feedback}`)
  }
  let feedback = ''
  let qualityFailures = 0
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    const proposals: string[] = []
    for (let offset = 0; offset < plan.tasks.length; offset += config.maxParallel) {
      const batch = await Promise.all(plan.tasks.slice(offset, offset + config.maxParallel).map(async (assignment) => {
        const result = await call('worker', `Inspect and propose a precise patch or answer. You may only read; never modify files or execute commands. Task:\n${task}\nAssignment:\n${assignment}\nReview feedback:\n${feedback}`, proposalSchema)
        return result.proposal
      }))
      proposals.push(...batch)
    }
    const artifact = proposals.join('\n\n')
    const review = await call('supervisor', `Review these worker proposals against the task, check correctness and scope. Do not modify files. Task:\n${task}\nProposals:\n${artifact}`, reviewSchema)
    await io.receipt({ role: 'supervisor', digest: digest(artifact), approved: review.approved, feedback: review.feedback })
    chiefRequired ||= review.escalate
    if (!review.approved) {
      qualityFailures++
      chiefRequired ||= qualityFailures >= 2
      feedback = review.feedback
      if (chiefRequired) {
        const chief = await call('chief', `Resolve repeated review failures or escalation. Task:\n${task}\nProposals:\n${artifact}\nFeedback:\n${feedback}`, reviewSchema)
        await io.receipt({ role: 'chief', digest: digest(artifact), approved: chief.approved, feedback: chief.feedback })
        feedback += `\nChief: ${chief.feedback}`
      }
      continue
    }
    if (chiefRequired) {
      const chief = await call('chief', `Approve proposals before integration. Task:\n${task}\nProposals:\n${artifact}`, reviewSchema)
      await io.receipt({ role: 'chief', digest: digest(artifact), approved: chief.approved, feedback: chief.feedback })
      if (!chief.approved) { feedback = chief.feedback; continue }
    }
    const integrated = await call('supervisor', `Integrate only these approved proposals. Preserve unrelated user changes. Run checks appropriate to the change. Report completed=false if integration or verification fails. Task:\n${task}\nApproved proposals SHA256 ${digest(artifact)}:\n${artifact}`, integrationSchema, true)
    if (!integrated.completed) throw new Error(`Integration incomplete: ${integrated.summary}\n${integrated.verification}`)
    const acceptance = await call('supervisor', `Independently inspect the actual integrated files and verify the task is complete. Do not edit. Task:\n${task}\nApproved proposals:\n${artifact}\nReported verification:\n${integrated.verification}`, reviewSchema)
    await io.receipt({ role: 'supervisor', digest: digest(JSON.stringify(integrated)), approved: acceptance.approved, feedback: acceptance.feedback })
    if (!acceptance.approved) throw new Error(`Integrated result rejected: ${acceptance.feedback}`)
    chiefRequired ||= acceptance.escalate
    if (chiefRequired) {
      const final = await call('chief', `Inspect the actual integrated files and verification evidence. Approve only if the task is complete. Task:\n${task}\nIntegration:\n${JSON.stringify(integrated)}`, reviewSchema)
      await io.receipt({ role: 'chief', digest: digest(JSON.stringify(integrated)), approved: final.approved, feedback: final.feedback })
      if (!final.approved) throw new Error(`Final review rejected: ${final.feedback}`)
    }
    return `${integrated.summary}\n\n${integrated.verification}`
  }
  throw new Error(`Review attempt limit reached: ${feedback}`)
}

function digest(text: string): string { return createHash('sha256').update(text).digest('hex') }
