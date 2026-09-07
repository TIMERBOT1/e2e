import {
  api,
  getJson,
  loginAdmin,
  poll,
  saveState,
  terminalUrl,
  unwrapList
} from './shared.mjs'
import { createTomorrowAppointment } from './admin-line-monitoring.mjs'
import { findAppointmentToken } from './cleanup-ui.mjs'
import { createPermissionUser } from './permissions-ui.mjs'
import {
  cleanupPreparedState,
  createUiCheckpoint,
  createUiLine,
  createUiShop,
  createUiStaffManagementRecord,
  createUiTerminal,
  startUiCheckpoint
} from './ui-admin.mjs'

const runId = `e2e-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`
const noSlotsTimeSlotSeconds = 60

function first(items, label) {
  const item = items.find(Boolean)
  if (!item) throw new Error(`Smoke fixture not found: ${label}`)
  return item
}

function itemName(item, fallback) {
  const value = item?.tag?.name?.translated || item?.tag?.name?.base || item?.name?.translated || item?.name?.base || item?.name || item?.displayName || item?.sourceText
  return String(value || fallback)
}

function itemId(item) {
  const value = item?.id || item?.tag?.id || item?.lineTemplateId
  const number = Number(value)
  return Number.isFinite(number) ? number : String(value)
}

async function createSmokeLineTemplate(page, adminUrl, state) {
  const brands = unwrapList(await getJson(page, adminUrl, '/api/getBrandList'))
  const configuredTemplateId = process.env.E2E_SOURCE_LINE_TEMPLATE_ID
  let sourceBrand
  let sourceTemplate

  if (configuredTemplateId) {
    for (const brand of brands) {
      const templates = unwrapList(await getJson(page, adminUrl, '/api/getLineTemplateList', { brandId: brand.id }))
      const candidate = templates.find((template) => String(itemId(template)) === String(configuredTemplateId))
      if (candidate) {
        sourceBrand = brand
        sourceTemplate = candidate
        break
      }
    }
  } else {
    sourceBrand = brands[0]
    if (sourceBrand) {
      const templates = unwrapList(
        await getJson(page, adminUrl, '/api/getLineTemplateList', { brandId: sourceBrand.id })
      )
      sourceTemplate = templates.find((template) => !String(itemName(template, '')).startsWith('E2E '))
    }
  }

  if (!sourceBrand) {
    if (configuredTemplateId) {
      throw new Error(`Source line template with id ${configuredTemplateId} not found.`)
    }
    throw new Error('Brand fixture not found. Create a brand first.')
  }

  const brandId = itemId(sourceBrand)
  const sourceTemplateId = sourceTemplate ? itemId(sourceTemplate) : undefined
  const sourceBody = await getJson(
    page,
    adminUrl,
    '/api/getLineTemplate',
    sourceTemplateId ? { brandId, lineTemplateId: sourceTemplateId } : { brandId }
  )
  const sourceData = sourceBody?.data && !Array.isArray(sourceBody.data) ? sourceBody.data : sourceBody
  const name = `E2E template ${state.runId}`.slice(0, 80)
  const payload = {
    ...sourceData,
    lineTemplateId: 0,
    brandId,
    name,
    description: `Temporary template for ${state.runId}`,
    bindedLinesCount: undefined,
    createdAt: undefined,
    line: {
      ...sourceData.line,
      brandId,
      name: sourceData.line?.name || `E2E template line ${state.runId}`.slice(0, 80),
      shortName: sourceData.line?.shortName || `E2E_tpl_${state.runId.slice(-8)}`.replace(/[^a-zA-Z0-9_]/g, '')
    }
  }

  await api(
    page,
    adminUrl,
    'post',
    `/api/createLineTemplate?${new URLSearchParams({ brandId }).toString()}`,
    payload
  )

  const created = await poll(async () => {
    const templates = unwrapList(await getJson(page, adminUrl, '/api/getLineTemplateList', { brandId }))
    return templates.find((template) => itemName(template, '') === name)
  }, `line template ${name}`)

  state.brand = { id: brandId, name: itemName(sourceBrand, 'brand') }
  state.lineTemplate = {
    id: itemId(created),
    name,
    brandId,
    sourceTemplateId: sourceTemplateId || null,
    createdByE2E: true
  }
  saveState(state)
}

