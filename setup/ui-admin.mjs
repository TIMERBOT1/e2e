import { expect } from '@playwright/test'
import { poll, saveState, unwrapData, unwrapList } from './shared.mjs'

const saveButton = /^Сохранить$/i

export function adminRoute(adminUrl, path) {
  return `${adminUrl}/#${path}`
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function jsonOrEmpty(response) {
  return response.text().then((text) => {
    if (!text) return undefined
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  })
}

export function responseHas(response, fragment, methods = ['POST']) {
  return methods.includes(response.request().method()) && response.url().toLowerCase().includes(fragment.toLowerCase())
}

export async function open(page, adminUrl, path) {
  await page.goto(adminRoute(adminUrl, path), { waitUntil: 'domcontentloaded' })
  await page.locator('body').waitFor({ timeout: 30_000 })
}

async function fillText(page, label, value, index = 0) {
  await poll(async () => {
    const exact = page.getByLabel(label, { exact: true }).nth(index)
    if (await exact.isVisible().catch(() => false)) {
      await exact.fill(String(value))
      return true
    }

    const placeholder = page.getByPlaceholder(label, { exact: true }).nth(index)
    if (await placeholder.isVisible().catch(() => false)) {
      await placeholder.fill(String(value))
      return true
    }

    return page.evaluate(
      ({ label, value, index }) => {
        const norm = (text) => (text || '').replace(/\s+/g, ' ').trim()
        const visible = (element) => {
          const style = getComputedStyle(element)
          const box = element.getBoundingClientRect()
          return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0
        }
        const textAround = (element) => {
          let node = element
          for (let i = 0; node && i < 6; i += 1, node = node.parentElement) {
            const text = norm(node.textContent)
            if (text.includes(label) && node.querySelectorAll('input, textarea').length <= 3) return text
          }
          return ''
        }
        const inputs = [...document.querySelectorAll('input, textarea')].filter((input) => !input.disabled && visible(input))
        const matches = inputs
          .map((input) => ({ input, text: textAround(input) }))
          .filter((item) => item.text.includes(label) || norm(item.input.placeholder) === label)
          .sort((a, b) => a.text.length - b.text.length)
        const input = matches[index]?.input
        if (!input) return false
        const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, String(value))
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      },
      { label, value, index }
    )
  }, `input ${label}`, 30_000)
}

async function fillTime(page, label, value, index = 0) {
  const [hours, minutes] = String(value).split(':')
  await poll(async () => {
    const field = page.getByLabel(label, { exact: true }).nth(index)
    if (!(await field.isVisible().catch(() => false))) return false

    const hour = field.getByRole('spinbutton', { name: /hours/i }).first()
    const minute = field.getByRole('spinbutton', { name: /minutes/i }).first()
    if ((await hour.isVisible().catch(() => false)) && (await minute.isVisible().catch(() => false))) {
      await hour.fill(hours)
      await minute.fill(minutes)
      return true
    }

    const input = field.locator('input').first()
    if (await input.isVisible().catch(() => false)) {
      await input.fill(value)
      return true
    }

    await field.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(value)
    await page.keyboard.press('Enter')
    return true
  }, `time ${label}`, 30_000)
}

function hourText(value) {
  const minutes = Math.round(Number(value) * 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

async function fillTimeInputs(page, label, value) {
  const inputs = page.locator('.MuiFormControl-root').filter({ hasText: label }).locator('input')
  const count = await poll(async () => (await inputs.count()) || false, `schedule ${label}`, 30_000)
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i)
    await input.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(value)
    await input.press('Tab')
  }
}

async function clickText(page, text) {
  const item = page.getByText(text, { exact: true }).first()
  await item.waitFor({ state: 'visible', timeout: 30_000 })
  await item.click({ force: true })
}

async function clickLastText(page, text) {
  await page.getByText(text, { exact: true }).last().click()
}

async function openUserBookingTab(page, tab, marker) {
  const nav = page.locator('nav')
  await poll(async () => {
    if (await page.getByText(marker, { exact: true }).first().isVisible({ timeout: 500 }).catch(() => false)) return true

    await nav.getByText('Запись пользователя', { exact: true }).first().click({ force: true, timeout: 1_000 }).catch(() => {})
    const items = nav.getByText(tab, { exact: true })
    for (let i = (await items.count()) - 1; i >= 0; i -= 1) {
      const item = items.nth(i)
      if (!(await item.isVisible().catch(() => false))) continue
      await item.click({ force: true, timeout: 1_000 })
      return page.getByText(marker, { exact: true }).first().isVisible({ timeout: 1_000 }).catch(() => false)
    }

    return false
  }, `user booking tab ${tab}`, 30_000)
}

