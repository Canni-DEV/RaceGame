import type { PlayerRole, TrackData, RoomState } from '../core/trackTypes'

export interface PlayerSummary {
  playerId: string
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
