import { chromium } from '@playwright/test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(here, '..')
export const statePath = resolve(rootDir, '.e2e-stand-state.json')
const envPath = resolve(rootDir, '.env.stand.local')

export const source = {
  shopId: Number(process.env.E2E_SOURCE_SHOP_ID || 60528),
  lineId: Number(process.env.E2E_SOURCE_LINE_ID || 80983),
  terminalId: Number(process.env.E2E_SOURCE_TERMINAL_ID || 80195)
}

export function loadEnv() {
  if (!existsSync(envPath)) return

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  }
}

export function readState() {
  if (!existsSync(statePath)) {
    throw new Error(
      `Stand state not found: ${statePath}. Use pnpm e2e:test, pnpm smoke:cycle, or pnpm permissions:cycle.`
    )
  }

  return JSON.parse(readFileSync(statePath, 'utf8'))
}

export function saveState(state) {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

export function removeState() {
  rmSync(statePath, { force: true })
}

export function terminalUrl(terminalId) {
  const base = process.env.CALL_TERMINAL_BASE_URL || process.env.TERMINAL_URL || 'https://call.vseupalo.ru/terminal/'

  if (base.includes('terminalId=')) {
    return base.replace(/terminalId=[^&]*/, `terminalId=${terminalId}`)
  }

  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}terminalId=${terminalId}`
}

function browserSlowMo() {
  return Number(process.env.STAND_SLOW_MO_MS || 0) || undefined
}

function contextOptions() {
  if (!process.env.STAND_VIDEO_DIR) return {}

  return {
    recordVideo: {
      dir: process.env.STAND_VIDEO_DIR,
      size: { width: 1080, height: 1920 }
    },
    viewport: { width: 1080, height: 1920 }
  }
}

export async function loginAdmin() {
  loadEnv()

  const adminUrl = requiredEnv('ADMIN_URL')
  const adminLogin = requiredEnv('ADMIN_LOGIN')
  const adminPassword = requiredEnv('ADMIN_PASSWORD')
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0', slowMo: browserSlowMo() })
  const context = await browser.newContext(contextOptions())
  const page = await context.newPage()

  await poll(async () => {
    await page.goto(`${adminUrl}/#/login`, { waitUntil: 'domcontentloaded', timeout: 10_000 })
    await page.locator('[data-test="LoginForm-Email"]').waitFor({ state: 'visible', timeout: 5_000 })
    return true
  }, 'admin login page')
  await page.locator('[data-test="LoginForm-Email"]').fill(adminLogin)
  await page.locator('[data-test="LoginForm-Password"]').fill(adminPassword)
  await page.waitForFunction(() => !document.querySelector('[data-test="LoginForm-Submit"]')?.disabled)
  await page.locator('[data-test="LoginForm-Submit"]').click()
  await page.waitForURL((url) => !String(url).includes('/login'))

  return { browser, context, page, adminUrl }
}