async function createSmokeCampaign(page, adminUrl, state) {
  const campaignName = `E2E campaign ${state.runId}`.slice(0, 100)
  const startDate = new Date().setHours(0, 0, 0, 0)
  const campaignPayload = {
    id: undefined,
    name: campaignName,
    startDate,
    endDate: startDate + 7 * 24 * 60 * 60 * 1_000,
    shopIds: [state.place.id],
    status: 'waiting',
    advertisementCount: 0,
    displayDuration: 10
  }

  await api(page, adminUrl, 'post', '/api/createCampaign', campaignPayload)
  const campaign = await poll(async () => {
    const campaigns = unwrapList(await getJson(page, adminUrl, '/api/getCampaignList'))
    return campaigns.find((item) => itemName(item, '') === campaignName)
  }, `campaign ${campaignName}`)

  state.campaign = {
    id: itemId(campaign),
    name: campaignName,
    createdByE2E: true
  }
  saveState(state)

  const campaignId = state.campaign.id
  const advertisementName = `E2E advertisement ${state.runId}`.slice(0, 100)
  const defaultBody = await getJson(page, adminUrl, '/api/getAdvt', { campaignId })
  const defaultData = defaultBody?.data && !Array.isArray(defaultBody.data) ? defaultBody.data : defaultBody
  const advertisementPayload = {
    ...defaultData,
    id: undefined,
    campaignId,
    name: advertisementName,
    type: 'text',
    text: `Temporary advertisement for ${state.runId}`,
    link: '',
    withLink: false,
    allLanguages: true,
    displayOrder: 0,
    terminal: true,
    webFrame: true,
    smartphone: true,
    paperTicket: false,
    infoPad: false,
    specificHours: false,
    specificHoursIntervals: false
  }

  await api(page, adminUrl, 'post', '/api/createAdvt', advertisementPayload)
  const advertisement = await poll(async () => {
    const advertisements = unwrapList(await getJson(page, adminUrl, '/api/getAdvtList', { campaignId }))
    return advertisements.find((item) => itemName(item, '') === advertisementName)
  }, `advertisement ${advertisementName}`)

  state.advertisement = {
    id: itemId(advertisement),
    name: advertisementName,
    campaignId,
    createdByE2E: true
  }
  saveState(state)
}

