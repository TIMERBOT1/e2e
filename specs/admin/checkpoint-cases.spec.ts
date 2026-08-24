import { expect, Page, test } from '@playwright/test'
import {
  createLineMonitoringPosition,
  expectPositionAbsentFromLineMonitoring,
  inspectTodayAppointmentSlots,
  loginAdmin
} from '../../setup/admin-line-monitoring.mjs'
import {
  api,
  createCheckpoint,
  getJson,
  loadEnv,
  poll,
  readState,
  requiredEnv,
  saveState,
  unwrapList
} from '../../setup/shared.mjs'
import {
  createUiCheckpoint,
  open,
  responseHas
} from '../../setup/ui-admin.mjs'

type PreparedCheckpoint = {
  id: number
  name: string
}

type CheckpointScenario = {
  key: string
  shopId: number
  lineId: number
  lineName: string
  serviceId: number
  serviceName: string
  checkpointId: number
  checkpointName: string
  checkpoints?: PreparedCheckpoint[]
  reservedPositionIds?: number[]
}

type StandState = {
  runId: string
  scenarios: Record<string, CheckpointScenario>
}

type StartMode = 'fixed' | 'lineSchedule'

function adminUrl() {
  loadEnv()
  return requiredEnv('ADMIN_URL')
}

function scenario() {
  const item = (readState() as StandState).scenarios.stoppedCheckpoint
  expect(item, 'Scenario stoppedCheckpoint is missing in stand state').toBeTruthy()
  return item
}

function caseKey(caseId: number) {
  return `tc${caseId}-${String(Date.now()).slice(-6)}`
}

function registerCheckpoint(checkpoint: PreparedCheckpoint) {
  const state = readState() as StandState
  const item = state.scenarios.stoppedCheckpoint
  const checkpoints = item.checkpoints?.length
    ? item.checkpoints
    : [{ id: item.checkpointId, name: item.checkpointName }]

  if (!checkpoints.some((candidate) => candidate.id === checkpoint.id)) checkpoints.push(checkpoint)
  item.checkpoints = checkpoints
  saveState(state)
}

function registerPosition(positionId: number, scenarioKey = 'stoppedCheckpoint') {
  const state = readState() as StandState
  const item = state.scenarios[scenarioKey]
  expect(item, `Scenario ${scenarioKey} is missing in stand state`).toBeTruthy()
  item.reservedPositionIds = [...new Set([...(item.reservedPositionIds || []), positionId])]
  saveState(state)
}

async function checkpointList(page: Page, item = scenario()) {
  return unwrapList(
    await getJson(page, adminUrl(), '/api/GetCheckpointList', {
      shopId: item.shopId,
      lineId: item.lineId
    })
  )
}

async function checkpointById(page: Page, checkpointId: number, item = scenario()) {
  return (await checkpointList(page, item)).find((candidate) => Number(candidate.id) === checkpointId)
}

async function createFixtureCheckpoint(page: Page, caseId: number) {
  const item = scenario()
  const created = await createCheckpoint(page, adminUrl(), item.shopId, item.lineId, readState().runId, caseKey(caseId))
  const checkpoint = { id: Number(created?.id), name: String(created?.name) }

  expect(checkpoint.id, `TC-${caseId} fixture checkpoint id`).toBeGreaterThan(0)
  registerCheckpoint(checkpoint)
  return checkpoint
}

async function clickStartAction(page: Page) {
  const byTest = page.locator('[data-test="CheckpointHost-Action-start"]')
  if (await byTest.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await byTest.click({ force: true })
    return
  }

  const fallback = page.getByRole('button').filter({ hasText: 'Обычный режим' }).first()
  await expect(fallback).toBeVisible({ timeout: 10_000 })
  await fallback.click({ force: true })
}

async function clickStopAction(page: Page) {
  const legacy = page.locator('[data-test="CheckpointHost-Mode-Stop"]')
  if (await legacy.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await legacy.click({ force: true })
    return
  }

  const fallback = page.getByRole('button').filter({ hasText: 'Выключена' }).first()
  await expect(fallback).toBeVisible({ timeout: 10_000 })
  await fallback.click({ force: true })
}

