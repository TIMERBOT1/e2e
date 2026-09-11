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
const e2eTimezone = process.env.E2E_TIMEZONE || 'Asia/Yekaterinburg'
const e2eLocale = process.env.E2E_LOCALE || 'ru-RU'
const isFunctionalE2E = process.env.E2E_SUITE === 'functional'
const functionalWorkers = Math.max(1, Number(process.env.E2E_WORKERS || 2) || 2)

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  fullyParallel: isFunctionalE2E,
  workers: isFunctionalE2E ? functionalWorkers : 1,
  expect: {
    timeout: 15_000
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.CALL_TERMINAL_BASE_URL || process.env.TERMINAL_URL || 'https://call.vseupalo.ru/terminal/',
    locale: e2eLocale,
    timezoneId: e2eTimezone,
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
