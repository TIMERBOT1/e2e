import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from '../../setup/e2e-test-fixture'
import { findAppointmentToken, removeAppointmentToken } from '../../setup/cleanup-ui.mjs'
import { loginAdmin } from '../../setup/admin-line-monitoring.mjs'
import { createFutureAppointmentFromTerminal } from '../../setup/terminal-flow.mjs'
import { loadEnv, readState, requiredEnv, unwrapData } from '../../setup/shared.mjs'
import { fillAdminText, jsonOrEmpty, open, saveAdminAndWait, setAdminToggle } from '../../setup/ui-admin.mjs'

type StandScenario = {
  key: string
  shopId: number
  lineId: number
  checkpointId: number
  terminalId: string
  terminalAdminId: number
}

type StandState = {
  runId: string
  place: { id: number; name: string }
  scenarios: Record<string, StandScenario>
}

function adminUrl() {
  loadEnv()
  return requiredEnv('ADMIN_URL')
}

function state(): StandState {
  return readState()
}

function scenario(key: string) {
  const item = state().scenarios[key]
  expect(item, `Scenario ${key} is missing in stand state`).toBeDefined()
  return item
}

async function apiBodyOnOpen(page: Page, route: string, apiPath: string) {
  const baseUrl = adminUrl()
  if (page.url().includes(`#${route}`)) await open(page, baseUrl, '/')
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname.toLowerCase() === apiPath.toLowerCase() && response.request().method() === 'GET',
    { timeout: 30_000 }
  )
  await open(page, baseUrl, route)
  const response = await responsePromise
  const body = await jsonOrEmpty(response)
  expect(response.ok(), `${apiPath} failed: ${response.status()} ${JSON.stringify(body)}`).toBe(true)
  return unwrapData(body)
}

async function saveText(page: Page, route: string, readPath: string, savePath: string, label: string, value: string) {
  await apiBodyOnOpen(page, route, readPath)
  await fillAdminText(page, label, value)
  await saveAdminAndWait(page, savePath, ['PUT', 'POST'])
}

async function saveDescription(page: Page, route: string, readPath: string, savePath: string, value: string) {
  await saveText(page, route, readPath, savePath, 'Описание', value)
}

async function saveTerminalFinalScreen(page: Page, item: StandScenario, value: boolean) {
  const route = `/terminals/${item.terminalAdminId}/edit`
  if (!page.url().includes(`#${route}`)) await apiBodyOnOpen(page, route, '/api/getTerminal')
  await setAdminToggle(page, 'Показывать финальный экран с информацией о записи', value)
  await saveAdminAndWait(page, '/api/updateTerminal', ['PUT', 'POST'])
}

async function cleanupAppointment(context: BrowserContext, item: StandScenario, phone: string, result?: { appointmentId: number; token?: string }) {
  if (!result) return

  const page = await context.newPage()
  try {
    await loginAdmin(page)
    const token = result.token || (await findAppointmentToken(page, adminUrl(), item, result.appointmentId, phone))
    await removeAppointmentToken(page, adminUrl(), item, token, true)
  } finally {
    await page.close()
  }
}

function nextDescription(prefix: string) {
  return `${prefix} settings ${Date.now()}`.slice(0, 100)
}

test.setTimeout(120_000)

test('terminal settings enable final screen for future appointment', async ({ page, context }) => {
  const item = scenario('futureNoFinal')
  const phone = `+7900000${String(Date.now()).slice(-4)}`
  const terminalRoute = `/terminals/${item.terminalAdminId}/edit`
  let result: { appointmentId: number; token?: string; successShown: boolean } | undefined

  await loginAdmin(page)
  const originalFinalScreen = (await apiBodyOnOpen(page, terminalRoute, '/api/getTerminal'))?.displayConfirmationScreen
  expect(typeof originalFinalScreen).toBe('boolean')

  try {
    await saveTerminalFinalScreen(page, item, true)
    const terminalPage = await context.newPage()
    try {
      result = await createFutureAppointmentFromTerminal(terminalPage, item, phone, true)
      expect(result.successShown).toBe(true)
    } finally {
      await terminalPage.close()
    }
  } finally {
    try {
      await cleanupAppointment(context, item, phone, result)
    } finally {
      await saveTerminalFinalScreen(page, item, originalFinalScreen)
    }
  }
})

test('line settings persist name after reopen', async ({ page }) => {
  const item = scenario('disabledTerminal')
  const route = `/shops/${item.shopId}/lines/${item.lineId}/edit`
  await loginAdmin(page)
  const original = String((await apiBodyOnOpen(page, route, '/api/getLine'))?.name ?? '')
  const changed = nextDescription('line')

  try {
    await saveText(page, route, '/api/getLine', '/api/updateLine', 'Название', changed)
    expect(String((await apiBodyOnOpen(page, route, '/api/getLine'))?.name ?? '')).toBe(changed)
  } finally {
    await saveText(page, route, '/api/getLine', '/api/updateLine', 'Название', original)
  }
})

test('checkpoint settings persist description after reopen', async ({ page }) => {
  const item = scenario('stoppedCheckpoint')
  const route = `/shops/${item.shopId}/lines/${item.lineId}/checkpoints/${item.checkpointId}/edit`
  await loginAdmin(page)
  const original = String((await apiBodyOnOpen(page, route, '/api/getCheckpoint'))?.description ?? '')
  const changed = nextDescription('checkpoint')

  try {
    await saveDescription(page, route, '/api/getCheckpoint', '/api/updateCheckpoint', changed)
    expect(String((await apiBodyOnOpen(page, route, '/api/getCheckpoint'))?.description ?? '')).toBe(changed)
  } finally {
    await saveDescription(page, route, '/api/getCheckpoint', '/api/updateCheckpoint', original)
  }
})

test('shop settings keep Ekaterinburg timezone and persist description after reopen', async ({ page }) => {
  const place = state().place
  const route = `/shops/${place.id}/edit`
  await loginAdmin(page)
  const shop = await apiBodyOnOpen(page, route, '/api/getShop')
  const original = String(shop?.description ?? '')
  const changed = nextDescription('shop')

  expect(String(shop?.timeZoneId ?? shop?.timezoneId ?? shop?.timeZone ?? '')).toContain('Yekaterinburg')
  await expect(page.getByText(/Екатеринбург/i).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })

  try {
    await saveDescription(page, route, '/api/getShop', '/api/updateShop', changed)
    const changedShop = await apiBodyOnOpen(page, route, '/api/getShop')
    expect(String(changedShop?.description ?? '')).toBe(changed)
    expect(String(changedShop?.timeZoneId ?? changedShop?.timezoneId ?? changedShop?.timeZone ?? '')).toContain('Yekaterinburg')
    await expect(page.getByText(/Екатеринбург/i).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
  } finally {
    await saveDescription(page, route, '/api/getShop', '/api/updateShop', original)
  }
})
