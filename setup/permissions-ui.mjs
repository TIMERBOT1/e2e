import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getJson, poll, readState as readStandState, unwrapList } from './shared.mjs'
import { fillAdminText, open, responseHas, saveAdminAndWait, setAdminToggle, setAdminToggleIfVisible } from './ui-admin.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(here, '..')
export const permissionsStatePath = resolve(rootDir, '.e2e-permissions-state.json')
const password = process.env.E2E_PERMISSION_USER_PASSWORD || 'E2ePermission1!'

const permissionSets = {
  full: {
    profile: 'Администратор',
    permissions: [
      'canAccessPlaceLineMonitoring',
      'manageAppointments',
      'canViewAppointments',
      'canEditAppointments',
      'manageJournal',
      'canEditPositionsAndAppointmentInJournal',
      'manageTerminals',
      'manageBrands',
      'manageCampaigns',
      'manageMessagesTemplates',
      'manageDataExport',
      'manageGlobalDataExport',
      'manageTranslations',
      'canManageUserAccounts',
      'canViewShop',
      'canUpdateShop',
      'canAddAndDeleteShop',
      'canViewLine',
      'canUpdateLine',
      'canAddAndDeleteLine',
      'canChangeCheckpointWorkScheduleMode',
      'canOpenCheckpoints',
      'canCloseCheckpoints',
      'canStartHiddenCheckpoint',
      'canEditCheckpointWorkingHours',
      'canEditCheckpointServices',
      'canAddAndEditPositions',
      'canAssignCustomServicePoints',
      'canDeletePositions',
      'canValidatePositions',
      'canCallInvalidPositions',
      'canViewPersonalInfo',
      'canListenAudioRecordings',
      'canBookFutureDayToOtherPlacesAtBrand',
      'canBookTodayToOtherPlacesAtBrand'
    ],
    values: {
      viewPositions: 'Все'
    }
  },
  restricted: {
    profile: 'Оператор',
    permissions: ['canViewShop', 'canViewLine'],
    values: {
      viewPositions: 'Все'
    }
  },
  noAccess: {
    profile: 'Оператор',
    permissions: []
  },
  manageUsers: {
    profile: 'Администратор',
    permissions: ['canManageUserAccounts', 'canViewShop', 'canViewLine']
  },
  reduced: {
    profile: 'Оператор',
    permissions: ['canViewShop', 'canViewLine', 'canAccessPlaceLineMonitoring', 'canCloseCheckpoints'],
    values: {
      viewPositions: 'Все'
    }
  },
  suggested: {
    profile: 'Оператор',
    permissions: ['canViewShop', 'canViewLine', 'canAccessPlaceLineMonitoring'],
    values: {
      viewPositions: 'Только предлагаемые'
    }
  }
}

