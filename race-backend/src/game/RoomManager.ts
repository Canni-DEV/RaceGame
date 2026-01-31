import { randomBytes } from "crypto";
import {
  CHAT_MESSAGE_BURST_LIMIT,
  CHAT_MESSAGE_BURST_WINDOW_MS,
  CHAT_MESSAGE_MAX_LENGTH,
  DEFAULT_ROOM_PREFIX,
  INPUT_BURST_LIMIT,
  INPUT_BURST_WINDOW_MS,
  MAX_PLAYERS_PER_ROOM,
  PROTOCOL_VERSION
} from "../config";
import {
  ChatMessage,
  ChatSendMessage,
  InputMessage,
  JoinRoomRequest,
  UsernameUpdateMessage
} from "../types/messages";
import { PlayerRole, RoomRadioState } from "../types/trackTypes";
import { trackRepository } from "./TrackRepository";
import { Room, PlayerInput } from "./Room";

type BufferedActions = NonNullable<PlayerInput["actions"]>;
type BufferedActionMessage = {
  analog: { steer: number; throttle: number; brake: number };
  actions: BufferedActions;
};

interface BufferedInputEntry {
  analog: { steer: number; throttle: number; brake: number };
  actionQueue: BufferedActionMessage[];
  dirtyAnalog: boolean;
  lastAppliedAnalog?: { steer: number; throttle: number; brake: number };
  lastReceivedAt: number;
  burstWindowStart: number;
  burstCount: number;
}

interface ChatRateLimitEntry {
  windowStart: number;
  burstCount: number;
}

interface ViewerJoinResult {
  room: Room;
  playerId: string;
  trackCreated: boolean;
  playerCreated: boolean;
  sessionToken: string;
}

interface ControllerJoinResult {
  room: Room;
  playerId: string;
  playerCreated: boolean;
  username: string;
  sessionToken?: string;
}

interface DisconnectResult {
  removedPlayers: { roomId: string; playerId: string; username: string }[];
  deletedRooms: string[];
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private socketToRoom: Map<string, string> = new Map();
  private socketRoles: Map<string, PlayerRole> = new Map();
  private viewerSocketToPlayer: Map<string, string> = new Map();
  private controllerSocketToPlayer: Map<string, string> = new Map();
  private readonly sessionTokens: Map<string, Map<string, string>> = new Map();
  private readonly inputBuffers: Map<string, Map<string, BufferedInputEntry>> = new Map();
  private readonly chatRateLimits: Map<string, ChatRateLimitEntry> = new Map();

