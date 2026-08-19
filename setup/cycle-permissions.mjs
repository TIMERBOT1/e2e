import { spawn } from 'node:child_process'

const permissionsSpec = process.env.PERMISSIONS_SPEC || 'specs/permissions'

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

function runPnpm(args) {
  if (process.env.npm_execpath) return run(process.execPath, [process.env.npm_execpath, ...args])
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args)
}

async function main() {
  process.env.E2E_SKIP_NO_SLOTS = '1'
  let code = await run('node', ['setup/prepare-stand.mjs'])

  try {
    if (code === 0) code = await run('node', ['setup/prepare-permissions.mjs'])
    if (code === 0) code = await runPnpm(['test', permissionsSpec])
  } finally {
    const permissionsCleanupCode = await run('node', ['setup/cleanup-permissions.mjs'])
    const standCleanupCode = await run('node', ['setup/cleanup-stand.mjs'])
    process.exit(code || permissionsCleanupCode || standCleanupCode)
  }
}

main()