async function openCheckpointHost(page: Page, checkpoint: PreparedCheckpoint, item = scenario()) {
  await poll(async () => {
    await open(page, adminUrl(), `/shops/${item.shopId}/lines/${item.lineId}/checkpoints/${checkpoint.id}/host`)
    return page.locator('[data-test="CheckpointHost-WorkScheduleCard"]').isVisible().catch(() => false)
  }, `checkpoint host form ${checkpoint.name}`, 30_000)
}

async function fillControl(page: Page, testId: string, value: string) {
  const control = page.locator(`[data-test="${testId}"]`).first()
  await expect(control).toBeVisible({ timeout: 30_000 })
  const input = control.locator('input, textarea').first()
  const target = (await input.count()) ? input : control
  await target.click()
  await target.press('ControlOrMeta+A')
  await target.fill(value).catch(async () => {
    await page.keyboard.type(value)
  })
  await target.press('Tab')
}

function timeText(offsetMinutes: number) {
  return standClock(new Date(Date.now() + offsetMinutes * 60_000))
}

function clockText(date: Date) {
  return standClock(date)
}

function standClock(date: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yekaterinburg',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date)
}

async function fillWorkTime(page: Page, testId: string, index: number, value: string) {
  const byTest = page.locator(`[data-test="${testId}"]`).first()
  if (await byTest.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await fillControl(page, testId, value)
    return
  }

  const input = page.getByRole('textbox', { name: 'HH:mm' }).nth(index)
  await expect(input).toBeVisible({ timeout: 30_000 })
  await input.fill(value)
  await input.press('Tab')
}

async function selectAllServices(page: Page) {
  const control = page.locator('[data-test="CheckpointHost-AllServices"]')
  await expect(control).toBeVisible({ timeout: 30_000 })
  if ((await control.textContent())?.trim() === 'Выбрать все') await control.click()
}

async function setAllDay(page: Page, desired: boolean) {
  const control = page.locator('[data-test="CheckpointHost-IsAnyHourOpened"]')
  await expect(control).toBeVisible({ timeout: 30_000 })
  const switchControl = control.getByRole('switch').or(control.locator('input[type="checkbox"]')).first()
  const checked = await switchControl.isChecked()
  if (checked !== desired) await switchControl.click()
}

async function applyHostSettings(page: Page) {
  const responsePromise = page.waitForResponse(
    (response) => responseHas(response, '/api/updateCheckpointHost', ['PUT']),
    { timeout: 30_000 }
  )
  await page.locator('[data-test="CheckpointHost-ApplyButton"]').click()
  const response = await responsePromise
  expect(response.ok(), `updateCheckpointHost failed with ${response.status()}`).toBe(true)
}

async function startCheckpoint(
  page: Page,
  checkpoint: PreparedCheckpoint,
  mode: StartMode,
  schedule?: { allDay?: boolean; start?: string; end?: string }
) {
  const item = scenario()
  await openCheckpointHost(page, checkpoint, item)
  await clickStartAction(page)
  await page.locator(`[data-test="CheckpointHost-WorkScheduleMode-${mode}"]`).click()

  if (mode === 'fixed') {
    const allDay = schedule?.allDay ?? false
    await setAllDay(page, allDay)
    if (!allDay) {
      await fillWorkTime(page, 'CheckpointHost-StartTime', 0, schedule?.start || timeText(-5))
      await fillWorkTime(page, 'CheckpointHost-ClosingTime', 1, schedule?.end || timeText(15))
    }
  }

  const reasonControl = page.locator('[data-test="CheckpointHost-ReasonChange"]')
  if (await reasonControl.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await fillControl(page, 'CheckpointHost-ReasonChange', 'Автоматизированный тест: запуск точки обслуживания')
  }

  await selectAllServices(page)
  await applyHostSettings(page)

  return poll(async () => {
    const current = await checkpointById(page, checkpoint.id)
    return ['starting', 'started'].includes(String(current?.status)) ? current : false
  }, `checkpoint ${checkpoint.name} started`, 30_000)
}

