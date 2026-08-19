import { spawn } from 'node:child_process'

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

function runPnpm(args) {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args])
  }

  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args)
}

async function main() {
  const prepareCode = await run('node', ['setup/prepare-stand.mjs'])
  if (prepareCode !== 0) {
    const cleanupCode = await run('node', ['setup/cleanup-stand.mjs'])
    process.exit(prepareCode || cleanupCode)
  }

  const testCode = await runPnpm(['test'])
  const cleanupCode = await run('node', ['setup/cleanup-stand.mjs'])

  process.exit(testCode || cleanupCode)
}

main()
