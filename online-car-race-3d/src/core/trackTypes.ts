export interface Vec2 {
  x: number
  z: number
}

export interface TrackData {
  id: string
  seed: number
  width: number
  centerline: Vec2[]
}

export interface CarState {
  playerId: string
  x: number
  z: number
  angle: number
  speed: number
}
