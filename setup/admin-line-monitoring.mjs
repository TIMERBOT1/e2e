import { expect } from '@playwright/test'
import { loadEnv, poll, requiredEnv } from './shared.mjs'
import { jsonOrEmpty, open } from './ui-admin.mjs'

const nextButton = /^Далее$/i
const doneButton = /^Готово$/i

function adminUrl() {
  loadEnv()
  return requiredEnv('ADMIN_URL')
}

function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

function datePart(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    timeZone: 'Asia/Yekaterinburg'
  }).formatToParts(date)
  return parts.find((part) => part.type === 'day')?.value || ''
}

function localSlotDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Yekaterinburg'
  }).formatToParts(new Date(Number(value)))
  const part = (type) => parts.find((candidate) => candidate.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function todayDateKey() {
  return localSlotDateKey(Date.now())
}

function localSlotTime(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Yekaterinburg'
  }).format(new Date(Number(value)))
}

function samePhone(left, right) {
  return digits(left).endsWith(digits(right).slice(-10)) || digits(right).endsWith(digits(left).slice(-10))
}

async function waitJsonResponse(page, fragment, methods = ['GET', 'POST']) {
  const response = await page.waitForResponse(
    (res) => {
      const path = new URL(res.url()).pathname.replace(/\/$/, '')
      return path === fragment.replace(/\/$/, '') && methods.includes(res.request().method())
    },
    { timeout: 60_000 }
  )
  const body = await jsonOrEmpty(response)
  if (!response.ok()) {
    throw new Error(`${response.request().method()} ${fragment} failed: ${response.status()} ${JSON.stringify(body)}`)
  }
  return body
}

async function clickButton(page, name) {
  const button = page.getByRole('button', { name }).last()
  await expect(button).toBeVisible()
  await expect(button).toBeEnabled()
  await button.click()
}

async function clickDrawerNext(page, expectedHeading) {
  const textAction = page.getByText('Далее', { exact: true }).last()
  const actionButton = textAction.locator('xpath=ancestor::button[1]')
  await expect(actionButton).toBeVisible({ timeout: 30_000 })
  await expect(actionButton).toBeEnabled()
  await actionButton.dispatchEvent('click')
  if (expectedHeading) {
    await expect(page.getByText(expectedHeading, { exact: true }).last()).toBeVisible({ timeout: 30_000 })
  }
}

async function fillField(page, label, value) {
  await poll(async () => {
    const byRole = page.getByRole('textbox', { name: label, exact: false }).last()
    if (await byRole.isVisible().catch(() => false)) {
      await byRole.fill(String(value))
      await byRole.press('Tab')
      return true
    }

    const placeholder = page.getByPlaceholder(label, { exact: true }).last()
    if (await placeholder.isVisible().catch(() => false)) {
      await placeholder.fill(String(value))
      await placeholder.press('Tab')
      return true
    }

    return page.evaluate(
      ({ label, value }) => {
        const norm = (text) => (text || '').replace(/\s+/g, ' ').trim()
        const visible = (element) => {
          const style = getComputedStyle(element)
          const box = element.getBoundingClientRect()
          return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0
        }
        const textAround = (element) => {
          let node = element
          for (let i = 0; node && i < 7; i += 1, node = node.parentElement) {
            const text = norm(node.textContent)
            if (text.includes(label) && node.querySelectorAll('input, textarea').length <= 3) return text
          }
          return ''
        }
        const inputs = [...document.querySelectorAll('input, textarea')].filter((input) => !input.disabled && visible(input))
        const input =
          inputs.find((candidate) => norm(candidate.placeholder) === label) ||
          inputs.find((candidate) => textAround(candidate).includes(label))
        if (!input) return false
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        setter?.call(input, String(value))
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        input.dispatchEvent(new Event('blur', { bubbles: true }))
        return true
      },
      { label, value }
    )
  }, `input ${label}`, 30_000)
}

