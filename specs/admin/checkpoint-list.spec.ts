import { expect, Page, test } from '@playwright/test'
import { loginAdmin } from '../../setup/admin-line-monitoring.mjs'
import { getJson, loadEnv, readState, requiredEnv, unwrapList } from '../../setup/shared.mjs'
import { open, responseHas, startUiCheckpoint } from '../../setup/ui-admin.mjs'

type PreparedCheckpoint = {
  id: number
  name: string
}

type BulkDisableScenario = {
  shopId: number
  lineId: number
  checkpoints: PreparedCheckpoint[]
}

type StandState = {
  scenarios: {
    bulkDisable: BulkDisableScenario
  }
}

function adminUrl() {
  loadEnv()
  return requiredEnv('ADMIN_URL')
}

function scenario() {
  const item = (readState() as StandState).scenarios.bulkDisable
  expect(item, 'Scenario bulkDisable is missing in stand state').toBeTruthy()
  expect(item.checkpoints, 'Scenario bulkDisable must contain three checkpoints').toHaveLength(3)
  return item
}

async function checkpointList(page: Page, baseUrl: string, item: BulkDisableScenario) {
  return unwrapList(
    await getJson(page, baseUrl, '/api/GetCheckpointList', {
      shopId: item.shopId,
      lineId: item.lineId
    })
  )
}

function finishCheckpointResponse(page: Page, checkpointId: number) {
  return page.waitForResponse(
    (response) => {
      if (!responseHas(response, '/api/finishCheckpoint', ['POST'])) return false
      try {
        return Number(response.request().postDataJSON()) === checkpointId
      } catch {
        return false
      }
    },
    { timeout: 30_000 }
  )
}

test('disables all service points in a line', async ({ page }) => {
  const item = scenario()
  const baseUrl = adminUrl()

  await loginAdmin(page)

  for (const checkpoint of item.checkpoints) {
    const current = (await checkpointList(page, baseUrl, item)).find(
      (candidate) => Number(candidate.id) === checkpoint.id
    )
    if (!['starting', 'started'].includes(String(current?.status))) {
      await startUiCheckpoint(page, baseUrl, item.shopId, item.lineId, checkpoint.id)
    }
  }

  const getList = page.waitForResponse(
    (response) => responseHas(response, '/api/getCheckpointList', ['GET']),
    { timeout: 30_000 }
  )
  await open(page, baseUrl, `/shops/${item.shopId}/lines/${item.lineId}/checkpoints`)
  await getList

  for (const checkpoint of item.checkpoints) {
    await expect(page.getByText(checkpoint.name, { exact: true })).toBeVisible()
  }

  const disableAll = page.getByRole('button', { name: 'Выключить все точки', exact: true })
  await expect(disableAll).toBeEnabled()
  await disableAll.click()

  const dialog = page.getByRole('dialog', { name: 'Выключить точки обслуживания?' })
  await expect(dialog).toContainText('3 точки')

  const finishedResponses = item.checkpoints.map((checkpoint) => finishCheckpointResponse(page, checkpoint.id))
  await dialog.getByRole('button', { name: 'Выключить', exact: true }).click()

  for (const response of await Promise.all(finishedResponses)) {
    expect(response.ok(), `finishCheckpoint failed with ${response.status()}`).toBe(true)
  }

  await expect(disableAll).toBeDisabled()
  await expect(page.getByText(/^Выключена(?: |$)/)).toHaveCount(item.checkpoints.length)
  await expect
    .poll(async () => {
      const ids = new Set(item.checkpoints.map((checkpoint) => checkpoint.id))
      const checkpoints = (await checkpointList(page, baseUrl, item)).filter((checkpoint) =>
        ids.has(Number(checkpoint.id))
      )
      return checkpoints.length === ids.size && checkpoints.every((checkpoint) => checkpoint.status === 'finished')
    })
    .toBe(true)
})
