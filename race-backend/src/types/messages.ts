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
  players: { playerId: string }[];
}

export interface InputMessage {
  roomId: string;
  playerId: string;
  steer: number;
  throttle: number;
  brake: number;
}

export interface StateMessage {
  room: RoomState;
}

export interface ErrorMessage {
  message: string;
}

export interface PlayerEventMessage {
  roomId: string;
  playerId: string;
}