async function fillPhoneField(page, value) {
  const phone = page.getByRole('textbox', { name: 'Номер телефона' }).last()
  await expect(phone).toBeVisible({ timeout: 30_000 })
  await phone.fill('')
  await phone.fill(String(value))
  await page.keyboard.press('Tab')
}

async function fillJournalPhoneField(page, value) {
  const phone = page.locator('input[type="tel"]').last()
  await expect(phone).toBeVisible({ timeout: 30_000 })
  await phone.fill('')
  await phone.fill(String(value))
  await phone.press('Tab')
}

async function setSwitchNearText(page, text, desired) {
  const labels = page.getByText(text, { exact: true })
  const count = await labels.count()
  for (let i = count - 1; i >= 0; i -= 1) {
    const label = labels.nth(i)
    if (!(await label.isVisible().catch(() => false))) continue

    const container = label.locator('xpath=ancestor::*[.//input or .//*[@role="switch"] or .//*[@aria-pressed]][1]')
    const input = container.locator('input[type="checkbox"]').first()
    if (await input.count()) {
      if ((await input.isChecked()) === Boolean(desired)) return
      if (await input.isDisabled()) continue
      await input.setChecked(Boolean(desired))
      await expect(input).toBeChecked({ checked: Boolean(desired) })
      return
    }

    const toggle = container.locator('[role="switch"], [aria-pressed]').first()
    if (!(await toggle.count())) {
      const fallback = page.getByRole('switch').last()
      if (await fallback.count()) {
        const checked = (await fallback.getAttribute('aria-checked')) === 'true'
        if (checked !== Boolean(desired)) await fallback.click()
        await expect.poll(async () => (await fallback.getAttribute('aria-checked')) === 'true')
          .toBe(Boolean(desired))
        return
      }
      continue
    }
    if (await toggle.isDisabled().catch(() => false)) continue
    const checked = (await toggle.getAttribute('aria-checked')) === 'true' ||
      (await toggle.getAttribute('aria-pressed')) === 'true'
    if (checked !== Boolean(desired)) await toggle.click()
    await expect.poll(async () =>
      (await toggle.getAttribute('aria-checked')) === 'true' ||
      (await toggle.getAttribute('aria-pressed')) === 'true'
    ).toBe(Boolean(desired))
    return
  }

  throw new Error(`Enabled switch not found near: ${text}`)
}

async function chooseMonitoringDialogTime(page, kind, slotPosition = 'last') {
  const dialog = page.getByRole('dialog').last()
  const scope = await dialog.count() ? dialog : page.locator('main').last()
  await scope.getByText(datePart(), { exact: true }).last().click()

  if (kind === 'asap') {
    await expect(scope.getByText('Запись как можно скорее', { exact: true })).toBeVisible({ timeout: 30_000 })
    await setSwitchNearText(page, 'Запись как можно скорее', true)
    return 'asap'
  }

  await setSwitchNearText(page, 'Запись как можно скорее', false)
  const slots = scope.getByText(/^\d{1,2}:\d{2}$/)
  const slot = slotPosition === 'second' ? slots.nth(1) : slotPosition === 'first' ? slots.first() : slots.last()
  await expect(slot).toBeVisible({ timeout: 30_000 })
  const selectedTime = (await slot.textContent())?.trim()
  await slot.click({ timeout: 30_000 })
  return selectedTime
}