function beaconVersion(runId, salt) {
  let hash = salt
  for (const character of runId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return (hash % 65_534) + 1
}

async function createSmokeBeacon(page, adminUrl, state) {
  const name = `E2E beacon ${state.runId}`.slice(0, 100)
  const payload = {
    id: '',
    shopId: String(state.place.id),
    name,
    major: beaconVersion(state.runId, 17),
    minor: beaconVersion(state.runId, 53),
    active: true,
    lastChargeDate: Date.now()
  }

  await api(page, adminUrl, 'post', '/api/createBeacon', payload)
  const beacon = await poll(async () => {
    const items = unwrapList(await getJson(page, adminUrl, '/api/getBeaconList', { shopId: state.place.id }))
    return items.find((item) => itemName(item, '') === name)
  }, `beacon ${name}`)

  state.beacon = {
    id: itemId(beacon),
    name,
    shopId: state.place.id,
    major: payload.major,
    minor: payload.minor,
    createdByE2E: true
  }
  saveState(state)
}

async function createSmokeCallScreen(page, adminUrl, state) {
  const name = `E2E call screen ${state.runId}`.slice(0, 100)
  const payload = {
    name,
    placeId: String(state.place.id),
    isEnable: true,
    newCallScreenEnabled: true,
    lineIds: [],
    screenType: "General",
    showWaitingPositionsEnabled: false,
    checkpointIds: [],
    displayNameTemplate: '{{Code}}',
    callMode: 'Bell',
    repeatAlarm: 1,
    repeatAlarmSec: 30,
    unbranded: false,
    displayCustomLogo: false,
    advertisementSettings: {
      advertisementOnPositionsScreenEnabled: false
    },
    animationEnabled: true,
    displayCurrentPlaceTime: false,
    emptyPositionsScreenContentSettings: null
  }

  await api(page, adminUrl, 'post', '/api/createCallScreen', payload)
  const callScreen = await poll(async () => {
    const items = unwrapList(
      await getJson(page, adminUrl, '/api/getCallScreensList', { shopId: state.place.id })
    )
    return items.find((item) => itemName(item, '') === name)
  }, `call screen ${name}`)

  state.callScreen = {
    id: itemId(callScreen),
    name,
    shopId: state.place.id,
    createdByE2E: true
  }
  saveState(state)
}

async function createSmokeTranslation(page, adminUrl, state) {
  const sourceText = `E2E translation ${state.runId}`.slice(0, 200)
  const brandId = state.brand.id
  const payload = {
    id: 0,
    brandId: String(brandId),
    sourceText,
    translations: [
      {
        destinationLanguage: 'en',
        translationText: `Temporary translation for ${state.runId}`
      }
    ]
  }

  await api(page, adminUrl, 'post', '/api/createTranslation', payload)
  const translation = await poll(async () => {
    const items = unwrapList(
      await getJson(page, adminUrl, '/api/getTranslationList', { term: sourceText, brandId })
    )
    return items.find((item) => item.sourceText === sourceText)
  }, `translation ${sourceText}`)

  state.translation = {
    id: itemId(translation),
    sourceText,
    brandId,
    createdByE2E: true
  }
  saveState(state)
}

async function createSmokeTag(page, adminUrl, state) {
  const name = `E2E tag ${state.runId}`.slice(0, 200)
  const payload = {
    translationBrandId: state.brand.id,
    tag: {
      name: {
        base: name
      }
    },
    tagLinesItems: []
  }

  await api(page, adminUrl, 'post', '/api/createTag', payload)
  const tagItem = await poll(async () => {
    const items = unwrapList(await getJson(page, adminUrl, '/api/getTagItemsList'))
    return items.find((item) => itemName(item, '') === name)
  }, `tag ${name}`)

  state.tag = {
    id: itemId(tagItem),
    name,
    createdByE2E: true
  }
  saveState(state)
}

function noSlotsLineOptions(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Yekaterinburg',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
      .formatToParts(now)
      .map((part) => [part.type, Number(part.value)])
  )
  const secondsToday = parts.hour * 60 * 60 + parts.minute * 60 + parts.second
  let opening = Math.floor(secondsToday / 60) * 60
  let closing = Math.min(opening + 60 * 60, 24 * 60 * 60 - 60)
  if (closing - opening < 15 * 60) {
    opening = 0
    closing = 24 * 60 * 60 - 60
  }
  const serviceDuration = Math.max(noSlotsTimeSlotSeconds, Math.ceil(((closing - opening) / 2 + 1) / 60) * 60)

  return {
    serviceTime: noSlotsTimeSlotSeconds,
    serviceDuration,
    openingHour: opening / 60 / 60,
    closingHour: closing / 60 / 60,
    maxSimultaneous: 1
  }
}

async function fillReadonlyInputs(page, values) {
  await page.evaluate((items) => {
    const setValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }

    document.querySelectorAll('input').forEach((element, index) => {
      if (items[index] != null) setValue(element, items[index])
    })
  }, values)
}

