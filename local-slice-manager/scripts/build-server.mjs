import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const outDir = resolve(projectRoot, 'server-dist')
const tscCommand = process.platform === 'win32'
  ? ['cmd.exe', ['/d', '/s', '/c', 'tsc -p tsconfig.server.json']]
  : [resolve(projectRoot, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.server.json']]

rmSync(outDir, { force: true, recursive: true })

const build = spawnSync(tscCommand[0], tscCommand[1], {
  cwd: projectRoot,
  stdio: 'inherit',
})

if (build.error) {
  throw build.error
}

if ((build.status ?? 1) !== 0) {
  process.exit(build.status ?? 1)
}

const schemaSource = resolve(projectRoot, 'server', 'schema.sql')
const schemaTarget = resolve(outDir, 'server', 'schema.sql')
mkdirSync(dirname(schemaTarget), { recursive: true })

if (!existsSync(schemaSource)) {
  throw new Error(`Missing schema source: ${schemaSource}`)
}

cpSync(schemaSource, schemaTarget)
