/** English hierarchy editor dictionary. */
export const en = {
  trigger: 'Model hierarchy', title: 'Choose your model team',
  description: 'Supervisors plan and check. Workers execute. The chief reviews complex decisions and project milestones.',
  enabled: 'Enable by default in all projects', project: 'Enable for this project',
  workers: 'Workers', supervisors: 'Supervisors', chief: 'Chief reviewer',
  free: 'Free route', remove: 'Remove', add: 'Add a model…',
  save: 'Confirm and save', cancel: 'Cancel', loading: 'Loading models…',
  error: 'Could not save. Reload the editor and try again.', reload: 'Reload',
  unavailable: 'Hierarchy settings are unavailable. Enable the host plugin first.',
  required: 'Select at least one model in each tier.',
  notice: 'Changes apply to the next task. Paid fallback is allowed without a separate spending cap. Mark free routes explicitly; the catalog does not report prices.',
  pending: 'Needs setup', on: 'On', off: 'Off', saved: 'Settings saved',
  unavailableModel: 'Unavailable in current catalog',
}
/** Dictionary key union used by the registered locale namespace. */
export type HierarchyKey = keyof typeof en
/** Russian hierarchy editor dictionary. */
export const ru: Record<HierarchyKey, string> = {
  trigger: 'Иерархия моделей', title: 'Команда моделей',
  description: 'Руководители планируют и проверяют. Исполнители выполняют. Главный ревьюер принимает сложные решения и итоги проекта.',
  enabled: 'Включить по умолчанию во всех проектах', project: 'Включить для этого проекта',
  workers: 'Исполнители', supervisors: 'Руководители', chief: 'Главный ревьюер',
  free: 'Бесплатный маршрут', remove: 'Удалить', add: 'Добавить модель…',
  save: 'Подтвердить и сохранить', cancel: 'Отмена', loading: 'Загрузка моделей…',
  error: 'Не удалось сохранить. Обновите редактор и повторите.', reload: 'Обновить',
  unavailable: 'Настройки недоступны. Сначала включите основной плагин иерархии.',
  required: 'Выберите хотя бы одну модель на каждом уровне.',
  notice: 'Изменения действуют со следующей задачи. Платный резерв разрешён без отдельного лимита расходов. Отметьте бесплатные маршруты вручную: каталог не сообщает цены.',
  pending: 'Нужна настройка', on: 'Вкл', off: 'Выкл', saved: 'Настройки сохранены',
  unavailableModel: 'Недоступна в текущем каталоге',
}
