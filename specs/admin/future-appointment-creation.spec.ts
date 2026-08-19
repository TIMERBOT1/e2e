import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAppointment, removeAppointmentToken } from '../../setup/cleanup-ui.mjs'
import { open } from '../../setup/ui-admin.mjs'
import {
  createTomorrowAppointmentFromPositionJournal,
  createTomorrowAppointmentFromScheduler,
  loginAdmin
} from '../../setup/admin-line-monitoring.mjs'

type StandScenario = {
  shopId: number
  lineId: number
  serviceName: string
}

type StandState = {
  runId: string
  place: {
    name: string
  }
  scenarios: Record<string, StandScenario>
}

const rootDir = fileURLToPath(new URL('../..', import.meta.url))
const statePath = resolve(rootDir, '.e2e-stand-state.json')

function readState(): StandState {
  expect(existsSync(statePath), `Run pnpm stand:prepare first. Missing ${statePath}`).toBeTruthy()
  return JSON.parse(readFileSync(statePath, 'utf8'))
}

function futureScenario() {
  const state = readState()
  const scenario = state.scenarios.futureFinal
  expect(scenario, `Scenario futureFinal is missing in ${statePath}`).toBeTruthy()
  return { ...scenario, placeName: state.place.name }
}

function customer(caseId: number) {
  const stamp = String(Date.now())
  const nameSuffix = stamp
    .slice(-8)
    .replace(/\d/g, (digit) => String.fromCharCode('a'.charCodeAt(0) + Number(digit)))
  return {
    firstName: 'Kiwi',
    lastName: `Future${nameSuffix}`,
    phone: `+7900${stamp.slice(-7)}`,
    email: `tc-${caseId}-${stamp}@example.com`
  }
}

function adminUrl() {
  expect(process.env.ADMIN_URL, 'Set ADMIN_URL in .env.stand.local').toBeTruthy()
  return process.env.ADMIN_URL!
}

async function expectFutureAppointmentInList(page, scenario: StandScenario, positionId: number, person: ReturnType<typeof customer>) {
  const found = await findAppointment(page, adminUrl(), scenario, positionId, person.email)
  const serialized = JSON.stringify(found.appointment)

  expect(Number(found.appointment.positionId)).toBe(positionId)
  expect(serialized).toContain(scenario.serviceName)
  expect(serialized).toContain(person.firstName)
  expect(serialized).toContain(person.lastName)
  expect(serialized.replace(/\D/g, '')).toContain(person.phone.replace(/\D/g, ''))
  return found.token
}

test.setTimeout(120_000)

test('TC-7 creates a future appointment from the position journal', async ({ page }) => {
  const scenario = futureScenario()
  const person = customer(7)
  let token: string | undefined

  await loginAdmin(page)
  try {
    const { positionId } = await createTomorrowAppointmentFromPositionJournal(page, scenario, person)
    token = await expectFutureAppointmentInList(page, scenario, positionId, person)
  } finally {
    if (token) await removeAppointmentToken(page, adminUrl(), scenario, token, true, person.email)
  }
})

test('TC-10 creates a future appointment from the appointment scheduler', async ({ page }) => {
  const scenario = futureScenario()
  const person = customer(10)
  let token: string | undefined

  await loginAdmin(page)
  try {
    const result = await createTomorrowAppointmentFromScheduler(page, scenario, person)
    token = await expectFutureAppointmentInList(page, scenario, result.positionId, person)

    await open(page, adminUrl(), `/shops/${scenario.shopId}/lines/${scenario.lineId}/appointmentScheduler`)
    await expect(page.getByText(`${person.lastName} ${person.firstName}`, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(scenario.serviceName, { exact: true }).last()).toBeVisible({ timeout: 30_000 })
  } finally {
    if (token) await removeAppointmentToken(page, adminUrl(), scenario, token, true, person.email)
  }
})