  handleViewerJoin(socketId: string, payload: JoinRoomRequest): ViewerJoinResult {
    this.assertProtocolVersion(payload.protocolVersion);
    const { room, isNewRoom } = this.resolveRoom(payload.roomId);

    let playerId = payload.playerId;
    let playerCreated = false;

    if (!playerId) {
      playerId = this.generatePlayerId(room);
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
    const sessionToken = this.getOrCreateSessionToken(room.roomId, playerId);

    return {
      room,
      playerId,
      trackCreated: isNewRoom,
      playerCreated,
      sessionToken
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
    if (!room.isJoinOpen()) {
      throw new Error("Carrera en curso, espera al lobby y actualiza el controlador.");
    }

    if (!room.hasViewerForPlayer(payload.playerId)) {
      throw new Error("Viewer session not found for player");
    }

    const expectedToken = this.getSessionToken(room.roomId, payload.playerId);
    this.assertProtocolVersion(payload.protocolVersion);
    if (!expectedToken || !payload.sessionToken || payload.sessionToken !== expectedToken) {
      throw new Error("Session token inválido");
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
      this.cleanupSocket(existingController);
    }

    room.attachController(socketId, payload.playerId);

    this.socketToRoom.set(socketId, room.roomId);
    this.socketRoles.set(socketId, "controller");
    this.controllerSocketToPlayer.set(socketId, payload.playerId);

    return {
      room,
      playerId: payload.playerId,
      playerCreated,
      username: room.getUsername(payload.playerId),
      sessionToken: expectedToken
    };
  }

  handleInput(socketId: string, payload: InputMessage): void {
    const role = this.socketRoles.get(socketId);
    if (role !== "controller") {
      throw new Error("Socket no autorizado para enviar inputs");
    }
    const roomId = this.socketToRoom.get(socketId);
    const playerId = this.controllerSocketToPlayer.get(socketId);
    if (!roomId || !playerId) {
      throw new Error("Controller session not bound");
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("Room not found");
    }
    if (!room.cars.has(playerId)) {
      throw new Error("Player not found in room");
    }

    const expectedToken = this.getSessionToken(roomId, playerId);
    if (!expectedToken || !payload.sessionToken || payload.sessionToken !== expectedToken) {
      throw new Error("Session token inválido");
    }

    const input = this.sanitizeInputPayload(payload);
    const buffered = this.getOrCreateBuffer(roomId, playerId);
    this.enforceBurstLimit(buffered, socketId);

    const incomingAnalog = {
      steer: input.steer,
      throttle: input.throttle,
      brake: input.brake
    };
    const analogChanged = !this.analogEquals(buffered.analog, incomingAnalog);
    buffered.analog = incomingAnalog;
    buffered.dirtyAnalog = buffered.dirtyAnalog || analogChanged || !buffered.lastAppliedAnalog;

    const actions = this.normalizeActions(input.actions);
    if (actions) {
      buffered.actionQueue.push({
        analog: incomingAnalog,
        actions
      });
    }

    buffered.lastReceivedAt = Date.now();
  }

  handleRadioCycle(socketId: string): {
    room: Room;
    actorId: string | null;
    actorName: string;
    actorIsNpc: boolean;
    previousRadio: RoomRadioState;
    nextRadio: RoomRadioState;
  } {
    const role = this.socketRoles.get(socketId);
    if (!role) {
      throw new Error("Socket no autorizado para radio");
    }
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) {
      throw new Error("Room not found");
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("Room not found");
    }

    const actorId = role === "viewer"
      ? this.viewerSocketToPlayer.get(socketId) ?? null
      : this.controllerSocketToPlayer.get(socketId) ?? null;
    const actorName = actorId ? room.getUsername(actorId) : "Alguien";
    const actorIsNpc = actorId ? room.isNpc(actorId) : false;
    const previousRadio = room.getRadioState();
    room.cycleRadio();
    const nextRadio = room.getRadioState();
    return { room, actorId, actorName, actorIsNpc, previousRadio, nextRadio };
  }

  handleUsernameUpdate(
    socketId: string,
    payload: UsernameUpdateMessage
  ): { room: Room; playerId: string; username: string } {
    const role = this.socketRoles.get(socketId);
    const roomId = this.socketToRoom.get(socketId);
    const boundPlayerId = this.controllerSocketToPlayer.get(socketId);

    if (role !== "controller" || !roomId || !boundPlayerId) {
      throw new Error("Solo el controlador puede actualizar el username");
    }
    if (payload.roomId !== roomId || payload.playerId !== boundPlayerId) {
      throw new Error("Sesión de controlador no vinculada con el jugador");
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("Room not found");
    }

    const username = room.updateUsername(boundPlayerId, payload.username);
    return { room, playerId: boundPlayerId, username };
  }

  handleChatMessage(socketId: string, payload: ChatSendMessage): ChatMessage {
    if (!payload) {
      throw new Error("Invalid chat payload");
    }
    const role = this.socketRoles.get(socketId);
    if (!role) {
      throw new Error("Socket no autorizado para chat");
    }

    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) {
      throw new Error("Room not found");
    }
    if (payload.roomId && payload.roomId !== roomId) {
      throw new Error("Chat room mismatch");
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("Room not found");
    }

    const playerId = role === "viewer"
      ? this.viewerSocketToPlayer.get(socketId)
      : this.controllerSocketToPlayer.get(socketId);
    if (!playerId) {
      throw new Error("Player not bound");
    }

    const message = this.sanitizeChatMessage(payload.message);
    if (!message) {
      throw new Error("Mensaje vacío");
    }

    this.enforceChatBurstLimit(socketId);

    return {
      roomId,
      playerId,
      username: room.getUsername(playerId),
      message,
      sentAt: Date.now()
    };
  }

