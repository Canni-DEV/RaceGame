export function getNumberEnv(key: string, fallback: number): number {
  const raw = import.meta.env?.[key]
  if (typeof raw !== 'string') {
    return fallback
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

export function getStringEnv(key: string, fallback: string): string | null {
  const raw = import.meta.env?.[key]
  if (typeof raw !== 'string') {
    return fallback
  }
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}
