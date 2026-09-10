import type { Page } from '@playwright/test'
import { expect, test } from '../../setup/e2e-test-fixture'
import { loginAdmin } from '../../setup/admin-line-monitoring.mjs'
import {
  api,
  createStaffManagementRecord,
  getJson,
  loadEnv,
  readState,
  requiredEnv,
  saveState,
  unwrapData,
  unwrapList
} from '../../setup/shared.mjs'
import {
  fillAdminText,
  fillAdminTime,
  jsonOrEmpty,
  open,
  responseHas,
  setAdminToggle
} from '../../setup/ui-admin.mjs'

type StaffScenario = {
  shopId: number
  lineId: number
  serviceId: number
  serviceName: string
  serviceIds: number[]
  serviceNames: string[]
  checkpointId: number
  staffManagementIds?: number[]
}

type StandState = {
  runId: string
  scenarios: Record<string, StaffScenario>
}

type ScheduleExpectation = {
  date: string
  numberOfStaff: number
  startTime: string
  endTime: string
  pauseStart: string
  pauseEnd: string
  serviceId: number
  comment: string
}

type TimeSlotExpectation = {
  date: string
  serviceName: string
  visibleTimes?: string[]
  hiddenTimes?: string[]
  none?: boolean
}

function adminUrl() {
  loadEnv()
  return requiredEnv('ADMIN_URL')
}

function scenario() {
  const item = (readState() as StandState).scenarios.bulkDisable
  expect(item, 'Scenario bulkDisable is missing in stand state').toBeTruthy()
  expect(item.serviceIds?.length, 'Staff schedule scenario must contain two services').toBeGreaterThanOrEqual(2)
  return item
}

function dateInput(offsetDays: number) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return [date.getDate(), date.getMonth() + 1, date.getFullYear()]
    .map((part) => String(part).padStart(2, '0'))
    .join('.')
}

function caseComment(caseId: number) {
  return `TC-${caseId} ${readState().runId} ${String(Date.now()).slice(-6)}`
}

function timeMs(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return (hours * 60 + minutes) * 60 * 1000
}

function utcTimeMs(value: number | string) {
  const date = new Date(Number(value))
  return (date.getUTCHours() * 60 + date.getUTCMinutes()) * 60 * 1000
}

function utcDateInput(value: number | string) {
  const date = new Date(Number(value))
  return [date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear()]
    .map((part) => String(part).padStart(2, '0'))
    .join('.')
}

function registerSchedule(id: number) {
  const state = readState() as StandState
  const item = state.scenarios.bulkDisable
  item.staffManagementIds = [...new Set([...(item.staffManagementIds || []), id])]
  saveState(state)
}

function unregisterSchedule(id: number) {
  const state = readState() as StandState
  const item = state.scenarios.bulkDisable
  item.staffManagementIds = (item.staffManagementIds || []).filter((candidate) => Number(candidate) !== Number(id))
  saveState(state)
}

async function deleteSchedule(page: Page, id: number) {
  await api(page, adminUrl(), 'delete', '/api/deleteStaffManagementRecord', id).catch(() => undefined)
  unregisterSchedule(id)
}

async function scheduleList(page: Page) {
  const item = scenario()
  const dayMs = 24 * 60 * 60 * 1000
  return unwrapList(
    await getJson(page, adminUrl(), '/api/getStaffManagement', {
      shopId: item.shopId,
      lineId: item.lineId,
      startDate: Date.now() - dayMs,
      endDate: Date.now() + 10 * dayMs
    })
  )
}

async function scheduleRecord(page: Page, id: number) {
  const item = scenario()
  return unwrapData(
    await getJson(page, adminUrl(), '/api/getStaffManagementRecord', {
      shopId: item.shopId,
      lineId: item.lineId,
      managementId: id
    })
  )
}

