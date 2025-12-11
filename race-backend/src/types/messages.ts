import { PlayerRole, RoomState, RoomStateDelta, TrackData } from "./trackTypes";

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
  players: { playerId: string; username: string; isNpc?: boolean }[];
}

export interface InputMessage {
  roomId: string;
  playerId: string;
  steer: number;
  throttle: number;
  brake: number;
  actions?: {
    turbo?: boolean;
    reset?: boolean;
    shoot?: boolean;
  };
}

export type StateMessage = RoomState;
export type StateFullMessage = RoomState;
export type StateDeltaMessage = RoomStateDelta;

export interface ErrorMessage {
  message: string;
}

export interface PlayerEventMessage {
  roomId: string;
  playerId: string;
  username: string;
}

export interface UsernameUpdateMessage {
  roomId: string;
  playerId: string;
  username: string;
}