async function setToggle(page, label, desired) {
  await poll(async () => {
    const exact = page.getByLabel(label, { exact: true }).first()
    const checked = await exact.isChecked({ timeout: 500 }).catch(() => undefined)
    if (checked !== undefined) {
      if (checked !== Boolean(desired)) await exact.setChecked(Boolean(desired), { force: true })
      return true
    }

    return page.evaluate(
      ({ label, desired }) => {
        const norm = (text) => (text || '').replace(/\s+/g, ' ').trim()
        const visible = (element) => {
          const style = getComputedStyle(element)
          const box = element.getBoundingClientRect()
          return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0
        }
        const byText = [...document.querySelectorAll('label, p, span, div')]
          .filter((element) => visible(element) && norm(element.textContent).includes(label))
          .sort((a, b) => norm(a.textContent).length - norm(b.textContent).length)
        let input
        for (const item of byText) {
          for (let node = item; node && !input; node = node.parentElement) {
            input = node.querySelector('input[type="checkbox"]:not(:disabled)')
          }
          if (input) break
        }
        if (!input) return false
        if (Boolean(input.checked) !== Boolean(desired)) input.click()
        return true
      },
      { label, desired }
    )
  }, `toggle ${label}`, 30_000)
}

async function setToggleIfVisible(page, label, desired) {
  if (await page.getByText(label, { exact: true }).first().isVisible({ timeout: 3_000 }).catch(() => false)) {
    await setToggle(page, label, desired)
  }
}

async function saveAndWait(page, fragment, methods = ['POST']) {
  const [response] = await Promise.all([
    page.waitForResponse((item) => responseHas(item, fragment, methods), { timeout: 30_000 }),
    page.getByRole('button', { name: saveButton }).first().click()
  ])
  if (!response.ok()) throw new Error(`${response.request().method()} ${fragment} failed: ${response.status()}`)
  return jsonOrEmpty(response)
}

export {
  fillTime as fillAdminTime,
  fillText as fillAdminText,
  saveAndWait as saveAdminAndWait,
  setToggle as setAdminToggle,
  setToggleIfVisible as setAdminToggleIfVisible
}

async function waitListItem(page, adminUrl, path, fragment, name) {
  return poll(async () => {
    const responsePromise = page.waitForResponse((response) => response.url().toLowerCase().includes(fragment.toLowerCase()), {
      timeout: 30_000
    })
    await page.goto(adminRoute(adminUrl, path), { waitUntil: 'domcontentloaded' })
    const body = await jsonOrEmpty(await responsePromise)
    return unwrapList(body).find((item) => item.name === name || item.displayName === name)
  }, `UI list item ${name}`)
}

async function selectFirstDropdown(page, testId, optionName) {
  await poll(async () => {
    const control = page.locator(`[data-test="${testId}"]`).first()
    const combobox = control.getByRole('combobox').first()
    if (!(await combobox.isVisible().catch(() => false))) return false
    await combobox.click()
    const option = optionName ? page.getByRole('option', { name: optionName }).first() : page.getByRole('option').first()
    if (!(await option.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false))) return false
    await option.click()
    const current = (await combobox.textContent().catch(() => '')).replace(/[\u200B\uFEFF]/g, '').trim()
    if (!optionName) return Boolean(current)
    return optionName instanceof RegExp ? optionName.test(current) : current.includes(String(optionName))
  }, `dropdown ${testId}`, 30_000)
}

async function selectDropdownValue(page, testId, value, optionName) {
  await poll(async () => {
    const control = page.locator(`[data-test="${testId}"]`).first()
    const combobox = control.getByRole('combobox').first()
    if (!(await combobox.isVisible().catch(() => false))) return false

    const input = control.locator('input').first()
    if ((await input.inputValue().catch(() => '')) === value) return true

    await combobox.click()
    const byValue = page.locator(`[role="option"][data-value="${value}"]`).first()
    const option = (await byValue.isVisible({ timeout: 1_000 }).catch(() => false))
      ? byValue
      : page.getByRole('option', { name: optionName }).first()
    if (!(await option.isVisible({ timeout: 1_000 }).catch(() => false))) return false
    await option.click()

    return (await input.inputValue().catch(() => '')) === value
  }, `dropdown ${testId} ${value}`, 30_000)
}