async function addPause(page: Page, start: string, end: string) {
  await setAdminToggle(page, 'Установить перерывы', true)
  const addButton = page
    .getByText('Установить перерывы', { exact: true })
    .locator('xpath=following::button[1]')
  await expect(addButton).toBeVisible({ timeout: 30_000 })
  await addButton.click()
  await fillAdminTime(page, 'Начало перерыва', start)
  await fillAdminTime(page, 'Конец перерыва', end)
}

async function fillScheduleForm(page: Page, expected: ScheduleExpectation, serviceName: string) {
  await fillAdminText(page, 'Дата', expected.date)
  await setAdminToggle(page, serviceName, true)
  await fillAdminText(page, 'Количество точек обслуживания', expected.numberOfStaff)
  await fillAdminTime(page, 'Время начала работы', expected.startTime)
  await fillAdminTime(page, 'Время завершения работы', expected.endTime)
  await addPause(page, expected.pauseStart, expected.pauseEnd)
  await fillAdminText(page, 'Комментарий', expected.comment)
}

async function saveSchedule(page: Page, endpoint: string, methods: string[]) {
  const responsePromise = page.waitForResponse((response) => responseHas(response, endpoint, methods), {
    timeout: 30_000
  })
  await page.getByRole('button', { name: /^Сохранить$/i }).first().click()
  const response = await responsePromise
  expect(response.ok(), `${endpoint} failed with ${response.status()}`).toBe(true)
  return jsonOrEmpty(response)
}

async function expectSchedule(page: Page, id: number, expected: ScheduleExpectation) {
  const record = await scheduleRecord(page, id)
  expect(Number(record.id)).toBe(id)
  expect(utcDateInput(record.startDate)).toBe(expected.date)
  expect(Number(record.numberOfStaff)).toBe(expected.numberOfStaff)
  expect(utcTimeMs(record.startHour_unixtime)).toBe(timeMs(expected.startTime))
  expect(utcTimeMs(record.endHour_unixtime)).toBe(timeMs(expected.endTime))
  expect(record.comments).toBe(expected.comment)
  expect((record.servicesSelected || []).map((service) => Number(service.id))).toEqual([expected.serviceId])
  expect(record.pauses).toHaveLength(1)
  expect(utcTimeMs(record.pauses[0].startHour_unixtime)).toBe(timeMs(expected.pauseStart))
  expect(utcTimeMs(record.pauses[0].endHour_unixtime)).toBe(timeMs(expected.pauseEnd))

  const listItem = (await scheduleList(page)).find((candidate) => Number(candidate.id) === id)
  expect(listItem, `Schedule ${id} must be present in staff management list`).toBeTruthy()

  const item = scenario()
  await open(page, adminUrl(), `/shops/${item.shopId}/lines/${item.lineId}/staffManagement`)
  const row = page.getByRole('button').filter({ hasText: expected.comment }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row.getByText(expected.comment, { exact: true })).toBeVisible()
  await expect(row.getByText(expected.startTime, { exact: true })).toBeVisible()
  await expect(row.getByText(expected.endTime, { exact: true })).toBeVisible()
  await expect(row.getByText(`${expected.pauseStart} — ${expected.pauseEnd}`, { exact: true })).toBeVisible()
}

function localSlotDate(value: number | string) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Yekaterinburg'
  }).formatToParts(new Date(Number(value)))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value
  return `${part('day')}.${part('month')}.${part('year')}`
}

function localSlotTime(value: number | string) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Yekaterinburg'
  }).format(new Date(Number(value)))
}

async function closeAppointmentForm(page: Page) {
  await page.keyboard.press('Escape')
  const confirmation = page.getByText('Закрыть без сохранения?', { exact: true })
  if (await confirmation.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await page.getByRole('button', { name: /^Да, закрыть$/i }).click()
  }
  await expect(page.getByText('Создание записи', { exact: true })).toBeHidden({ timeout: 30_000 })
}

