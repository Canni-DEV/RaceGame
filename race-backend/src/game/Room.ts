import {
  CarState,
  RoomState,
  TrackData,
  Vec2
} from "../types/trackTypes";
import {
  TURBO_ACCELERATION_MULTIPLIER,
  TURBO_DURATION,
  TURBO_MAX_CHARGES,
  TURBO_MAX_SPEED_MULTIPLIER,
  TURBO_RECHARGE_SECONDS
} from "../config";
import { updateCarsForRoom } from "./Physics";
import { NpcControllerState, updateNpcControllers } from "./NpcController";
import { TrackGeometry } from "./TrackGeometry";

export interface PlayerInput {
  steer: number;
  throttle: number;
  brake: number;
  actions?: {
    turbo?: boolean;
    reset?: boolean;
    shoot?: boolean;
  };
}

interface TurboState {
  charges: number;
  activeTime: number;
  rechargeProgress: number;
}

interface SpawnPoint {
  position: Vec2;
  angle: number;
}

export interface MovementMultipliers {
  accelerationMultiplier: number;
  maxSpeedMultiplier: number;
  turboActive: boolean;
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
  private spawnPoints: Map<string, SpawnPoint> = new Map();
  private turboStates: Map<string, TurboState> = new Map();
  private npcIds: Set<string> = new Set();
  private npcStates: Map<string, NpcControllerState> = new Map();
  private readonly trackGeometry: TrackGeometry;

  constructor(public readonly roomId: string, public readonly track: TrackData) {
    this.trackGeometry = new TrackGeometry(track);
    this.initializeNpc();
  }

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

  hasViewerForPlayer(playerId: string): boolean {
    for (const viewerPlayerId of this.viewerPlayers.values()) {
      if (viewerPlayerId === playerId) {
        return true;
      }
    }
    return false;
  }

  isPlayerIdTaken(playerId: string): boolean {
    if (this.cars.has(playerId)) {
      return true;
    }
    return this.hasViewerForPlayer(playerId);
  }

  addPlayer(playerId: string): CarState {
    const spawnIndex = this.cars.size % this.track.centerline.length;
    const spawnPoint = this.track.centerline[spawnIndex];
    const nextPoint = this.track.centerline[(spawnIndex + 1) % this.track.centerline.length];
    const angle = Math.atan2(nextPoint.z - spawnPoint.z, nextPoint.x - spawnPoint.x);

    const spawn: SpawnPoint = {
      position: { x: spawnPoint.x, z: spawnPoint.z },
      angle
    };

    const car: CarState = {
      playerId,
      x: spawn.position.x,
      z: spawn.position.z,
      angle: spawn.angle,
      speed: 0,
      isNpc: false
    };

    this.cars.set(playerId, car);
    this.spawnPoints.set(playerId, spawn);
    this.latestInputs.set(playerId, { steer: 0, throttle: 0, brake: 0 });
    this.turboStates.set(playerId, {
      charges: TURBO_MAX_CHARGES,
      activeTime: 0,
      rechargeProgress: 0
    });
    this.updateCarTurboTelemetry(playerId, car);
    return car;
  }

  removePlayer(playerId: string): string | undefined {
    if (this.npcIds.has(playerId)) {
      this.cars.delete(playerId);
      this.latestInputs.delete(playerId);
      this.spawnPoints.delete(playerId);
      this.turboStates.delete(playerId);
      this.npcIds.delete(playerId);
      this.npcStates.delete(playerId);
      return undefined;
    }

    this.cars.delete(playerId);
    this.latestInputs.delete(playerId);
    this.spawnPoints.delete(playerId);
    this.turboStates.delete(playerId);
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
    this.handleActions(playerId, input.actions);
  }

  setNpcInput(playerId: string, input: PlayerInput): void {
    if (!this.npcIds.has(playerId)) {
      return;
    }
    this.latestInputs.set(playerId, {
      steer: input.steer,
      throttle: input.throttle,
      brake: input.brake
    });
  }

  getMovementMultipliers(playerId: string): MovementMultipliers {
    const turbo = this.ensureTurboState(playerId);
    const turboActive = turbo.activeTime > 0;
    return {
      accelerationMultiplier: turboActive ? TURBO_ACCELERATION_MULTIPLIER : 1,
      maxSpeedMultiplier: turboActive ? TURBO_MAX_SPEED_MULTIPLIER : 1,
      turboActive
    };
  }

  private handleActions(playerId: string, actions?: PlayerInput["actions"]): void {
    if (!actions) {
      return;
    }
    if (actions.reset) {
      this.resetCar(playerId);
    }
    if (actions.turbo) {
      this.activateTurbo(playerId);
    }
  }

  private resetCar(playerId: string): void {
    const car = this.cars.get(playerId);
    const spawn = this.getSpawnPoint(playerId);
    if (!car || !spawn) {
      return;
    }

    car.x = spawn.position.x;
    car.z = spawn.position.z;
    car.angle = spawn.angle;
    car.speed = 0;

    this.latestInputs.set(playerId, { steer: 0, throttle: 0, brake: 0 });
  }