async function createAppointmentFromAppointments(page, scenario, person, offsetDays, source = 'appointments') {
  const isScheduler = source === 'scheduler'
  const path = isScheduler
    ? `/shops/${scenario.shopId}/lines/${scenario.lineId}/appointmentScheduler`
    : `/shops/${scenario.shopId}/lines/${scenario.lineId}/appointments`
  await open(page, adminUrl(), path)
  const addButton = isScheduler
    ? page.getByRole('button', { name: /^Добавить$/i }).first()
    : page.getByRole('button', { name: /^Добавить запись$/i }).first()
  await expect(addButton).toBeVisible({ timeout: 30_000 })
  await addButton.click()
  await expect(page.getByText('Создание записи', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Выбор очереди и услуги' })).toBeVisible({ timeout: 30_000 })
  await clickButton(page, nextButton)

  await expect(page.getByRole('heading', { name: 'Выбор даты и времени' })).toBeVisible({ timeout: 30_000 })
  await page.getByText(datePart(offsetDays), { exact: true }).last().click()
  const dialog = page.getByRole('dialog').last()
  const scope = await dialog.count() ? dialog : page.locator('main').last()
  const slot = scope.getByText(/^\d{1,2}:\d{2}$/).last()
  await expect(slot).toBeVisible({ timeout: 30_000 })
  const selectedTime = (await slot.textContent())?.trim()
  await slot.click()
  await clickButton(page, nextButton)

  await expect(page.getByRole('heading', { name: 'Ввод персональных данных' })).toBeVisible({ timeout: 30_000 })
  await fillField(page, 'Фамилия', person.lastName)
  await fillField(page, 'Имя и отчество', person.firstName)
  await fillField(page, 'Адрес электронной почты', person.email)
  await fillPhoneField(page, person.phone)
  await clickButton(page, nextButton)

  await expect(page.getByRole('heading', { name: 'Проверка данных' })).toBeVisible({ timeout: 30_000 })
  const [body] = await Promise.all([
    waitJsonResponse(page, '/api/positionsManagement/editForm', ['POST']),
    page.getByRole('button', { name: /^Создать запись$/i }).last().click()
  ])
  const data = body?.data || body
  const positionId = Number(data?.positionId || data?.id)
  if (!positionId) throw new Error(`Created appointment id not found: ${JSON.stringify(body)}`)
  if (offsetDays > 0 && data?.isAppointment !== true) {
    throw new Error(`Future appointment was not created as appointment: ${JSON.stringify(body)}`)
  }

  await expect(page.getByText('Запись успешно создана!', { exact: true })).toBeVisible({ timeout: 30_000 })
  await clickButton(page, doneButton)

  return { positionId, selectedTime, response: data }
}

async function createAppointmentFromPositionJournal(page, scenario, person, offsetDays) {
  await open(page, adminUrl(), '/position-journal')
  const createButton = page.getByRole('button', { name: /^Создать запись$/i }).first()
  await expect(createButton).toBeVisible({ timeout: 30_000 })
  await createButton.click()

  await expect(page.getByRole('heading', { name: 'Выбор очереди и услуги' })).toBeVisible({ timeout: 30_000 })
  const lineSelect = page.getByRole('combobox').last()
  await expect(lineSelect).toBeVisible({ timeout: 30_000 })
  await lineSelect.click()
  const line = page.getByRole('option', { name: scenario.lineName, exact: true })
  await expect(line).toBeVisible({ timeout: 30_000 })
  await line.click()
  await expect(page.getByText(scenario.serviceName, { exact: true }).last()).toBeVisible({ timeout: 30_000 })
  await clickDrawerNext(page, 'Выбор места')

  await expect(page.getByRole('heading', { name: 'Выбор места' })).toBeVisible({ timeout: 30_000 })
  const place = page.getByText(scenario.placeName, { exact: true }).last()
  await expect(place).toBeVisible({ timeout: 30_000 })
  await place.click()
  await clickDrawerNext(page, 'Выбор даты и времени')

  await page.getByText(datePart(offsetDays), { exact: true }).last().dispatchEvent('click')
  const slot = page.getByText(/^\d{1,2}:\d{2}$/).first()
  await expect(slot).toBeVisible({ timeout: 30_000 })
  const selectedTime = (await slot.textContent())?.trim()
  await slot.dispatchEvent('click')
  await clickDrawerNext(page, 'Ввод персональных данных')

  await expect(page.getByText('Ввод персональных данных', { exact: true }).last()).toBeVisible({ timeout: 30_000 })
  await fillField(page, 'Фамилия', person.lastName)
  await fillField(page, 'Имя и отчество', person.firstName)
  await fillField(page, 'Адрес электронной почты', person.email)
  await fillJournalPhoneField(page, person.phone)
  await clickDrawerNext(page, 'Проверка данных')

  await expect(page.getByText('Проверка данных', { exact: true }).last()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(scenario.serviceName, { exact: true }).last()).toBeVisible()
  await expect(page.getByText(person.lastName, { exact: true }).last()).toBeVisible()
  await expect(page.getByText(person.email, { exact: true }).last()).toBeVisible()
  const createAppointmentButton = page
    .getByText('Создать запись', { exact: true })
    .last()
    .locator('xpath=ancestor::button[1]')
  await expect(createAppointmentButton).toBeEnabled()
  const [body] = await Promise.all([
    waitJsonResponse(page, '/api/positionsManagement/editForm', ['POST']),
    createAppointmentButton.dispatchEvent('click')
  ])
  const data = body?.data || body
  const positionId = Number(data?.positionId || data?.id)
  if (!positionId) throw new Error(`Created appointment id not found: ${JSON.stringify(body)}`)
  if (offsetDays > 0 && data?.isAppointment !== true) {
    throw new Error(`Future appointment was not created as appointment: ${JSON.stringify(body)}`)
  }

  await expect(page.getByText('Запись успешно создана!', { exact: true })).toBeVisible({ timeout: 30_000 })
  const done = page.getByText('Готово', { exact: true }).last().locator('xpath=ancestor::button[1]')
  await expect(done).toBeEnabled()
  await done.dispatchEvent('click')

  return { positionId, selectedTime, response: data }
}

async function closeAppointmentForm(page) {
  await page.keyboard.press('Escape')
  const confirmation = page.getByText('Закрыть без сохранения?', { exact: true })
  if (await confirmation.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await page.getByRole('button', { name: /^Да, закрыть$/i }).click()
  }
  await expect(page.getByText('Создание записи', { exact: true })).toBeHidden({ timeout: 30_000 })
}

async function requestMonitoringTimeSlots(page, scenario) {
  const result = await page.evaluate(async (payload) => {
    const response = await fetch('/api/positionsManagement/getServiceDateTimes', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/vnd.jefile.bo.web.1+json',
        'Content-Type': 'application/json',
        'Form-Source': 'Monitoring'
      },
      body: JSON.stringify(payload)
    })
    const text = await response.text()
    return {
      ok: response.ok,
      status: response.status,
      body: text ? JSON.parse(text) : {}
    }
  }, {
    lineId: String(scenario.lineId),
    services: [{ name: scenario.serviceName, count: 1 }],
    positionType: 'ScreenCall',
    priority: false
  })

  if (!result.ok) throw new Error(`Monitoring getServiceDateTimes failed: ${result.status} ${JSON.stringify(result.body)}`)
  return result.body
}

