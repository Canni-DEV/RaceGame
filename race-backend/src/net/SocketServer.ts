import http from "http";
import { Server, Socket } from "socket.io";
import {
  ErrorMessage,
  InputMessage,
  JoinRoomRequest,
  PlayerEventMessage,
  RoomInfoMessage,
  UsernameUpdateMessage
} from "../types/messages";
import { RoomState } from "../types/trackTypes";
import { RoomManager } from "../game/RoomManager";
import { serializeRoomState } from "./stateSerializer";
import { computeStateDelta, hasBroadcastableChanges, shouldSendFullSnapshot } from "./stateDiff";

export class SocketServer {
  private io: Server;
  private readonly lastFullStates: Map<string, RoomState> = new Map();

  constructor(httpServer: http.Server, private readonly roomManager: RoomManager) {
    this.io = new Server(httpServer, {
      cors: {
        origin: "*"
      }
    });

    this.io.on("connection", (socket) => this.onConnection(socket));
  }

  broadcastState(roomId: string, state: RoomState): void {
    const serialized = serializeRoomState(state);
    const previous = this.lastFullStates.get(roomId);

    if (!previous) {
      this.sendFull(roomId, serialized);
      return;
    }

    const delta = computeStateDelta(previous, serialized);
    if (!hasBroadcastableChanges(delta)) {
      this.lastFullStates.set(roomId, serialized);
      return;
    }

    if (shouldSendFullSnapshot(delta, previous, serialized)) {
      this.sendFull(roomId, serialized);
      return;
    }

    delta.serverTime = serialized.serverTime;
    this.lastFullStates.set(roomId, serialized);
    this.io.to(roomId).emit("state_delta", delta);
  }

  private onConnection(socket: Socket): void {
    socket.on("join_room", (payload: JoinRoomRequest) => {
      this.handleJoinRoom(socket, payload);
    });

    socket.on("input", (payload: InputMessage) => {
      this.handleInput(socket, payload);
    });

    socket.on("update_username", (payload: UsernameUpdateMessage) => {
      this.handleUsernameUpdate(socket, payload);
    });

    socket.on("request_state_full", (payload: { roomId?: string }) => {
      const targetRoomId = payload?.roomId ?? this.roomManager.getRoomIdForSocket(socket.id);
      this.handleFullStateRequest(socket, targetRoomId);
    });

    socket.on("disconnect", () => {
      this.handleDisconnect(socket);
    });
  }

  private handleJoinRoom(socket: Socket, payload: JoinRoomRequest): void {
    if (!payload || !payload.role) {
      this.emitError(socket, "Invalid join payload");
      return;
    }

    try {
      if (payload.role === "viewer") {
        const result = this.roomManager.handleViewerJoin(socket.id, payload);
        socket.join(result.room.roomId);

        const info: RoomInfoMessage = {
          roomId: result.room.roomId,
          playerId: result.playerId,
          role: "viewer",
          track: result.room.track,
          players: result.room.getPlayers()
        };

        socket.emit("room_info", info);
        this.sendFullToSocket(socket, result.room.roomId, serializeRoomState(result.room.toRoomState()));

      } else if (payload.role === "controller") {
        const result = this.roomManager.handleControllerJoin(socket.id, payload);
        socket.join(result.room.roomId);

        const info: RoomInfoMessage = {
          roomId: result.room.roomId,
          playerId: result.playerId,
          role: "controller",
          track: result.room.track,
          players: result.room.getPlayers()
        };

        socket.emit("room_info", info);

        if (result.playerCreated) {
          const joinMessage: PlayerEventMessage = {
            roomId: result.room.roomId,
            playerId: result.playerId,
            username: result.username
          };
          this.io.to(result.room.roomId).emit("player_joined", joinMessage);
        }

        this.sendFullToSocket(socket, result.room.roomId, serializeRoomState(result.room.toRoomState()));
      } else {
        this.emitError(socket, "Unsupported role");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.emitError(socket, message);
    }
  }

  private handleInput(socket: Socket, payload: InputMessage): void {
    if (!payload) {
      this.emitError(socket, "Invalid input payload");
      return;
    }

    try {
      this.roomManager.handleInput(payload.roomId, payload.playerId, {
        steer: payload.steer,
        throttle: payload.throttle,
        brake: payload.brake,
        actions: payload.actions
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.emitError(socket, message);
    }
  }

  private handleUsernameUpdate(socket: Socket, payload: UsernameUpdateMessage): void {
    if (!payload) {
      this.emitError(socket, "Invalid username payload");
      return;
    }

    try {
      const result = this.roomManager.handleUsernameUpdate(socket.id, payload);
      const updateMessage: PlayerEventMessage = {
        roomId: result.room.roomId,
        playerId: result.playerId,
        username: result.username
      };
      this.io.to(result.room.roomId).emit("player_updated", updateMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.emitError(socket, message);
    }
  }

  private handleDisconnect(socket: Socket): void {
    const result = this.roomManager.handleDisconnect(socket.id);
    for (const player of result.removedPlayers) {
      const message: PlayerEventMessage = {
        roomId: player.roomId,
        playerId: player.playerId,
        username: player.username
      };
      this.io.to(player.roomId).emit("player_left", message);
    }
    for (const roomId of result.deletedRooms) {
      this.lastFullStates.delete(roomId);
      this.io.in(roomId).socketsLeave(roomId);
    }
  }

  private emitError(socket: Socket, message: string): void {
    const errorMessage: ErrorMessage = { message };
    socket.emit("error_message", errorMessage);
  }

  private handleFullStateRequest(socket: Socket, roomId?: string): void {
    if (!roomId) {
      this.emitError(socket, "RoomId required for state request");
      return;
    }

    const room = this.roomManager.getRoom(roomId);
    if (room) {
      const state = serializeRoomState(room.toRoomState());
      this.sendFullToSocket(socket, roomId, state);
      return;
    }

    const cached = this.lastFullStates.get(roomId);
    if (cached) {
      this.sendFullToSocket(socket, roomId, cached);
      return;
    }

    this.emitError(socket, "Room not found");
  }

  private sendFull(roomId: string, state: RoomState): void {
    this.lastFullStates.set(roomId, state);
    this.io.to(roomId).emit("state_full", state);
    this.io.to(roomId).emit("state", state);
  }

  private sendFullToSocket(socket: Socket, roomId: string, state: RoomState): void {
    socket.emit("state_full", state);
    socket.emit("state", state);
  }
}
