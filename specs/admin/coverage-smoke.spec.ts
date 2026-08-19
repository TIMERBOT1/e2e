import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loginAdmin } from '../../setup/admin-line-monitoring.mjs'
import { readState } from '../../setup/shared.mjs'
import { open } from '../../setup/ui-admin.mjs'

type ApiWait = string | { url?: string; method?: string }

type CoverageRoute = {
  nav: string
  status: string
  path: string
  fixture?: string | null
  params?: Record<string, string | number>
  assert?: {
    text?: string | string[]
    selector?: string
    apiWait?: ApiWait | ApiWait[]
  }
}

type PreparedRoute = {
  nav: string
  path: string
  assert?: CoverageRoute['assert']
}

const rootDir = fileURLToPath(new URL('../..', import.meta.url))
const matrixPath = resolve(rootDir, 'setup/coverage-matrix.json')
const routes = (JSON.parse(readFileSync(matrixPath, 'utf8')) as CoverageRoute[]).filter((route) => route.status === 'smoke-only')
const placeholderPattern = /\$[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+|\[\d+\])*/g

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

function prepareRoute(route: CoverageRoute, state: unknown): PreparedRoute {
  if (route.fixture && missing(stateValue(state, route.fixture))) {
    throw new Error(`${route.nav}: smoke fixture ${route.fixture} is absent in stand state`)
  }

  const params = Object.fromEntries(
    Object.entries(route.params ?? {}).map(([key, value]) => [key, resolveValue(state, value, `${route.nav}: params.${key}`)])
  )
  const assertion = route.assert ? { ...route.assert } : undefined
  if (Array.isArray(assertion?.text)) assertion.text = assertion.text.map((text) => resolveText(state, text, `${route.nav}: assert.text`))
  else if (assertion?.text) assertion.text = resolveText(state, assertion.text, `${route.nav}: assert.text`)

  return { nav: route.nav, path: resolvedPath(route, params), assert: assertion }
}

function apiWaits(route: PreparedRoute) {
  const waits = route.assert?.apiWait ? (Array.isArray(route.assert.apiWait) ? route.assert.apiWait : [route.assert.apiWait]) : []
  return waits.map((wait) => {
    const url = typeof wait === 'string' ? wait : wait.url
    const method = typeof wait === 'string' ? undefined : wait.method
    if (!url) throw new Error(`${route.nav}: assert.apiWait requires url`)

    return (page: import('@playwright/test').Page) =>
      page.waitForResponse(
        (response) => response.url().includes(url) && (!method || response.request().method().toUpperCase() === method.toUpperCase()),
        { timeout: 30_000 }
      )
  })
}

async function openWithApiWaits(page: import('@playwright/test').Page, adminUrl: string, route: PreparedRoute) {
  const waits = apiWaits(route).map((wait) => wait(page))
  await open(page, adminUrl, route.path)
  await Promise.all(waits)
}

for (const route of routes) {
  test(`admin coverage smoke ${route.nav}`, async ({ page }) => {
    const prepared = prepareRoute(route, readState())

    const adminUrl = process.env.ADMIN_URL
    expect(adminUrl, 'Set ADMIN_URL in .env.stand.local').toBeTruthy()

    await loginAdmin(page)
    await openWithApiWaits(page, adminUrl!, prepared).catch(async (error) => {
      if (!/Timeout/i.test(String(error?.message || error))) throw error
      await openWithApiWaits(page, adminUrl!, prepared)
    })

    if (prepared.assert?.selector) await expect(page.locator(prepared.assert.selector).first()).toBeVisible({ timeout: 30_000 })
    if (prepared.assert?.text) {
      const texts = Array.isArray(prepared.assert.text) ? prepared.assert.text : [prepared.assert.text]
      const heading = texts
        .map((text) => page.getByText(text).filter({ visible: true }))
        .reduce((current, next) => current.or(next))
        .first()
      await expect(heading).toBeVisible({ timeout: 30_000 })
    }
  })
}
