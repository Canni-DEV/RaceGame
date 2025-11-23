import { randomBytes } from "crypto";
import {
  DEFAULT_ROOM_PREFIX,
  MAX_PLAYERS_PER_ROOM
} from "../config";
import { JoinRoomRequest } from "../types/messages";
import { PlayerRole } from "../types/trackTypes";
import { trackRepository } from "./TrackRepository";
import { Room, PlayerInput } from "./Room";

interface ViewerJoinResult {
  room: Room;
  playerId: string;
  trackCreated: boolean;
  playerCreated: boolean;
}

interface ControllerJoinResult {
  room: Room;
  playerId: string;
  playerCreated: boolean;
}

interface DisconnectResult {
  removedPlayers: { roomId: string; playerId: string }[];
  deletedRooms: string[];
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private socketToRoom: Map<string, string> = new Map();
  private socketRoles: Map<string, PlayerRole> = new Map();
  private viewerSocketToPlayer: Map<string, string> = new Map();
  private controllerSocketToPlayer: Map<string, string> = new Map();

  handleViewerJoin(socketId: string, payload: JoinRoomRequest): ViewerJoinResult {
    const { room, isNewRoom } = this.resolveRoom(payload.roomId);

    let playerId = payload.playerId;
    let playerCreated = false;

    if (!playerId) {
      playerId = this.generatePlayerId(room);
      console.log(playerId);
    } else if (room.isPlayerIdTaken(playerId)) {
      throw new Error("Player already assigned");
    }

    if (!playerId) {
      throw new Error("Unable to assign playerId");
    }

    room.addViewer(socketId, playerId);

    this.socketToRoom.set(socketId, room.roomId);
    this.socketRoles.set(socketId, "viewer");
    this.viewerSocketToPlayer.set(socketId, playerId);

    return {
      room,
      playerId,
      trackCreated: isNewRoom,
      playerCreated
    };
  }

  handleControllerJoin(socketId: string, payload: JoinRoomRequest): ControllerJoinResult {
    if (!payload.roomId) {
      throw new Error("roomId is required for controllers");
    }
    if (!payload.playerId) {
      throw new Error("playerId is required for controllers");
    }

    const room = this.rooms.get(payload.roomId);
    if (!room) {
      throw new Error("Room not found");
    }

    if (!room.hasViewerForPlayer(payload.playerId)) {
      throw new Error("Viewer session not found for player");
    }

    let playerCreated = false;

    if (!room.cars.has(payload.playerId)) {
      if (room.getHumanPlayerCount() >= MAX_PLAYERS_PER_ROOM) {
        throw new Error("Room is full");
      }
      room.addPlayer(payload.playerId);
      playerCreated = true;
    }

    const existingController = room.getControllerSocket(payload.playerId);
    if (existingController) {
      room.detachController(existingController);
      this.controllerSocketToPlayer.delete(existingController);
      this.socketToRoom.delete(existingController);
      this.socketRoles.delete(existingController);
    }

    room.attachController(socketId, payload.playerId);

    this.socketToRoom.set(socketId, room.roomId);
    this.socketRoles.set(socketId, "controller");
    this.controllerSocketToPlayer.set(socketId, payload.playerId);

    return {
      room,
      playerId: payload.playerId,
      playerCreated
    };
  }

  handleInput(roomId: string, playerId: string, input: PlayerInput): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("Room not found");
    }
    if (!room.cars.has(playerId)) {
      throw new Error("Player not found in room");
    }

    room.applyInput(playerId, input);
  }

  handleDisconnect(socketId: string): DisconnectResult {
    const roomId = this.socketToRoom.get(socketId);
    const role = this.socketRoles.get(socketId);
    const removedPlayers: { roomId: string; playerId: string }[] = [];

    if (!roomId || !role) {
      return { removedPlayers, deletedRooms: [] };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      this.cleanupSocket(socketId);
      return { removedPlayers, deletedRooms: [] };
    }

    if (role === "viewer") {
      const playerId = this.viewerSocketToPlayer.get(socketId);
      const removedPlayerId = room.removeViewer(socketId);
      this.viewerSocketToPlayer.delete(socketId);
      if (playerId && removedPlayerId === playerId) {
        const controllerSocket = room.removePlayer(playerId);
        if (controllerSocket) {
          this.controllerSocketToPlayer.delete(controllerSocket);
          this.cleanupSocket(controllerSocket);
        }
        removedPlayers.push({ roomId, playerId });
      }
    } else if (role === "controller") {
      room.detachController(socketId);
      this.controllerSocketToPlayer.delete(socketId);
    }

    this.cleanupSocket(socketId);

    let deletedRooms: string[] = [];
    if (room.isEmpty()) {
      this.rooms.delete(room.roomId);
      deletedRooms = [room.roomId];
    }

    return { removedPlayers, deletedRooms };
  }

  getRooms(): IterableIterator<Room> {
    return this.rooms.values();
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  deleteRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }

  private resolveRoom(roomId?: string): { room: Room; isNewRoom: boolean } {
    if (roomId) {
      const existingRoom = this.rooms.get(roomId);
      if (!existingRoom) {
        throw new Error("Room not found");
      }
      return { room: existingRoom, isNewRoom: false };
    }

    const reusableRoom = this.findReusableRoom();
    if (reusableRoom) {
      return { room: reusableRoom, isNewRoom: false };
    }

    const newRoomId = this.generateRoomId();
    console.log(newRoomId);
    const track = trackRepository.getDefaultTrack();
    const room = new Room(newRoomId, track);
    this.rooms.set(newRoomId, room);
    return { room, isNewRoom: true };
  }

  private findReusableRoom(): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.getHumanPlayerCount() < MAX_PLAYERS_PER_ROOM) {
        return room;
      }
    }
    return undefined;
  }

  private generateRoomId(): string {
    return `${DEFAULT_ROOM_PREFIX}-${randomBytes(3).toString("hex")}`;
  }

  private generatePlayerId(room: Room): string {
    let playerId = "";
    do {
      playerId = `player-${randomBytes(2).toString("hex")}`;
    } while (room.isPlayerIdTaken(playerId));
    return playerId;
  }

  private cleanupSocket(socketId: string): void {
    this.socketToRoom.delete(socketId);
    this.socketRoles.delete(socketId);
  }
}
