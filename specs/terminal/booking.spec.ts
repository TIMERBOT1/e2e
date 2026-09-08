import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from '../../setup/e2e-test-fixture'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAppointmentToken, removeAppointmentToken, removeMonitoringPosition } from '../../setup/cleanup-ui.mjs'
import { terminalUrl } from '../../setup/shared.mjs'
import { createFutureAppointmentFromTerminal, fillPersonalData, openTerminal } from '../../setup/terminal-flow.mjs'

type StandScenario = {
  key: string
  shopId: number
  lineId: number
  checkpointId: number
  terminalId: string
}

type StandState = {
  runId: string
  place: { id: number; name: string }
  scenarios: Record<string, StandScenario>
}

const rootDir = fileURLToPath(new URL('../..', import.meta.url))
const statePath = resolve(rootDir, '.e2e-stand-state.json')
const adminUrl = process.env.ADMIN_URL
const adminLogin = process.env.ADMIN_LOGIN
const adminPassword = process.env.ADMIN_PASSWORD

function readState(): StandState {
  expect(existsSync(statePath), `Use pnpm e2e:test. Missing ${statePath}`).toBe(true)
  return JSON.parse(readFileSync(statePath, 'utf8'))
}

function getScenario(key: string): StandScenario {
  const scenario = readState().scenarios[key]
  expect(scenario, `Scenario ${key} is missing in ${statePath}`).toBeDefined()
  return scenario
}

async function loginAdmin(page: Page) {
  expect(adminUrl, 'Set ADMIN_URL in .env.stand.local').toBeDefined()
  expect(adminLogin, 'Set ADMIN_LOGIN in .env.stand.local').toBeDefined()
  expect(adminPassword, 'Set ADMIN_PASSWORD in .env.stand.local').toBeDefined()

  await page.goto(`${adminUrl}/#/login`)
  await page.locator('[data-test="LoginForm-Email"]').fill(adminLogin!)
  await page.locator('[data-test="LoginForm-Password"]').fill(adminPassword!)
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-test="LoginForm-Submit"]')?.disabled)
  await page.locator('[data-test="LoginForm-Submit"]').click()
  await page.waitForURL((url) => !String(url).includes('/login'))
}

async function cleanupPositions(context: BrowserContext, scenario: StandScenario, ids: number[]) {
  if (ids.length === 0) return

  const adminPage = await context.newPage()

  try {
    await loginAdmin(adminPage)

    for (const positionId of ids) {
      await removeMonitoringPosition(adminPage, adminUrl!, scenario, positionId)
    }
  } finally {
    await adminPage.close()
  }
}

async function cleanupAppointmentsByIds(
  context: BrowserContext,
  scenario: StandScenario,
  ids: number[],
  phone: string,
  tokens: string[] = []
) {
  if (ids.length === 0 && tokens.length === 0) return

  const adminPage = await context.newPage()

  try {
    await loginAdmin(adminPage)

    for (const token of tokens) {
      await removeAppointmentToken(adminPage, adminUrl!, scenario, token, true)
    }
    for (const appointmentId of ids) {
      if (tokens.length) break
      const token = await findAppointmentToken(adminPage, adminUrl!, scenario, appointmentId, phone)
      await removeAppointmentToken(adminPage, adminUrl!, scenario, token, true)
    }
    await adminPage.waitForTimeout(1_000)
  } finally {
    await adminPage.close()
  }
}

test('timed today creates booking and removes it from monitoring', async ({ page, context }) => {
  const scenario = getScenario('timed')
  const createdPositionIds: number[] = []

  try {
    await openTerminal(page, scenario)
    await fillPersonalData(page)

    const notificationSms = page.locator('[data-test="notification-sms"]')
    const timeslotSelect = page.locator('[data-test="timeslot-select"]')
    await expect(notificationSms.or(timeslotSelect)).toBeVisible()
    if (await notificationSms.isVisible().catch(() => false)) {
      await expect(notificationSms).toContainText('Выбрать время')
      await notificationSms.click({ force: true })
    } else {
      await expect(timeslotSelect).toBeVisible()
    }

    const today = page.locator('[data-test="date-select-today"]')
    if (await today.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(today).toContainText('Сегодня')
      await today.click({ force: true })
    }

    const slot = page.getByRole('button', { name: /^\d{1,2}:\d{2}$/ }).last()
    await expect(slot).toBeVisible()
    const slotText = await slot.innerText()

    await slot.click({ force: true })
    await expect(page.locator('[data-test="appointment-confirmation"]')).toBeVisible()
    await expect(page.locator('[data-test="confirmation-date"]')).toContainText(slotText)

    const joinLineResponse = page.waitForResponse((response) => response.url().includes('/terminal/joinLine'))

    await page.locator('[data-test="btn-confirm-appointment"]').click({ force: true })

    const joinLine = await joinLineResponse
    const body = await joinLine.json()
    const positionId = Number(body.positionId)

    expect(joinLine.ok(), JSON.stringify(body)).toBe(true)
    expect(Number.isFinite(positionId) && positionId > 0, JSON.stringify(body)).toBe(true)
    createdPositionIds.push(positionId)
  } finally {
    await cleanupPositions(context, scenario, createdPositionIds)
  }
})