async function selectAutocomplete(page, placeholder, option) {
  const options = Array.isArray(option) ? option : [option]
  const input = page.getByPlaceholder(placeholder, { exact: true }).last()
  for (const item of options) {
    await input.fill(item)
    const exact = page.getByText(item, { exact: true }).last()
    if (await exact.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await exact.click()
      return
    }
  }
  await page.getByRole('option').first().click()
}

async function addAutocompleteItem(page, label, itemName) {
  const section = page.locator('section').filter({ hasText: label }).first()
  await section.getByRole('combobox').or(section.locator('input')).last().fill(itemName)
  await page.getByRole('option', { name: new RegExp(escapeRe(itemName)) }).first().click()
  await section.getByRole('button', { name: /Добавить/i }).last().click()
}

async function addSelectItem(page, label, itemName) {
  await poll(async () => {
    const section = page
      .locator('section')
      .filter({ hasText: label })
      .filter({ has: page.getByRole('button', { name: /Добавить/i }) })
      .last()
    if (!(await section.isVisible().catch(() => false))) return false
    const button = section.getByRole('button', { name: /Добавить/i }).last()
    if (
      (await section.getByText(itemName, { exact: false }).first().isVisible().catch(() => false)) &&
      (await button.isEnabled().catch(() => false))
    ) {
      await button.click()
      return true
    }
    const combobox = section.getByRole('combobox').last()
    if (!(await combobox.isVisible().catch(() => false))) return false
    await combobox.click()
    const option = page.getByRole('option', { name: new RegExp(escapeRe(itemName)) }).first()
    if (!(await option.isVisible({ timeout: 1_000 }).catch(() => false))) return false
    await option.click()
    if (!(await button.isEnabled({ timeout: 1_000 }).catch(() => false))) return false
    await button.click()
    return true
  }, `${label} ${itemName}`, 30_000)
}

async function createService(page, name, durationMinutes, options = {}) {
  await poll(async () => {
    await clickText(page, 'Настройки услуг')
    await clickText(page, 'Список услуг')
    const addButton = page.getByRole('button', { name: /^Добавить$/ }).last()
    if (!(await addButton.isVisible({ timeout: 1_000 }).catch(() => false))) return false
    await addButton.click()
    return true
  }, 'service add form', 30_000)
  await fillText(page, 'Название услуги', name)
  await fillText(page, 'Ключ', name.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'service')
  await fillText(page, 'Длительность', durationMinutes)
  if (options.isPrivate) await setToggle(page, 'Техническая услуга', true)
  await page.getByRole('button', { name: /^Применить$/ }).click()
  await page.getByText(name, { exact: true }).waitFor({ timeout: 10_000 })
}

async function setLineTerminalOptions(page, options = {}) {
  await openUserBookingTab(page, 'Терминал', 'Разрешить запись как можно скорее')
  const allowAsap = options.allowAsapTerminalBooking ?? true
  if (allowAsap) await setToggle(page, 'Разрешить запись как можно скорее', false)
  await setToggle(page, 'Разрешить запись как можно скорее', allowAsap)
  await setToggle(page, 'Разрешить запись на сегодня ко времени', options.allowTodayTerminalBooking ?? true)
  await setToggle(page, 'Разрешить запись на будущие дни', options.allowFutureTerminalBooking ?? false)
}

async function setLineJoiningMethods(page) {
  await openUserBookingTab(page, 'Основные', 'Мониторинг очереди')
  await setToggle(page, 'Мониторинг очереди', true)
}

async function setLineBackofficeOptions(page) {
  const todayBackofficeLabel = 'Возможность записывать на сегодня через раздел "Бронирования"'
  await openUserBookingTab(page, 'Административная панель', todayBackofficeLabel)
  const label = page.getByText(todayBackofficeLabel, { exact: true }).last()
  const toggle = label
    .locator('xpath=ancestor::div[.//input[@role="switch"]][1]')
    .getByRole('switch')
    .first()
  await toggle.setChecked(true)
  await poll(() => toggle.isChecked(), 'backoffice today booking toggle', 10_000)
}

async function openLineSettingsGroup(page, group, marker) {
  if (await page.getByText(marker, { exact: true }).first().isVisible({ timeout: 500 }).catch(() => false)) return

  const nav = page.locator('nav')
  await nav.getByText(group, { exact: true }).last().click({ force: true })
  await page.getByText(marker, { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 })
}

