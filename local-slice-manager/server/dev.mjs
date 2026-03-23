import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const buildCommand = process.platform === 'win32'
  ? ['cmd.exe', ['/d', '/s', '/c', 'npm.cmd run build']]
  : ['npm', ['run', 'build']]

const build = spawnSync(buildCommand[0], buildCommand[1], {
  cwd: projectRoot,
  stdio: 'inherit',
})

if (build.error) {
  console.error(build.error)
  process.exit(1)
}

if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

const child = spawn(
  process.execPath,
  ['--import', 'tsx', './server/app.ts'],
  {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      SLICE_MANAGER_AUTO_SCAN: process.env.SLICE_MANAGER_AUTO_SCAN ?? '1',
      SLICE_MANAGER_HOST: process.env.SLICE_MANAGER_HOST ?? '127.0.0.1',
      PORT: process.env.PORT ?? '4177',
    },
  },
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
