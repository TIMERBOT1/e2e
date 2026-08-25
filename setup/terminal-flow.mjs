import { expect } from '@playwright/test'
import { terminalUrl } from './shared.mjs'

async function fillReadonlyInputs(page, values) {
  await page.evaluate((values) => {
    const setValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

      setter?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }

    document.querySelectorAll('input').forEach((element, index) => {
      if (values[index] != null) {
        setValue(element, values[index])
      }
    })
  }, values)
}

export async function openTerminal(page, scenario) {
  await page.goto(terminalUrl(scenario.terminalId))
  const intro = page.locator('[data-test="intro"]')
  const langRu = page.locator('[data-test="lang-ru"]')
  await expect(intro).toBeVisible()
  for (let i = 0; i < 3 && !(await langRu.isVisible({ timeout: 1_000 }).catch(() => false)); i += 1) {
    if (await intro.isVisible().catch(() => false)) await intro.click({ force: true })
    else await page.mouse.click(1, 1)
  }
  await langRu.click({ force: true })
  await page.getByRole('button', { name: '1' }).click({ force: true })
}

export async function fillPersonalData(page, phone = '+79000000001') {
  await expect(page.locator('[data-test="common-title"]')).toContainText('Введите личные данные')
  await fillReadonlyInputs(page, ['Тестов', 'Тест'])
  await page.locator('[data-test="btn-next"]').click({ force: true })

  await expect(page.locator('[data-test="common-phone-title"]')).toContainText('Введите ваш контактный номер')
  await fillReadonlyInputs(page, [phone])
  await page.locator('[data-test="btn-next"]').click({ force: true })
}

export async function createFutureAppointmentFromTerminal(page, scenario, phone, expectFinalScreen) {
  await openTerminal(page, scenario)
  await fillPersonalData(page, phone)

  await expect(page.locator('[data-test="notification-sms"]')).toContainText('Выбрать время')
  await page.locator('[data-test="notification-sms"]').click({ force: true })

  const otherDay = page.locator('[data-test="date-select-other-day"]')
  if (await otherDay.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await otherDay.click({ force: true })
  }

  const dayPicker = page.locator('[data-test="day-picker"]')
  if (!(await dayPicker.isVisible().catch(() => false))) {
    const skipEmail = page.locator('[data-test="btn-skip-email"], [data-test="btn-next-email"]')
    await expect(skipEmail).toBeVisible({ timeout: 15_000 })
    await skipEmail.click({ force: true })
  }

  const day = page.locator('[data-test^="day-picker-card-"]').filter({ hasNotText: /нет свобод|no time/i }).first()
  await expect(dayPicker).toBeVisible()
  await expect(day).toBeVisible()
  await day.click({ force: true })

  const slot = page.getByRole('button', { name: /^\d{1,2}:\d{2}$/ }).first()
  const slotText = await slot.innerText()

  await slot.click({ force: true })
  await expect(page.locator('[data-test="appointment-confirmation"]')).toBeVisible()
  await expect(page.locator('[data-test="confirmation-date"]')).toContainText(slotText)

  const appointmentResponse = page.waitForResponse((response) => response.url().includes('/terminal/createAppointment'))
  const completed = expectFinalScreen
    ? page.locator('[data-test="success-join"]').waitFor({ state: 'visible', timeout: 15_000 })
    : page.locator('[data-test="intro"]').waitFor({ state: 'visible', timeout: 15_000 })

  await page.locator('[data-test="btn-confirm-appointment"]').click({ force: true })

  const appointment = await appointmentResponse
  const body = await appointment.json()
  const appointmentId = Number(body.appointmentId)

  expect(appointment.ok(), JSON.stringify(body)).toBe(true)
  expect(Number.isFinite(appointmentId) && appointmentId > 0, JSON.stringify(body)).toBe(true)
  await completed

  return {
    appointmentId,
    token: String(body.recap || '').match(/Номер брони:\s*(\S+)/)?.[1],
    successShown: expectFinalScreen
  }
}
