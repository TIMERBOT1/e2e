import { api, getJson, poll, unwrapList } from './shared.mjs'
import { jsonOrEmpty, open } from './ui-admin.mjs'

const removeButton = /^Удалить$/i
const yesButton = /^Да$/i

function scenarios(state) {
  return Object.values(state.scenarios || {}).filter(Boolean)
}

function lineName(state, scenario) {
  return scenario.lineName || `E2E ${scenario.key} ${state.runId}`.slice(0, 80)
}

function terminalName(state, scenario) {
  return scenario.terminalName || `E2E ${scenario.key} ${state.runId}`.slice(0, 80)
}

function hasItem(body, matcher) {
  return listItems(body).some(matcher)
}

function listItems(body) {
  return unwrapList(body).length ? unwrapList(body) : body?.data?.items || body?.Data?.Items || body?.items || []
}

function samePhone(left, right) {
  return left?.replace(/\D/g, '') === right?.replace(/\D/g, '')
}

async function waitWrite(page, methods = ['DELETE', 'POST', 'PUT']) {
  const response = await page.waitForResponse(
    (res) => methods.includes(res.request().method()) && res.url().includes('/api/'),
    { timeout: 60_000 }
  )

  if (!response.ok()) throw new Error(`${response.request().method()} ${response.url()} failed: ${response.status()}`)
}

async function waitWriteUrl(page, fragment, methods = ['DELETE', 'POST', 'PUT']) {
  const response = await page.waitForResponse(
    (res) => methods.includes(res.request().method()) && res.url().toLowerCase().includes(fragment.toLowerCase()),
    { timeout: 60_000 }
  )

  if (!response.ok()) throw new Error(`${response.request().method()} ${response.url()} failed: ${response.status()}`)
}

async function readList(page, adminUrl, route, fragment) {
  const responsePromise = page.waitForResponse((res) => res.url().toLowerCase().includes(fragment.toLowerCase()), {
    timeout: 30_000
  })
  await open(page, adminUrl, route)
  return jsonOrEmpty(await responsePromise)
}

async function itemExists(page, adminUrl, route, fragment, matcher) {
  const body = await readList(page, adminUrl, route, fragment)
  return hasItem(body, matcher)
}

async function waitMissing(page, adminUrl, route, fragment, matcher, label) {
  await poll(async () => !(await itemExists(page, adminUrl, route, fragment, matcher)), label, 30_000)
}

async function clickTwoStepRemove(page, confirm = removeButton) {
  await page.getByRole('button', { name: removeButton }).last().click()
  await page.getByText('Вы действительно хотите удалить?').waitFor({ timeout: 10_000 }).catch(() => {})
  const responsePromise = waitWrite(page, ['DELETE'])
  await page.getByRole('button', { name: confirm }).last().click()
  await responsePromise
}

async function clickVisibleText(page, text) {
  const items = page.getByText(text, { exact: true })
  for (let i = 0; i < await items.count(); i += 1) {
    const item = items.nth(i)
    if (await item.isVisible().catch(() => false)) {
      await item.click()
      return
    }
  }
  throw new Error(`Visible text not found: ${text}`)
}

async function searchAppointments(page, adminUrl, route, token) {
  const term = String(token)
  await open(page, adminUrl, route)
  await page.getByLabel('Поиск', { exact: true }).fill(term)
  const responsePromise = page.waitForResponse(
    (res) => {
      const url = new URL(res.url())
      return url.pathname.toLowerCase() === '/api/reports/getappointments' && url.searchParams.get('term') === term
    },
    { timeout: 30_000 }
  )
  await page.getByRole('button', { name: /^Поиск$/i }).click()
  return jsonOrEmpty(await responsePromise)
}

