const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:|^\/\//

function getBrowserOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return ''
}

function parseUrl(value: string | undefined): URL | null {
  if (!value) {
    return null
  }
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isLocalHost(hostname: string | null | undefined): boolean {
  if (!hostname) {
    return false
  }
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  )
}

const RAW_BASE_URL = import.meta.env?.BASE_URL ?? '/'
const RAW_ENV_SERVER_URL = (import.meta.env?.VITE_SERVER_URL ?? '').trim()

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

function readNumberEnv(key: string, fallback: number, min: number, max: number): number {
  const raw = import.meta.env?.[key]
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(Math.max(parsed, min), max)
}

export const SERVER_URL = trimTrailingSlash(
  ((): string => {
    const origin = getBrowserOrigin()
    const envUrl = parseUrl(RAW_ENV_SERVER_URL)
    const originUrl = parseUrl(origin)

    // Prefer explicit env; only fall back to origin when env is empty.
    // Special case: if env points to localhost but we are served from a non-local host (e.g. tunnel),
    // use the current origin to avoid mixed origins.
    if (envUrl) {
      if (originUrl && isLocalHost(envUrl.hostname) && !isLocalHost(originUrl.hostname)) {
        return originUrl.origin
      }
      return RAW_ENV_SERVER_URL
    }

    if (origin) {
      return origin
    }

    return 'https://localhost:4000'
  })(),
)

export const PROTOCOL_VERSION = 2
export const CHAT_MESSAGE_TTL_MS = readNumberEnv('VITE_CHAT_MESSAGE_TTL_MS', 30000, 1000, 300000)
export const CHAT_MAX_MESSAGES = Math.round(readNumberEnv('VITE_CHAT_MAX_MESSAGES', 6, 1, 40))
export const CHAT_MAX_MESSAGE_LENGTH = Math.round(
  readNumberEnv('VITE_CHAT_MAX_MESSAGE_LENGTH', 140, 1, 500),
)
export const CHAT_SEND_COOLDOWN_MS = Math.round(
  readNumberEnv('VITE_CHAT_SEND_COOLDOWN_MS', 400, 0, 5000),
)

const BASE_PATH = normalizeBasePath(RAW_BASE_URL)

const RAW_PROCEDURAL_SKY_ROOMS = String(import.meta.env?.VITE_PROCEDURAL_SKY_ROOMS ?? '').trim()
const PROCEDURAL_SKY_ALL =
  RAW_PROCEDURAL_SKY_ROOMS === '*' || RAW_PROCEDURAL_SKY_ROOMS.toLowerCase() === 'all'
const PROCEDURAL_SKY_ROOM_SET = new Set(
  RAW_PROCEDURAL_SKY_ROOMS
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== '*' && entry.toLowerCase() !== 'all'),
)

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

export function isProceduralSkyEnabled(roomId: string | null): boolean {
  if (PROCEDURAL_SKY_ALL) {
    return true
  }
  if (!roomId) {
    return false
  }
  return PROCEDURAL_SKY_ROOM_SET.has(roomId)
}
