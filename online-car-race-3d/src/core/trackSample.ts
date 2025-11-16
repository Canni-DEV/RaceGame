import { normalize, sub } from './math2d'
import type {
  StartBuildingDecoration,
  TrackData,
  TrackDecoration,
  TreeBeltDecoration,
  Vec2,
} from './trackTypes'

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

function createTrack(track: Omit<TrackData, 'decorations'>): TrackData {
  return {
    ...track,
    decorations: buildDecorations(track.centerline, track.width),
  }
}

function buildDecorations(centerline: Vec2[], width: number): TrackDecoration[] {
  const trees: TreeBeltDecoration = {
    type: 'tree-belt',
    density: 6,
    minDistance: width * 0.7,
    maxDistance: width * 2.5,
  }
  const building = createStartBuilding(centerline, width)
  return building ? [trees, building] : [trees]
}

function createStartBuilding(centerline: Vec2[], width: number): StartBuildingDecoration | null {
  if (centerline.length < 2) {
    return null
  }
  const start = centerline[0]
  const next = centerline[1]
  const direction = normalize(sub(next, start))
  if (direction.x === 0 && direction.z === 0) {
    return null
  }
  const normal = { x: -direction.z, z: direction.x }
  const offset = width * 1.6
  const rotation = Math.atan2(direction.z, direction.x)
  return {
    type: 'start-building',
    position: {
      x: start.x + normal.x * offset,
      z: start.z + normal.z * offset,
    },
    rotation,
    length: width * 2.1,
    width: width * 1.1,
    height: width * 0.6,
  }
}
