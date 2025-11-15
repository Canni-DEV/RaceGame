import { CarState, RoomState, TrackData } from "../types/trackTypes";
import { updateCarsForRoom } from "./Physics";

export interface PlayerInput {
  steer: number;
  throttle: number;
  brake: number;
}

export class Room {
  public serverTime = 0;
  public cars: Map<string, CarState> = new Map();
  public latestInputs: Map<string, PlayerInput> = new Map();
  public viewers: Set<string> = new Set();
  public controllers: Set<string> = new Set();

  private viewerPlayers: Map<string, string> = new Map();
  private controllerToPlayer: Map<string, string> = new Map();
  private playerToController: Map<string, string> = new Map();

  constructor(public readonly roomId: string, public readonly track: TrackData) {}

  addViewer(socketId: string, playerId: string): void {
    this.viewers.add(socketId);
    this.viewerPlayers.set(socketId, playerId);
  }

  removeViewer(socketId: string): string | undefined {
    this.viewers.delete(socketId);
    const playerId = this.viewerPlayers.get(socketId);
    this.viewerPlayers.delete(socketId);
    return playerId;
  }

  addPlayer(playerId: string): CarState {
    const spawnIndex = this.cars.size % this.track.centerline.length;
    const spawnPoint = this.track.centerline[spawnIndex];
    const nextPoint = this.track.centerline[(spawnIndex + 1) % this.track.centerline.length];
    const angle = Math.atan2(nextPoint.z - spawnPoint.z, nextPoint.x - spawnPoint.x);

    const car: CarState = {
      playerId,
      x: spawnPoint.x,
      z: spawnPoint.z,
      angle,
      speed: 0
    };

    this.cars.set(playerId, car);
    this.latestInputs.set(playerId, { steer: 0, throttle: 0, brake: 0 });
    return car;
  }

  removePlayer(playerId: string): string | undefined {
    this.cars.delete(playerId);
    this.latestInputs.delete(playerId);
    const controllerSocket = this.playerToController.get(playerId);
    if (controllerSocket) {
      this.controllers.delete(controllerSocket);
      this.controllerToPlayer.delete(controllerSocket);
      this.playerToController.delete(playerId);
    }
    return controllerSocket;
  }

  attachController(socketId: string, playerId: string): void {
    this.controllers.add(socketId);
    this.controllerToPlayer.set(socketId, playerId);
    this.playerToController.set(playerId, socketId);
  }

  detachController(socketId: string): string | undefined {
    this.controllers.delete(socketId);
    const playerId = this.controllerToPlayer.get(socketId);
    if (playerId) {
      this.playerToController.delete(playerId);
    }
    this.controllerToPlayer.delete(socketId);
    return playerId;
  }

  getControllerSocket(playerId: string): string | undefined {
    return this.playerToController.get(playerId);
  }

  applyInput(playerId: string, input: PlayerInput): void {
    if (!this.cars.has(playerId)) {
      return;
    }
    this.latestInputs.set(playerId, {
      steer: input.steer,
      throttle: input.throttle,
      brake: input.brake
    });
  }

  update(dt: number): void {
    updateCarsForRoom(this, dt);
    this.serverTime += dt;
  }

  getPlayers(): { playerId: string }[] {
    return Array.from(this.cars.keys()).map((playerId) => ({ playerId }));
  }

  toRoomState(): RoomState {
    return {
      roomId: this.roomId,
      trackId: this.track.id,
      serverTime: this.serverTime,
      cars: Array.from(this.cars.values()).map((car) => ({ ...car }))
    };
  }

  isEmpty(): boolean {
    return this.viewers.size === 0 && this.controllers.size === 0;
  }
}