function todaySlots(body) {
  const slots = (body?.times || body?.data?.times || []).filter(
    (slot) => localSlotDateKey(slot.startTime) === todayDateKey()
  )
  return { slots, times: slots.map((slot) => localSlotTime(slot.startTime)) }
}

async function openTodayMonitoringTimeStep(page, scenario) {
  await open(page, adminUrl(), `/shops/${scenario.shopId}/lines/${scenario.lineId}/lineMonitoring`)
  const addButton = page.locator('[aria-label="Добавить позицию"] button').first()
  const addPositionVisible = await addButton.isVisible({ timeout: 2_000 }).catch(() => false)
  if (!addPositionVisible) {
    const body = await requestMonitoringTimeSlots(page, scenario)
    return { body, ...todaySlots(body), addPositionVisible: false }
  }

  await addButton.click()
  await expect(page.getByText('Создание записи', { exact: true })).toBeVisible({ timeout: 30_000 })

  const responsePromise = waitJsonResponse(page, '/api/positionsManagement/getServiceDateTimes', ['POST'])
  await clickButton(page, nextButton)
  const body = await responsePromise
  await expect(page.getByRole('heading', { name: 'Выбор даты и времени' })).toBeVisible({ timeout: 30_000 })

  const { slots, times } = todaySlots(body)

  const today = page.getByText(datePart(), { exact: true }).last()
  if (await today.isVisible({ timeout: 2_000 }).catch(() => false)) await today.click()

  return { body, slots, times, addPositionVisible: true }
}

