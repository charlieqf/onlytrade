import { spawnSync } from 'node:child_process'

function run(args) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: process.env,
  })

  if (typeof result.status === 'number') return result.status
  // In rare cases spawn can fail before producing a status.
  return 1
}

// Node's test runner flags differ slightly across Node versions.
// Some environments (notably Windows CI) benefit from serial execution,
// but older Node versions may not support the concurrency flag.
const preferred = ['--test', '--test-concurrency=1']
const fallback = ['--test']

const code = run(preferred)
if (code === 0) process.exit(0)

// If the flag is unsupported, retry without it.
// We don't try to parse stderr reliably here; a second run is cheap.
process.exit(run(fallback))
