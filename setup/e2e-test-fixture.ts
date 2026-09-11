import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo
} from '@playwright/test'
import { cleanupStand } from './cleanup-stand.mjs'
import { prepareStand } from './prepare-stand.mjs'
import { clearActiveState, loginAdmin } from './shared.mjs'

type FixturePlan = {
  scenarios: string[]
  operator?: boolean
}

type StandState = {
  runId: string
  profile: string
  place: { id: number; name: string } | null
  scenarios: Record<string, unknown>
}

type AdminSession = {
  browser: Browser
  context: BrowserContext
  page: Page
  adminUrl: string
  ownsBrowser: boolean
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

export const test = base.extend<
  { e2eEntities: StandState },
  { e2eAdminSession: AdminSession }
>({
  e2eAdminSession: [
    async ({ browser }, use) => {
      const session = await loginAdmin(browser) as AdminSession
      try {
        await use(session)
      } finally {
        await session.context.close().catch(() => {})
      }
    },
    { scope: 'worker', timeout: 120_000 }
  ],

  e2eEntities: [
    async ({ e2eAdminSession }, use, testInfo) => {
      const plan = planFor(testInfo)
      let state: StandState | undefined
      const preparePage = await e2eAdminSession.context.newPage()
      const prepareSession = { ...e2eAdminSession, page: preparePage }

      clearActiveState()
      try {
        state = await prepareStand({
          session: prepareSession,
          profile: 'e2e',
          scenarios: plan.scenarios,
          createOperator: Boolean(plan.operator),
          stateMode: 'memory'
        }) as StandState
        await preparePage.close()
        await use(state)
      } finally {
        if (state) {
          const cleanupPage = await e2eAdminSession.context.newPage()
          try {
            await cleanupStand({
              session: { ...e2eAdminSession, page: cleanupPage },
              state,
              stateMode: 'memory'
            })
          } finally {
            await cleanupPage.close().catch(() => {})
          }
        } else {
          clearActiveState()
        }
        await preparePage.close().catch(() => {})
      }
    },
    { auto: true, timeout: 300_000 }
  ]
})

export { expect }
