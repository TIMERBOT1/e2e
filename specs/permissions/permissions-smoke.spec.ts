import { expect, Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loginAdmin } from '../../setup/admin-line-monitoring.mjs'
import { readPermissionsState } from '../../setup/permissions-ui.mjs'
import { loadEnv, readState, requiredEnv } from '../../setup/shared.mjs'
import { open } from '../../setup/ui-admin.mjs'

type PermissionUserKey = 'full' | 'restricted' | 'noAccess' | 'manageUsers' | 'reduced' | 'suggested'
type PermissionUser = { email: string; password: string }
type PermissionState = {
  place: { id: number; name: string }
  users: Record<PermissionUserKey, PermissionUser>
}
type StandScenario = {
  lineId: number
  terminalName?: string
}
type StandState = {
  scenarios: Record<string, StandScenario>
}
type MatrixEntry = {
  permission: string
  target?: { kind?: string }
  blocker?: { kind?: string; reason?: string }
}
type CoverageRoute = {
  nav: string
  status: string
  path: string
  permission: string
  fixture?: string | null
  params?: Record<string, string | number>
  assert?: {
    text?: string | string[]
    selector?: string
    apiWait?: string | { url?: string; method?: string } | Array<string | { url?: string; method?: string }>
  }
}
type PreparedRoute = {
  nav: string
  path: string
  assert?: CoverageRoute['assert']
}
type Marker = {
  selector?: string
  text?: string | RegExp | Array<string | RegExp>
}
type SmokeRoute = {
  name: string
  permission: string
  coveragePermission?: string
  allowedUser: PermissionUserKey | 'admin'
  deniedUser?: PermissionUserKey
  path?: (state: PermissionState, stand: StandState) => string
  marker?: Marker
}

const rootDir = fileURLToPath(new URL('../..', import.meta.url))
const matrixPath = resolve(rootDir, 'setup/permissions-matrix.json')
const coverageMatrixPath = resolve(rootDir, 'setup/coverage-matrix.json')
const matrix = JSON.parse(readFileSync(matrixPath, 'utf8')) as MatrixEntry[]
const coverageMatrix = JSON.parse(readFileSync(coverageMatrixPath, 'utf8')) as CoverageRoute[]
const matrixByPermission = new Map(matrix.map((entry) => [entry.permission, entry]))
const placeholderPattern = /\$[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+|\[\d+\])*/g
const addIconButton = '.MuiAppBar-root button:has(svg path[d^="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"])'

function missing(value: unknown) {
  return value === undefined || value === null || value === ''
}

function stateValue(state: unknown, placeholder: string) {
  if (!placeholder.startsWith('$')) return placeholder

  let current: unknown = state
  for (const match of placeholder.slice(1).matchAll(/([A-Za-z0-9_]+)|\[(\d+)\]/g)) {
    if (current === undefined || current === null) return undefined
    current = (current as Record<string | number, unknown>)[match[1] ?? Number(match[2])]
  }
  return current
}

function resolveValue(state: unknown, value: string | number, label: string) {
  if (typeof value !== 'string' || !value.startsWith('$')) return value

  const resolved = stateValue(state, value)
  if (missing(resolved)) throw new Error(`${label}: missing ${value}`)
  return resolved
}

function resolveText(state: unknown, text: string, label: string) {
  return text.replace(placeholderPattern, (placeholder) => {
    const resolved = stateValue(state, placeholder)
    if (missing(resolved)) throw new Error(`${label}: missing ${placeholder}`)
    return String(resolved)
  })
}

function resolvedPath(route: CoverageRoute, params: Record<string, unknown>) {
  return route.path.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
    const value = params[key]
    if (missing(value)) throw new Error(`${route.nav}: missing params.${key}`)
    return encodeURIComponent(String(value))
  })
}

function prepareRoute(route: CoverageRoute, stand: StandState): PreparedRoute {
  if (route.fixture && missing(stateValue(stand, route.fixture))) {
    throw new Error(`${route.nav}: smoke fixture ${route.fixture} is absent in stand state`)
  }

  const params = Object.fromEntries(
    Object.entries(route.params ?? {}).map(([key, value]) => [key, resolveValue(stand, value, `${route.nav}: params.${key}`)])
  )
  const assertion = route.assert ? { ...route.assert } : undefined
  if (Array.isArray(assertion?.text)) assertion.text = assertion.text.map((text) => resolveText(stand, text, `${route.nav}: assert.text`))
  else if (assertion?.text) assertion.text = resolveText(stand, assertion.text, `${route.nav}: assert.text`)

  return { nav: route.nav, path: resolvedPath(route, params), assert: assertion }
}

