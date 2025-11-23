import http from "http";
import { Server, Socket } from "socket.io";
import {
  ErrorMessage,
  InputMessage,
  JoinRoomRequest,
  PlayerEventMessage,
  RoomInfoMessage
} from "../types/messages";
import { RoomState } from "../types/trackTypes";
import { RoomManager } from "../game/RoomManager";

export class SocketServer {
  private io: Server;

  constructor(httpServer: http.Server, private readonly roomManager: RoomManager) {
    this.io = new Server(httpServer, {
      cors: {
        origin: "*"
      }
    });

    this.io.on("connection", (socket) => this.onConnection(socket));
  }

  broadcastState(roomId: string, state: RoomState): void {
    this.io.to(roomId).emit("state", state);
  }

  private onConnection(socket: Socket): void {
    socket.on("join_room", (payload: JoinRoomRequest) => {
      this.handleJoinRoom(socket, payload);
    });

    socket.on("input", (payload: InputMessage) => {
      this.handleInput(socket, payload);
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
            playerId: result.playerId
          };
          this.io.to(result.room.roomId).emit("player_joined", joinMessage);
        }
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
        brake: payload.brake
      });
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
        playerId: player.playerId
      };
      this.io.to(player.roomId).emit("player_left", message);
    }
    for (const roomId of result.deletedRooms) {
      this.io.in(roomId).socketsLeave(roomId);
    }
  }

  private emitError(socket: Socket, message: string): void {
    const errorMessage: ErrorMessage = { message };
    socket.emit("error_message", errorMessage);
  }
}
