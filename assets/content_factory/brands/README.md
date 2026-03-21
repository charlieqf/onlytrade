# Brand Asset Naming

Place optional fallback brand images for the shared `china-bigtech` content-factory pipeline in this folder.

- Use one file per reusable image.
- Name files as `<entity_key>--<slot>.<ext>`.
- Allowed examples: `tencent--cover.png`, `alibaba--quote.jpg`, `bytedance--wide.webp`.
- Keep filenames lowercase with ASCII letters, numbers, and dashes.
- Supported image extensions are `.png`, `.jpg`, `.jpeg`, and `.webp`.

The selector loads files whose prefix matches the package `entity_key`, sorts them by filename, and uses them after article images but before generated cards. These fallbacks are primarily for `t_022`, but they are selected in the shared package layer so the same content package can feed both `t_019` and `t_022`.