const permissionLabels = {
  canAccessPlaceLineMonitoring: 'Доступ к разделу "Мониторинг очереди"',
  canAddAndDeleteLine: 'Создавать и удалять очереди',
  canAddAndDeleteShop: 'Создавать и удалять места',
  canAddAndEditPositions: 'Добавлять и редактировать позиции',
  canAssignCustomServicePoints: 'Может закреплять позиции за точкой обслуживания',
  canCallInvalidPositions: 'Вызывать без отметки "Готов к обслуживанию"',
  canChangeCheckpointWorkScheduleMode: 'Менять расписание работы точки обслуживания',
  canCloseCheckpoints: 'Закрывать точки обслуживания',
  canDeletePositions: 'Удалять позиции',
  canEditAppointments: 'Создание, удаление и редактирование предварительных записей',
  canEditCheckpointServices: 'Редактировать услуги точки обслуживания',
  canEditPositionsAndAppointmentInJournal: 'Редактировать записи',
  canManageUserAccounts: 'Доступ к разделу "Пользователи"',
  canOpenCheckpoints: 'Запускать точки обслуживания в обычном режиме',
  canStartHiddenCheckpoint: 'Запускать точки обслуживания в скрытом режиме',
  canEditCheckpointWorkingHours: 'Редактировать рабочее время точки обслуживания',
  canUpdateLine: 'Редактирование настроек очереди',
  canUpdateShop: 'Редактирование настроек места',
  canValidatePositions: 'Показывать "Готов к обслуживанию"',
  canViewAppointments: 'Просмотр предварительных записей',
  canViewLine: 'Доступ к разделу "Настройки очереди"',
  canViewPersonalInfo: 'Просмотр персональных данных позиции',
  canViewShop: 'Доступ к разделу "Настройки места"',
  canListenAudioRecordings: 'Прослушивать аудиозаписи',
  canBookFutureDayToOtherPlacesAtBrand: 'Разрешить предварительную запись в другие места в рамках организации',
  canBookTodayToOtherPlacesAtBrand: 'Разрешить запись на сегодня в другие места в рамках организации',
  manageAppointments: 'Доступ к разделу "Бронирования"',
  manageBrands: 'Доступ к разделу "Организации"',
  manageCampaigns: 'Доступ к разделу "Рекламные кампании"',
  manageDataExport: 'Доступ к разделу "Выгрузка данных"',
  manageGlobalDataExport: 'Доступ к разделу "Отчеты"',
  manageJournal: 'Доступ к разделу "Журнал записей"',
  manageMessagesTemplates: 'Доступ к разделу "Шаблоны сообщений"',
  manageTerminals: 'Доступ к разделу "Терминалы"',
  manageTranslations: 'Доступ к разделу "Переводы"'
}
const optionalPermissionControls = new Set(['canEditCheckpointWorkingHours'])
const resetPermissions = [
  'canViewPersonalInfo',
  'canAddAndEditPositions',
  'canDeletePositions',
  'canValidatePositions',
  'canCallInvalidPositions',
  'canOpenCheckpoints',
  'canCloseCheckpoints',
  'canStartHiddenCheckpoint',
  'canChangeCheckpointWorkScheduleMode',
  'canEditCheckpointWorkingHours',
  'canEditCheckpointServices',
  'canAccessPlaceLineMonitoring',
  'manageAppointments',
  'manageDataExport',
  'manageGlobalDataExport',
  'manageJournal',
  'manageCampaigns',
  'manageBrands',
  'manageTerminals',
  'manageMessagesTemplates',
  'manageTranslations',
  'canManageUserAccounts',
  'canViewShop',
  'canAddAndDeleteShop',
  'canUpdateShop',
  'canViewLine',
  'canAddAndDeleteLine',
  'canUpdateLine',
  'canViewAppointments',
  'canEditAppointments',
  'canListenAudioRecordings',
  'canBookFutureDayToOtherPlacesAtBrand',
  'canBookTodayToOtherPlacesAtBrand',
  'canEditPositionsAndAppointmentInJournal'
]

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function readPermissionsState() {
  if (!existsSync(permissionsStatePath)) throw new Error(`Permissions state not found: ${permissionsStatePath}`)
  return JSON.parse(readFileSync(permissionsStatePath, 'utf8'))
}

export function savePermissionsState(state) {
  writeFileSync(permissionsStatePath, `${JSON.stringify(state, null, 2)}\n`)
}

export function removePermissionsState() {
  rmSync(permissionsStatePath, { force: true })
}

export function readRequiredStandState() {
  try {
    return readStandState()
  } catch (error) {
    throw new Error(`${error.message} permissions:prepare needs an existing stand state, or run setup/cycle-permissions.mjs.`)
  }
}

function emailFor(runId, key) {
  return `perm-${key}-${runId.replace(/[^a-z0-9]/gi, '').slice(-12).toLowerCase()}@example.com`
}