test('asap creates live queue position and removes it from monitoring', async ({ page, context }) => {
  const scenario = getScenario('asap')
  const createdPositionIds: number[] = []

  try {
    await openTerminal(page, scenario)
    await fillPersonalData(page, '+79000000002')

    const notificationScreen = page.locator('[data-test="notification-screen"]')
    const confirmation = page.locator('[data-test="appointment-confirmation"]')
    await expect(notificationScreen.or(confirmation)).toBeVisible()
    if (await notificationScreen.isVisible().catch(() => false)) {
      await notificationScreen.click({ force: true })
    }
    await expect(confirmation).toBeVisible()

    const joinLineResponse = page.waitForResponse((response) => response.url().includes('/terminal/joinLine'))

    await page.locator('[data-test="btn-confirm-appointment"]').click({ force: true })

    const joinLine = await joinLineResponse
    const body = await joinLine.json()
    const positionId = Number(body.positionId)

    expect(joinLine.ok(), JSON.stringify(body)).toBe(true)
    expect(Number.isFinite(positionId) && positionId > 0, JSON.stringify(body)).toBe(true)
    createdPositionIds.push(positionId)
  } finally {
    await cleanupPositions(context, scenario, createdPositionIds)
  }
})

test('future appointment with final screen shows success and removes it from appointments list', async ({ page, context }) => {
  const scenario = getScenario('futureFinal')
  const phone = '+79000000003'
  const appointmentIds: number[] = []
  const appointmentTokens: string[] = []

  try {
    const result = await createFutureAppointmentFromTerminal(page, scenario, phone, true)
    appointmentIds.push(result.appointmentId)
    if (result.token) appointmentTokens.push(result.token)
    expect(result.successShown).toBe(true)
  } finally {
    await cleanupAppointmentsByIds(context, scenario, appointmentIds, phone, appointmentTokens)
  }
})

test('future appointment without final screen returns to intro and removes it from appointments list', async ({ page, context }) => {
  const scenario = getScenario('futureNoFinal')
  const phone = '+79000000004'
  const appointmentIds: number[] = []
  const appointmentTokens: string[] = []

  try {
    const result = await createFutureAppointmentFromTerminal(page, scenario, phone, false)
    appointmentIds.push(result.appointmentId)
    if (result.token) appointmentTokens.push(result.token)
    expect(result.successShown).toBe(false)
    await expect(page.getByText(/Click here to join the line|Нажмите, чтобы занять очередь/i)).toBeVisible()
  } finally {
    await cleanupAppointmentsByIds(context, scenario, appointmentIds, phone, appointmentTokens)
  }
})

test('no slots shows unavailable time screen', async ({ page }) => {
  const scenario = getScenario('noSlots')

  await page.goto(terminalUrl(scenario.terminalId))
  const unavailable = page.locator('[data-test="not-timeslots-container"], [data-test="timeselect-notime"]')
  await expect(unavailable).toBeVisible()
  await expect(unavailable).toContainText(/закрыт|closed|заполн|нет свобод|no time/i)
})

test('stopped checkpoint shows unavailable screen', async ({ page }) => {
  const scenario = getScenario('stoppedCheckpoint')

  await page.goto(terminalUrl(scenario.terminalId))
  const unavailable = page.locator('[data-test="terminal-closed"], [data-test="not-timeslots-container"]')
  await expect(unavailable).toBeVisible()
  await expect(unavailable).toContainText(/закрыт|недоступ|выключен|disabled|заполн|нет свобод/i)
})

test('disabled terminal shows closed terminal screen', async ({ page }) => {
  const scenario = getScenario('disabledTerminal')

  await page.goto(terminalUrl(scenario.terminalId))
  const unavailable = page.locator('[data-test="terminal-closed"], [data-test="not-timeslots-container"]')
  await expect(unavailable).toBeVisible()
  await expect(unavailable).toContainText(/закрыт|недоступ|выключен|disabled|заполн|нет свобод/i)
})
