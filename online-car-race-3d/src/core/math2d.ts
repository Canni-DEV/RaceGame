import * as THREE from 'three'
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

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z }
}

export function scale(v: Vec2, factor: number): Vec2 {
  return { x: v.x * factor, z: v.z * factor }
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z
}

export function signedAngle(a: Vec2, b: Vec2): number {
  const na = normalize(a)
  const nb = normalize(b)
  const cross = na.x * nb.z - na.z * nb.x
  const clampedDot = THREE.MathUtils.clamp(dot(na, nb), -1, 1)
  return Math.atan2(cross, clampedDot)
}