  handleDisconnect(socketId: string): DisconnectResult {
    const roomId = this.socketToRoom.get(socketId);
    const role = this.socketRoles.get(socketId);
    const removedPlayers: { roomId: string; playerId: string; username: string }[] = [];

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
      const username = playerId ? room.getUsername(playerId) : "";
      const removedPlayerId = room.removeViewer(socketId);
      this.viewerSocketToPlayer.delete(socketId);
      if (playerId && removedPlayerId === playerId) {
        this.deleteSessionToken(roomId, playerId);
        const controllerSocket = room.removePlayer(playerId);
        this.removeBufferedInput(roomId, playerId);
        if (controllerSocket) {
          this.controllerSocketToPlayer.delete(controllerSocket);
          this.cleanupSocket(controllerSocket);
        }
        removedPlayers.push({ roomId, playerId, username: username || playerId });
      }
    } else if (role === "controller") {
      room.detachController(socketId);
      this.controllerSocketToPlayer.delete(socketId);
    }

    this.cleanupSocket(socketId);

    let deletedRooms: string[] = [];
    if (room.isEmpty()) {
      this.rooms.delete(room.roomId);
      this.inputBuffers.delete(room.roomId);
      this.sessionTokens.delete(room.roomId);
      deletedRooms = [room.roomId];
    }

