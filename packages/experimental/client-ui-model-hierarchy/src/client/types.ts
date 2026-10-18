/** Exact provider route selected for a hierarchy role. */
export interface Route { provider: string; model: string; reasoningEffort?: string; free?: boolean; label?: string }
/** User-confirmed routing preferences owned by the host settings namespace. */
export interface ModelHierarchySettings {
  enabled: boolean
  confirmed: boolean
  workers: Route[]
  supervisors: Route[]
  chief: Route[]
  disabledProjects: string[]
}
