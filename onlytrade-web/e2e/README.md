# E2E (Playwright)

These tests are intended to run from your local dev PC against the public URL after VM deployment.

## Environment Variables

- `E2E_BASE_URL` (required)
- `E2E_IGNORE_HTTPS_ERRORS` (optional, `true` to ignore self-signed certs)
- `E2E_EXPECT_TRADERS_NONEMPTY` (optional, `true` to require `/api/traders` returns at least 1 trader)
- `E2E_TRADER_SLUG` (optional, enables the "room loads with a known trader" test)
- `E2E_STREAM_TRADER_SLUG` (optional, enables stream page telemetry tests; falls back to `E2E_TRADER_SLUG`)
- `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_TOTP_SECRET` (optional, enables the login+OTP smoke test)

## Run

1) Install browsers (once per machine):

```bash
npx playwright install
```

2) Run smoke tests against the deployed URL:

```bash
E2E_BASE_URL="http://<public-ip-or-domain>" npm run test:e2e
```

PowerShell:

```powershell
$env:E2E_BASE_URL = "http://<public-ip-or-domain>"
npm run test:e2e
```

CMD:

```bat
set E2E_BASE_URL=http://<public-ip-or-domain>
npm run test:e2e
```

If you're using HTTPS with a self-signed cert:

```bash
E2E_BASE_URL="https://<public-ip-or-domain>" E2E_IGNORE_HTTPS_ERRORS=true npm run test:e2e
```

PowerShell:

```powershell
$env:E2E_BASE_URL = "https://<public-ip-or-domain>"
$env:E2E_IGNORE_HTTPS_ERRORS = "true"
npm run test:e2e
```
