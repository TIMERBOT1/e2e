process.env.STAND_VIDEO = process.env.STAND_VIDEO || 'on'
process.env.STAND_SLOW_MO_MS = process.env.STAND_SLOW_MO_MS || '250'

await import('./cycle-e2e.mjs')
