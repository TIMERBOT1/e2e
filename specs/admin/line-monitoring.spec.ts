import type { Page } from '@playwright/test'
import { expect, test } from '../../setup/e2e-test-fixture'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAppointmentToken, removeAppointmentToken } from '../../setup/cleanup-ui.mjs'
import {
  completeLineMonitoringPosition,
  createLineMonitoringPosition,
  createTomorrowAppointment,
  expectPositionAbsentFromLineMonitoring,
  expectPositionJournalDetails,
  loginAdmin,
  openLineMonitoring
} from '../../setup/admin-line-monitoring.mjs'

type MonitoringPositionKind = 'asap' | 'timed'
type CustomerKind = MonitoringPositionKind | 'future'

type StandScenario = {
  key: string
  shopId: number
  lineId: number
  checkpointId: number
  lineName: string
  checkpointName: string
  serviceName: string
}

type MonitoringJournalRecord = {
  kind: MonitoringPositionKind
  positionId: number
  firstName: string
  lastName: string
  phone: string
  scenario: StandScenario
}

type StandState = {
  runId: string
  place: { id: number; name: string }
  scenarios: Record<string, StandScenario>
  monitoringJournal?: MonitoringJournalRecord[]
}

const rootDir = fileURLToPath(new URL('../..', import.meta.url))
const statePath = resolve(rootDir, '.e2e-stand-state.json')

function readState(): StandState {
  expect(existsSync(statePath), `Use pnpm e2e:test. Missing ${statePath}`).toBeTruthy()
  return JSON.parse(readFileSync(statePath, 'utf8'))
}

function saveState(state: StandState) {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

function getScenario(key: string): StandScenario {
  const scenario = readState().scenarios[key]
  expect(scenario, `Scenario ${key} is missing in ${statePath}`).toBeTruthy()
  return scenario
}

function customer(kind: CustomerKind) {
  const runId = readState().runId.replace(/[^a-zA-Z0-9]/g, '').slice(-10)
  const timestamp = String(Date.now())
  const attempt = timestamp.slice(-4)
  const nameSuffix = timestamp
    .slice(-8)
    .replace(/\d/g, (digit) => String.fromCharCode('a'.charCodeAt(0) + Number(digit)))

  return {
    firstName: `Monitor${kind}`,
    lastName: `Etest${kind}${nameSuffix}`,
    phone: `+7900000${attempt}`,
    email: `monitor-${kind}-${runId.toLowerCase()}-${attempt}@example.com`
  }
}

function recordForJournal(record: MonitoringJournalRecord) {
  const state = readState()
  state.monitoringJournal = [...(state.monitoringJournal || []).filter((item) => item.kind !== record.kind), record]
  saveState(state)
}

async function createCompleteAndRecord(page: Page, kind: MonitoringPositionKind, scenarioKey: string) {
  const scenario = getScenario(scenarioKey)
  const person = customer(kind)

  await loginAdmin(page)
  await openLineMonitoring(page, scenario)
  const positionId = await createLineMonitoringPosition(page, scenario, kind, person)
  await completeLineMonitoringPosition(page, scenario, positionId, person)
  await expectPositionAbsentFromLineMonitoring(page, scenario, positionId, person)

  recordForJournal({ kind, positionId, ...person, scenario })
}

async function createFindAndRemoveTomorrowAppointment(page: Page) {
  const scenario = getScenario('futureFinal')
  const person = customer('future')
  const adminUrl = process.env.ADMIN_URL

  expect(adminUrl, 'Set ADMIN_URL in .env.stand.local').toBeTruthy()
  await loginAdmin(page)

  const positionId = await createTomorrowAppointment(page, scenario, person)
  await findAppointmentToken(page, adminUrl!, scenario, positionId, person.email)
  await removeAppointmentToken(page, adminUrl!, scenario, person.email, true)
}

test.setTimeout(120_000)

test('line monitoring creates asap position and completes service', async ({ page }) => {
  await createCompleteAndRecord(page, 'asap', 'asap')
})

test('line monitoring creates timed today position and completes service', async ({ page }) => {
  await createCompleteAndRecord(page, 'timed', 'timed')
})

test('line monitoring creates tomorrow appointment and removes it from appointments list', async ({ page }) => {
  await createFindAndRemoveTomorrowAppointment(page)
})

test('position journal shows completed line monitoring positions with details', async ({ page }) => {
  await createCompleteAndRecord(page, 'asap', 'asap')
  await createCompleteAndRecord(page, 'timed', 'timed')

  const records = (readState().monitoringJournal || []).filter((item) => ['asap', 'timed'].includes(item.kind))
  expect(records.map((item) => item.kind).sort()).toEqual(['asap', 'timed'])

  await loginAdmin(page)

  for (const record of records) {
    await expectPositionJournalDetails(page, record)
  }
})
