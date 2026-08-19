import { loginAdmin } from './shared.mjs'
import { createPermissionUsers, readRequiredStandState, validatePermissionControls } from './permissions-ui.mjs'

async function main() {
  const stand = readRequiredStandState()
  const { browser, context, page, adminUrl } = await loginAdmin()

  try {
    await validatePermissionControls(page, adminUrl)
    const state = await createPermissionUsers(page, adminUrl, stand)
    console.log(`[permissions:prepare] created ${Object.keys(state.users).length} users for ${state.runId}`)
  } finally {
    await context.close().catch(() => {})
    await browser.close()
  }
}

main().catch((error) => {
  console.error(`[permissions:prepare:error] ${error.stack || error.message}`)
  process.exitCode = 1
})
