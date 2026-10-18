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
const deliberationSchema = z.object({
  selectedId: z.string().min(1),
  agreed: z.boolean(),
  rationale: z.string().min(1),
  objections: z.array(z.string()),
  safetyRisk: z.string(),
})
const selectionSchema = z.object({
  selectedId: z.string().min(1),
  approved: z.boolean(),
  rationale: z.string().min(1),
  escalate: z.boolean(),
})
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
  async function callRoute<T>(role: Role, route: Route, prompt: string, schema: z.ZodType<T>, integrate = false): Promise<T> {
    io.signal.throwIfAborted()
    const outputSchema = providerSchema(z.toJSONSchema(schema))
    if (outputSchema.type !== 'object') throw new Error(`Hierarchy ${role} output schema must be an object`)
    return schema.parse(await io.invoke({ role, route, prompt, schema: { ...outputSchema, type: 'object' }, integrate }))
  }
  async function call<T>(role: Role, prompt: string, schema: z.ZodType<T>, integrate = false): Promise<T> {
    const routes = role === 'worker'
      ? [...config.workers.filter(r => r.free !== false), ...config.workers.filter(r => r.free === false), ...config.supervisors]
      : role === 'supervisor' ? config.supervisors : config.chief
    let lastFailure: Error = new Error(`No confirmed ${role} routes`)
    for (const route of routes) {
      io.signal.throwIfAborted()
      try {
        return await callRoute(role, route, prompt, schema, integrate)
      } catch (error) {
        if (integrate) throw error
        if (!(error instanceof RouteUnavailable)) throw error
        lastFailure = error
      }
    }
    throw lastFailure
  }

  async function proposeWithAllWorkers(assignment: string, feedback: string) {
    const routes = [...config.workers.filter(route => route.free !== false), ...config.workers.filter(route => route.free === false)]
    const successful: Array<{ id: string; route: Route; proposal: string }> = []
    for (let offset = 0; offset < routes.length; offset += config.maxParallel) {
      const batch = await Promise.all(routes.slice(offset, offset + config.maxParallel).map(async (route, index) => {
        const id = `P${offset + index + 1}`
        try {
          const result = await callRoute('worker', route, `Independently inspect this assignment and propose the safest, most stable production-ready patch or answer. You may only read; never modify files or execute commands. Do not assume another worker's solution. Task:\n${task}\nAssignment:\n${assignment}\nReview feedback:\n${feedback}`, proposalSchema)
          return { id, route, proposal: result.proposal }
        } catch (error) {
          io.signal.throwIfAborted()
          await io.receipt({ role: 'worker', digest: digest(`${assignment}\n${route.provider}/${route.model}`), approved: false, feedback: `Proposal failed for ${route.provider}/${route.model}: ${errorMessage(error)}` })
          return undefined
        }
      }))
      successful.push(...batch.filter((proposal): proposal is NonNullable<typeof proposal> => proposal !== undefined))
    }

    // Preserve the configured paid fallback when every ordinary worker route is unavailable.
    if (successful.length === 0) {
      let lastFailure: Error = new Error('No confirmed supervisor routes')
      for (const route of config.supervisors) {
        try {
          const fallback = await callRoute('worker', route, `All configured worker routes failed. Produce one read-only fallback proposal for this assignment. Task:\n${task}\nAssignment:\n${assignment}\nReview feedback:\n${feedback}`, proposalSchema)
          return [{ id: 'P1', route, proposal: fallback.proposal }]
        } catch (error) {
          io.signal.throwIfAborted()
          lastFailure = error instanceof Error ? error : new Error(String(error))
          if (!(error instanceof RouteUnavailable)) throw error
        }
      }
      throw lastFailure
    }
    return successful
  }

  async function selectByWorkerConsensus(assignment: string, proposals: Array<{ id: string; route: Route; proposal: string }>) {
    const proposalText = proposals.map(item => `${item.id}:\n${item.proposal}`).join('\n\n')
    async function supervisorSelect(reason: string, assessments = '', risks: string[] = []) {
      const decision = await call('supervisor', `Workers require a supervisor decision because ${reason}. Select a valid candidate ID, or return approved=false. Task:\n${task}\nAssignment:\n${assignment}\nCandidates:\n${proposalText}\nWorker assessments:\n${assessments}\nReported risks:\n${risks.join('\n')}`, selectionSchema)
      await io.receipt({ role: 'supervisor', digest: digest(proposalText), approved: decision.approved, feedback: JSON.stringify({ selectedId: decision.selectedId, rationale: decision.rationale }) })
      chiefRequired ||= decision.escalate || risks.length > 0
      const selected = proposals.find(proposal => proposal.id === decision.selectedId)
      if (!decision.approved || !selected) throw new Error(`Supervisor rejected worker candidates: ${decision.rationale}`)
      return { proposal: selected.proposal }
    }
    if (proposals.length === 1) return supervisorSelect('only one worker proposal succeeded')

    let prior = ''
    const reportedRisks: string[] = []
    for (let round = 1; round <= 2; round++) {
      const assessments: Array<{ participant: typeof proposals[number]; assessment: z.infer<typeof deliberationSchema> } | undefined> = []
      for (let offset = 0; offset < proposals.length; offset += config.maxParallel) {
        const batch = await Promise.all(proposals.slice(offset, offset + config.maxParallel).map(async (participant) => {
          let assessment: z.infer<typeof deliberationSchema>
          try {
            assessment = await callRoute('worker', participant.route, `Compare every candidate using this production-readiness rubric: correctness and completeness; security and data-loss risk; stability and failure handling; testability; maintainability and architectural compatibility; rollback and observability where relevant. Select one candidate ID. agreed=true means you can support it as the group decision. State concrete objections and put any security or data-loss concern in safetyRisk. This is consensus round ${round} of 2.\nTask:\n${task}\nAssignment:\n${assignment}\nCandidates:\n${proposalText}\nPrior round decisions:\n${prior}`, deliberationSchema)
          } catch (error) {
            io.signal.throwIfAborted()
            await io.receipt({ role: 'worker', digest: digest(`${proposalText}\n${participant.id}`), approved: false, feedback: `Peer assessment failed in round ${round} for ${participant.route.provider}/${participant.route.model}: ${errorMessage(error)}` })
            return undefined
          }
          await io.receipt({ role: 'worker', digest: digest(proposalText), approved: assessment.agreed, feedback: JSON.stringify({ round, participant: participant.id, ...assessment }) })
          return { participant, assessment }
        }))
        assessments.push(...batch)
      }
      const completed = assessments.filter((item): item is NonNullable<typeof item> => item !== undefined)
      reportedRisks.push(...completed.flatMap(item => item.assessment.safetyRisk.trim() ? [`round ${round}, ${item.participant.id}: ${item.assessment.safetyRisk}`] : []))
      if (completed.length < 2) return supervisorSelect('fewer than two workers completed peer assessment', prior, reportedRisks)

      const selectedId = completed.at(0)?.assessment.selectedId ?? ''
      const selected = proposals.find(proposal => proposal.id === selectedId)
      const unanimous = selected !== undefined && completed.every(
        item => item.assessment.agreed && item.assessment.selectedId === selectedId,
      )
      if (unanimous && reportedRisks.length === 0) return { proposal: selected.proposal }

      prior = JSON.stringify(completed.map(item => ({ participant: item.participant.id, ...item.assessment })))
      if (unanimous || round === 2) {
        return supervisorSelect(reportedRisks.length > 0 ? 'a safety or data-loss risk was reported' : 'unanimous consensus was not reached after two rounds', prior, reportedRisks)
      }
    }
    throw new Error('Worker deliberation ended without a decision')
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
    for (const assignment of plan.tasks) {
      const candidates = await proposeWithAllWorkers(assignment, feedback)
      const decision = await selectByWorkerConsensus(assignment, candidates)
      proposals.push(decision.proposal)
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
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/** Keep structured-output schemas inside the subset shared by Harness providers. */
function providerSchema(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(source)) {
    if (key === 'properties' && child !== null && typeof child === 'object' && !Array.isArray(child)) {
      result[key] = Object.fromEntries(Object.entries(child).map(([name, property]) => [name, providerSchema(property)]))
    } else if (key === 'items') {
      result[key] = providerSchema(child)
    } else if (key === 'oneOf' && Array.isArray(child)) {
      result[key] = child.map(providerSchema)
    } else if (['type', 'required', 'additionalProperties', 'enum', 'const', 'title', 'description'].includes(key)) {
      result[key] = child
    }
  }
  return result
}