  private activateTurbo(playerId: string): void {
    const car = this.cars.get(playerId);
    const turbo = this.ensureTurboState(playerId);
    if (!car) {
      return;
    }

    if (turbo.charges <= 0) {
      return;
    }

    turbo.charges -= 1;
    turbo.activeTime = Math.max(turbo.activeTime, TURBO_DURATION);
    this.updateCarTurboTelemetry(playerId, car, turbo);
  }

  private updateTurboStates(dt: number): void {
    for (const [playerId, car] of this.cars.entries()) {
      if (car.isNpc) {
        continue;
      }
      const turbo = this.ensureTurboState(playerId);

      if (turbo.activeTime > 0) {
        turbo.activeTime = Math.max(0, turbo.activeTime - dt);
      }

      if (turbo.charges < TURBO_MAX_CHARGES) {
        turbo.rechargeProgress += dt;
        if (turbo.rechargeProgress >= TURBO_RECHARGE_SECONDS) {
          const recovered = Math.floor(turbo.rechargeProgress / TURBO_RECHARGE_SECONDS);
          turbo.charges = Math.min(TURBO_MAX_CHARGES, turbo.charges + recovered);
          turbo.rechargeProgress -= recovered * TURBO_RECHARGE_SECONDS;
        }
      } else {
        turbo.rechargeProgress = 0;
      }

      this.updateCarTurboTelemetry(playerId, car, turbo);
    }
  }

  private updateCarTurboTelemetry(playerId: string, car?: CarState, turbo?: TurboState): void {
    const targetCar = car ?? this.cars.get(playerId);
    const targetTurbo = turbo ?? this.turboStates.get(playerId);
    if (!targetCar || !targetTurbo) {
      return;
    }

    targetCar.turboActive = targetTurbo.activeTime > 0;
    targetCar.turboCharges = targetTurbo.charges;
    targetCar.turboRecharge = targetTurbo.charges >= TURBO_MAX_CHARGES
      ? 0
      : Math.max(0, TURBO_RECHARGE_SECONDS - targetTurbo.rechargeProgress);
    targetCar.turboDurationLeft = targetTurbo.activeTime;
  }

  private ensureTurboState(playerId: string): TurboState {
    let turbo = this.turboStates.get(playerId);
    if (!turbo) {
      turbo = {
        charges: this.npcIds.has(playerId) ? 0 : TURBO_MAX_CHARGES,
        activeTime: 0,
        rechargeProgress: 0
      };
      this.turboStates.set(playerId, turbo);
    }
    return turbo;
  }

  private getSpawnPoint(playerId: string): SpawnPoint | undefined {
    const existing = this.spawnPoints.get(playerId);
    if (existing) {
      return existing;
    }

    if (this.track.centerline.length === 0) {
      return undefined;
    }

    const basePoint = this.track.centerline[0];
    const nextPoint = this.track.centerline[1 % this.track.centerline.length] ?? this.track.centerline[0];
    const angle = Math.atan2(nextPoint.z - basePoint.z, nextPoint.x - basePoint.x);
    const spawn: SpawnPoint = { position: { ...basePoint }, angle };
    this.spawnPoints.set(playerId, spawn);
    return spawn;
  }

  update(dt: number): void {
    this.updateTurboStates(dt);
    updateNpcControllers(this, this.npcStates, dt);
    updateCarsForRoom(this, dt);
    this.serverTime += dt;
  }

  getPlayers(): { playerId: string; isNpc: boolean }[] {
    return Array.from(this.cars.keys()).map((playerId) => ({
      playerId,
      isNpc: this.npcIds.has(playerId)
    }));
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

  getHumanPlayerCount(): number {
    return Math.max(0, this.cars.size - this.npcIds.size);
  }

  isOnTrack(position: { x: number; z: number }): boolean {
    return this.trackGeometry.isPointOnTrack(position);
  }

  private initializeNpc(): void {
    if (this.track.centerline.length < 2) {
      return;
    }

    const npcId = "Garburator";
    const spawnPoint = this.track.centerline[0];
    const nextPoint = this.track.centerline[1 % this.track.centerline.length];
    const angle = Math.atan2(nextPoint.z - spawnPoint.z, nextPoint.x - spawnPoint.x);

    const car: CarState = {
      playerId: npcId,
      x: spawnPoint.x,
      z: spawnPoint.z,
      angle,
      speed: 0,
      isNpc: true
    };

    this.cars.set(npcId, car);
    this.latestInputs.set(npcId, { steer: 0, throttle: 1, brake: 0 });
    this.npcIds.add(npcId);
    this.npcStates.set(npcId, {
      targetIndex: 1 % this.track.centerline.length,
      mistakeCooldown: 0,
      mistakeDuration: 0,
      mistakeDirection: 1
    });
  }
}
