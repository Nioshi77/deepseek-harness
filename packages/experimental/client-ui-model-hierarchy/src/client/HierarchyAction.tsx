/** Session-header trigger and revision-fenced hierarchy editor. */
import { useEffect, useId, useRef, useState } from 'react'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ModelHierarchySettings, Route } from './types.ts'
import css from './HierarchyAction.module.css'

/** Injected preferences and host actions; the editor owns only its unsaved draft. */
export interface HierarchyInjected {
  hooks: { hierarchy: ConfigForm<ModelHierarchySettings> }
  loadCatalog: () => Promise<ModelCatalog>
  save: (value: ModelHierarchySettings, revision: number) => Promise<boolean>
}
/** Slot-derived component props. */
export type HierarchyProps = PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'model-hierarchy'> & InjectFace<HierarchyInjected>

/** Render the hierarchy control beside the session preset.
 * @param props Scoped session data, settings snapshot, and host actions.
 * @returns Header control and an accessible modal editor.
 */
export function HierarchyAction({ sessionId, useSessions, useHierarchy, loadCatalog, save, t }: HierarchyProps) {
  const settings = useHierarchy(value => value)
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef(0)
  const titleId = useId()
  const [draft, setDraft] = useState<ModelHierarchySettings>()
  const [revision, setRevision] = useState<number>()
  const [catalog, setCatalog] = useState<ModelCatalog>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => () => { request.current++ }, [])

  async function load() {
    const generation = ++request.current
    setLoading(true)
    setError(undefined)
    try {
      const value = await loadCatalog()
      if (request.current === generation) setCatalog(value)
    } catch (cause) {
      if (request.current === generation) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (request.current === generation) setLoading(false)
    }
  }

  function open() {
    setDraft(settings.value === undefined ? undefined : structuredClone(settings.value))
    setRevision(settings.revision)
    setSaved(false)
    dialog.current?.showModal()
    void load()
  }

  const tiers = ['workers', 'supervisors', 'chief'] as const
  const complete = draft !== undefined && tiers.every(tier => draft[tier].length > 0)
  const valid = draft !== undefined && (!draft.enabled || complete)
  const editable = settings.writable && !busy
  const active = settings.value?.enabled === true && (cwd === undefined || !settings.value.disabledProjects.includes(cwd))

  function changeTier(tier: typeof tiers[number], routes: Route[]) {
    if (draft !== undefined) setDraft({ ...draft, [tier]: routes })
  }

  async function submit() {
    if (draft === undefined || revision === undefined || !valid || !editable) return
    const generation = request.current
    setBusy(true)
    setError(undefined)
    try {
      const accepted = await save({ ...draft, confirmed: complete }, revision)
      if (generation !== request.current) return
      if (!accepted) { setError(t('error')); return }
      dialog.current?.close()
      setSaved(true)
    } catch (cause) {
      if (generation === request.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (generation === request.current) setBusy(false)
    }
  }

  return <>
    <button type="button" className={css.trigger} onClick={open} aria-haspopup="dialog" disabled={settings.status === 'loading'}>
      <span aria-hidden="true" className={active ? css.dotActive : css.dot} />
      {t('trigger')} <span className={css.status}>{t(settings.value?.confirmed !== true ? 'pending' : active ? 'on' : 'off')}</span>
    </button>
    <span className={css.srOnly} role="status">{saved ? t('saved') : ''}</span>
    <dialog ref={dialog} className={css.dialog} aria-labelledby={titleId} onCancel={(event) => { if (busy) event.preventDefault() }}>
      <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <header className={css.header}><h2 id={titleId}>{t('title')}</h2><p>{t('description')}</p></header>
        <div className={css.body}>
          {draft === undefined ? <p role="status">{t(settings.status === 'loading' ? 'loading' : 'unavailable')}</p> : <>
            <label className={css.toggle}><input type="checkbox" checked={draft.enabled} disabled={!editable} onChange={(event) =>{  setDraft({ ...draft, enabled: event.target.checked }) }} />{t('enabled')}</label>
            {cwd !== undefined && <label className={css.toggle} title={cwd}><input type="checkbox" disabled={!editable} checked={!draft.disabledProjects.includes(cwd)} onChange={(event) =>{  setDraft({ ...draft, disabledProjects: event.target.checked ? draft.disabledProjects.filter(path => path !== cwd) : [...new Set([...draft.disabledProjects, cwd])] }) }} />{t('project')}</label>}
            {tiers.map((tier, index) => <fieldset className={css.tier} key={tier} disabled={!editable}>
              <legend><span className={css.number}>{index + 1}</span>{t(tier)}</legend>
              {draft[tier].map((route, routeIndex) => {
                const available = catalog?.groups.find(group => group.id === route.provider)?.models.some(model => model.id === route.model)
                return <div className={css.route} key={JSON.stringify([route.provider, route.model])}>
                  <div className={css.routeName}><strong>{route.label ?? route.model}</strong><small>{route.provider}{catalog !== undefined && !available ? ` · ${t('unavailableModel')}` : ''}</small></div>
                  {tier === 'workers' && <label className={css.free}><input type="checkbox" checked={route.free === true} onChange={(event) =>{  changeTier(tier, draft[tier].map((item, position) => position === routeIndex ? { ...item, free: event.target.checked } : item)) }} />{t('free')}</label>}
                  <button className={css.remove} type="button" aria-label={`${t('remove')} ${route.label ?? route.model}`} onClick={() =>{  changeTier(tier, draft[tier].filter((_, position) => position !== routeIndex)) }}>×</button>
                </div>
              })}
              <select aria-label={`${t('add')} ${t(tier)}`} className={css.select} value="" disabled={loading || catalog === undefined} onChange={(event) => {
                const options = catalog?.groups.flatMap(group => group.models.map(model => ({
                  provider: group.id, model: model.id, label: model.name,
                }))) ?? []
                const chosen = options.find(route => JSON.stringify([route.provider, route.model]) === event.target.value)
                if (chosen !== undefined) changeTier(tier, [...draft[tier], chosen])
              }}>
                <option value="">{t('add')}</option>
                {catalog?.groups.map(group => <optgroup key={group.id} label={group.name}>
                  {group.models.map(model => <option key={model.id} value={JSON.stringify([group.id, model.id])}
                    disabled={draft[tier].some(route => route.provider === group.id && route.model === model.id)}>
                    {model.name}
                  </option>)}
                </optgroup>)}
              </select>
            </fieldset>)}
            {!valid && <p className={css.hint}>{t('required')}</p>}
            <p className={css.hint}>{t('notice')}</p>
          </>}
          {loading && <p role="status">{t('loading')}</p>}
          {catalog?.failures.map(failure => <p className={css.error} key={failure.id}>{failure.name}: {failure.message}</p>)}
          {error !== undefined && <div role="alert" className={css.error}>{error} <button type="button" disabled={busy} onClick={open}>{t('reload')}</button></div>}
        </div>
        <footer className={css.footer}><button type="button" disabled={busy} onClick={() => dialog.current?.close()}>{t('cancel')}</button><button className={css.save} type="submit" disabled={!editable || !valid || revision === undefined}>{t('save')}</button></footer>
      </form>
    </dialog>
  </>
}
