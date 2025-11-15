import type { Vec2 } from './trackTypes'

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z }
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.z)
}

export function normalize(v: Vec2): Vec2 {
  const len = length(v)
  if (len === 0) {
    return { x: 0, z: 0 }
  }
  return { x: v.x / len, z: v.z / len }
}

export function rightNormal(dir: Vec2): Vec2 {
  const normal = { x: dir.z, z: -dir.x }
  return normalize(normal)
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
  }
}
