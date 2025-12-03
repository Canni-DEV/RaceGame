export interface Vec2 {
  x: number
  z: number
}

export interface TrackData {
  id: string
  seed: number
  width: number
  centerline: Vec2[]
  decorations: TrackDecoration[]
}

export interface TrackObjectInstance {
  position: Vec2
  rotation: number
  scale: number
}

export type InstanceMeshKind = 'gltf' | 'procedural-tree'

export interface InstancedDecoration {
  type: 'instanced-decoration'
  mesh: InstanceMeshKind
  assetUrl?: string
  instances: TrackObjectInstance[]
}

export type TrackDecoration = InstancedDecoration

export interface CarState {
  playerId: string
  username?: string
  x: number
  z: number
  angle: number
  speed: number
  isNpc?: boolean
  turboActive?: boolean
  turboCharges?: number
  turboRecharge?: number
  turboDurationLeft?: number
  missileCharges?: number
  missileRecharge?: number
  impactSpinTimeLeft?: number
}

export interface MissileState {
  id: string
  ownerId: string
  x: number
  z: number
  angle: number
  speed: number
  targetId?: string
}

export interface RoomState {
  roomId: string
  trackId: string
  serverTime: number
  cars: CarState[]
  missiles: MissileState[]
  race: RaceState
}

export type PlayerRole = 'viewer' | 'controller'

export type RacePhase = 'lobby' | 'countdown' | 'race' | 'postrace'

export interface LeaderboardEntry {
  playerId: string
  username?: string
  position: number
  lap: number
  totalDistance: number
  gapToFirst: number | null
  isFinished: boolean
  isNpc?: boolean
  ready: boolean
  finishTime?: number
}

export interface RacePlayerState {
  playerId: string
  username?: string
  lap: number
  progressOnLap: number
  totalDistance: number
  ready: boolean
  isFinished: boolean
  isNpc?: boolean
  finishTime?: number
}

export interface RaceState {
  phase: RacePhase
  lapsRequired: number
  countdownRemaining: number | null
  countdownTotal: number | null
  finishTimeoutRemaining: number | null
  postRaceRemaining: number | null
  startSegmentIndex: number
  leaderboard: LeaderboardEntry[]
  players: RacePlayerState[]
}