async function stopCheckpoint(page: Page, checkpoint: PreparedCheckpoint, reason: string) {
  const item = scenario()
  const current = await checkpointById(page, checkpoint.id)
  if (!current || current.status === 'finished') return

  await openCheckpointHost(page, checkpoint, item)
  await clickStopAction(page)
  const reasonControl = page.locator('[data-test="CheckpointHost-ReasonStop"]')
  if (await reasonControl.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await fillControl(page, 'CheckpointHost-ReasonStop', reason)
  }
  await applyHostSettings(page)

  await poll(
    async () => (await checkpointById(page, checkpoint.id))?.status === 'finished',
    `checkpoint ${checkpoint.name} stopped`,
    30_000
  )
}

async function finishCheckpointApi(page: Page, checkpoint: PreparedCheckpoint) {
  const current = await checkpointById(page, checkpoint.id)
  if (!current || current.status === 'finished') return
  await api(page, adminUrl(), 'post', '/api/finishCheckpoint', checkpoint.id)
  await poll(
    async () => (await checkpointById(page, checkpoint.id))?.status === 'finished',
    `checkpoint ${checkpoint.name} finished through API`,
    30_000
  )
}

async function finishActiveCheckpoints(page: Page) {
  const active = (await checkpointList(page)).filter((checkpoint) =>
    ['starting', 'started'].includes(String(checkpoint.status))
  )

  for (const checkpoint of active) {
    await finishCheckpointApi(page, {
      id: Number(checkpoint.id),
      name: String(checkpoint.name || checkpoint.id)
    })
  }
}

async function openCheckpointEditFromList(page: Page, checkpoint: PreparedCheckpoint) {
  const item = scenario()
  await open(page, adminUrl(), `/shops/${item.shopId}/lines/${item.lineId}/checkpoints`)
  await expect(page.getByText(checkpoint.name, { exact: true })).toBeVisible({ timeout: 30_000 })
  const action = page.locator(`[data-test="EditItemButton-Id-${checkpoint.id}"]`)
  if (await action.isVisible({ timeout: 2_000 }).catch(() => false)) await action.click()
  else await open(page, adminUrl(), `/shops/${item.shopId}/lines/${item.lineId}/checkpoints/${checkpoint.id}/edit`)
  await expect(page.locator('[data-test="CheckpointEdit-Name"]')).toBeVisible({ timeout: 30_000 })
}

async function clickPositionAction(page: Page, label: string) {
  const action = page.getByText(label, { exact: true }).first()
  await expect(action).toBeVisible({ timeout: 30_000 })
  const responsePromise = page.waitForResponse(
    (response) => responseHas(response, '/api/changePositionState', ['POST']),
    { timeout: 30_000 }
  )
  await action.click()

  const yes = page.getByRole('button', { name: /^Да$/i }).last()
  if (await yes.isVisible({ timeout: 2_000 }).catch(() => false)) await yes.click()
  const confirm = page.getByRole('button', { name: /^Подтвердить$/i }).last()
  if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await confirm.click({ force: true, timeout: 10_000 }).catch(async () => {
      const current = page.getByRole('button', { name: /^Подтвердить$/i }).last()
      if (await current.isVisible({ timeout: 2_000 }).catch(() => false)) await current.dispatchEvent('click')
    })
  }

  const response = await responsePromise
  expect(response.ok(), `${label}: changePositionState failed with ${response.status()}`).toBe(true)
}

async function validatePosition(page: Page) {
  const action = page.getByText('Готов к обслуживанию', { exact: true }).first()
  await expect(action).toBeVisible({ timeout: 30_000 })
  const responsePromise = page.waitForResponse(
    (response) => responseHas(response, '/api/validatePosition', ['POST']),
    { timeout: 30_000 }
  )
  await action.click()
  const response = await responsePromise
  expect(response.ok(), `validatePosition failed with ${response.status()}`).toBe(true)
}

