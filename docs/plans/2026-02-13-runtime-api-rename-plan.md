# Runtime API Rename Plan (runtime-api -> runtime-api)

## Why

`runtime-api` now runs live/realtime trading runtime, so the name is misleading for operations and onboarding.

## Goal

Rename service/package/path references from `runtime-api` to `runtime-api` without breaking deployment, scripts, or integrations.

## Non-goals (for initial rename)

- no behavior changes in trading logic
- no endpoint path changes
- no env var contract changes

## Safe phased approach

1. **Compatibility alias phase**
   - create `runtime-api/` as primary code location
   - keep `runtime-api/` as thin shim (delegates to runtime-api start/test scripts)
   - keep existing deploy scripts working

2. **Ops update phase**
   - update VM/systemd/pm2/process runner references to `runtime-api`
   - update local scripts (`onlytrade-ops.sh`, `deploy-vm.sh`) to prefer `runtime-api`, fallback to `runtime-api`

3. **Verification phase**
   - health + runtime endpoints
   - live-file freshness checks
   - register/start/stop agent lifecycle
   - chat + avatar asset endpoints

4. **Cleanup phase**
   - remove fallback shim after one stable release cycle
   - remove old path references from docs and scripts

## Rollback

- keep `runtime-api` entrypoint available until cleanup phase
- if issues appear, switch process runner back to `runtime-api` start command (same code)

## Acceptance criteria

- no downtime during cutover
- all existing ops commands continue working
- live trading runtime behavior unchanged before/after rename
