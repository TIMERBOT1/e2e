import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const statuses = new Set(['required-e2e', 'feature-only', 'smoke-only', 'inventory-only', 'deprecated'])
const targetKinds = new Set(['route', 'action', 'affordance'])
const here = dirname(fileURLToPath(import.meta.url))
const e2eRoot = resolve(here, '..')
const appRoot = resolve(process.env.E2E_APP_ROOT || resolve(e2eRoot, '..'))
const modelPath = resolve(
  appRoot,
  'src/Backoffice/src/JeFile.WebClient/src/shared/models/entities/permissions.model.ts'
)
const matrixPath = resolve(here, 'permissions-matrix.json')
const permissionsSmokePath = resolve(e2eRoot, 'specs/permissions/permissions-smoke.spec.ts')

function read(path) {
  return readFileSync(path, 'utf8')
}

function parseModelPermissions(source) {
  const match = /export interface PermissionsModel\s*\{([\s\S]*?)\n\}/.exec(source)
  if (!match) throw new Error('PermissionsModel interface not found')

  return [...match[1].matchAll(/^\s*([A-Za-z]\w+)(?:\?|:)/gm)].map((item) => item[1])
}

function readMatrix() {
  const matrix = JSON.parse(read(matrixPath))
  if (!Array.isArray(matrix)) throw new Error(`${matrixPath} must contain a JSON array`)
  return matrix
}

function hasUiCoverage(entry) {
  return entry.coverage?.ui?.positive === true && entry.coverage?.ui?.negative === true
}

function hasRefs(entry) {
  return Array.isArray(entry.refs) && entry.refs.length > 0
}

function hasAdminWebTarget(entry) {
  return entry.target?.adminWeb === true && Array.isArray(entry.target.files) && entry.target.files.length > 0
}

function allowedOutOfScope(entry) {
  return entry.permission === 'dashboardAccess' && entry.outOfScope?.reason === 'dashboard'
}

function validate(modelPermissions, matrix) {
  const errors = []
  const modelSet = new Set(modelPermissions)
  const matrixByPermission = new Map()
  const permissionsSmoke = read(permissionsSmokePath)

  for (const entry of matrix) {
    if (!entry.permission) {
      errors.push('matrix entry without permission')
      continue
    }

    if (matrixByPermission.has(entry.permission)) errors.push(`duplicate matrix permission: ${entry.permission}`)
    matrixByPermission.set(entry.permission, entry)
  }

  for (const entry of matrix) {
    if (!entry.permission) continue

    if (!statuses.has(entry.status)) errors.push(`${entry.permission}: invalid status ${entry.status}`)
    if (entry.status !== 'deprecated' && !modelSet.has(entry.permission)) {
      errors.push(`${entry.permission}: matrix permission absent in PermissionsModel`)
    }

    if (entry.status === 'inventory-only' && entry.permission !== 'dashboardAccess') {
      errors.push(`${entry.permission}: only dashboardAccess may be inventory-only`)
    }

    if (entry.status === 'inventory-only' && !allowedOutOfScope(entry)) {
      errors.push(`${entry.permission}: inventory-only requires allowed dashboard outOfScope reason`)
    }

    if (entry.outOfScope && !allowedOutOfScope(entry)) {
      errors.push(`${entry.permission}: outOfScope requires allowed dashboard reason`)
    }

    if (entry.permission !== 'dashboardAccess' && entry.status !== 'deprecated' && !hasAdminWebTarget(entry)) {
      errors.push(`${entry.permission}: non-dashboard permission requires admin-web target`)
    }

    if (entry.target?.kind && !targetKinds.has(entry.target.kind)) {
      errors.push(`${entry.permission}: invalid target.kind ${entry.target.kind}`)
    }

    if (entry.target?.kind === 'route' && entry.permission !== 'dashboardAccess') {
      const permission = entry.runtimePermission || entry.permission
      if (!permissionsSmoke.includes(`permission: '${permission}'`)) {
        errors.push(`${entry.permission}: route target requires permissions-smoke coverage for ${permission}`)
      }
    }

    if (['required-e2e', 'feature-only', 'smoke-only'].includes(entry.status) && !hasUiCoverage(entry)) {
      errors.push(`${entry.permission}: ${entry.status} requires positive+negative UI checks`)
    }

    if (['required-e2e', 'feature-only', 'smoke-only'].includes(entry.status) && !hasRefs(entry)) {
      errors.push(`${entry.permission}: ${entry.status} requires refs to e2e evidence`)
    }

    for (const ref of entry.refs || []) {
      if (!existsSync(resolve(e2eRoot, ref.replace(/^e2e\//, '')))) errors.push(`${entry.permission}: missing ref ${ref}`)
    }

    for (const dependency of entry.requires || []) {
      if (!matrixByPermission.has(dependency)) {
        errors.push(`${entry.permission}: requires missing permission ${dependency}`)
      }
    }

    if (entry.blocker) {
      errors.push(`${entry.permission}: blocker ${entry.blocker.kind || 'unknown'} - ${entry.blocker.reason || ''}`)
    }
  }

  for (const permission of modelPermissions) {
    if (!matrixByPermission.has(permission)) errors.push(`PermissionsModel permission missing from matrix: ${permission}`)
  }

  return errors
}

function counts(matrix) {
  return [...statuses].map((status) => `${status}=${matrix.filter((entry) => entry.status === status).length}`).join(', ')
}

const modelPermissions = parseModelPermissions(read(modelPath))
const matrix = readMatrix()
const errors = validate(modelPermissions, matrix)

console.log(`admin permissions matrix: model=${modelPermissions.length}, matrix=${matrix.length}, ${counts(matrix)}`)

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
}
