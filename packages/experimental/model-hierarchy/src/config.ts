/** Validated deployment settings shared by the hierarchy controller and settings editor. */
import z from '@deepseek-ai/schemastery'

/** An explicitly confirmed model route. */
export interface Route {
  provider: string
  model: string
  reasoningEffort?: string
  free?: boolean
  label?: string
}

/** Project defaults and bounded orchestration limits; no monetary ceiling is imposed. */
export interface HierarchyConfig {
  enabled: boolean
  confirmed: boolean
  workers: Route[]
  supervisors: Route[]
  chief: Route[]
  disabledProjects: string[]
  workerPreset: string
  supervisorPreset: string
  chiefPreset: string
  maxAttempts: number
  maxParallel: number
  readTools: string[]
}

const route = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
  free: z.boolean(),
  label: z.string(),
})

/** Loader schema used by the normal Harness settings editor. */
export const hierarchyConfig: z<HierarchyConfig> = z.object({
  enabled: z.boolean().default(true).volatile(),
  confirmed: z.boolean().default(false).volatile(),
  workers: z.array(route).default([]).volatile(),
  supervisors: z.array(route).default([]).volatile(),
  chief: z.array(route).default([]).volatile(),
  disabledProjects: z.array(z.string()).default([]).volatile(),
  workerPreset: z.string().default('standard'),
  supervisorPreset: z.string().default('standard'),
  chiefPreset: z.string().default('standard'),
  maxAttempts: z.number().step(1).min(2).max(10).default(3),
  maxParallel: z.number().step(1).min(1).max(8).default(3),
  readTools: z.array(z.string()).default(['read', 'read_file', 'glob', 'grep', 'list_directory', 'search', 'structured_output']),
})