async function setCheckpointTestOptions(page, options = {}) {
  if (options.requestCheckpointHostEditReason !== undefined) {
    const label = 'Запрашивать комментарий при редактировании точки обслуживания во время ее работы'
    await openLineSettingsGroup(page, 'Точки обслуживания', label)
    await setToggle(page, label, options.requestCheckpointHostEditReason)
  }

  if (options.displayPositionValidate !== undefined) {
    const label = 'Отмечать как "Готов к обслуживанию"'
    await openLineSettingsGroup(page, 'Мониторинг', label)
    await setToggle(page, label, options.displayPositionValidate)
  }
}

async function setLineSchedule(page, options = {}) {
  await clickText(page, 'Расписание работы')
  if (options.openingHour == null || options.closingHour == null) {
    await setToggle(page, 'Круглосуточно', true)
    return
  }

  await setToggle(page, 'Круглосуточно', false)
  await fillTimeInputs(page, 'Начало', hourText(options.openingHour))
  await fillTimeInputs(page, 'Конец', hourText(options.closingHour))
}

async function setFutureAppointment(page, enabled, options = {}) {
  await openUserBookingTab(page, 'Основные', 'Предварительная запись на будущие дни')
  await setToggle(page, 'Запись как можно скорее', options.asapMode ?? true)
  await setToggle(page, 'Запись на сегодня ко времени', options.manageAppointments ?? true)
  await setToggle(page, 'Предварительная запись на будущие дни', enabled)
  if (enabled) {
    await clickText(page, 'Предварительная запись')
    await fillText(page, 'Глубина предварительной записи для всех способов записи', 14)
  }
}

async function setNoSlots(page) {
  const nav = page.locator('nav')
  if (!(await nav.getByText('Список услуг', { exact: true }).isVisible().catch(() => false))) {
    await nav.getByText('Настройки услуг', { exact: true }).click()
  }
  await nav.getByText('Основные', { exact: true }).last().click()
  await setToggle(page, 'Запрашивать количество', true)
  await fillText(page, 'Максимальное значение поля количество', 1)
}

async function readLine(page, adminUrl, shopId, lineId) {
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/getLine') && response.url().includes(`id=${lineId}`),
    { timeout: 30_000 }
  )
  await page.goto(adminRoute(adminUrl, `/shops/${shopId}/lines/${lineId}/edit`), { waitUntil: 'domcontentloaded' })
  return unwrapData(await jsonOrEmpty(await responsePromise))
}

export async function createUiShop(page, adminUrl, runId) {
  const name = `E2E ${runId}`
  await open(page, adminUrl, '/shops/create')
  await selectFirstDropdown(page, 'ShopEdit-BrandId')
  await fillText(page, 'Название', name)
  await fillText(page, 'Краткое название', `E2E_${runId.slice(-8)}`)
  await fillText(page, 'Описание', name)
  await poll(async () => {
    if (await page.getByPlaceholder('Адрес', { exact: true }).isVisible().catch(() => false)) return true
    await clickText(page, 'Геопозиция')
    return page.getByPlaceholder('Адрес', { exact: true }).isVisible({ timeout: 1_000 }).catch(() => false)
  }, 'shop geolocation section', 30_000)
  await fillText(page, 'Адрес', 'E2E street')
  await fillText(page, 'Город', 'E2E')
  await fillText(page, 'Широта', '55.751244')
  await fillText(page, 'Долгота', '37.618423')
  await fillText(page, 'Радиус обнаружения очереди', '100')
  await page.getByText('Russian', { exact: true }).click()
  await selectAutocomplete(page, 'Страна', ['Российская Федерация', 'Russian Federation'])
  await selectDropdownValue(page, 'ShopEdit-TimeZone', 'Asia/Yekaterinburg', /Екатеринбург|Yekaterinburg/)
  await saveAndWait(page, '/api/createShop')
  const shop = await waitListItem(page, adminUrl, '/shops', '/api/getShopListSimplified', name)
  return { id: Number(shop.id), name }
}