async function createTimedPosition(context, scenario) {
  const page = await context.newPage()
  const createdPositionIds = []

  try {
    const intro = page.locator('[data-test="intro"]')
    await poll(async () => {
      await page.goto(terminalUrl(scenario.terminalId))
      if (await intro.isVisible({ timeout: 10_000 }).catch(() => false)) return true
      return /Click here to join the line|Нажмите, чтобы занять очередь/i.test(await page.locator('body').innerText().catch(() => ''))
    }, 'noSlots terminal intro', 180_000).catch(async () => {
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
      if (/join the line|занять очередь/i.test(body)) return
      throw new Error(`noSlots reservation failed: intro not visible: ${body}`)
    })

    if (await intro.isVisible().catch(() => false)) await intro.click({ force: true })
    else await page.locator('body').click({ force: true })
    const langRu = page.locator('[data-test="lang-ru"]')
    const firstService = page.locator('[data-test^="line-btn-"], [data-test^="hold-position-service-"]').first()
    const firstServiceFallback = page.getByRole('button', { name: /^1$/ }).first()
    const personalData = page.locator('[data-test="common-title"]')
    const serviceStep = await poll(async () => {
      if (await personalData.isVisible({ timeout: 1_000 }).catch(() => false)) return 'personal'
      if (await firstService.isVisible({ timeout: 1_000 }).catch(() => false)) return 'service'
      if (await firstServiceFallback.isVisible({ timeout: 1_000 }).catch(() => false)) return 'service'
      if (await langRu.isVisible({ timeout: 1_000 }).catch(() => false)) await langRu.click({ force: true })
      else if (await intro.isVisible().catch(() => false)) await intro.click({ force: true })
      else await page.mouse.click(1, 1)
      return false
    }, 'terminal service button', 30_000).catch(async (error) => {
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
      throw new Error(`${error.message}: ${page.url()} ${body}`)
    })
    if (serviceStep === 'service') {
      if (await firstService.isVisible().catch(() => false)) await firstService.click({ force: true })
      else await firstServiceFallback.click({ force: true })
    }
    await fillReadonlyInputs(page, ['Тестов', 'Тест'])
    await page.locator('[data-test="btn-next"]').click({ force: true })
    await fillReadonlyInputs(page, ['+79000009999'])
    await page.locator('[data-test="btn-next"]').click({ force: true })

    const booking = page.locator('[data-test="notification-sms"]')
    const timeslot = page.locator('[data-test="timeslot-select"]')
    const mode = await poll(async () => {
      if (await booking.isVisible().catch(() => false)) return 'booking'
      if (await timeslot.isVisible().catch(() => false)) return 'timeslot'
      if (await page.locator('[data-test="notification-screen"]').isVisible().catch(() => false)) return 'asap'
      return false
    }, 'noSlots terminal booking step', 60_000).catch(async () => {
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
      throw new Error(`noSlots reservation failed: no booking, timeslot, or asap option: ${body}`)
    })
    let needsSlot = false
    if (mode === 'booking') {
      await booking.click({ force: true })
      needsSlot = true
    } else if (mode === 'timeslot') {
      needsSlot = true
    } else {
      throw new Error('noSlots reservation failed: timed booking option not visible')
    }

    if (needsSlot) {
      const today = page.locator('[data-test="date-select-today"]')
      await poll(async () => {
        if (await today.isVisible().catch(() => false)) {
          await today.click({ force: true })
          return false
        }
        if (await timeslot.isVisible().catch(() => false)) return true
        if (await booking.isVisible().catch(() => false)) await booking.click({ force: true })
        return false
      }, 'noSlots time select', 60_000)
      const slot = page.locator('[data-test="timeslot-select"] .MuiChip-root').filter({ hasText: /^\d{1,2}:\d{2}$/ }).first()
      if (!(await slot.isVisible({ timeout: 10_000 }).catch(() => false))) {
        const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
        throw new Error(`noSlots reservation failed: slot not visible: ${body}`)
      }
      await slot.click({ force: true })
    }

    const responsePromise = page.waitForResponse((response) => response.url().includes('/terminal/joinLine'))
    await page.locator('[data-test="btn-confirm-appointment"]').click({ force: true })

    const response = await responsePromise
    const body = await response.json()
    if (response.ok() && body.positionId) createdPositionIds.push(body.positionId)
    else throw new Error(`noSlots reservation failed: ${response.status()} ${JSON.stringify(body)}`)
  } finally {
    await page.close()
  }

  return createdPositionIds
}

