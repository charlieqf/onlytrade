# mock-api (shim)

This directory is a compatibility shim.

The real backend service now lives in `runtime-api/`.

Why this exists:
- Existing deploy scripts and VM layouts may still run `node mock-api/server.mjs`.
- Keeping this shim reduces downtime and avoids having to migrate `.env.local` immediately.

Install note:

- Dependencies must be installed in `runtime-api/` (the shim only forwards execution).