async function findUser(page, adminUrl, email) {
  const users = unwrapList(await getJson(page, adminUrl, '/api/getUserList', { term: email, hideInactive: false }))
  return users.find((user) => String(user.email).toLowerCase() === email.toLowerCase())
}

function isApiPath(response, path, methods = ['GET']) {
  return methods.includes(response.request().method()) && new URL(response.url()).pathname.toLowerCase() === path.toLowerCase()
}

async function selectDropdown(page, label, optionName) {
  await poll(async () => {
    const control = page.locator('.MuiFormControl-root').filter({ hasText: label }).first()
    const combobox = control.getByRole('combobox').first()
    if (!(await combobox.isVisible().catch(() => false))) return false
    await combobox.click()
    const option = page.getByRole('option', { name: new RegExp(escapeRe(optionName)) }).first()
    if (!(await option.isVisible({ timeout: 1_000 }).catch(() => false))) return false
    await option.click()
    return true
  }, `dropdown ${label}`, 30_000)
}

async function reveal(page, title, marker) {
  if (await page.getByText(marker, { exact: true }).first().isVisible({ timeout: 1_000 }).catch(() => false)) return
  await page.getByText(title, { exact: true }).first().click()
  await page.getByText(marker, { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 })
}

async function revealPermissionAccordions(page) {
  const sections = [
    ['Разрешить запись во все места в рамках организации', 'Разрешить предварительную запись в другие места в рамках организации'],
    ['Действия с позицией', 'Просмотр персональных данных позиции'],
    ['Действия с предварительной записью', 'Просмотр предварительных записей'],
    ['Доступ к разделам', 'Запускать точки обслуживания в обычном режиме']
  ]

  for (const [title, marker] of sections) {
    if (await page.getByText(marker, { exact: true }).first().isVisible({ timeout: 500 }).catch(() => false)) continue
    await page.getByText(title, { exact: true }).first().click({ timeout: 1_000 }).catch(() => {})
    await page.getByText(marker, { exact: true }).first().waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {})
  }
}

async function addShop(page, shopName) {
  const section = page.locator('[data-test="UserEdit-ShopsFormHeader"]')
  await section.waitFor({ state: 'visible', timeout: 30_000 })

  if (await section.getByText(shopName, { exact: true }).isVisible({ timeout: 1_000 }).catch(() => false)) return

  const addButton = section.locator('#addToList')
  if (!(await addButton.isVisible({ timeout: 1_000 }).catch(() => false))) {
    await section.getByText('Места', { exact: true }).first().click()
    if (await section.getByText(shopName, { exact: true }).isVisible({ timeout: 1_000 }).catch(() => false)) return
    await addButton.waitFor({ state: 'visible', timeout: 10_000 })
  }

  const input = section.locator('input').first()
  await input.fill(shopName)
  await page.getByRole('option', { name: shopName, exact: true }).click()
  await poll(() => addButton.isEnabled().catch(() => false), `shop ${shopName} selected`, 30_000)
  await addButton.click()
  await poll(() => section.getByText(shopName, { exact: true }).isVisible().catch(() => false), `shop ${shopName} linked`, 30_000)
}

async function setPermissionSet(page, set) {
  await reveal(page, 'Права и доступ', 'Активен')
  await setAdminToggle(page, 'Активен', true)
  await selectDropdown(page, 'Тип пользователя', set.profile)
  await revealPermissionAccordions(page)

  for (const name of resetPermissions) {
    if (permissionLabels[name]) await setAdminToggleIfVisible(page, permissionLabels[name], false)
  }

  for (const name of set.permissions) {
    if (optionalPermissionControls.has(name)) {
      await setAdminToggleIfVisible(page, permissionLabels[name], true)
    } else {
      await setAdminToggle(page, permissionLabels[name], true)
    }
  }

  if (set.values?.viewPositions) {
    await selectDropdown(page, 'Просмотр позиций в мониторинге точки обслуживания', set.values.viewPositions)
  }
}

