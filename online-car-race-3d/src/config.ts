const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:|^\/\//

function resolveDefaultServerUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return 'https://localhost:4000'
}

const DEFAULT_SERVER_URL = resolveDefaultServerUrl()
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
