import { cleanupUiStand } from './cleanup-ui.mjs'
import { loginAdmin, readState, removeState } from './shared.mjs'

async function main() {
  if (process.env.KEEP_E2E_STAND === '1') {
    console.log('[stand:cleanup] skipped because KEEP_E2E_STAND=1')
    return
  }

  let state
  try {
    state = readState()
  } catch (error) {
    console.log(`[stand:cleanup] ${error.message}`)
    return
  }

  const { browser, context, page, adminUrl } = await loginAdmin()

  try {
    await cleanupUiStand(page, adminUrl, state)
    removeState()
    console.log(`[stand:cleanup] removed ${state.runId}`)
  } finally {
    await context.close().catch(() => {})
    await browser.close()
  }
}

main().catch((error) => {
  console.error(`[stand:cleanup:error] ${error.stack || error.message}`)
  process.exitCode = 1
})