async function expectPositionActionDisabled(page: Page, label: string) {
  const action = page.getByText(label, { exact: true }).last()
  const container = action.locator('xpath=ancestor::div[contains(@class,"positionAction")][1]')
  await expect(container).toHaveClass(/disabled|current/, { timeout: 30_000 })
}

async function startHiddenCheckpoint(page: Page, checkpoint: PreparedCheckpoint) {
  await openCheckpointHost(page, checkpoint)
  const action = page.locator('[data-test="CheckpointHost-Action-startHidden"]')
  await expect(action).toBeVisible({ timeout: 30_000 })
  await action.click()

  await page.locator('[data-test="CheckpointHost-WorkScheduleMode-fixed"]').click()
  await setAllDay(page, false)
  await fillWorkTime(page, 'CheckpointHost-StartTime', 0, timeText(-5))
  await fillWorkTime(page, 'CheckpointHost-ClosingTime', 1, timeText(60))
  const hiddenReason = page.locator('[data-test="CheckpointHost-ReasonHiddenStart"]')
  if (await hiddenReason.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await fillControl(page, 'CheckpointHost-ReasonHiddenStart', 'TC-73: скрытый запуск')
  }
  await selectAllServices(page)

  const allowCreatePosition = page.locator('[data-test="CheckpointHost-HiddenStartAllowCreatePosition"]')
  if (await allowCreatePosition.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const input = allowCreatePosition.locator('input[type="checkbox"]').first()
    if ((await input.count()) && !(await input.isChecked())) await input.check()
    if (await input.count()) await expect(input).toBeChecked()
  }

  await applyHostSettings(page)
  return poll(async () => {
    const current = await checkpointById(page, checkpoint.id)
    return current?.status === 'started' && current?.isHidden === true ? current : false
  }, `hidden checkpoint ${checkpoint.name} started`, 30_000)
}

async function expectHiddenCheckpointServices(page: Page, checkpoint: PreparedCheckpoint, serviceId: number) {
  await poll(async () => {
    const body = await getJson(page, adminUrl(), '/api/getCheckpointMonitoring', { id: checkpoint.id })
    const data = body?.data || body
    const enabledServices = (data?.enabledServices || []).map((service) => Number(service?.id ?? service))
    return enabledServices.includes(Number(serviceId))
  }, `service ${serviceId} enabled for hidden checkpoint ${checkpoint.name}`, 30_000)
}

async function completePositionAtCheckpoint(
  page: Page,
  checkpoint: PreparedCheckpoint,
  positionId: number,
  person: { lastName: string }
) {
  const item = scenario()
  const monitoringResponse = page.waitForResponse(
    (response) => responseHas(response, '/api/getCheckpointNightClubMonitoring', ['GET']),
    { timeout: 30_000 }
  )
  await open(
    page,
    adminUrl(),
    `/shops/${item.shopId}/lines/${item.lineId}/checkpoints/${checkpoint.id}/monitoring`
  )
  await monitoringResponse

  const position = page.getByText(person.lastName, { exact: false }).first()
  await expect(position, `Position ${positionId} must be visible at hidden checkpoint`).toBeVisible({ timeout: 30_000 })
  await position.click({ force: true })

  await validatePosition(page)
  await expectPositionActionDisabled(page, 'Готов к обслуживанию')
  await clickPositionAction(page, 'Вызвать')
  await expectPositionActionDisabled(page, 'Вызвать')
  await clickPositionAction(page, 'Начать обслуживание')
  await expectPositionActionDisabled(page, 'Начать обслуживание')
  await clickPositionAction(page, 'Закончить обслуживание')
}

