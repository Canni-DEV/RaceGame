const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:|^\/\//

const DEFAULT_SERVER_URL = 'https://192.168.0.214:4000'
const RAW_BASE_URL = import.meta.env?.BASE_URL ?? '/'

function normalizeBasePath(base: string): string {
  if (!base || base === '/') {
    return '/'
  }
  return base.endsWith('/') ? base : `${base}/`
}

function isAbsoluteUrl(value: string): boolean {
  return ABSOLUTE_URL_PATTERN.test(value)
}

function trimTrailingSlash(value: string): string {
  if (!value || value === '/') {
    return '/'
  }
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export const SERVER_URL = trimTrailingSlash(
  (import.meta.env?.VITE_SERVER_URL ?? DEFAULT_SERVER_URL).trim(),
)

const BASE_PATH = normalizeBasePath(RAW_BASE_URL)

export function resolvePublicAssetUrl(path: string): string {
  if (!path) {
    return BASE_PATH
  }
  if (isAbsoluteUrl(path)) {
    return path
  }
  const relative = path.startsWith('/') ? path.slice(1) : path
  return `${BASE_PATH}${relative}`
}

export function resolveServerAssetUrl(path: string): string {
  if (!path) {
    return SERVER_URL
  }
  if (isAbsoluteUrl(path)) {
    return path
  }
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${SERVER_URL}${suffix}`
}
