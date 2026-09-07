import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { removeMonitoringPosition } from '../../setup/cleanup-ui.mjs'
import {
  createLineMonitoringPositionWithDetails,
  createTechnicalBreak,
  createTodayAppointment,
  expectCreatedMonitoringPosition,
  loginAdmin
} from '../../setup/admin-line-monitoring.mjs'

type StandScenario = {
  shopId: number
  lineId: number
  checkpointId: number
  checkpointName: string
  serviceName: string
  technicalServiceName?: string
}

type StandState = {
  runId: string
  technicalBreakOperator?: { firstName: string; lastName: string; email: string }
  scenarios: Record<string, StandScenario>
}

const rootDir = fileURLToPath(new URL('../..', import.meta.url))
const statePath = resolve(rootDir, '.e2e-stand-state.json')

function readState(): StandState {
  expect(existsSync(statePath), `Run pnpm stand:prepare first. Missing ${statePath}`).toBeTruthy()
  return JSON.parse(readFileSync(statePath, 'utf8'))
}

function timedScenario() {
  const scenario = readState().scenarios.timed
  expect(scenario, `Scenario timed is missing in ${statePath}`).toBeTruthy()
  return scenario
}

function customer(caseId: number) {
  const suffix = String(Date.now())
    .slice(-8)
    .replace(/\d/g, (digit) => String.fromCharCode('a'.charCodeAt(0) + Number(digit)))
  const phoneSuffix = String(Date.now()).slice(-7)
  return {
    firstName: `KiwiCase${String(caseId).replace(/\d/g, (digit) => String.fromCharCode(65 + Number(digit)))}`,
    lastName: `Today${suffix}`,
    phone: `+7900${phoneSuffix}`,
    email: `tc-${caseId}-${Date.now()}@example.com`
  }
}

function adminUrl() {
  expect(process.env.ADMIN_URL, 'Set ADMIN_URL in .env.stand.local').toBeTruthy()
  return process.env.ADMIN_URL!
}

test.setTimeout(120_000)

test('TC-1 creates a timed appointment for today from line monitoring', async ({ page }) => {
  const scenario = timedScenario()
  const person = customer(1)
  let positionId: number | undefined

  await loginAdmin(page)
  try {
    const result = await createLineMonitoringPositionWithDetails(page, scenario, 'timed', person)
    positionId = result.positionId
    await expectCreatedMonitoringPosition(page, scenario, positionId, {
      serviceName: scenario.serviceName,
      selectedTime: result.selectedTime,
      ...person
    })
  } finally {
    if (positionId) await removeMonitoringPosition(page, adminUrl(), scenario, positionId)
  }
})

test('TC-5 creates a timed technical service break for today from line monitoring', async ({ page }) => {
  const state = readState()
  const scenario = timedScenario()
  const operator = state.technicalBreakOperator
  expect(operator, 'Technical break operator is missing; run pnpm stand:prepare again').toBeTruthy()
  expect(scenario.technicalServiceName, 'Technical service is missing; run pnpm stand:prepare again').toBeTruthy()
  let positionId: number | undefined

  await loginAdmin(page)
  try {
    const result = await createTechnicalBreak(page, scenario, operator!.lastName)
    positionId = result.positionId
    await expectCreatedMonitoringPosition(page, scenario, positionId, {
      serviceName: scenario.technicalServiceName!,
      checkpointId: scenario.checkpointId,
      selectedTime: result.selectedTime,
      operatorName: result.operatorName,
      type: 'Break'
    })
  } finally {
    if (positionId) await removeMonitoringPosition(page, adminUrl(), scenario, positionId)
  }
})

test('TC-14 creates an appointment for today from the appointments journal', async ({ page }) => {
  const scenario = timedScenario()
  const person = customer(14)
  let positionId: number | undefined

  await loginAdmin(page)
  try {
    const result = await createTodayAppointment(page, scenario, person)
    positionId = result.positionId
    await expectCreatedMonitoringPosition(page, scenario, positionId, {
      serviceName: scenario.serviceName,
      selectedTime: result.selectedTime,
      state: 'joined',
      statusText: 'В очереди',
      ...person
    })
  } finally {
    if (positionId) await removeMonitoringPosition(page, adminUrl(), scenario, positionId)
  }
})
