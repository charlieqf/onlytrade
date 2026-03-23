function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(value)
}

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim()
  if (!trimmed || trimmed === '/') {
    return '/'
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`
}

export function resolveAppUrl(path: string, basePath: string, origin = 'http://localhost'): string {
  if (isAbsoluteUrl(path)) {
    return path
  }

  const normalizedBase = normalizeBasePath(basePath)
  if (path.startsWith(normalizedBase)) {
    return path
  }
  if (normalizedBase === '/' && path.startsWith('/')) {
    return path
  }

  const normalizedPath = path.replace(/^\/+/, '')
  const url = new URL(normalizedPath, new URL(normalizedBase, origin))
  return `${url.pathname}${url.search}${url.hash}`
}

export function resolveDownloadUrl(path: string, basePath: string, origin = 'http://localhost'): string {
  if (isAbsoluteUrl(path)) {
    const url = new URL(path)
    url.searchParams.set('download', '1')
    return url.toString()
  }

  const url = new URL(resolveAppUrl(path, basePath, origin), origin)
  url.searchParams.set('download', '1')
  return `${url.pathname}${url.search}${url.hash}`
}

export function toAppUrl(path: string): string {
  return resolveAppUrl(path, import.meta.env.BASE_URL, window.location.origin)
}

export function toDownloadUrl(path: string): string {
  return resolveDownloadUrl(path, import.meta.env.BASE_URL, window.location.origin)
}
