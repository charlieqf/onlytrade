import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = dirname(fileURLToPath(import.meta.url))
const appRoot = process.env.SLICE_MANAGER_APP_ROOT
  ? resolve(process.env.SLICE_MANAGER_APP_ROOT)
  : resolve(serverDir, '..')
const repoRoot = process.env.SLICE_MANAGER_REPO_ROOT
  ? resolve(process.env.SLICE_MANAGER_REPO_ROOT)
  : resolve(appRoot, '..')
const liveRoot = join(repoRoot, 'data', 'live', 'onlytrade')

function resolveConfiguredPath(envValue: string | undefined, fallbackPath: string): string {
  return envValue ? resolve(envValue) : fallbackPath
}

function resolveConfiguredNumber(envValue: string | undefined, fallbackValue: number): number {
  const parsed = Number(envValue)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallbackValue
}

const configuredDataDir = resolveConfiguredPath(
  process.env.SLICE_MANAGER_DATA_DIR,
  join(repoRoot, 'data', 'local_slice_manager'),
)
const configuredDbPath = resolveConfiguredPath(
  process.env.SLICE_MANAGER_DB_PATH,
  join(configuredDataDir, 'slice_manager.db'),
)

export const sliceManagerConfig = {
  appRoot,
  repoRoot,
  liveRoot,
  dataDir: configuredDataDir,
  dbPath: configuredDbPath,
  roomId: process.env.SLICE_MANAGER_ROOM_ID || 't_022',
  manifestDir: resolveConfiguredPath(
    process.env.SLICE_MANAGER_MANIFEST_DIR,
    join(liveRoot, 'content_factory'),
  ),
  videoDir: resolveConfiguredPath(
    process.env.SLICE_MANAGER_VIDEO_DIR,
    join(liveRoot, 'content_videos'),
  ),
  posterDir: resolveConfiguredPath(
    process.env.SLICE_MANAGER_POSTER_DIR,
    join(liveRoot, 'content_posters'),
  ),
  topicPackageDir: resolveConfiguredPath(
    process.env.SLICE_MANAGER_TOPIC_PACKAGE_DIR,
    join(liveRoot, 'topic_packages'),
  ),
  host: process.env.SLICE_MANAGER_HOST || '127.0.0.1',
  port: resolveConfiguredNumber(process.env.PORT, 4177),
} as const