async function hasPermissionLabel(page, label) {
  return page.evaluate((label) => {
    const norm = (text) => (text || '').replace(/\s+/g, ' ').trim()
    return [...document.querySelectorAll('label, p, span, div')].some((element) => norm(element.textContent).includes(label))
  }, label)
}

export async function validatePermissionControls(page, adminUrl) {
  await open(page, adminUrl, '/users/create')
  await reveal(page, 'Права и доступ', 'Активен')
  await selectDropdown(page, 'Тип пользователя', 'Администратор')
  await revealPermissionAccordions(page)
  await setAdminToggle(page, permissionLabels.manageJournal, true)
  await setAdminToggle(page, permissionLabels.canAddAndEditPositions, true)

  const requiredPermissions = new Set(Object.values(permissionSets).flatMap((set) => set.permissions))
  const missing = []

  for (const name of requiredPermissions) {
    const label = permissionLabels[name]
    if (!label || (!optionalPermissionControls.has(name) && !(await hasPermissionLabel(page, label)))) {
      missing.push(`${name}${label ? ` (${label})` : ''}`)
    }
  }

  if (missing.length) {
    throw new Error(`Admin UI is missing permission controls: ${missing.join(', ')}`)
  }
}

export async function createPermissionUser(page, adminUrl, stand, key) {
  const set = permissionSets[key]
  const email = emailFor(stand.runId, key)
  const stale = await findUser(page, adminUrl, email)
  if (stale) await deletePermissionUser(page, adminUrl, { id: stale.id, email })

  await open(page, adminUrl, '/users/create')
  await fillAdminText(page, 'Имя', `E2E ${key}`)
  await fillAdminText(page, 'Фамилия', 'Permissions')
  await fillAdminText(page, 'Адрес электронной почты', email)
  await fillAdminText(page, 'Описание', `E2E permissions ${stand.runId} ${key}`)
  await fillAdminText(page, 'Пароль', password)
  await fillAdminText(page, 'Подтвердите пароль', password)
  await setPermissionSet(page, set)
  await addShop(page, stand.place.name)
  await saveAdminAndWait(page, '/api/createUser')

  const user = await poll(() => findUser(page, adminUrl, email), `created permission user ${email}`, 30_000)
  return {
    id: Number(user.id),
    email,
    password,
    permissionSet: key,
    permissionSetNames: set.permissions
  }
}

export async function deletePermissionUser(page, adminUrl, user) {
  const existing = await findUser(page, adminUrl, user.email)
  if (!existing) {
    console.log(`[permissions:cleanup] user not found: ${user.email}`)
    return
  }

  const getUser = page.waitForResponse((response) => isApiPath(response, '/api/getUser'), { timeout: 30_000 })
  await open(page, adminUrl, `/users/${existing.id}/edit`)
  await getUser
  await page.locator('[data-test="UserEdit-DeleteButton"]').click()
  const deleted = page.waitForResponse((response) => responseHas(response, '/api/deleteUser', ['DELETE']), { timeout: 30_000 })
  await page.getByRole('button', { name: /^Удалить$/i }).last().click()
  await deleted
  await poll(async () => !(await findUser(page, adminUrl, user.email)), `deleted permission user ${user.email}`, 30_000)
}

export async function createPermissionUsers(page, adminUrl, stand = readRequiredStandState()) {
  const state = {
    runId: stand.runId,
    place: stand.place,
    users: {}
  }
  savePermissionsState(state)

  for (const key of ['full', 'restricted', 'noAccess', 'manageUsers', 'reduced', 'suggested']) {
    state.users[key] = await createPermissionUser(page, adminUrl, stand, key)
    savePermissionsState(state)
  }

  return state
}

export async function cleanupPermissionUsers(page, adminUrl, state = readPermissionsState()) {
  for (const user of Object.values(state.users || {}).reverse()) {
    await deletePermissionUser(page, adminUrl, user)
  }
  removePermissionsState()
}