async function createMonitoringPositionFromDialog(page, scenario, kind, person) {
  await open(page, adminUrl(), `/shops/${scenario.shopId}/lines/${scenario.lineId}/lineMonitoring`)
  const addButton = page.locator('[aria-label="Добавить позицию"] button').first()
  await expect(addButton).toBeVisible({ timeout: 30_000 })
  await addButton.click()
  await expect(page.getByText('Создание записи', { exact: true })).toBeVisible({ timeout: 30_000 })
  await clickButton(page, nextButton)

  await expect(page.getByRole('heading', { name: 'Выбор даты и времени' })).toBeVisible({ timeout: 30_000 })
  const selectedTime = await chooseMonitoringDialogTime(page, kind)
  await clickButton(page, nextButton)

  await expect(page.getByRole('heading', { name: 'Ввод персональных данных' })).toBeVisible({ timeout: 30_000 })
  await fillField(page, 'Фамилия', person.lastName)
  await fillField(page, 'Имя и отчество', person.firstName)
  await fillField(page, 'Адрес электронной почты', person.email)
  await fillPhoneField(page, person.phone)
  await clickButton(page, nextButton)

  await expect(page.getByRole('heading', { name: 'Проверка данных' })).toBeVisible({ timeout: 30_000 })
  const [body] = await Promise.all([
    waitJsonResponse(page, '/api/positionsManagement/editForm', ['POST']),
    page.getByRole('button', { name: /^Создать запись$/i }).last().click()
  ])
  const data = body?.data || body
  const positionId = Number(data?.positionId || data?.id)
  if (!positionId || data?.isAppointment !== false) throw new Error(`Created monitoring position id not found: ${JSON.stringify(body)}`)

  await expect(page.getByText('Запись успешно создана!', { exact: true })).toBeVisible({ timeout: 30_000 })
  await clickButton(page, doneButton)

  return { positionId, selectedTime, response: data }
}

async function selectOperator(page, searchTerm) {
  const input = page.getByRole('combobox', { name: 'Поиск сотрудника', exact: false }).last()
  await expect(input).toBeVisible({ timeout: 30_000 })
  await input.fill(searchTerm)
  const option = page.getByRole('option').first()
  await expect(option).toBeVisible({ timeout: 30_000 })
  const operatorName = (await option.textContent())?.replace(/\s+/g, ' ').trim()
  await option.click()
  return operatorName
}

