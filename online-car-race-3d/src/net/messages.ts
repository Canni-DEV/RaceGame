import type { PlayerRole, TrackData, RoomState, RoomStateDelta } from '../core/trackTypes'

export interface PlayerSummary {
  playerId: string
  username: string
  isNpc?: boolean
}

export interface RoomInfoMessage {
  roomId: string
  playerId: string
  role: PlayerRole
  track: TrackData
  players: PlayerSummary[]
  sessionToken?: string
  protocolVersion?: number
  serverVersion?: string
}

export type StateMessage = RoomState
export type StateFullMessage = RoomState
export type StateDeltaMessage = RoomStateDelta

export interface ErrorMessage {
  message: string
}

export interface PlayerEventMessage {
  roomId: string
  playerId: string
  username: string
}