export async function createUiLine(page, adminUrl, shopId, runId, key, options = {}) {
  const name = `E2E ${key} ${runId}`.slice(0, 80)
  const shortName = `E2E_${key}_${runId.slice(-4)}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)
  const serviceName = `${key} service ${runId}`.slice(0, 80)
  const serviceNames = [
    serviceName,
    ...Array.from(
      { length: Number(options.additionalServiceCount || 0) },
      (_, index) => `${key} service ${index + 2} ${runId}`.slice(0, 80)
    )
  ]
  const serviceDuration = Math.round((options.serviceDuration ?? 15 * 60) / 60)
  const serviceTime = Math.round((options.serviceTime ?? 15 * 60) / 60)
  const technicalServiceName = options.technicalService
    ? `${key} technical service ${runId}`.slice(0, 80)
    : undefined

  await open(page, adminUrl, `/shops/${shopId}/lines/create`)
  await fillText(page, 'Название', name)
  await fillText(page, 'Системное название', shortName)
  await fillText(page, 'Длительность временного интервала', serviceTime)
  await setFutureAppointment(page, options.allowFutureAppointments ?? true, options)
  await setLineJoiningMethods(page)
  await setCheckpointTestOptions(page, options)
  await setLineTerminalOptions(page, options)
  await setLineSchedule(page, options)
  for (const itemName of serviceNames) await createService(page, itemName, serviceDuration)
  if (technicalServiceName) await createService(page, technicalServiceName, serviceDuration, { isPrivate: true })
  if (options.maxSimultaneous) await setNoSlots(page)

  const createBody = await saveAndWait(page, '/api/createLine')
  let lineId = Number(createBody?.lineId || createBody?.id)
  if (!lineId) {
    const urlMatch = String(page.url()).match(/\/lines\/(\d+)\/checkpoints\/create/)
    lineId = Number(urlMatch?.[1])
  }
  if (!lineId) {
    const line = await waitListItem(page, adminUrl, `/shops/${shopId}/lines`, '/api/getLineListSimplified', name)
    lineId = Number(line.id)
  }

  let full = await readLine(page, adminUrl, shopId, lineId)
  if (options.showTodayBackofficeBooking) {
    await setLineBackofficeOptions(page)
    await saveAndWait(page, '/api/updateLine', ['PUT', 'POST'])
    full = await readLine(page, adminUrl, shopId, lineId)
    if (!full.showTimeslotsForTodayInBackoffice) {
      throw new Error(`Backoffice today booking setting was not saved for ${name}`)
    }
  }
  const services = serviceNames
    .map((itemName) => full.services?.find((item) => item.name === itemName || item.displayName === itemName))
    .filter(Boolean)
  const service = services[0] || full.services?.[0]
  if (!service?.id) throw new Error(`Service id not found for ${name}`)
  const technicalService = technicalServiceName
    ? full.services?.find((item) => item.name === technicalServiceName || item.displayName === technicalServiceName)
    : undefined
  if (technicalServiceName && !technicalService?.id) throw new Error(`Technical service id not found for ${name}`)

  return {
    id: lineId,
    name,
    serviceId: Number(service.id),
    serviceName,
    serviceIds: services.map((item) => Number(item.id)),
    serviceNames,
    technicalServiceId: technicalService ? Number(technicalService.id) : undefined,
    technicalServiceName
  }
}

export async function createUiCheckpoint(page, adminUrl, shopId, lineId, runId, key) {
  const name = `E2E ${key}`.slice(0, 20)
  await open(page, adminUrl, `/shops/${shopId}/lines/${lineId}/checkpoints/create`)
  await fillText(page, 'Название точки обслуживания', name)
  await fillText(page, 'Описание', `E2E ${key} ${runId}`.slice(0, 100))
  await saveAndWait(page, '/api/createCheckpoint')
  const checkpoint = await waitListItem(
    page,
    adminUrl,
    `/shops/${shopId}/lines/${lineId}/checkpoints`,
    '/api/getCheckpointList',
    name
  )
  return { id: Number(checkpoint.id), name }
}

export async function startUiCheckpoint(page, adminUrl, shopId, lineId, checkpointId) {
  await open(page, adminUrl, `/shops/${shopId}/lines/${lineId}/checkpoints/${checkpointId}/host`)
  await page.locator('[data-test="CheckpointHost-Action-start"]').click()
  await page.locator('[data-test="CheckpointHost-WorkScheduleMode-lineSchedule"]').click()
  const allServices = page.locator('[data-test="CheckpointHost-AllServices"]')
  if ((await allServices.textContent()).trim() === 'Выбрать все') await allServices.click()
  await expect(page.locator('[data-test="CheckpointHost-AllServices"]')).not.toHaveText(/Выбрать все/)
  await expect(page.locator('[data-test="CheckpointHost-ApplyButton"]')).toBeEnabled()
  const hostPath = `/checkpoints/${checkpointId}/host`
  const [response] = await Promise.all([
    page.waitForResponse((item) => responseHas(item, '/api/updateCheckpointHost', ['PUT']), { timeout: 30_000 }),
    page.waitForURL((url) => !String(url).includes(hostPath), { timeout: 30_000 }),
    page.locator('[data-test="CheckpointHost-ApplyButton"]').click()
  ])
  if (!response.ok()) throw new Error(`PUT /api/updateCheckpointHost failed: ${response.status()}`)
}

async function terminalFromList(page, adminUrl, name) {
  return waitListItem(page, adminUrl, `/terminals?term=${encodeURIComponent(name)}`, '/api/getTerminalList', name)
}

export async function createUiTerminal(page, adminUrl, shopId, lineId, key, runId, enabled = true, lineName, options = {}) {
  const name = `E2E ${key} ${runId}`.slice(0, 80)
  await open(page, adminUrl, '/terminals/create')
  await page.getByLabel('Веб-терминал').check()
  await fillText(page, 'Название', name)
  await fillText(page, 'Краткое название', `E2E_${key}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))
  await fillText(page, 'Отображаемое название', name)
  if (options.displayConfirmationScreen !== undefined) {
    await setToggleIfVisible(page, 'Показывать финальный экран с информацией о записи', options.displayConfirmationScreen)
  }
  const lineListResponse = page.waitForResponse((response) => response.url().includes('/api/getLineListSimplified'), {
    timeout: 30_000
  })
  await addAutocompleteItem(page, 'Места', `E2E ${runId}`)
  await lineListResponse
  await addSelectItem(page, 'Управляемые очереди', lineName)
  await saveAndWait(page, '/api/createTerminal')

  const terminal = await terminalFromList(page, adminUrl, name)
  if (Boolean(terminal.enabled) !== Boolean(enabled)) {
    const row = page.locator('li').filter({ hasText: name }).first()
    const endpoint = enabled ? '/api/enableTerminal' : '/api/disableTerminal'
    const responsePromise = page.waitForResponse((response) => responseHas(response, endpoint), { timeout: 30_000 })
    await row.locator('input[type="checkbox"]').click()
    await responsePromise
  }

  const fullResponse = page.waitForResponse(
    (response) => response.url().includes('/api/getTerminal') && response.url().includes(`id=${terminal.id}`),
    { timeout: 30_000 }
  )
  await page.goto(adminRoute(adminUrl, `/terminals/${terminal.id}/edit`), { waitUntil: 'domcontentloaded' })
  const fullTerminal = unwrapData(await jsonOrEmpty(await fullResponse))
  if (
    options.displayConfirmationScreen !== undefined &&
    Boolean(fullTerminal.displayConfirmationScreen) !== Boolean(options.displayConfirmationScreen)
  ) {
    await setToggle(page, 'Показывать финальный экран с информацией о записи', options.displayConfirmationScreen)
    await saveAndWait(page, '/api/updateTerminal', ['PUT', 'POST'])
  }

  return {
    adminId: Number(terminal.id),
    guid: fullTerminal.guid || terminal.guid || fullTerminal.monitoringId || terminal.monitoringId || fullTerminal.terminalId,
    name
  }
}

function tomorrowRu() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return [date.getDate(), date.getMonth() + 1, date.getFullYear()].map((part) => String(part).padStart(2, '0')).join('.')
}

export async function createUiStaffManagementRecord(page, adminUrl, scenario, serviceName, checkpointName) {
  await open(page, adminUrl, `/shops/${scenario.shopId}/lines/${scenario.lineId}/staffManagement/create`)
  await fillText(page, 'Дата', tomorrowRu())
  await setToggle(page, serviceName, true)
  await fillText(page, 'Количество точек обслуживания', 1)
  await fillTime(page, 'Время начала работы', '00:00')
  await fillTime(page, 'Время завершения работы', '23:59')
  const body = await saveAndWait(page, '/api/createStaffManagementRecord')
  return Number(body?.id || body?.Id)
}

export async function cleanupPreparedState(page, adminUrl, state) {
  try {
    const cleanup = await import('./cleanup-ui.mjs')
    if (cleanup.cleanupUiStand) await cleanup.cleanupUiStand(page, adminUrl, state)
  } catch (error) {
    console.error(`[stand:prepare:cleanup-ui:error] ${error.message}`)
  } finally {
    saveState(state)
  }
}