async function createTechnicalBreakFromDialog(page, scenario, operatorSearchTerm) {
  if (!scenario.technicalServiceName) throw new Error('Technical service fixture is missing')

  await open(page, adminUrl(), `/shops/${scenario.shopId}/lines/${scenario.lineId}/lineMonitoring`)
  const addButton = page.locator('[aria-label="Добавить позицию"] button').first()
  await expect(addButton).toBeVisible({ timeout: 30_000 })
  await addButton.click()
  await expect(page.getByText('Создание записи', { exact: true })).toBeVisible({ timeout: 30_000 })

  await setSwitchNearText(page, 'Технический перерыв', true)
  const operatorName = await selectOperator(page, operatorSearchTerm)
  await expect(page.getByText(scenario.technicalServiceName, { exact: true })).toBeVisible({ timeout: 30_000 })
  await clickButton(page, nextButton)

  await expect(page.getByRole('heading', { name: 'Выбор даты и времени' })).toBeVisible({ timeout: 30_000 })
  const checkpointChip = page.getByRole('button', { name: scenario.checkpointName, exact: true }).last()
  await expect(checkpointChip).toBeVisible({ timeout: 30_000 })
  await checkpointChip.click()
  await expect(checkpointChip).toHaveClass(/MuiChip-colorPrimary/)
  const selectedTime = await chooseMonitoringDialogTime(page, 'timed', 'second')
  await clickButton(page, nextButton)

  await expect(page.getByRole('heading', { name: 'Проверка данных' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(scenario.technicalServiceName, { exact: true })).toBeVisible()
  await expect(page.getByText(scenario.checkpointName, { exact: true })).toBeVisible()
  for (const part of operatorName.split(/\s+/).filter(Boolean)) {
    await expect(page.getByText(part, { exact: true })).toBeVisible()
  }

  const [body] = await Promise.all([
    waitJsonResponse(page, '/api/positionsManagement/editForm', ['POST']),
    page.getByRole('button', { name: /^Создать запись$/i }).last().click()
  ])
  const data = body?.data || body
  const positionId = Number(data?.positionId || data?.id)
  if (!positionId || data?.isAppointment !== false) throw new Error(`Created technical break id not found: ${JSON.stringify(body)}`)

  await expect(page.getByText('Запись успешно создана!', { exact: true })).toBeVisible({ timeout: 30_000 })
  await clickButton(page, doneButton)
  return { positionId, selectedTime, operatorName, response: data }
}

function expectTextInJson(value, expected, label) {
  expect(JSON.stringify(value), label).toContain(String(expected))
}

async function expectMonitoringPositionDetails(page, scenario, positionId, expected) {
  const body = await readLineMonitoring(page, scenario, positionId)
  const position = monitoringPosition(body, positionId)
  expect(position, `position ${positionId} in monitoring API`).toBeTruthy()
  expectTextInJson(position, expected.serviceName, 'monitoring API service')
  if (expected.firstName) expectTextInJson(position, expected.firstName, 'monitoring API first name')
  if (expected.lastName) expectTextInJson(position, expected.lastName, 'monitoring API last name')
  if (expected.phone) expect(digits(JSON.stringify(position))).toContain(digits(expected.phone).slice(-10))
  if (expected.checkpointId) expectTextInJson(position, expected.checkpointId, 'monitoring API checkpoint')
  if (expected.operatorName) {
    for (const part of expected.operatorName.split(/\s+/).filter(Boolean)) {
      expectTextInJson(position, part, 'monitoring API operator')
    }
  }
  if (expected.type) expect(String(position.type || position.positionType)).toBe(expected.type)
  if (expected.state) expect(String(position.state || position.status)).toBe(expected.state)

  const marker = expected.lastName || expected.serviceName
  const card = page.locator('[data-test="Position"]').filter({ hasText: marker }).first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card.getByText(expected.serviceName, { exact: false })).toBeVisible()
  if (expected.lastName) await expect(card.getByText(expected.lastName, { exact: false })).toBeVisible()
  if (expected.selectedTime) await expect(card.getByText(expected.selectedTime, { exact: true }).last()).toBeVisible()
  if (expected.operatorName) {
    for (const part of expected.operatorName.split(/\s+/).filter(Boolean)) {
      await expect(card.getByText(part, { exact: false }).first()).toBeVisible()
    }
  }
  if (expected.statusText) await expect(card.getByText(expected.statusText, { exact: false }).first()).toBeVisible()
  return position
}

async function readLineMonitoring(page, scenario, positionId) {
  const path = `/shops/${scenario.shopId}/lines/${scenario.lineId}/lineMonitoring${positionId ? `/${positionId}` : ''}`
  const responsePromise = waitJsonResponse(page, '/api/getLineNightClubMonitoring', ['GET'])
  if (new URL(page.url()).hash === `#${path}`) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 })
  } else {
    await open(page, adminUrl(), path)
  }
  return responsePromise
}

function monitoringPosition(body, positionId) {
  const data = body?.data || body
  return (data?.positions || []).find((position) => String(position.id) === String(positionId))
}

