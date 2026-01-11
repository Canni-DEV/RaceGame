export function hashPlayerIdToHue(playerId: string): number {
  let hash = 0
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash * 31 + playerId.charCodeAt(i)) | 0
  }
  const normalized = (hash & 0xffff) / 0xffff
  return (normalized + 1) % 1
}
