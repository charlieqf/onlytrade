import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function runNodeTest(args) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: process.env,
  })

  if (typeof result.status === 'number') return result.status
  return 1
}

// Run test files sequentially for portability.
// This avoids relying on Node-version-specific concurrency flags and reduces
// flakiness from concurrently spawned child processes.
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const testDir = path.resolve(__dirname, '..', 'test')

let entries
try {
  entries = await readdir(testDir, { withFileTypes: true })
} catch {
  process.exit(runNodeTest(['--test']))
}

const testFiles = entries
  .filter((ent) => ent.isFile() && ent.name.endsWith('.test.mjs'))
  .map((ent) => path.join(testDir, ent.name))
  .sort((a, b) => a.localeCompare(b))

if (testFiles.length === 0) {
  process.exit(runNodeTest(['--test']))
}

for (const filePath of testFiles) {
  const code = runNodeTest(['--test', filePath])
  if (code !== 0) process.exit(code)
}

process.exit(0)
