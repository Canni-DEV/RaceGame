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
