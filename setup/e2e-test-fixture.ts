import { expect, test as base, type TestInfo } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const standStatePath = resolve(rootDir, '.e2e-stand-state.json')

type FixturePlan = {
  scenarios: string[]
  operator?: boolean
}

function planFor(testInfo: TestInfo): FixturePlan {
  const file = testInfo.file.replace(/\\/g, '/')
  const title = testInfo.title

  if (file.endsWith('/appointment-today.spec.ts')) {
    return { scenarios: ['timed'], operator: title.startsWith('TC-5 ') }
  }
  if (file.endsWith('/checkpoint-cases.spec.ts')) {
    return { scenarios: [title.startsWith('TC-53 ') ? 'asap' : 'stoppedCheckpoint'] }
  }
  if (file.endsWith('/checkpoint-list.spec.ts')) return { scenarios: ['bulkDisable'] }
  if (file.endsWith('/future-appointment-creation.spec.ts')) return { scenarios: ['futureFinal'] }
  if (file.endsWith('/staff-management-cases.spec.ts')) return { scenarios: ['bulkDisable'] }

  if (file.endsWith('/line-monitoring.spec.ts')) {
    if (title.includes('tomorrow appointment')) return { scenarios: ['futureFinal'] }
    if (title.includes('position journal')) return { scenarios: ['asap', 'timed'] }
    return { scenarios: [title.includes('timed today') ? 'timed' : 'asap'] }
  }

  if (file.endsWith('/settings.spec.ts')) {
    if (title.startsWith('terminal settings')) return { scenarios: ['futureNoFinal'] }
    if (title.startsWith('line settings')) return { scenarios: ['disabledTerminal'] }
    if (title.startsWith('checkpoint settings')) return { scenarios: ['stoppedCheckpoint'] }
    return { scenarios: [] }
  }

  if (file.endsWith('/booking.spec.ts')) {
    if (title.startsWith('timed today')) return { scenarios: ['timed'] }
    if (title.startsWith('asap ')) return { scenarios: ['asap'] }
    if (title.startsWith('future appointment with final')) return { scenarios: ['futureFinal'] }
    if (title.startsWith('future appointment without final')) return { scenarios: ['futureNoFinal'] }
    if (title.startsWith('no slots')) return { scenarios: ['noSlots'] }
    if (title.startsWith('stopped checkpoint')) return { scenarios: ['stoppedCheckpoint'] }
    if (title.startsWith('disabled terminal')) return { scenarios: ['disabledTerminal'] }
  }

  throw new Error(`E2E fixture plan is not defined for ${file}: ${title}`)
}

function runNode(script: string, env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script], { cwd: rootDir, env, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${script} exited with code ${code ?? 1}`))
    })
  })
}

export const test = base.extend<{ e2eEntities: void }>({
  e2eEntities: [
    async ({}, use, testInfo) => {
      const plan = planFor(testInfo)
      const env = {
        ...process.env,
        E2E_STAND_PROFILE: 'e2e',
        E2E_SCENARIOS: plan.scenarios.length ? plan.scenarios.join(',') : 'none',
        E2E_CREATE_OPERATOR: plan.operator ? '1' : '0'
      }

      if (existsSync(standStatePath)) await runNode('setup/cleanup-stand.mjs', env)
      try {
        await runNode('setup/prepare-stand.mjs', env)
        await use()
      } finally {
        await runNode('setup/cleanup-stand.mjs', env)
      }
    },
    { auto: true, timeout: 300_000 }
  ]
})

export { expect }
