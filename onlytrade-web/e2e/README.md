# E2E (Playwright)

These tests are intended to run from your local dev PC against the public URL after VM deployment.

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
