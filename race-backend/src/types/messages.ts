import { PlayerRole, RoomState, TrackData } from "./trackTypes";

export interface JoinRoomRequest {
  roomId?: string;
  role: PlayerRole;
  playerId?: string;
}

export interface RoomInfoMessage {
  roomId: string;
  playerId: string;
  role: PlayerRole;
  track: TrackData;
  players: { playerId: string; isNpc?: boolean }[];
}

export interface InputMessage {
  roomId: string;
  playerId: string;
  steer: number;
  throttle: number;
  brake: number;
}

export type StateMessage = RoomState;

export interface ErrorMessage {
  message: string;
}

export interface PlayerEventMessage {
  roomId: string;
  playerId: string;
}