async function createScenario(page, adminUrl, state, key, options = {}) {
  const line = await createUiLine(page, adminUrl, state.place.id, state.runId, key, options.line)
  const checkpoint = await createUiCheckpoint(page, adminUrl, state.place.id, line.id, state.runId, key)
  const terminal = await createUiTerminal(
    page,
    adminUrl,
    state.place.id,
    line.id,
    key,
    state.runId,
    options.enabled !== false,
    line.name,
    options.terminal
  )
  const scenario = {
    key,
    shopId: state.place.id,
    lineId: line.id,
    lineName: line.name,
    checkpointId: Number(checkpoint.id),
    serviceId: line.serviceId,
    serviceName: line.serviceName,
    technicalServiceId: line.technicalServiceId,
    technicalServiceName: line.technicalServiceName,
    checkpointName: checkpoint.name,
    terminalAdminId: terminal.adminId,
    terminalId: terminal.guid,
    terminalName: terminal.name,
    reservedPositionIds: [],
    appointmentTokens: [],
    staffManagementIds: []
  }

  state.scenarios[key] = scenario
  saveState(state)

  if (options.start !== false) {
    await startUiCheckpoint(page, adminUrl, scenario.shopId, scenario.lineId, scenario.checkpointId)
  }

  return scenario
}

async function createBulkDisableScenario(page, adminUrl, state) {
  const key = 'bulkDisable'
  const line = await createUiLine(page, adminUrl, state.place.id, state.runId, key, { additionalServiceCount: 1 })
  const checkpoints = []

  for (let index = 1; index <= 3; index += 1) {
    const checkpoint = await createUiCheckpoint(
      page,
      adminUrl,
      state.place.id,
      line.id,
      state.runId,
      `${key}-${index}`
    )
    checkpoints.push({ id: Number(checkpoint.id), name: checkpoint.name })
  }

  const scenario = {
    key,
    shopId: state.place.id,
    lineId: line.id,
    lineName: line.name,
    serviceId: line.serviceId,
    serviceName: line.serviceName,
    serviceIds: line.serviceIds,
    serviceNames: line.serviceNames,
    checkpointId: checkpoints[0].id,
    checkpointName: checkpoints[0].name,
    checkpoints,
    reservedPositionIds: [],
    appointmentTokens: [],
    staffManagementIds: []
  }

  state.scenarios[key] = scenario
  saveState(state)
  return scenario
}

async function readSmokeFixtures(page, adminUrl, state) {
  const users = unwrapList(await getJson(page, adminUrl, '/api/getUserList', { term: process.env.ADMIN_LOGIN || '' }))
  const user = first(users, 'currentUser')

  state.currentUserId = itemId(user)
  state.currentUser = {
    id: itemId(user),
    firstName: user.firstName,
    lastName: user.secondName ?? user.lastName,
    email: user.email
  }
}

async function createSmokeAppointment(page, adminUrl, state) {
  const scenario = state.scenarios.futureFinal
  const person = {
    firstName: 'Smoke',
    lastName: 'Appointment',
    phone: `+7900${String(Date.now()).slice(-7)}`,
    email: `smoke-${state.runId.replace(/[^a-z0-9]/gi, '').slice(-10).toLowerCase()}@example.com`
  }
  const id = await createTomorrowAppointment(page, scenario, person)
  const token = await findAppointmentToken(page, adminUrl, scenario, id, person.email)

  scenario.appointmentTokens.push(token)
  state.appointment = { id, token, shopId: scenario.shopId, lineId: scenario.lineId, scenarioKey: scenario.key }
}

