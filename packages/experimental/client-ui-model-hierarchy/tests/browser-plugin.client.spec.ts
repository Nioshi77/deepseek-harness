import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { HierarchyAction } from '../src/client/HierarchyAction.tsx'

describe('hierarchy header registration', () => {
  it('registers next to Standard and removes the control when unloaded', async () => {
    const ctx = new Context()
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('configForms', { get: () => ({ getSnapshot: () => ({}), subscribe: () => () => {} }) } as never)
    ctx.provide('remote', { session: { modelCatalog: async () => ({ ok: false }) } } as never)
    await ctx.plugin(SlotRegistry).await()
    const removeHeader = ctx.slots.register({
      name: 'root', children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    const fiber = ctx.plugin({ inject, apply })
    try {
      await fiber.await()
      const entry = ctx.slots.entries('conversation.session.header.actions').find(item => item.component === HierarchyAction)
      expect(entry?.options).toMatchObject({ id: 'model-hierarchy', order: 0 })
      expect(ctx.locale.bind('model-hierarchy')('trigger')).toBe('Model hierarchy')
      await fiber.dispose()
      expect(ctx.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    } finally {
      removeHeader()
      await fiber.dispose()
    }
  })
})