export async function findAppointment(page, adminUrl, scenario, appointmentId, phone) {
  const route = `/shops/${scenario.shopId}/lines/${scenario.lineId}/appointments`
  let lastBody

  const appointment = await poll(async () => {
    lastBody = await searchAppointments(page, adminUrl, route, phone)
    return listItems(lastBody).find(
      (appointment) =>
        Number(appointment.positionId) === Number(appointmentId) || samePhone(appointment.customer?.phoneNumber, phone)
    )
  }, `appointment ${appointmentId} token`, 60_000)

  if (appointment?.id) return { token: String(appointment.id), appointment }

  throw new Error(`Appointment ${appointmentId} was not found in appointments list: ${JSON.stringify(lastBody)}`)
}

export async function findAppointmentToken(page, adminUrl, scenario, appointmentId, phone) {
  return (await findAppointment(page, adminUrl, scenario, appointmentId, phone)).token
}

export async function removeAppointmentToken(page, adminUrl, scenario, token, required = false, searchTerm = token) {
  const route = `/shops/${scenario.shopId}/lines/${scenario.lineId}/appointments`
  const body = await searchAppointments(page, adminUrl, route, searchTerm)
  if (!JSON.stringify(body).includes(String(token))) {
    if (required) throw new Error(`Appointment ${token} was not found in appointments UI`)
    return
  }

  await clickVisibleText(page, 'Действия').catch(async () => {
    await page.getByText(/\d+\s+запис/).first().click()
    await clickVisibleText(page, 'Действия')
  })
  await clickVisibleText(page, 'Удалить')
  const responsePromise = waitWriteUrl(page, '/api/reports/delete', ['DELETE'])
  await page.getByRole('button', { name: yesButton }).last().click()
  await responsePromise

  await poll(async () => {
    const next = await searchAppointments(page, adminUrl, route, searchTerm)
    return !JSON.stringify(next).includes(String(token))
  }, `appointment ${token} removed`, 30_000)
}

async function readMonitoring(page, adminUrl, scenario, positionId) {
  await open(page, adminUrl, `/shops/${scenario.shopId}/lines/${scenario.lineId}/checkpoints`)
  const responsePromise = page.waitForResponse((res) => res.url().toLowerCase().includes('/api/getcheckpointnightclubmonitoring'), {
    timeout: 30_000
  })
  await open(page, adminUrl, `/shops/${scenario.shopId}/lines/${scenario.lineId}/checkpoints/${scenario.checkpointId}/monitoring/${positionId}`)
  return jsonOrEmpty(await responsePromise)
}

function monitoringHasPosition(body, positionId) {
  const data = body?.data || body
  return (data?.positions || []).some((item) => String(item.id) === String(positionId))
}

export async function removeMonitoringPosition(page, adminUrl, scenario, positionId) {
  const body = await readMonitoring(page, adminUrl, scenario, positionId)
  if (!monitoringHasPosition(body, positionId)) return

  let action = page.getByText('Удалить', { exact: true }).first()
  if (!(await action.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false))) {
    const data = body?.data || body
    const position = (data?.positions || []).find((item) => String(item.id) === String(positionId))
    const cardText = position?.reservationCode || [position?.customer?.lastName, position?.customer?.firstName].filter(Boolean).join(' ')
    if (cardText) await page.getByText(cardText).first().click()
    action = page.getByText('Удалить', { exact: true }).first()
  }
  if (!(await action.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false))) {
    throw new Error(`Position ${positionId} is present but UI remove action is missing`)
  }

  const responsePromise = waitWrite(page, ['POST'])
  await action.click()

  const reason = page.getByLabel('Причина удаления', { exact: true }).first()
  if (await reason.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await reason.fill('E2E cleanup')
    await page.getByRole('button', { name: removeButton }).last().click()
  } else {
    const yes = page.getByRole('button', { name: yesButton }).last()
    if (await yes.isVisible({ timeout: 2_000 }).catch(() => false)) await yes.click()
    if (await reason.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await reason.fill('E2E cleanup')
      await page.getByRole('button', { name: removeButton }).last().click()
    }
  }

  await responsePromise
  await poll(
    async () => !monitoringHasPosition(await readMonitoring(page, adminUrl, scenario, positionId), positionId),
    `position ${positionId} removed`,
    30_000
  )
}

