// Compatibility entrypoint.
//
// The real runtime service lives in runtime-api/.
// This file exists to avoid breaking existing ops scripts and VM layouts
// that still run `node mock-api/server.mjs`.

try {
  await import('../runtime-api/server.mjs')
} catch (err) {
  console.error('[mock-api] Failed to start shim. The real service is in runtime-api/.')
  console.error('[mock-api] Fix: run `npm ci --prefix runtime-api` (or `npm install --prefix runtime-api`) then retry.')
  throw err
}
