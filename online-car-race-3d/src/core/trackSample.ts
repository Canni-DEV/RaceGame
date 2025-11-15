import type { TrackData } from './trackTypes'

export const SAMPLE_TRACK: TrackData = {
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
}

export const ARCADE_SAMPLE_TRACK: TrackData = {
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
}