async function stopCheckpoint(page, adminUrl, scenario) {
  return
}

async function removeStaffRecord(page, adminUrl, scenario, recordId) {
  const route = `/shops/${scenario.shopId}/lines/${scenario.lineId}/staffManagement`
  const matcher = (item) => String(item.id) === String(recordId)
  if (!(await itemExists(page, adminUrl, route, '/api/getStaffManagement', matcher))) return

  await open(page, adminUrl, `${route}/${recordId}`)
  await clickTwoStepRemove(page)
  await waitMissing(page, adminUrl, route, '/api/getStaffManagement', matcher, `staff schedule ${recordId} removed`)
}

async function discoverStaffRecordIds(page, adminUrl, scenario) {
  const dayMs = 24 * 60 * 60 * 1000
  const body = await getJson(page, adminUrl, '/api/getStaffManagement', {
    shopId: scenario.shopId,
    lineId: scenario.lineId,
    startDate: Date.now() - dayMs,
    endDate: Date.now() + 30 * dayMs
  }).catch(() => [])

  return listItems(body).map((item) => Number(item.id)).filter(Boolean)
}

async function removeTerminal(page, adminUrl, state, scenario) {
  if (!scenario.terminalAdminId) return

  const name = terminalName(state, scenario)
  const matcher = (item) =>
    String(item.id) === String(scenario.terminalAdminId) ||
    item.name === name ||
    item.displayName === name
  const exists = async () => hasItem(await getJson(page, adminUrl, '/api/getTerminalList', { term: name }), matcher)
  if (!(await exists())) return

  await api(page, adminUrl, 'delete', '/api/deleteTerminal', scenario.terminalAdminId, {
    headers: { 'Content-Type': 'application/json' }
  })
  await poll(async () => !(await exists()), `terminal ${name} removed`, 30_000)
}

async function removeCheckpoint(page, adminUrl, scenario) {
  const route = `/shops/${scenario.shopId}/lines/${scenario.lineId}/checkpoints`
  const checkpoints = scenario.checkpoints?.length
    ? scenario.checkpoints
    : scenario.checkpointId
      ? [{ id: scenario.checkpointId, name: scenario.checkpointName }]
      : []

  for (const checkpoint of [...checkpoints].reverse()) {
    const matcher = (item) => item.name === checkpoint.name || String(item.id) === String(checkpoint.id)
    if (!(await itemExists(page, adminUrl, route, '/api/getCheckpointList', matcher))) continue

    await open(page, adminUrl, `${route}/${checkpoint.id}/edit`)
    await clickTwoStepRemove(page)
    await waitMissing(page, adminUrl, route, '/api/getCheckpointList', matcher, `checkpoint ${checkpoint.name} removed`)
  }
}

async function removeLine(page, adminUrl, state, scenario) {
  if (!scenario.lineId) return

  const name = lineName(state, scenario)
  const route = `/shops/${scenario.shopId}/lines`
  const matcher = (item) => String(item.id) === String(scenario.lineId) || item.name === name || item.displayName === name
  const exists = async () =>
    hasItem(await getJson(page, adminUrl, '/api/getLineListSimplified', { shopId: scenario.shopId }), matcher)
  if (!(await exists())) return

  await open(page, adminUrl, `${route}/${scenario.lineId}/edit`)
  await clickTwoStepRemove(page, yesButton)
  await poll(async () => !(await exists()), `line ${name} removed`, 30_000)
}

async function removeShop(page, adminUrl, state) {
  if (!state.place?.id) return

  const name = state.place.name || `E2E ${state.runId}`
  const matcher = (item) => String(item.id) === String(state.place.id) || item.name === name || item.displayName === name
  const exists = async () => hasItem(await getJson(page, adminUrl, '/api/getShopListSimplified'), matcher)
  if (!(await exists())) return

  await open(page, adminUrl, `/shops/${state.place.id}/edit`)
  await clickTwoStepRemove(page, yesButton)
  await poll(async () => !(await exists()), `shop ${name} removed`, 30_000)
}

