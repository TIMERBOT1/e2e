import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const statuses = new Set(['required-e2e', 'smoke-only', 'inventory-only', 'deprecated'])
const here = dirname(fileURLToPath(import.meta.url))
const e2eRoot = resolve(here, '..')
const appRoot = resolve(process.env.E2E_APP_ROOT || resolve(e2eRoot, '..'))
const sourcePath = resolve(appRoot, 'src/Backoffice/src/JeFile.WebClient/src/pages/backoffice-routing.tsx')
const matrixPath = resolve(here, 'coverage-matrix.json')
const update = process.argv.includes('--update')

function read(path) {
  return readFileSync(path, 'utf8')
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function balanced(source, openIndex, open = '{', close = '}') {
  let depth = 0
  let quote = ''

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i]
    const prev = source[i - 1]

    if (quote) {
      if (char === quote && prev !== '\\') quote = ''
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
    } else if (char === open) {
      depth += 1
    } else if (char === close) {
      depth -= 1
      if (depth === 0) return source.slice(openIndex + 1, i)
    }
  }

  throw new Error(`Unbalanced ${open}${close} at ${openIndex}`)
}

function routeTag(source, start) {
  let depth = 0
  let quote = ''

  for (let i = start; i < source.length; i += 1) {
    const char = source[i]
    const prev = source[i - 1]

    if (quote) {
      if (char === quote && prev !== '\\') quote = ''
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
    } else if (char === '/' && source[i + 1] === '>' && depth === 0) {
      return source.slice(start, i + 2)
    }
  }

  throw new Error(`Unclosed WRoute at ${start}`)
}

function propExpression(tag, name) {
  const match = new RegExp(`${name}\\s*=\\s*\\{`).exec(tag)
  if (!match) return ''
  return normalize(balanced(tag, match.index + match[0].lastIndexOf('{')))
}

function actionOf(tag) {
  const match = /\baction\s*=\s*(?:"([^"]+)"|'([^']+)'|\{([^}]+)\})/.exec(tag)
  if (!match) return 'None'
  return normalize(match[1] || match[2] || match[3]).replace(/^['"]|['"]$/g, '')
}

function componentOf(tag) {
  const component = propExpression(tag, 'component')
  if (component) return component

  const render = propExpression(tag, 'render')
  const lazy = [...render.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)].map((match) => match[1]).find((name) => name !== 'Suspense')
  return lazy || 'render'
}

function permissionBefore(source, start) {
  const open = source.lastIndexOf('{', start)
  if (open === -1) return ''

  const raw = source.slice(open + 1, start)
  if (!raw.includes('&&') || raw.includes(';') || raw.includes('return')) return ''

  return normalize(raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/&&\s*\(?\s*$/g, '').replace(/\(\s*$/g, ''))
}

export function parseRoutes(source) {
  const routes = []

  for (let start = source.indexOf('<WRoute'); start !== -1; start = source.indexOf('<WRoute', start + 1)) {
    const tag = routeTag(source, start)
    const nav = propExpression(tag, 'path')
    if (!nav) throw new Error(`WRoute without path at ${start}`)

    routes.push({
      nav,
      status: 'inventory-only',
      path: '',
      component: componentOf(tag),
      permission: permissionBefore(source, start),
      action: actionOf(tag),
      fixture: null,
      params: {},
      assert: {}
    })
  }

  return routes
}

function readMatrix() {
  if (!existsSync(matrixPath)) return []
  const matrix = JSON.parse(read(matrixPath))
  if (!Array.isArray(matrix)) throw new Error(`${matrixPath} must contain a JSON array`)
  return matrix
}

function hasAssert(entry) {
  return Boolean(entry.assert?.text || entry.assert?.selector || entry.assert?.apiWait)
}

function validate(sourceRoutes, matrix) {
  const errors = []
  const sourceByNav = new Map()
  const matrixByNav = new Map()

  for (const route of sourceRoutes) {
    if (sourceByNav.has(route.nav)) errors.push(`duplicate source nav: ${route.nav}`)
    sourceByNav.set(route.nav, route)
  }

  for (const entry of matrix) {
    if (!entry.nav) errors.push('matrix entry without nav')
    if (matrixByNav.has(entry.nav)) errors.push(`duplicate matrix nav: ${entry.nav}`)
    matrixByNav.set(entry.nav, entry)

    if (!statuses.has(entry.status)) errors.push(`${entry.nav}: invalid status ${entry.status}`)
    if (['smoke-only', 'required-e2e'].includes(entry.status)) {
      if (!entry.path) errors.push(`${entry.nav}: ${entry.status} requires path`)
      if (!hasAssert(entry)) errors.push(`${entry.nav}: ${entry.status} requires assert.text, assert.selector, or assert.apiWait`)
    }
  }

  for (const route of sourceRoutes) {
    if (!matrixByNav.has(route.nav)) errors.push(`source route missing from matrix: ${route.nav}`)
  }

  for (const entry of matrix) {
    if (entry.status !== 'deprecated' && !sourceByNav.has(entry.nav)) {
      errors.push(`matrix route missing from source: ${entry.nav}`)
    }
  }

  return errors
}

function merge(sourceRoutes, matrix) {
  const existing = new Map(matrix.map((entry) => [entry.nav, entry]))
  const next = sourceRoutes.map((route) => {
    const old = existing.get(route.nav) || {}
    return {
      nav: route.nav,
      status: old.status || route.status,
      path: old.path ?? route.path,
      component: route.component,
      permission: route.permission,
      action: route.action,
      fixture: old.fixture ?? route.fixture,
      params: old.params ?? route.params,
      assert: old.assert ?? route.assert
    }
  })
  const sourceNavs = new Set(sourceRoutes.map((route) => route.nav))
  return next.concat(matrix.filter((entry) => !sourceNavs.has(entry.nav)))
}

function counts(matrix) {
  return [...statuses].map((status) => `${status}=${matrix.filter((entry) => entry.status === status).length}`).join(', ')
}

const sourceRoutes = parseRoutes(read(sourcePath))
const matrix = update ? merge(sourceRoutes, readMatrix()) : readMatrix()

if (update) {
  writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`)
}

const errors = validate(sourceRoutes, matrix)
console.log(`admin coverage matrix: source=${sourceRoutes.length}, matrix=${matrix.length}, ${counts(matrix)}`)

if (update) {
  const sourceNavs = new Set(sourceRoutes.map((route) => route.nav))
  console.log(`admin coverage matrix updated: ${matrixPath}`)
  const gone = matrix.filter((entry) => entry.status !== 'deprecated' && !sourceNavs.has(entry.nav))
  if (gone.length) console.log(`non-deprecated routes missing from source: ${gone.length}`)
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
}
