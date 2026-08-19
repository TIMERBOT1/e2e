import { expect, Page, test } from '@playwright/test'
import { readPermissionsState } from '../../setup/permissions-ui.mjs'
import { loadEnv, readState, requiredEnv } from '../../setup/shared.mjs'
import { open } from '../../setup/ui-admin.mjs'

type PermissionUserKey = 'full' | 'restricted' | 'reduced' | 'suggested'
type PermissionUser = { email: string; password: string }
type PermissionState = {
  users: Record<PermissionUserKey, PermissionUser>
}
type StandScenario = {
  lineId: number
  checkpointId: number
}
type StandState = {
  place: { id: number }
  scenarios: Record<string, StandScenario>
}

function adminUrl() {
  loadEnv()
  return requiredEnv('ADMIN_URL')
}

function permissionUser(state: PermissionState, key: PermissionUserKey) {
  const user = state.users?.[key]
  expect(user, `Permissions user "${key}" is missing. Run pnpm permissions:prepare first.`).toBeTruthy()
  return user
}

async function loginPermissionUser(page: Page, user: PermissionUser) {
  if (page.url().startsWith(adminUrl())) {
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  }
  await page.context().clearCookies()
  await page.goto(`${adminUrl()}/#/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-test="LoginForm-Email"]').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('[data-test="LoginForm-Email"]').fill(user.email)
  await page.locator('[data-test="LoginForm-Password"]').fill(user.password)
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-test="LoginForm-Submit"]')?.disabled)
  await page.locator('[data-test="LoginForm-Submit"]').click()
  await page.waitForURL((url) => !String(url).includes('/login'))
}

async function loginAs(page: Page, key: PermissionUserKey) {
  const permissions = readPermissionsState() as PermissionState
  await loginPermissionUser(page, permissionUser(permissions, key))
}

function scenario() {
  const stand = readState() as StandState
  const item = stand.scenarios.asap
  expect(item, 'Scenario asap is missing in stand state').toBeTruthy()
  return { placeId: stand.place.id, lineId: item.lineId, checkpointId: item.checkpointId }
}

async function openCheckpointHost(page: Page) {
  const { placeId, lineId, checkpointId } = scenario()
  const response = page.waitForResponse((item) => new URL(item.url()).pathname.toLowerCase() === '/api/getcheckpointmonitoring')
  await open(page, adminUrl(), `/shops/${placeId}/lines/${lineId}/checkpoints/${checkpointId}/host`)
  await response
}

async function openCheckpoints(page: Page) {
  const { placeId, lineId } = scenario()
  await open(page, adminUrl(), `/shops/${placeId}/lines/${lineId}/checkpoints`)
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test('checkpoint feature permissions expose full host controls', async ({ page }) => {
  await loginAs(page, 'full')
  await openCheckpointHost(page)

  await expect(page.locator('[data-test="CheckpointHost-Action-start"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-test="CheckpointHost-Action-startHidden"]')).toBeVisible()
  await expect(page.locator('[data-test="CheckpointHost-WorkScheduleMode-fixed"]')).toBeEnabled()
  await expect(page.locator('[data-test="CheckpointHost-AllServices"]')).toBeVisible()
})

test('checkpoint feature permissions show read-only host controls without rights', async ({ page }) => {
  await loginAs(page, 'restricted')
  await openCheckpointHost(page)

  await expect(page.locator('[data-test="CheckpointHost-Action-start"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-test="CheckpointHost-Action-startHidden"]')).not.toBeVisible()
  await expect(page.locator('[data-test="CheckpointHost-WorkScheduleMode-fixed"]')).not.toBeVisible()
  await expect(page.locator('[data-test="CheckpointHost-AllServices"]')).not.toBeVisible()
})

test('displayReducedInterface hides checkpoint bulk close action', async ({ browser, page }) => {
  await loginAs(page, 'full')
  await openCheckpoints(page)
  await expect(page.getByRole('button', { name: /Выключить все точки/ })).toBeVisible({ timeout: 30_000 })

  const reducedContext = await browser.newContext()
  const reducedPage = await reducedContext.newPage()
  try {
    await loginAs(reducedPage, 'reduced')
    await openCheckpoints(reducedPage)
    await expect(reducedPage.getByRole('button', { name: /Выключить все точки/ })).not.toBeVisible({ timeout: 5_000 })
  } finally {
    await reducedContext.close()
  }
})
