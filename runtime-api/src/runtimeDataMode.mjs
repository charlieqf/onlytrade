export function resolveRuntimeDataMode(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'live_file') return 'live_file'
  return 'replay'
}
