# Local Slice Manager

Local-only review app for retained OnlyTrade MP4 slices on the resource generation PC.

## Install

```bash
npm --prefix local-slice-manager install
```

## Run in dev

```bash
npm --prefix local-slice-manager run dev
```

Default local paths are resolved from the repo root:

- `data/live/onlytrade/content_videos`
- `data/live/onlytrade/content_posters`
- `data/live/onlytrade/content_factory`
- `data/live/onlytrade/topic_packages`

The dev server binds to `127.0.0.1:4177` by default and is intended to run on the local content-generation PC only.

## Build

```bash
npm --prefix local-slice-manager run build
```

## Local-only access notes

- This app is designed for local review workflows, not public or VM-hosted access.
- Keep it bound to loopback unless you intentionally change the host setting.
- Scans read local retained manifests and local media folders; they do not depend on the zhibo VM.