function routeForPermission(route: SmokeRoute) {
  if (route.path) return undefined
  const token = route.coveragePermission || route.permission
  const exactToken = new RegExp(`\\b${token}\\b`)
  const candidate = coverageMatrix.find((item) => item.status === 'smoke-only' && exactToken.test(item.permission))
  expect(candidate, `coverage-matrix route not found for ${route.permission} (${token})`).toBeTruthy()
  return candidate!
}

function apiWaits(route: PreparedRoute) {
  const waits = route.assert?.apiWait ? (Array.isArray(route.assert.apiWait) ? route.assert.apiWait : [route.assert.apiWait]) : []
  return waits.map((wait) => {
    const url = typeof wait === 'string' ? wait : wait.url
    const method = typeof wait === 'string' ? undefined : wait.method
    if (!url) throw new Error(`${route.nav}: assert.apiWait requires url`)

    return (page: Page) =>
      page.waitForResponse(
        (response) => response.url().includes(url) && (!method || response.request().method().toUpperCase() === method.toUpperCase()),
        { timeout: 30_000 }
      )
  })
}

async function openPreparedRoute(page: Page, route: PreparedRoute) {
  const waits = apiWaits(route).map((wait) => wait(page))
  await open(page, adminUrl(), route.path)
  await Promise.all(waits)
}

