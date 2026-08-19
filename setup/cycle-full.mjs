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

async function runPermissionsCycle() {
  let code = await run('node', ['setup/prepare-permissions.mjs'])
  let cleanupCode = 0
  try {
    if (code === 0) code = await runPnpm(['test', permissionsSpec])
  } finally {
    cleanupCode = await run('node', ['setup/cleanup-permissions.mjs'])
  }
  return code || cleanupCode
}

async function main() {
  let code = await run('node', ['setup/prepare-stand.mjs'])

  try {
    if (code === 0) code = await runPnpm(['test'])
    if (code === 0) code = await runPermissionsCycle()
  } finally {
    const cleanupCode = await run('node', ['setup/cleanup-stand.mjs'])
    process.exit(code || cleanupCode)
  }
}

main()