    return { removedPlayers, deletedRooms };
  }

  applyBufferedInputs(): void {
    for (const room of this.rooms.values()) {
      const buffers = this.inputBuffers.get(room.roomId);
      if (!buffers) {
        continue;
      }

      for (const [playerId, entry] of buffers.entries()) {
        if (!room.cars.has(playerId)) {
          buffers.delete(playerId);
          continue;
        }

        const hasActions = entry.actionQueue.length > 0;
        const analogChanged = entry.dirtyAnalog || !this.analogEquals(entry.lastAppliedAnalog, entry.analog);

        if (!hasActions && !analogChanged) {
          continue;
        }

        if (hasActions) {
          for (const message of entry.actionQueue) {
            room.applyInput(playerId, {
              ...message.analog,
              actions: message.actions
            });
            entry.lastAppliedAnalog = { ...message.analog };
          }
          entry.actionQueue.length = 0;
          entry.dirtyAnalog = entry.dirtyAnalog || !this.analogEquals(entry.lastAppliedAnalog, entry.analog);
          if (!entry.dirtyAnalog) {
            continue;
          }
        }

        room.applyInput(playerId, entry.analog);
        entry.lastAppliedAnalog = { ...entry.analog };
        entry.dirtyAnalog = false;
      }
    }
  }

  getRooms(): IterableIterator<Room> {
    return this.rooms.values();
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getRoomIdForSocket(socketId: string): string | undefined {
    return this.socketToRoom.get(socketId);
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
    this.chatRateLimits.delete(socketId);
  }

  private getOrCreateBuffer(roomId: string, playerId: string): BufferedInputEntry {
    let roomBuffers = this.inputBuffers.get(roomId);
    if (!roomBuffers) {
      roomBuffers = new Map();
      this.inputBuffers.set(roomId, roomBuffers);
    }

    let entry = roomBuffers.get(playerId);
    if (!entry) {
      entry = {
        analog: { steer: 0, throttle: 0, brake: 0 },
        actionQueue: [],
        dirtyAnalog: true,
        lastAppliedAnalog: undefined,
        lastReceivedAt: Date.now(),
        burstWindowStart: Date.now(),
        burstCount: 0
      };
      roomBuffers.set(playerId, entry);
    }
    return entry;
  }

  private removeBufferedInput(roomId: string, playerId: string): void {
    const buffers = this.inputBuffers.get(roomId);
    buffers?.delete(playerId);
  }

  private getSessionToken(roomId: string, playerId: string): string | undefined {
    return this.sessionTokens.get(roomId)?.get(playerId);
  }

  private getOrCreateSessionToken(roomId: string, playerId: string): string {
    let roomTokens = this.sessionTokens.get(roomId);
    if (!roomTokens) {
      roomTokens = new Map();
      this.sessionTokens.set(roomId, roomTokens);
    }

    const existing = roomTokens.get(playerId);
    if (existing) {
      return existing;
    }

    const token = randomBytes(16).toString("hex");
    roomTokens.set(playerId, token);
    return token;
  }

  private deleteSessionToken(roomId: string, playerId: string): void {
    const roomTokens = this.sessionTokens.get(roomId);
    if (!roomTokens) {
      return;
    }
    roomTokens.delete(playerId);
    if (roomTokens.size === 0) {
      this.sessionTokens.delete(roomId);
    }
  }

  private assertProtocolVersion(value?: number): void {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Protocol version requerida");
    }
    const normalized = Math.max(1, Math.floor(value));
    if (normalized !== PROTOCOL_VERSION) {
      throw new Error("Protocol version no soportada");
    }
  }

  private sanitizeInputPayload(payload: InputMessage): PlayerInput {
    return {
      steer: this.clampNumber(payload.steer, -1, 1, 0),
      throttle: this.clampNumber(payload.throttle, 0, 1, 0),
      brake: this.clampNumber(payload.brake, 0, 1, 0),
      actions: payload.actions
    };
  }

  private sanitizeChatMessage(raw: unknown): string {
    if (typeof raw !== "string") {
      return "";
    }
    const normalized = raw.replace(/[\r\n\t]+/g, " ").trim();
    if (!normalized) {
      return "";
    }
    if (normalized.length <= CHAT_MESSAGE_MAX_LENGTH) {
      return normalized;
    }
    return normalized.slice(0, CHAT_MESSAGE_MAX_LENGTH).trimEnd();
  }

  private clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.min(Math.max(numeric, min), max);
  }

  private analogEquals(
    first?: { steer: number; throttle: number; brake: number },
    second?: { steer: number; throttle: number; brake: number }
  ): boolean {
    if (!first || !second) {
      return false;
    }
    return (
      first.steer === second.steer &&
      first.throttle === second.throttle &&
      first.brake === second.brake
    );
  }

  private normalizeActions(actions?: PlayerInput["actions"]): BufferedActions | undefined {
    if (!actions) {
      return undefined;
    }
    const normalized: BufferedActions = {};
    if (actions.turbo) {
      normalized.turbo = true;
    }
    if (actions.reset) {
      normalized.reset = true;
    }
    if (actions.shoot) {
      normalized.shoot = true;
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  private enforceBurstLimit(entry: BufferedInputEntry, socketId: string): void {
    const now = Date.now();
    if (now - entry.burstWindowStart > INPUT_BURST_WINDOW_MS) {
      entry.burstWindowStart = now;
      entry.burstCount = 0;
    }

    entry.burstCount += 1;
    if (entry.burstCount > INPUT_BURST_LIMIT) {
      console.warn(`Input burst limit exceeded by socket ${socketId}`);
      throw new Error("Demasiados inputs en un intervalo corto");
    }
  }

  private enforceChatBurstLimit(socketId: string): void {
    const now = Date.now();
    let entry = this.chatRateLimits.get(socketId);
    if (!entry) {
      entry = { windowStart: now, burstCount: 0 };
      this.chatRateLimits.set(socketId, entry);
    }

    if (now - entry.windowStart > CHAT_MESSAGE_BURST_WINDOW_MS) {
      entry.windowStart = now;
      entry.burstCount = 0;
    }

    entry.burstCount += 1;
    if (entry.burstCount > CHAT_MESSAGE_BURST_LIMIT) {
      console.warn(`Chat burst limit exceeded by socket ${socketId}`);
      throw new Error("Demasiados mensajes en un intervalo corto");
    }
  }
}
