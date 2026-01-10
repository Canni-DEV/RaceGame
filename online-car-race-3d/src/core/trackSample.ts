import * as THREE from 'three'
import type { TrackData, TrackDecoration, TrackObjectInstance } from './trackTypes'
import { createRandom } from './random'
import { normalize, rightNormal, sub } from './math2d'

const TREE_SIDES: ReadonlyArray<1 | -1> = [1, -1]

export const SAMPLE_TRACK: TrackData = createTrack({
  id: 'sample-oval',
  seed: 12345,
  width: 12,
  centerline: [
    { x: -30, z: 0 },
    { x: -20, z: 20 },
    { x: 0, z: 30 },
    { x: 20, z: 20 },
    { x: 30, z: 0 },
    { x: 20, z: -20 },
    { x: 0, z: -30 },
    { x: -20, z: -20 },
  ],
})

export const ARCADE_SAMPLE_TRACK: TrackData = createTrack({
  id: 'arcade-speedway',
  seed: 98765,
  width: 14,
  centerline: [
    { x: -55, z: -8 },
    { x: -68, z: 10 },
    { x: -70, z: 35 },
    { x: -50, z: 60 },
    { x: -20, z: 72 },
    { x: 15, z: 74 },
    { x: 45, z: 65 },
    { x: 70, z: 38 },
    { x: 75, z: 5 },
    { x: 60, z: -25 },
    { x: 30, z: -45 },
    { x: 0, z: -55 },
    { x: -30, z: -50 },
    { x: -55, z: -35 },
    { x: -60, z: -15 },
    { x: -40, z: 5 },
    { x: -15, z: 20 },
    { x: 15, z: 32 },
    { x: 40, z: 28 },
    { x: 58, z: 10 },
    { x: 52, z: -10 },
    { x: 30, z: -22 },
    { x: 0, z: -28 },
    { x: -30, z: -20 },
  ],
})

function createTrack(track: Omit<TrackData, 'decorations' | 'itemSpawns'>): TrackData {
  const decorations = buildDecorations(track.width, track.centerline, track.seed)
  return { ...track, itemSpawns: [], decorations }
}

function buildDecorations(width: number, centerline: TrackData['centerline'], seed: number): TrackDecoration[] {
  const random = createRandom(seed ^ 0x9e3779b9)
  const minDistance = width * 0.7
  const maxDistance = width * 2.3
  const minSpacing = Math.max(4, width * 0.8)
  const instances: TrackObjectInstance[] = []

  for (let i = 0; i < centerline.length; i++) {
    const current = centerline[i]
    const next = centerline[(i + 1) % centerline.length]
    const dir = normalize(sub(next, current))
    const normal = rightNormal(dir)

    for (const side of TREE_SIDES) {
      if (random() < 0.35) {
        continue
      }
      const distance = THREE.MathUtils.lerp(minDistance, maxDistance, random())
      const offset = random() * width * 0.6
      const position = {
        x: current.x + dir.x * offset + normal.x * distance * side,
        z: current.z + dir.z * offset + normal.z * distance * side,
      }
      if (isTooClose(position, instances, minSpacing)) {
        continue
      }
      const rotation = random() * Math.PI * 2
      const scale = THREE.MathUtils.lerp(0.85, 1.6, random())
      instances.push({ position, rotation, scale })
    }
  }

  return [
    {
      type: 'instanced-decoration',
      mesh: 'procedural-tree',
      instances,
    },
  ]
}

function isTooClose(position: { x: number; z: number }, instances: TrackObjectInstance[], minSpacing: number): boolean {
  const minSq = minSpacing * minSpacing
  return instances.some((instance) => {
    const dx = instance.position.x - position.x
    const dz = instance.position.z - position.z
    return dx * dx + dz * dz < minSq
  })
}
