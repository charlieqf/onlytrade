import { defineConfig } from 'vite'

function normalizePublicBase(basePath: string | undefined): string {
  const trimmed = basePath?.trim() ?? ''
  if (!trimmed || trimmed === '/') {
    return '/'
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`
}

export default defineConfig({
  base: normalizePublicBase(process.env.SLICE_MANAGER_PUBLIC_BASE),
})