async function removeLineTemplate(page, adminUrl, state) {
  const template = state.lineTemplate
  if (!template?.createdByE2E || !template.id || !template.brandId) return

  const templates = unwrapList(
    await getJson(page, adminUrl, '/api/getLineTemplateList', { brandId: template.brandId })
  )
  if (!templates.some((item) => String(item.lineTemplateId || item.id) === String(template.id))) return

  const query = new URLSearchParams({
    brandId: template.brandId,
    lineTemplateId: template.id
  }).toString()
  await api(page, adminUrl, 'delete', `/api/deleteLineTemplate?${query}`)
  await poll(async () => {
    const next = unwrapList(
      await getJson(page, adminUrl, '/api/getLineTemplateList', { brandId: template.brandId })
    )
    return !next.some((item) => String(item.lineTemplateId || item.id) === String(template.id))
  }, `line template ${template.name} removed`, 30_000)
}

async function removeCampaignFixtures(page, adminUrl, state) {
  const advertisement = state.advertisement
  if (advertisement?.createdByE2E && advertisement.id && advertisement.campaignId) {
    const advertisementExists = async () => {
      const items = unwrapList(
        await getJson(page, adminUrl, '/api/getAdvtList', { campaignId: advertisement.campaignId }).catch(() => [])
      )
      return items.some((item) => String(item.id) === String(advertisement.id))
    }

    if (await advertisementExists()) {
      await api(page, adminUrl, 'delete', '/api/deleteAdvt', advertisement.id, {
        headers: { 'Content-Type': 'application/json' }
      })
      await poll(async () => !(await advertisementExists()), `advertisement ${advertisement.name} removed`, 30_000)
    }
  }

  const campaign = state.campaign
  if (campaign?.createdByE2E && campaign.id) {
    const campaignExists = async () => {
      const items = unwrapList(await getJson(page, adminUrl, '/api/getCampaignList'))
      return items.some((item) => String(item.id) === String(campaign.id))
    }

    if (await campaignExists()) {
      await api(page, adminUrl, 'delete', '/api/deleteCampaign', campaign.id, {
        headers: { 'Content-Type': 'application/json' }
      })
      await poll(async () => !(await campaignExists()), `campaign ${campaign.name} removed`, 30_000)
    }
  }
}

async function removeBeaconFixture(page, adminUrl, state) {
  const beacon = state.beacon
  if (!beacon?.createdByE2E || !beacon.id || !beacon.shopId) return

  const beaconExists = async () => {
    const items = unwrapList(
      await getJson(page, adminUrl, '/api/getBeaconList', { shopId: beacon.shopId }).catch(() => [])
    )
    return items.some((item) => String(item.id) === String(beacon.id))
  }

  if (!(await beaconExists())) return
  await api(page, adminUrl, 'delete', '/api/deleteBeacon', beacon.id, {
    headers: { 'Content-Type': 'application/json' }
  })
  await poll(async () => !(await beaconExists()), `beacon ${beacon.name} removed`, 30_000)
}

async function removeCallScreenFixture(page, adminUrl, state) {
  const callScreen = state.callScreen
  if (!callScreen?.createdByE2E || !callScreen.id || !callScreen.shopId) return

  const callScreenExists = async () => {
    const items = unwrapList(
      await getJson(page, adminUrl, '/api/getCallScreensList', { shopId: callScreen.shopId }).catch(() => [])
    )
    return items.some((item) => String(item.id) === String(callScreen.id))
  }

  if (!(await callScreenExists())) return
  await api(page, adminUrl, 'delete', '/api/deleteCallScreen', callScreen.id, {
    headers: { 'Content-Type': 'application/json' }
  })
  await poll(async () => !(await callScreenExists()), `call screen ${callScreen.name} removed`, 30_000)
}

