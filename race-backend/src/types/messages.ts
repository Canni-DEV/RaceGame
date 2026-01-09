import { PlayerRole, RoomState, RoomStateDelta, TrackData } from "./trackTypes";

export interface JoinRoomRequest {
  roomId?: string;
  role: PlayerRole;
  playerId?: string;
  sessionToken?: string;
  protocolVersion?: number;
}

export interface RoomInfoMessage {
  roomId: string;
  playerId: string;
  role: PlayerRole;
  track: TrackData;
  players: { playerId: string; username: string; isNpc?: boolean }[];
  sessionToken?: string;
  protocolVersion?: number;
  serverVersion?: string;
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
  sessionToken?: string;
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