export function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Set ${name} in .env.stand.local`)
  return value
}

export function unwrapList(body) {
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.data)) return body.data
  if (Array.isArray(body?.Data)) return body.Data
  if (Array.isArray(body?.items)) return body.items
  if (Array.isArray(body?.data?.items)) return body.data.items
  if (Array.isArray(body?.Data?.Items)) return body.Data.Items
  return []
}

export function unwrapData(body) {
  return body?.data && !Array.isArray(body.data) ? body.data : body
}

export async function api(page, adminUrl, method, path, data, options = {}) {
  const requestOptions = data === undefined
    ? (Object.keys(options).length ? options : undefined)
    : { ...options, data }
  const response = await page.request[method](`${adminUrl}${path}`, requestOptions)
  const text = await response.text()

  if (!response.ok()) {
    throw new Error(`${method.toUpperCase()} ${path} failed: ${response.status()} ${text}`)
  }

  if (!text) return undefined

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function getJson(page, adminUrl, path, params) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  return api(page, adminUrl, 'get', `${path}${query}`)
}

export async function poll(fn, label, timeoutMs = 60_000) {
  const started = Date.now()
  let lastError

  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

export function todayWorkday(opening = 8, closing = 20) {
  return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((dayOfWeek) => ({
    dayOfWeek,
    isWeekend: false,
    openingTime_unixtime: Math.round(opening * 60 * 60 * 1000),
    closingTime_unixtime: Math.round(closing * 60 * 60 * 1000),
    breaks: []
  }))
}

export async function createShop(page, adminUrl, runId) {
  const shop = await getJson(page, adminUrl, '/api/getShop', { id: source.shopId })
  const name = `E2E ${runId}`
  const payload = {
    ...shop,
    id: undefined,
    name,
    displayName: name,
    description: name,
    disabled: false
  }

  await api(page, adminUrl, 'post', '/api/createShop', payload)

  return poll(async () => {
    const shops = unwrapList(await getJson(page, adminUrl, '/api/getShopListSimplified'))
    return shops.find((item) => item.name === name)
  }, `created shop ${name}`)
}

export async function createLine(page, adminUrl, shopId, runId, key, options = {}) {
  const sourceLine = unwrapData(
    await getJson(page, adminUrl, '/api/getLine', {
      id: source.lineId,
      shopId: source.shopId
    })
  )
  const name = `E2E ${key} ${runId}`.slice(0, 80)
  const shortName = `E2E-${key}-${runId.slice(-4)}`.slice(0, 20)
  const services = (sourceLine.services || []).slice(0, 1).map((service, index) => ({
    ...service,
    id: undefined,
    name: `${key} service ${runId}`.slice(0, 80),
    displayName: `${key} service ${runId}`.slice(0, 80),
    shortName: `${key}-${index + 1}`.slice(0, 20),
    duration: options.serviceDuration ?? service.duration
  }))

  await api(page, adminUrl, 'post', '/api/createLine', {
    ...sourceLine,
    id: undefined,
    shopId,
    name,
    displayName: name,
    shortName,
    serviceTime: options.serviceTime ?? sourceLine.serviceTime,
    maxSimultaneous: options.maxSimultaneous ?? sourceLine.maxSimultaneous,
    asapMode: options.asapMode ?? true,
    allowTodayTerminalBooking: options.allowTodayTerminalBooking ?? true,
    allowFutureTerminalBooking: options.allowFutureTerminalBooking ?? false,
    allowFutureAppointments: options.allowFutureAppointments ?? true,
    openingHours: {
      nonStopService: false,
      weekDays: todayWorkday(options.openingHour ?? 0, options.closingHour ?? 23 + 59 / 60)
    },
    services
  })

  const created = await poll(async () => {
    const lines = unwrapList(await getJson(page, adminUrl, '/api/getLineListSimplified', { shopId }))
    return lines.find((item) => item.name === name)
  }, `created line ${name}`)
  const full = unwrapData(await getJson(page, adminUrl, '/api/getLine', { id: created.id, shopId }))

  return {
    id: Number(created.id),
    name,
    serviceId: Number(full.services?.[0]?.id)
  }
}

export async function createCheckpoint(page, adminUrl, shopId, lineId, runId, key) {
  const name = `E2E ${key}`.slice(0, 20)

  await api(page, adminUrl, 'post', '/api/createCheckpoint', {
    lineId: String(lineId),
    beaconId: '',
    name,
    description: `E2E ${key} ${runId}`.slice(0, 100),
    capacities: [],
    specialCapacity: false,
    audioRecordingEnabled: false,
    supportedBookingChannels: ["admin", "rdv", "smartphone", "terminal"]
  })

  return poll(async () => {
    const checkpoints = unwrapList(await getJson(page, adminUrl, '/api/GetCheckpointList', { shopId, lineId }))
    return checkpoints.find((item) => item.name === name)
  }, `created checkpoint ${name}`, 5_000).catch(async () => {
    const list = await getJson(page, adminUrl, '/api/GetCheckpointList', { shopId, lineId })
    return unwrapList(list).find((item) => item.name === name)
  })
}

export async function createTerminal(page, adminUrl, shopId, lineId, runId, key, enabled = true) {
  const sourceTerminal = unwrapData(await getJson(page, adminUrl, '/api/getTerminal', { id: source.terminalId }))
  const name = `E2E ${key} ${runId}`.slice(0, 80)

  await api(page, adminUrl, 'post', '/api/createTerminal', {
    ...sourceTerminal,
    id: undefined,
    guid: undefined,
    name,
    displayName: name,
    shopIds: [String(shopId)],
    lineIds: [String(lineId)],
    enabled
  })

  const terminal = await poll(async () => {
    const terminals = unwrapList(await getJson(page, adminUrl, '/api/getTerminalList'))
    return terminals.find((item) => item.name === name)
  }, `created terminal ${name}`)
  const fullTerminal = unwrapData(await getJson(page, adminUrl, '/api/getTerminal', { id: terminal.id }).catch(() => terminal))

  await api(page, adminUrl, 'post', enabled ? '/api/enableTerminal' : '/api/disableTerminal', Number(terminal.id))

  return {
    adminId: Number(terminal.id),
    guid: fullTerminal.guid || terminal.guid || fullTerminal.monitoringId || terminal.monitoringId || fullTerminal.terminalId,
    name
  }
}

export async function startCheckpoint(page, adminUrl, checkpointId, serviceId) {
  await api(page, adminUrl, 'post', '/api/StartCheckpoint', checkpointId)
}

export function tomorrowUtcStart() {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
}

export async function createStaffManagementRecord(page, adminUrl, scenario) {
  const form = unwrapData(
    await getJson(page, adminUrl, '/api/getStaffManagementRecord', {
      shopId: scenario.shopId,
      lineId: scenario.lineId
    })
  )
  const service = (form.services || []).find((item) => Number(item.id) === Number(scenario.serviceId)) || form.services?.[0]
  const servicePoint =
    (form.servicePoints || []).find((item) => Number(item.id) === Number(scenario.checkpointId)) || form.servicePoints?.[0]
  const response = await api(page, adminUrl, 'post', '/api/createStaffManagementRecord', {
    ...form,
    lineId: String(scenario.lineId),
    startDate: tomorrowUtcStart(),
    startHour_unixtime: 0,
    endHour_unixtime: Math.round((23 + 59 / 60) * 60 * 60 * 1000),
    numberOfStaff: 1,
    comments: 'E2E tomorrow schedule',
    serviceWithPause: false,
    pauses: [],
    servicesSelected: service ? [service] : [],
    servicePointsSelected: servicePoint ? [servicePoint] : []
  })

  return Number(response.id || response.Id)
}

export async function removePosition(page, adminUrl, state, scenario, positionId) {
  await api(page, adminUrl, 'post', '/api/changePositionState', {
    shopId: state.place.id,
    lineId: scenario.lineId,
    checkpointId: scenario.checkpointId,
    positionId,
    newState: 'removed'
  })
}

export async function deleteScenario(page, adminUrl, scenario) {
  if (!scenario) return

  for (const appointmentToken of scenario.appointmentTokens || []) {
    console.log(`[cleanup:api:fallback] delete appointment ${appointmentToken}`)
    await api(page, adminUrl, 'delete', '/api/reports/deleteAppointment', {
      isAppointment: true,
      appointmentReservationToken: appointmentToken
    }).catch((error) => console.log(`[cleanup:api:error] ${error.message}`))
  }

  for (const staffManagementId of scenario.staffManagementIds || []) {
    console.log(`[cleanup:api:fallback] delete staff management ${staffManagementId}`)
    await api(page, adminUrl, 'delete', '/api/deleteStaffManagementRecord', staffManagementId).catch((error) =>
      console.log(`[cleanup:api:error] ${error.message}`)
    )
  }

  for (const positionId of scenario.reservedPositionIds || []) {
    console.log(`[cleanup:api:fallback] remove position ${positionId}`)
    await api(page, adminUrl, 'post', '/api/changePositionState', {
      shopId: scenario.shopId,
      lineId: scenario.lineId,
      checkpointId: scenario.checkpointId,
      positionId,
      newState: 'removed'
    }).catch((error) => console.log(`[cleanup:api:error] ${error.message}`))
  }

  if (scenario.terminalAdminId) {
    console.log(`[cleanup:api:fallback] delete terminal ${scenario.terminalAdminId}`)
    await api(page, adminUrl, 'post', '/api/disableTerminal', scenario.terminalAdminId).catch(() => {})
    await api(page, adminUrl, 'delete', '/api/deleteTerminal', scenario.terminalAdminId).catch((error) =>
      console.log(`[cleanup:api:error] ${error.message}`)
    )
  }

  if (scenario.checkpointId) {
    console.log(`[cleanup:api:fallback] delete checkpoint ${scenario.checkpointId}`)
    await api(page, adminUrl, 'post', '/api/finishCheckpoint', scenario.checkpointId).catch(() => {})
    await api(page, adminUrl, 'delete', '/api/deleteCheckpoint', scenario.checkpointId).catch((error) =>
      console.log(`[cleanup:api:error] ${error.message}`)
    )
  }

  if (scenario.lineId) {
    console.log(`[cleanup:api:fallback] delete line ${scenario.lineId}`)
    await api(page, adminUrl, 'delete', '/api/deleteLine', scenario.lineId).catch((error) =>
      console.log(`[cleanup:api:error] ${error.message}`)
    )
  }
}