function routePath(page: Page) {
  return new URL(page.url()).hash.replace(/^#/, '') || '/'
}

function markerLocator(page: Page, marker: Marker) {
  const locators = []
  if (marker.selector) locators.push(page.locator(marker.selector).filter({ visible: true }))
  for (const text of Array.isArray(marker.text) ? marker.text : marker.text ? [marker.text] : []) {
    locators.push(page.getByText(text).filter({ visible: true }))
  }
  if (!locators.length) throw new Error('Permission smoke marker requires selector or text')
  return locators.reduce((current, next) => current.or(next)).first()
}

function preparedMarker(route: PreparedRoute): Marker | null {
  if (!route.assert?.selector && !route.assert?.text) return null
  return {
    selector: route.assert?.selector,
    text: route.assert?.text
  }
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
  await page.goto(`${adminUrl()}/#/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-test="LoginForm-Email"]').fill(user.email)
  await page.locator('[data-test="LoginForm-Password"]').fill(user.password)
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-test="LoginForm-Submit"]')?.disabled)
  await page.locator('[data-test="LoginForm-Submit"]').click()
  await page.waitForURL((url) => !String(url).includes('/login'))
}

async function loginAllowedUser(page: Page, state: PermissionState, user: SmokeRoute['allowedUser']) {
  if (user === 'admin') await loginAdmin(page)
  else await loginPermissionUser(page, permissionUser(state, user))
}

function requireRouteMatrix(permission: string) {
  const entry = matrixByPermission.get(permission)
  expect(entry, `${permission} must be present in permissions matrix`).toBeTruthy()
  expect(entry?.blocker, `${permission} is blocked in permissions matrix; do not cover as passing`).toBeFalsy()
  expect(['route', 'affordance']).toContain(entry?.target?.kind)
}

const smokeRoutes: SmokeRoute[] = [
  { name: 'beacons/list', permission: 'accessBeacons', allowedUser: 'full', deniedUser: 'noAccess' },
  { name: 'days-off/list', permission: 'accessDaysOff', allowedUser: 'full', deniedUser: 'noAccess' },
  { name: 'availabilities/list', permission: 'accessAvailabilities', allowedUser: 'full', deniedUser: 'noAccess' },
  { name: 'brands/list', permission: 'manageBrands', allowedUser: 'full', deniedUser: 'restricted' },
  { name: 'campaigns/list', permission: 'manageCampaigns', allowedUser: 'full', deniedUser: 'restricted' },
  { name: 'messages/list', permission: 'manageMessagesTemplates', allowedUser: 'full', deniedUser: 'restricted' },
  { name: 'data-export/list', permission: 'manageDataExport', allowedUser: 'full', deniedUser: 'restricted' },
  { name: 'global-data-export/list', permission: 'manageGlobalDataExport', allowedUser: 'full', deniedUser: 'restricted' },
  { name: 'translations/list', permission: 'manageTranslations', allowedUser: 'full', deniedUser: 'restricted' },
  {
    name: 'shop/add affordance',
    permission: 'canAddAndDeleteShop',
    allowedUser: 'full',
    deniedUser: 'restricted',
    path: () => '/shops',
    marker: { selector: addIconButton }
  },
  { name: 'shop/edit', permission: 'canUpdateShop', allowedUser: 'full', deniedUser: 'restricted' },
  {
    name: 'line/add affordance',
    permission: 'canAddAndDeleteLine',
    allowedUser: 'full',
    deniedUser: 'restricted',
    path: (state) => `/shops/${state.place.id}/lines`,
    marker: { selector: addIconButton }
  },
  { name: 'line/edit', permission: 'canUpdateLine', allowedUser: 'full', deniedUser: 'restricted' },
  { name: 'line/view', permission: 'canViewLine', allowedUser: 'restricted', deniedUser: 'noAccess' },
  {
    name: 'checkpoint/work-schedule',
    permission: 'canChangeCheckpointWorkScheduleMode',
    allowedUser: 'full',
    deniedUser: 'restricted'
  },
  { name: 'brand-admin/routes', permission: 'canPromoteToAdmin', allowedUser: 'admin', deniedUser: 'restricted' },
  {
    name: 'users/list',
    permission: 'canManageUserAccounts',
    allowedUser: 'manageUsers',
    deniedUser: 'restricted',
  },
  {
    name: 'terminals/list',
    permission: 'manageTerminals',
    allowedUser: 'full',
    deniedUser: 'restricted',
  },
  {
    name: 'appointments/list',
    permission: 'manageAppointments',
    allowedUser: 'full',
    deniedUser: 'restricted',
    coveragePermission: 'userManageAppointments'
  },
  {
    name: 'appointments/view',
    permission: 'canViewAppointments',
    allowedUser: 'full',
    deniedUser: 'restricted',
    coveragePermission: 'userManageAppointments'
  },
  {
    name: 'appointments/edit',
    permission: 'canEditAppointments',
    allowedUser: 'full',
    deniedUser: 'restricted'
  },
  {
    name: 'journal/list',
    permission: 'manageJournal',
    allowedUser: 'full',
    deniedUser: 'restricted',
  },
  {
    name: 'monitoring route',
    permission: 'accessPlaceLineMonitoring',
    allowedUser: 'full',
    deniedUser: 'restricted',
    coveragePermission: 'accessPlaceLineMonitoring'
  }
]

for (const entry of matrix.filter((item) => item.blocker && ['route', 'affordance'].includes(String(item.target?.kind)))) {
  test(`permissions matrix blocker is skipped: ${entry.permission}`, async ({}, testInfo) => {
    const reason = `${entry.blocker?.kind || 'blocker'}: ${entry.blocker?.reason || 'blocked in permissions matrix'}`
    testInfo.annotations.push({ type: 'permissions-blocker', description: reason })
    test.skip(true, reason)
  })
}

for (const route of smokeRoutes) {
  test(`permissions allowed route ${route.name}`, async ({ page }) => {
    requireRouteMatrix(route.permission)
    const permissions = readPermissionsState() as PermissionState
    const stand = readState() as StandState
    const coverageRoute = routeForPermission(route)
    const prepared = coverageRoute ? prepareRoute(coverageRoute, stand) : { nav: route.name, path: route.path!(permissions, stand) }

    await loginAllowedUser(page, permissions, route.allowedUser)
    await openPreparedRoute(page, prepared)

    const marker = route.marker || preparedMarker(prepared)
    if (marker) await expect(markerLocator(page, marker)).toBeVisible({ timeout: 30_000 })
  })

  if (route.deniedUser) {
    test(`permissions denied route ${route.name}`, async ({ page }) => {
    requireRouteMatrix(route.permission)
    const permissions = readPermissionsState() as PermissionState
    const stand = readState() as StandState
    const coverageRoute = routeForPermission(route)
    const prepared = coverageRoute ? prepareRoute(coverageRoute, stand) : { nav: route.name, path: route.path!(permissions, stand) }
    const targetPath = prepared.path

    await loginPermissionUser(page, permissionUser(permissions, route.deniedUser))
    await open(page, adminUrl(), prepared.path)

      const marker = route.marker || preparedMarker(prepared)
      if (route.path) {
        expect(marker, `${route.name} custom permission smoke requires marker`).toBeTruthy()
        await expect(markerLocator(page, marker!)).not.toBeVisible({ timeout: 5_000 })
        return
      }

      await expect
        .poll(() => routePath(page), { message: `${route.name} must redirect away from denied route`, timeout: 30_000 })
        .not.toBe(targetPath)
      if (marker) await expect(markerLocator(page, marker)).not.toBeVisible({ timeout: 5_000 })
    })
  }
}
