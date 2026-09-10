import { spawn } from 'node:child_process'

const defaultSpecs = [
  'specs/admin/appointment-today.spec.ts',
  'specs/admin/checkpoint-cases.spec.ts',
  'specs/admin/checkpoint-list.spec.ts',
  'specs/admin/future-appointment-creation.spec.ts',
  'specs/admin/line-monitoring.spec.ts',
  'specs/admin/settings.spec.ts',
  'specs/admin/staff-management-cases.spec.ts',
  'specs/terminal/booking.spec.ts'
]

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, E2E_SUITE: 'functional' }
    })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

function runPnpm(args) {
  if (process.env.npm_execpath) return run(process.execPath, [process.env.npm_execpath, ...args])
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args)
}

function testArgs() {
  const args = process.argv.slice(2)
  const hasExplicitSpec = args.some((arg) => /(^|[\\/])specs[\\/].*\.spec\.[cm]?[jt]s$/i.test(arg))
  return [...(hasExplicitSpec ? [] : defaultSpecs), ...args]
}

async function main() {
  const code = await runPnpm(['exec', 'playwright', 'test', ...testArgs()])
  process.exit(code)
}

main()