async function selectMonitoringPosition(page, scenario, positionId, person) {
  const body = await readLineMonitoring(page, scenario, positionId)
  if (!monitoringPosition(body, positionId)) {
    throw new Error(`Position ${positionId} is missing from active line monitoring`)
  }

  const card = page.locator('[data-test="Position"]').filter({ hasText: person.lastName }).first()
  await expect(card).toBeVisible({ timeout: 30_000 })

  const action = card
    .getByText('Готов к обслуживанию', { exact: true })
    .or(card.getByText('Вызвать', { exact: true }))
    .or(card.getByText('Начать обслуживание', { exact: true }))
    .first()
  if (!(await action.waitFor({ state: 'visible', timeout: 1_000 }).then(() => true).catch(() => false))) {
    await card.getByText(person.lastName, { exact: false }).first().click({ force: true })
  }
  await expect(action).toBeVisible({ timeout: 30_000 })
  return card
}

async function validatePositionIfAvailable(page, card) {
  const action = card.getByText('Готов к обслуживанию', { exact: true }).first()
  if (!(await action.isVisible().catch(() => false))) return false
  const container = action.locator('xpath=ancestor::div[contains(@class,"positionAction")][1]')
  if (/disabled|current/.test((await container.getAttribute('class')) || '')) return false

  const responsePromise = waitJsonResponse(page, '/api/validatePosition', ['POST'])
  await action.click()
  await responsePromise
  return true
}

async function clickPositionAction(page, card, label) {
  const action = card.getByText(label, { exact: true }).first()
  await expect(action).toBeVisible({ timeout: 30_000 })
  const responsePromise = waitJsonResponse(page, '/api/changePositionState', ['POST'])
  await action.click()

  const yes = page.getByRole('button', { name: /^Да$/i }).last()
  if (await yes.isVisible({ timeout: 2_000 }).catch(() => false)) await yes.click()

  const confirm = page.getByRole('button', { name: /^Подтвердить$/i }).last()
  if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click()

  await responsePromise
}

export async function loginAdmin(page) {
  loadEnv()

  const mode = await poll(async () => {
    await page.goto(`${adminUrl()}/#/login`, { waitUntil: 'domcontentloaded' })
    const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
    if (/502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout/i.test(bodyText)) {
      throw new Error(`admin login gateway error: ${bodyText.replace(/\s+/g, ' ').slice(0, 120)}`)
    }
    if (await page.locator('[data-test="LoginForm-Email"]').waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) return 'login'
    if (!String(page.url()).includes('/login')) return 'authenticated'
    return false
  }, 'admin login page', 60_000)
  if (mode === 'authenticated') return

  await page.locator('[data-test="LoginForm-Email"]').fill(requiredEnv('ADMIN_LOGIN'))
  await page.locator('[data-test="LoginForm-Password"]').fill(requiredEnv('ADMIN_PASSWORD'))
  await page.waitForFunction(() => !document.querySelector('[data-test="LoginForm-Submit"]')?.disabled)
  await page.locator('[data-test="LoginForm-Submit"]').click()
  await page.waitForURL((url) => !String(url).includes('/login'))
}

export async function openLineMonitoring(page, scenario) {
  const body = await readLineMonitoring(page, scenario)
  return body
}

export async function createLineMonitoringPosition(page, scenario, kind, person) {
  if (kind === 'future') {
    throw new Error('Future appointments must be created from appointments list, not active line monitoring')
  }

  return (await createMonitoringPositionFromDialog(page, scenario, kind, person)).positionId
}

export async function createLineMonitoringPositionWithDetails(page, scenario, kind, person) {
  return createMonitoringPositionFromDialog(page, scenario, kind, person)
}

export async function createTechnicalBreak(page, scenario, operatorSearchTerm) {
  return createTechnicalBreakFromDialog(page, scenario, operatorSearchTerm)
}

export async function expectCreatedMonitoringPosition(page, scenario, positionId, expected) {
  return expectMonitoringPositionDetails(page, scenario, positionId, expected)
}

