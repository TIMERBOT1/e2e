import { loginAdmin } from './shared.mjs'
import { cleanupPermissionUsers, readPermissionsState } from './permissions-ui.mjs'

async function main() {
  let state
  try {
    state = readPermissionsState()
  } catch (error) {
    console.log(`[permissions:cleanup] ${error.message}`)
    return
  }

  const { browser, context, page, adminUrl } = await loginAdmin()

  try {
    await cleanupPermissionUsers(page, adminUrl, state)
    console.log(`[permissions:cleanup] removed users for ${state.runId}`)
  } finally {
    await context.close().catch(() => {})
    await browser.close()
  }
}

main().catch((error) => {
  console.error(`[permissions:cleanup:error] ${error.stack || error.message}`)
  process.exitCode = 1
})
