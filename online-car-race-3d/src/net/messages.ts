import type { PlayerRole, TrackData, RoomState } from '../core/trackTypes'

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
}

export type StateMessage = RoomState

export interface ErrorMessage {
  message: string
}

export interface PlayerEventMessage {
  roomId: string
  playerId: string
  username: string
}
