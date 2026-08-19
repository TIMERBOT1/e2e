import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const envFile = resolve(fileURLToPath(new URL('.', import.meta.url)), '.env.stand.local')

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)

    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  }
}

const standSlowMoMs = Number(process.env.STAND_SLOW_MO_MS || 0) || undefined

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  expect: {
    timeout: 15_000
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.CALL_TERMINAL_BASE_URL || process.env.TERMINAL_URL || 'https://call.vseupalo.ru/terminal/',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: process.env.STAND_VIDEO || 'retain-on-failure',
    launchOptions: standSlowMoMs ? { slowMo: standSlowMoMs } : undefined
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1080, height: 1920 }
      }
    }
  ]
})
