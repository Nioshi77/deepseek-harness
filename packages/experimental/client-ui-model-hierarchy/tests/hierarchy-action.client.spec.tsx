// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HierarchyAction, type HierarchyProps } from '../src/client/HierarchyAction.tsx'
import { en } from '../src/client/locales.ts'
import type { ModelHierarchySettings } from '../src/client/types.ts'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(cleanup)

function setup(overrides: Partial<ModelHierarchySettings> = {}, accepted = true) {
  const route = { provider: 'provider', model: 'one', label: 'First model' }
  const value: ModelHierarchySettings = {
    enabled: true, confirmed: false, workers: [], supervisors: [route], chief: [route], disabledProjects: [], ...overrides,
  }
  const save = vi.fn().mockResolvedValue(accepted)
  const props = {
    sessionId: 'session',
    useSessions: (select: (state: object) => unknown) => select({ byId: { session: { cwd: '/project' } } }),
    useHierarchy: (select: (state: object) => unknown) => select({ status: 'ready', value, revision: 7, writable: true }),
    loadCatalog: vi.fn().mockResolvedValue({ default: route, routableProviders: ['provider'], failures: [], groups: [{ id: 'provider', name: 'Provider', models: [{ id: 'one', name: 'First model' }, { id: 'two', name: 'Second model' }] }] }),
    save, t: (key: keyof typeof en) => en[key],
  } as HierarchyProps
  render(<HierarchyAction {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Model hierarchy/ }))
  return { save, value }
}

describe('hierarchy editor', () => {
  it('requires every tier and saves confirmed routes with the opening revision', async () => {
    const { save } = setup()
    expect(screen.getByRole('button', { name: en.save }).hasAttribute('disabled')).toBe(true)
    const workers = screen.getByRole('combobox', { name: `${en.add} ${en.workers}` })
    await waitFor(() =>{  expect(workers.hasAttribute('disabled')).toBe(false) })
    fireEvent.change(workers, { target: { value: JSON.stringify(['provider', 'two']) } })
    fireEvent.click(screen.getByRole('checkbox', { name: en.free }))
    fireEvent.click(screen.getByRole('checkbox', { name: en.project }))
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() =>{  expect(save).toHaveBeenCalledWith(expect.objectContaining({
      confirmed: true, workers: [{ provider: 'provider', model: 'two', label: 'Second model', free: true }], disabledProjects: ['/project'],
    }), 7) })
    await waitFor(() =>{  expect(screen.getByRole('status').textContent).toBe(en.saved) })
  })

  it('keeps rejected edits visible and never reports success', async () => {
    setup({ workers: [{ provider: 'provider', model: 'one' }] }, false)
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() =>{  expect(screen.getByRole('alert').textContent).toContain(en.error) })
    expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true)
    expect(screen.queryByText(en.saved)).toBeNull()
  })

  it('cancel discards unsaved tier edits', async () => {
    const { save } = setup({ workers: [{ provider: 'provider', model: 'one' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove one' }))
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    fireEvent.click(screen.getByRole('button', { name: /Model hierarchy/ }))
    expect(screen.getByRole('button', { name: 'Remove one' })).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })
})
