import { spawn } from 'node:child_process'

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

async function main() {
  const cycles = ['setup/cycle-e2e.mjs', 'setup/cycle-stand.mjs', 'setup/cycle-permissions.mjs']
  let exitCode = 0

  for (const cycle of cycles) {
    const code = await run('node', [cycle])
    if (code !== 0 && exitCode === 0) exitCode = code
  }

  process.exit(exitCode)
}

main()