async function expectDisplayedTimeSlots(page: Page, expected: TimeSlotExpectation) {
  const item = scenario()
  await open(page, adminUrl(), `/shops/${item.shopId}/lines/${item.lineId}/appointments`)
  const addButton = page.getByRole('button', { name: /^Добавить запись$/i }).first()
  await expect(addButton).toBeVisible({ timeout: 30_000 })
  await addButton.click()
  await expect(page.getByRole('heading', { name: 'Выбор очереди и услуги' })).toBeVisible({ timeout: 30_000 })

  await page.getByText(expected.serviceName, { exact: true }).click()
  const responsePromise = page.waitForResponse(
    (response) => responseHas(response, '/api/positionsManagement/getServiceDateTimes', ['POST']),
    { timeout: 30_000 }
  )
  await page.getByRole('button', { name: /^Далее$/i }).last().click()
  const response = await responsePromise
  expect(response.ok(), `getServiceDateTimes failed with ${response.status()}`).toBe(true)
  const body = await jsonOrEmpty(response)
  const slots = (body?.times || body?.data?.times || [])
    .filter((slot: { startTime: number | string }) => localSlotDate(slot.startTime) === expected.date)
    .map((slot: { startTime: number | string }) => localSlotTime(slot.startTime))

  await expect(page.getByRole('heading', { name: 'Выбор даты и времени' })).toBeVisible({ timeout: 30_000 })

  if (expected.none) {
    expect(slots, `Time slots for ${expected.date} must not be available`).toEqual([])
    await expect(page.getByText('Нет свободного времени для записи', { exact: true })).toBeVisible({ timeout: 30_000 })
    await closeAppointmentForm(page)
    return
  }

  for (const time of expected.visibleTimes || []) {
    expect(slots, `Time slot ${time} must be returned for ${expected.date}`).toContain(time)
    await expect(page.getByText(time, { exact: true })).toBeVisible({ timeout: 30_000 })
  }
  for (const time of expected.hiddenTimes || []) {
    expect(slots, `Time slot ${time} must not be returned for ${expected.date}`).not.toContain(time)
    await expect(page.getByText(time, { exact: true })).toHaveCount(0)
  }
  await closeAppointmentForm(page)
}

test.setTimeout(120_000)

test('TC-41 creates an employee schedule', async ({ page }) => {
  const item = scenario()
  const expected: ScheduleExpectation = {
    date: dateInput(2),
    numberOfStaff: 2,
    startTime: '09:00',
    endTime: '18:00',
    pauseStart: '13:00',
    pauseEnd: '14:00',
    serviceId: item.serviceIds[0],
    comment: caseComment(41)
  }
  let scheduleId = 0

  await loginAdmin(page)
  try {
    await open(page, adminUrl(), `/shops/${item.shopId}/lines/${item.lineId}/staffManagement`)
    await expect(page.getByRole('button', { name: /^Добавить$/i })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /^Добавить$/i }).click()
    await expect(page).toHaveURL(/staffManagement\/create$/)

    await fillScheduleForm(page, expected, item.serviceNames[0])
    const body = await saveSchedule(page, '/api/createStaffManagementRecord', ['POST'])
    scheduleId = Number(body?.id || body?.Id)
    expect(scheduleId, 'Created employee schedule id').toBeGreaterThan(0)
    registerSchedule(scheduleId)

    await expectSchedule(page, scheduleId, expected)
    await expectDisplayedTimeSlots(page, {
      date: expected.date,
      serviceName: item.serviceNames[0],
      visibleTimes: ['09:00', '12:45', '14:00', '17:45'],
      hiddenTimes: ['08:45', '13:00', '13:15', '13:30', '13:45', '18:00']
    })
  } finally {
    if (scheduleId) await deleteSchedule(page, scheduleId)
  }
})

