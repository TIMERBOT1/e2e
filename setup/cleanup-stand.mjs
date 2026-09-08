import { cleanupUiStand } from './cleanup-ui.mjs'
import { clearActiveState, loginAdmin, readState, removeState } from './shared.mjs'
import { fileURLToPath } from 'node:url'

export async function cleanupStand(options = {}) {
  if ((options.keep ?? process.env.KEEP_E2E_STAND === '1')) {
    console.log('[stand:cleanup] skipped because KEEP_E2E_STAND=1')
    return
  }

  let state = options.state
  try {
    state ||= readState()
  } catch (error) {
    console.log(`[stand:cleanup] ${error.message}`)
    return
  }

  const ownsSession = !options.session
  const session = options.session || await loginAdmin()
  const { browser, context, page, adminUrl } = session

  try {
    await cleanupUiStand(page, adminUrl, state)
    if (options.stateMode !== 'memory') removeState()
    console.log(`[stand:cleanup] removed ${state.runId}`)
  } finally {
    if (options.stateMode === 'memory') clearActiveState()
    if (ownsSession) {
      await context.close().catch(() => {})
      if (session.ownsBrowser !== false) await browser.close()
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cleanupStand().catch((error) => {
    console.error(`[stand:cleanup:error] ${error.stack || error.message}`)
    process.exitCode = 1
  })
}
