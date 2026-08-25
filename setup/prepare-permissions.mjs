import { loginAdmin } from './shared.mjs'
import { createPermissionUsers, readRequiredStandState, validatePermissionControls } from './permissions-ui.mjs'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

async function main() {
  const stand = readRequiredStandState()
  const { browser, context, page, adminUrl } = await loginAdmin()
  const validationPage = await context.newPage()

  try {
    try {
      await validatePermissionControls(validationPage, adminUrl)
    } finally {
      await validationPage.close().catch(() => {})
    }

    const state = await createPermissionUsers(page, adminUrl, stand).catch(async (error) => {
      const artifactDir = resolve('test-results', 'permissions-prepare')
      mkdirSync(artifactDir, { recursive: true })
      await page.screenshot({ path: resolve(artifactDir, 'failed.png'), fullPage: true }).catch(() => {})
      throw error
    })
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