test('TC-48 edits an employee schedule', async ({ page }) => {
  const item = scenario()
  let scheduleId = 0
  const expected: ScheduleExpectation = {
    date: dateInput(3),
    numberOfStaff: 3,
    startTime: '10:00',
    endTime: '19:00',
    pauseStart: '14:00',
    pauseEnd: '15:00',
    serviceId: item.serviceIds[1],
    comment: caseComment(48)
  }

  await loginAdmin(page)
  try {
    scheduleId = await createStaffManagementRecord(page, adminUrl(), item)
    expect(scheduleId, 'Employee schedule fixture id').toBeGreaterThan(0)
    registerSchedule(scheduleId)

    await open(page, adminUrl(), `/shops/${item.shopId}/lines/${item.lineId}/staffManagement/${scheduleId}`)
    await fillAdminText(page, 'Дата', expected.date)
    await setAdminToggle(page, item.serviceNames[0], false)
    await setAdminToggle(page, item.serviceNames[1], true)
    await fillAdminText(page, 'Количество точек обслуживания', expected.numberOfStaff)
    await fillAdminTime(page, 'Время начала работы', expected.startTime)
    await fillAdminTime(page, 'Время завершения работы', expected.endTime)
    await addPause(page, expected.pauseStart, expected.pauseEnd)
    await fillAdminText(page, 'Комментарий', expected.comment)
    const body = await saveSchedule(page, '/api/updateStaffManagementRecord', ['PUT'])
    const updatedId = Number(body?.id || body?.Id || scheduleId)
    if (updatedId !== scheduleId) {
      unregisterSchedule(scheduleId)
      scheduleId = updatedId
      registerSchedule(scheduleId)
    }

    await expectSchedule(page, scheduleId, expected)
    await expectDisplayedTimeSlots(page, {
      date: expected.date,
      serviceName: item.serviceNames[1],
      visibleTimes: ['10:00', '13:45', '15:00', '18:45'],
      hiddenTimes: ['09:00', '14:00', '14:15', '14:30', '14:45', '19:00']
    })
  } finally {
    if (scheduleId) await deleteSchedule(page, scheduleId)
  }
})

test('TC-49 deletes an employee schedule', async ({ page }) => {
  const item = scenario()
  let scheduleId = 0

  await loginAdmin(page)
  try {
    scheduleId = await createStaffManagementRecord(page, adminUrl(), item)
    expect(scheduleId, 'Employee schedule fixture id').toBeGreaterThan(0)
    registerSchedule(scheduleId)

    await expectDisplayedTimeSlots(page, {
      date: dateInput(1),
      serviceName: item.serviceNames[0],
      visibleTimes: ['00:00', '12:00', '23:30']
    })

    await open(page, adminUrl(), `/shops/${item.shopId}/lines/${item.lineId}/staffManagement`)
    const fixture = page.getByText('E2E tomorrow schedule', { exact: true }).first()
    await expect(fixture).toBeVisible({ timeout: 30_000 })
    await fixture.locator('xpath=ancestor::*[@role="button"][1]').click()
    await expect(page).toHaveURL(new RegExp(`staffManagement/${scheduleId}$`))

    await page.getByRole('button', { name: /^Удалить$/i }).click()
    await expect(page.getByText('Вы действительно хотите удалить?', { exact: true })).toBeVisible()
    const responsePromise = page.waitForResponse(
      (response) => responseHas(response, '/api/deleteStaffManagementRecord', ['DELETE']),
      { timeout: 30_000 }
    )
    await page.getByRole('button', { name: /^Удалить$/i }).click()
    const response = await responsePromise
    expect(response.ok(), `deleteStaffManagementRecord failed with ${response.status()}`).toBe(true)

    await expect
      .poll(async () => (await scheduleList(page)).some((candidate) => Number(candidate.id) === scheduleId), {
        timeout: 30_000
      })
      .toBe(false)
    await expect(page).toHaveURL(/staffManagement$/)
    unregisterSchedule(scheduleId)
    scheduleId = 0

    await expectDisplayedTimeSlots(page, {
      date: dateInput(1),
      serviceName: item.serviceNames[0],
      none: true
    })
  } finally {
    if (scheduleId) await deleteSchedule(page, scheduleId)
  }
})
