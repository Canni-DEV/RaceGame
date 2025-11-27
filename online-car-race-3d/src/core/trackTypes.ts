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
}

export type PlayerRole = 'viewer' | 'controller'