async function removeTranslationFixture(page, adminUrl, state) {
  const translation = state.translation
  if (!translation?.createdByE2E || !translation.id || !translation.brandId) return

  const translationExists = async () => {
    const items = unwrapList(
      await getJson(page, adminUrl, '/api/getTranslationList', {
        term: translation.sourceText,
        brandId: translation.brandId
      }).catch(() => [])
    )
    return items.some((item) => String(item.id) === String(translation.id))
  }

  if (!(await translationExists())) return
  await api(page, adminUrl, 'delete', '/api/deleteTranslation', translation.id, {
    headers: { 'Content-Type': 'application/json' }
  })
  await poll(async () => !(await translationExists()), `translation ${translation.sourceText} removed`, 30_000)
}

async function removeTagFixture(page, adminUrl, state) {
  const tag = state.tag
  if (!tag?.createdByE2E || !tag.id) return

  const tagExists = async () => {
    const items = unwrapList(await getJson(page, adminUrl, '/api/getTagItemsList').catch(() => []))
    return items.some((item) => String(item.tag?.id || item.id) === String(tag.id))
  }

  if (!(await tagExists())) return
  await api(page, adminUrl, 'delete', `/api/removeTag?${new URLSearchParams({ id: tag.id }).toString()}`)
  await poll(async () => !(await tagExists()), `tag ${tag.name} removed`, 30_000)
}

export async function cleanupUiStand(page, adminUrl, state) {
  const items = scenarios(state).reverse()
  let cleanupError

  try {
    await removeCampaignFixtures(page, adminUrl, state)
  } catch (error) {
    cleanupError = error
  }

  try {
    await removeBeaconFixture(page, adminUrl, state)
  } catch (error) {
    if (!cleanupError) cleanupError = error
    else console.error(`[stand:cleanup:beacon:error] ${error.message}`)
  }

  try {
    await removeCallScreenFixture(page, adminUrl, state)
  } catch (error) {
    if (!cleanupError) cleanupError = error
    else console.error(`[stand:cleanup:call-screen:error] ${error.message}`)
  }

  try {
    await removeTranslationFixture(page, adminUrl, state)
  } catch (error) {
    if (!cleanupError) cleanupError = error
    else console.error(`[stand:cleanup:translation:error] ${error.message}`)
  }

  try {
    await removeTagFixture(page, adminUrl, state)
  } catch (error) {
    if (!cleanupError) cleanupError = error
    else console.error(`[stand:cleanup:tag:error] ${error.message}`)
  }

  try {
    for (const scenario of items) {
      for (const token of scenario.appointmentTokens || []) await removeAppointmentToken(page, adminUrl, scenario, token)
      for (const positionId of scenario.reservedPositionIds || []) await removeMonitoringPosition(page, adminUrl, scenario, positionId)
    }

    for (const scenario of items) await stopCheckpoint(page, adminUrl, scenario)

    for (const scenario of items) {
      const recordIds = new Set([
        ...(scenario.staffManagementIds || []).map(Number),
        ...(await discoverStaffRecordIds(page, adminUrl, scenario))
      ])
      for (const recordId of recordIds) await removeStaffRecord(page, adminUrl, scenario, recordId)
    }

    for (const scenario of items) await removeTerminal(page, adminUrl, state, scenario)
    for (const scenario of items) await removeCheckpoint(page, adminUrl, scenario)
    for (const scenario of items) await removeLine(page, adminUrl, state, scenario)
    await removeShop(page, adminUrl, state)
  } catch (error) {
    if (!cleanupError) cleanupError = error
    else console.error(`[stand:cleanup:entities:error] ${error.message}`)
  }

  try {
    await removeLineTemplate(page, adminUrl, state)
  } catch (error) {
    if (!cleanupError) cleanupError = error
    else console.error(`[stand:cleanup:line-template:error] ${error.message}`)
  }

  if (cleanupError) throw cleanupError
}