async function main() {
  const { browser, context, page, adminUrl } = await loginAdmin()
  const state = {
    runId,
    createdAt: new Date().toISOString(),
    place: null,
    scenarios: {}
  }

  try {
    await createSmokeLineTemplate(page, adminUrl, state)
    const shop = await createUiShop(page, adminUrl, runId)
    state.place = { id: Number(shop.id), name: shop.name }
    saveState(state)

    const operator = await createPermissionUser(page, adminUrl, state, 'standOperator')
    state.technicalBreakOperator = {
      id: operator.id,
      firstName: operator.firstName,
      lastName: operator.lastName,
      email: operator.email
    }
    saveState(state)

    if (process.env.E2E_SKIP_BEACON !== '1') {
      await createSmokeBeacon(page, adminUrl, state)
    } else {
      console.warn('[stand:prepare] beacon creation skipped by E2E_SKIP_BEACON=1')
    }
    await createSmokeCallScreen(page, adminUrl, state)
    await createSmokeTranslation(page, adminUrl, state)
    await createSmokeTag(page, adminUrl, state)
    await createSmokeCampaign(page, adminUrl, state)
    await readSmokeFixtures(page, adminUrl, state)
    saveState(state)

    await createScenario(page, adminUrl, state, 'timed', {
      line: {
        technicalService: true,
        showTodayBackofficeBooking: true
      }
    })
    await createScenario(page, adminUrl, state, 'asap', {
      line: {
        asapMode: true,
        manageAppointments: false,
        allowFutureAppointments: false,
        allowAsapTerminalBooking: true,
        allowTodayTerminalBooking: false,
        allowFutureTerminalBooking: false,
        displayPositionValidate: true
      }
    })
    const futureLine = {
      allowTodayTerminalBooking: false,
      allowFutureTerminalBooking: true,
      allowFutureAppointments: true
    }
    const futureAppointmentWithFinalScreen = await createScenario(page, adminUrl, state, 'futureFinal', {
      line: futureLine,
      terminal: {
        displayConfirmationScreen: true
      }
    })
    futureAppointmentWithFinalScreen.staffManagementIds.push(
      await createUiStaffManagementRecord(
        page,
        adminUrl,
        futureAppointmentWithFinalScreen,
        futureAppointmentWithFinalScreen.serviceName,
        futureAppointmentWithFinalScreen.checkpointName
      )
    )
    saveState(state)
    const futureAppointmentWithoutFinalScreen = await createScenario(page, adminUrl, state, 'futureNoFinal', {
      line: {
        ...futureLine
      },
      terminal: {
        displayConfirmationScreen: false
      }
    })
    futureAppointmentWithoutFinalScreen.staffManagementIds.push(
      await createUiStaffManagementRecord(
        page,
        adminUrl,
        futureAppointmentWithoutFinalScreen,
        futureAppointmentWithoutFinalScreen.serviceName,
        futureAppointmentWithoutFinalScreen.checkpointName
      )
    )
    saveState(state)
    if (process.env.E2E_SKIP_NO_SLOTS !== '1') {
      const noSlots = await createScenario(page, adminUrl, state, 'noSlots', {
        line: noSlotsLineOptions()
      })

      noSlots.reservedPositionIds = await createTimedPosition(context, noSlots)
      if (!noSlots.reservedPositionIds.length) {
        throw new Error('noSlots setup failed: terminal reservation was not created')
      }
      saveState(state)
    }
    await createBulkDisableScenario(page, adminUrl, state)
    await createScenario(page, adminUrl, state, 'stoppedCheckpoint', {
      start: false,
      line: {
        displayPositionValidate: true,
        requestCheckpointHostEditReason: true
      }
    })
    await createScenario(page, adminUrl, state, 'disabledTerminal', { enabled: false })
    await createSmokeAppointment(page, adminUrl, state)
    saveState(state)

    await poll(async () => {
      const terminalPage = await browser.newPage()
      try {
        const serviceResponse = terminalPage.waitForResponse(
          (response) => response.url().endsWith('/terminal/service'),
          { timeout: 30_000 }
        ).catch(() => null)
        await terminalPage
          .goto(terminalUrl(state.scenarios.timed.terminalId), { waitUntil: 'domcontentloaded', timeout: 30_000 })
          .catch(() => null)
        const response = await serviceResponse
        if (!response) return false
        const body = await response.json()
        return body.state === 'opened'
      } finally {
        await terminalPage.close()
      }
    }, 'terminal sync', 180_000)

    console.log(`[stand:prepare] created ${runId}`)
    console.log(`[stand:prepare] state ${state.place.id} -> ${Object.keys(state.scenarios).join(', ')}`)
  } catch (error) {
    saveState(state)
    console.error(`[stand:prepare:error] ${error.stack || error.message}`)
    await cleanupPreparedState(page, adminUrl, state)
    process.exitCode = 1
  } finally {
    await context.close().catch(() => {})
    await browser.close()
  }
}

main()