export async function createTomorrowAppointment(page, scenario, person) {
  return (await createAppointmentFromAppointments(page, scenario, person, 1)).positionId
}

export async function createTomorrowAppointmentFromScheduler(page, scenario, person) {
  return createAppointmentFromAppointments(page, scenario, person, 1, 'scheduler')
}

export async function createTomorrowAppointmentFromPositionJournal(page, scenario, person) {
  return createAppointmentFromPositionJournal(page, scenario, person, 1)
}

export async function createTodayAppointment(page, scenario, person) {
  return createAppointmentFromAppointments(page, scenario, person, 0)
}

export async function inspectTodayAppointmentSlots(page, scenario) {
  const { times, addPositionVisible } = await openTodayMonitoringTimeStep(page, scenario)
  const noSlots = page.getByText('Нет свободного времени для записи', { exact: true })

  if (addPositionVisible) {
    if (times.length) {
      await expect(page.getByText(times.at(-1), { exact: true }).last()).toBeVisible({ timeout: 30_000 })
    } else {
      await expect(noSlots).toBeVisible({ timeout: 30_000 })
    }
  }

  const noSlotsVisible = addPositionVisible && await noSlots.isVisible().catch(() => false)
  if (addPositionVisible) await closeAppointmentForm(page)
  return { times, noSlotsVisible, addPositionVisible }
}

export async function completeLineMonitoringPosition(page, scenario, positionId, person) {
  let card = await selectMonitoringPosition(page, scenario, positionId, person)
  if (await validatePositionIfAvailable(page, card)) {
    card = await selectMonitoringPosition(page, scenario, positionId, person)
  }
  await clickPositionAction(page, card, 'Вызвать')
  card = await selectMonitoringPosition(page, scenario, positionId, person)
  await clickPositionAction(page, card, 'Начать обслуживание')
  card = await selectMonitoringPosition(page, scenario, positionId, person)
  await clickPositionAction(page, card, 'Закончить обслуживание')
}

export async function expectPositionAbsentFromLineMonitoring(page, scenario, positionId) {
  await poll(async () => !monitoringPosition(await readLineMonitoring(page, scenario), positionId), `position ${positionId} removed from active monitoring`, 30_000)
}

export async function expectPositionJournalDetails(page, record) {
  await open(page, adminUrl(), '/')
  await open(page, adminUrl(), '/position-journal')

  const search = page.getByRole('textbox', { name: 'Найти' })
  await expect(search).toBeVisible({ timeout: 30_000 })
  await search.fill(`p${record.positionId}`)

  const journalResponse = waitJsonResponse(page, '/api/reports/getPositionJournal', ['POST'])
  await clickButton(page, /^Найти$/i)
  await journalResponse

  await expect(page.getByText('1 запись', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(record.lastName, { exact: false })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(record.firstName, { exact: false })).toBeVisible()

  const detailsResponse = waitJsonResponse(page, '/api/reports/getPositionJournalDetails', ['GET'])
  await clickButton(page, /^Подробнее$/i)
  const detailsBody = await detailsResponse
  const details = detailsBody?.data || detailsBody

  expect(Number(details?.positionId), `details position id for ${record.kind}`).toBe(Number(record.positionId))
  expect([details?.customer?.lastName, details?.customer?.firstName].filter(Boolean).join(' ')).toContain(record.lastName)
  expect([details?.customer?.lastName, details?.customer?.firstName].filter(Boolean).join(' ')).toContain(record.firstName)
  expect(samePhone(details?.customer?.phoneNumber, record.phone), `details phone for ${record.kind}`).toBeTruthy()
  expect(String(details?.lineName || details?.line || '')).toContain(record.scenario.lineName)
  expect(JSON.stringify(details)).toContain(record.scenario.checkpointName)
  expect(JSON.stringify(details)).toContain(record.scenario.serviceName)
  expect(String(details?.status)).toMatch(/Finished/i)
  await expect(page.getByText('Завершена', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await page.keyboard.press('Escape').catch(() => {})
}