async function removePositionIfPresent(
  page: Page,
  item: CheckpointScenario,
  checkpoint: PreparedCheckpoint,
  positionId: number
) {
  await api(page, adminUrl(), 'post', '/api/changePositionState', {
    shopId: item.shopId,
    lineId: item.lineId,
    checkpointId: checkpoint.id,
    positionId,
    newState: 'removed'
  }).catch(() => undefined)
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

test('TC-31 creates a service point', async ({ page }) => {
  const item = scenario()
  await loginAdmin(page)

  const checkpoint = await createUiCheckpoint(
    page,
    adminUrl(),
    item.shopId,
    item.lineId,
    readState().runId,
    caseKey(31)
  )
  const created = { id: Number(checkpoint.id), name: checkpoint.name }
  registerCheckpoint(created)

  await expect(page.getByText(created.name, { exact: true })).toBeVisible({ timeout: 30_000 })
  expect(await checkpointById(page, created.id)).toMatchObject({ id: String(created.id), name: created.name })
})

test('TC-32 deletes a service point', async ({ page }) => {
  await loginAdmin(page)
  const checkpoint = await createFixtureCheckpoint(page, 32)
  await openCheckpointEditFromList(page, checkpoint)

  await page.locator('[data-test="CheckpointEdit-DeleteButton"]').click()
  await expect(page.getByText('Вы действительно хотите удалить?')).toBeVisible({ timeout: 10_000 })
  const responsePromise = page.waitForResponse(
    (response) => responseHas(response, '/api/deleteCheckpoint', ['DELETE']),
    { timeout: 30_000 }
  )
  await page.getByRole('button', { name: /^Удалить$/i }).last().click()
  const response = await responsePromise
  expect(response.ok(), `deleteCheckpoint failed with ${response.status()}`).toBe(true)
  await expect.poll(async () => Boolean(await checkpointById(page, checkpoint.id))).toBe(false)
})

test('TC-33 edits a service point', async ({ page }) => {
  await loginAdmin(page)
  const checkpoint = await createFixtureCheckpoint(page, 33)
  await openCheckpointEditFromList(page, checkpoint)
  const updatedName = `E2E tc33 ${String(Date.now()).slice(-6)}`.slice(0, 20)
  const updatedDescription = `TC-33 updated ${new Date().toISOString()}`

  await fillControl(page, 'CheckpointEdit-Name', updatedName)
  await fillControl(page, 'CheckpointEdit-Description', updatedDescription)
  const responsePromise = page.waitForResponse(
    (response) => responseHas(response, '/api/updateCheckpoint', ['PUT']),
    { timeout: 30_000 }
  )
  await page.locator('[data-test="CheckpointEdit-UpdateButton"]').click()
  const response = await responsePromise
  expect(response.ok(), `updateCheckpoint failed with ${response.status()}`).toBe(true)

  await expect(page.getByText(updatedName, { exact: true })).toBeVisible({ timeout: 30_000 })
  expect(await checkpointById(page, checkpoint.id)).toMatchObject({ name: updatedName, description: updatedDescription })
})

test('TC-34 starts a service point with supported work modes', async ({ page }) => {
  await loginAdmin(page)
  const checkpoint = await createFixtureCheckpoint(page, 34)

  try {
    const immediate = await startCheckpoint(page, checkpoint, 'fixed', { allDay: true })
    expect(immediate.status).toBe('started')
    await stopCheckpoint(page, checkpoint, 'TC-34: завершена проверка запуска сейчас')

    const fixed = await startCheckpoint(page, checkpoint, 'fixed', {
      start: timeText(-5),
      end: timeText(15)
    })
    expect(fixed.status).toBe('started')
    expect(fixed.workScheduleMode).toBe('fixed')
    await stopCheckpoint(page, checkpoint, 'TC-34: завершена проверка установленных часов')

    const lineSchedule = await startCheckpoint(page, checkpoint, 'lineSchedule')
    expect(lineSchedule.status).toBe('started')
    expect(lineSchedule.workScheduleMode).toBe('lineSchedule')
  } finally {
    await stopCheckpoint(page, checkpoint, 'TC-34: завершение теста').catch(() => {})
  }
})

test('TC-35 edits settings while a service point is active', async ({ page }) => {
  await loginAdmin(page)
  const checkpoint = await createFixtureCheckpoint(page, 35)

  try {
    await startCheckpoint(page, checkpoint, 'lineSchedule')
    const item = scenario()
    await open(page, adminUrl(), `/shops/${item.shopId}/lines/${item.lineId}/checkpoints/${checkpoint.id}/host`)
    await page.locator('[data-test="CheckpointHost-WorkScheduleMode-fixed"]').click()
    await setAllDay(page, true)
    await fillControl(page, 'CheckpointHost-ReasonChange', 'TC-35: изменение параметров активной точки')
    await applyHostSettings(page)

    const changed = await poll(async () => {
      const current = await checkpointById(page, checkpoint.id)
      return current?.status === 'started' && current?.workScheduleMode === 'fixed' ? current : false
    }, 'active checkpoint settings changed', 30_000)
    expect(changed.status).toBe('started')
  } finally {
    await stopCheckpoint(page, checkpoint, 'TC-35: завершение теста').catch(() => {})
  }
})

test('TC-36 stops an active service point with a reason', async ({ page }) => {
  await loginAdmin(page)
  const checkpoint = await createFixtureCheckpoint(page, 36)
  await startCheckpoint(page, checkpoint, 'lineSchedule')
  await stopCheckpoint(page, checkpoint, 'TC-36: плановое завершение работы')

  const stopped = await checkpointById(page, checkpoint.id)
  expect(stopped?.status).toBe('finished')
  await open(page, adminUrl(), `/shops/${scenario().shopId}/lines/${scenario().lineId}/checkpoints`)
  await expect(page.getByText(/^Выключена(?: |$)/).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
})

test('TC-39 starts a service point before its scheduled opening', async ({ page }) => {
  test.setTimeout(300_000)
  await loginAdmin(page)
  const checkpoint = await createFixtureCheckpoint(page, 39)

  try {
    const openingOffset = 2
    const openingTime = new Date(Date.now() + openingOffset * 60_000)
    const scheduled = await startCheckpoint(page, checkpoint, 'fixed', {
      start: clockText(openingTime),
      end: timeText(10)
    })
    expect(scheduled.status).toBe('started')
    expect(Number(scheduled.operatingFrom)).toBeGreaterThan(Date.now())

    await open(
      page,
      adminUrl(),
      `/shops/${scenario().shopId}/lines/${scenario().lineId}/checkpoints/${checkpoint.id}/monitoring`
    )
    const inactive = page.getByText(/Точка обслуживания (?:закрыта|выключена)/i).first()
    await expect(inactive).toBeVisible({ timeout: 30_000 })
    const openingWait = Math.max(10_000, openingTime.getTime() + 12_000 - Date.now())
    await poll(() => Date.now() > openingTime.getTime() + 2_000, 'scheduled opening time reached', openingWait)
    await poll(async () => {
      await open(
        page,
        adminUrl(),
        `/shops/${scenario().shopId}/lines/${scenario().lineId}/checkpoints/${checkpoint.id}/monitoring`
      )
      return !(await inactive.isVisible().catch(() => false))
    }, 'service point became active after scheduled opening', 90_000)
    await expect(page.getByText('Нет предложений', { exact: true })).toBeVisible({ timeout: 30_000 })
  } finally {
    await finishCheckpointApi(page, checkpoint).catch(() => {})
  }
})

test('TC-53 completes the full position service cycle at a service point', async ({ page }) => {
  const item = (readState() as StandState).scenarios.asap
  expect(item, 'Scenario asap is missing in stand state').toBeTruthy()
  const checkpoint = { id: item.checkpointId, name: item.checkpointName }
  const suffix = String(Date.now()).slice(-6)
  const person = {
    firstName: 'Checkpoint',
    lastName: 'Etestcheckpoint',
    phone: `+7900${String(Date.now()).slice(-7)}`,
    email: `tc53-${suffix}@example.com`
  }
  let positionId = 0

  await loginAdmin(page)
  try {
    const activeCheckpoint = await checkpointById(page, checkpoint.id, item)
    expect(activeCheckpoint?.status).toBe('started')
    positionId = await createLineMonitoringPosition(page, item, 'asap', person)
    registerPosition(positionId, 'asap')

    const monitoringResponse = page.waitForResponse(
      (response) => responseHas(response, '/api/getCheckpointNightClubMonitoring', ['GET']),
      { timeout: 30_000 }
    )
    await open(
      page,
      adminUrl(),
      `/shops/${item.shopId}/lines/${item.lineId}/checkpoints/${checkpoint.id}/monitoring`
    )
    await monitoringResponse

    const position = page.getByText(person.lastName, { exact: false }).first()
    await expect(position).toBeVisible({ timeout: 30_000 })
    await position.click({ force: true })

    await validatePosition(page)
    await expectPositionActionDisabled(page, 'Готов к обслуживанию')
    await clickPositionAction(page, 'Вызвать')
    await expectPositionActionDisabled(page, 'Вызвать')
    await expect(page.getByText('Начать обслуживание', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
    await clickPositionAction(page, 'Начать обслуживание')
    await expectPositionActionDisabled(page, 'Начать обслуживание')
    await clickPositionAction(page, 'Закончить обслуживание')
    await expectPositionAbsentFromLineMonitoring(page, item, positionId)
  } finally {
    if (positionId) {
      await api(page, adminUrl(), 'post', '/api/changePositionState', {
        shopId: item.shopId,
        lineId: item.lineId,
        checkpointId: checkpoint.id,
        positionId,
        newState: 'removed'
      }).catch(() => {})
    }
  }
})

test('TC-73 starts a hidden service point without adding booking capacity', async ({ page }) => {
  test.setTimeout(300_000)
  const item = scenario()
  const suffix = String(Date.now()).slice(-6)
  const person = {
    firstName: 'Hidden',
    lastName: 'Hiddencheckpoint',
    phone: `+7900${String(Date.now()).slice(-7)}`,
    email: `tc73-${suffix}@example.com`
  }
  let hiddenCheckpoint: PreparedCheckpoint | undefined
  let normalCheckpoint: PreparedCheckpoint | undefined
  let positionId = 0

  await loginAdmin(page)
  await finishActiveCheckpoints(page)
  hiddenCheckpoint = await createFixtureCheckpoint(page, 73)
  const normalFixture = await createUiCheckpoint(
    page,
    adminUrl(),
    item.shopId,
    item.lineId,
    readState().runId,
    caseKey(730)
  )
  normalCheckpoint = { id: Number(normalFixture.id), name: normalFixture.name }
  registerCheckpoint(normalCheckpoint)

  try {
    const hidden = await startHiddenCheckpoint(page, hiddenCheckpoint)
    expect(hidden.status).toBe('started')
    expect(hidden.isHidden).toBe(true)
    await expectHiddenCheckpointServices(page, hiddenCheckpoint, item.serviceId)

    const hiddenOnlySlots = await inspectTodayAppointmentSlots(page, item)
    expect(hiddenOnlySlots.times).toEqual([])
    expect(hiddenOnlySlots.addPositionVisible).toBe(false)

    const normal = await startCheckpoint(page, normalCheckpoint, 'fixed', { allDay: true })
    expect(normal.status).toBe('started')
    expect(normal.isHidden).not.toBe(true)

    const availableSlots = await poll(async () => {
      const slots = await inspectTodayAppointmentSlots(page, item)
      return slots.addPositionVisible && slots.times.length ? slots : false
    }, 'today slots available through line monitoring', 30_000)
    expect(availableSlots.times.length).toBeGreaterThan(0)

    positionId = await createLineMonitoringPosition(page, item, 'timed', person)
    registerPosition(positionId)
    await completePositionAtCheckpoint(page, hiddenCheckpoint, positionId, person)
    await expectPositionAbsentFromLineMonitoring(page, item, positionId)
  } finally {
    if (positionId && hiddenCheckpoint) {
      await removePositionIfPresent(page, item, hiddenCheckpoint, positionId)
    }
    if (normalCheckpoint) {
      await stopCheckpoint(page, normalCheckpoint, 'TC-73: завершение обычной точки').catch(() => {})
    }
    if (hiddenCheckpoint) {
      await stopCheckpoint(page, hiddenCheckpoint, 'TC-73: завершение скрытой точки').catch(() => {})
    }
  }
})
