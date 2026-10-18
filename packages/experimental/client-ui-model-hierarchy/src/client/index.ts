/** Header editor for the host-owned model hierarchy preferences. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { HierarchyAction } from './HierarchyAction.tsx'
import { en, ru, type HierarchyKey } from './locales.ts'
import type { ModelHierarchySettings } from './types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Model hierarchy editor copy. */
    'model-hierarchy': HierarchyKey
  }
}
/** Required client services. */
export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session']
/** Register a disposable header action beside the preset label.
 * @param ctx Browser plugin context.
 */
export function apply(ctx: Context): void {
  const form = ctx.configForms.get<ModelHierarchySettings>('model-hierarchy')
  ctx.effect(() => ctx.locale.register('model-hierarchy', 'en', en))
  ctx.effect(() => ctx.locale.register('model-hierarchy', 'ru', ru))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'model-hierarchy', order: 0,
    locale: 'model-hierarchy',
    inject: () => ({
      hooks: { hierarchy: form },
      loadCatalog: async () => {
        const result = await ctx.remote.session.modelCatalog()
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      save: (value: ModelHierarchySettings, revision: number) => form.mutate([
        { op: 'set', path: ['enabled'], value: value.enabled },
        { op: 'set', path: ['confirmed'], value: value.confirmed },
        { op: 'set', path: ['workers'], value: value.workers.map(route => ({ ...route })) },
        { op: 'set', path: ['supervisors'], value: value.supervisors.map(route => ({ ...route })) },
        { op: 'set', path: ['chief'], value: value.chief.map(route => ({ ...route })) },
        { op: 'set', path: ['disabledProjects'], value: value.disabledProjects },
      ], revision),
    }),
  }, HierarchyAction))
}
