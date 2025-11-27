import {
  CarState,
  MissileState,
  RoomState,
  TrackData,
  Vec2
} from "../types/trackTypes";
import {
  MISSILE_ACQUISITION_RADIUS,
  MISSILE_HIT_RADIUS,
  MISSILE_IMPACT_SPIN_DURATION,
  MISSILE_IMPACT_SPIN_TURNS,
  MISSILE_MAX_CHARGES,
  MISSILE_MAX_RANGE_FACTOR,
  MISSILE_MIN_SPEED,
  MISSILE_RECHARGE_SECONDS,
  MISSILE_SPEED_MULTIPLIER,
  TURBO_ACCELERATION_MULTIPLIER,
  TURBO_DURATION,
  TURBO_MAX_CHARGES,
  TURBO_MAX_SPEED_MULTIPLIER,
  TURBO_RECHARGE_SECONDS
} from "../config";
import { updateCarsForRoom } from "./Physics";
import { NpcControllerState, updateNpcControllers } from "./NpcController";
import { TrackGeometry } from "./TrackGeometry";
import { TrackNavigator } from "./TrackNavigator";

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

interface MissileChargeState {
  charges: number;
  rechargeProgress: number;
}

interface MissileRuntime extends MissileState {
  progress: { segmentIndex: number; distanceAlongSegment: number };
  distanceTravelled: number;
  onTrack: boolean;
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

function normalizeAngle(angle: number): number {
  const tau = Math.PI * 2;
  return ((angle + Math.PI) % tau + tau) % tau - Math.PI;
}

interface SpinState {
  timeLeft: number;
  angularVelocity: number;
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
  private missileCharges: Map<string, MissileChargeState> = new Map();
  private missiles: Map<string, MissileRuntime> = new Map();
  private npcIds: Set<string> = new Set();
  private npcStates: Map<string, NpcControllerState> = new Map();
  private readonly trackGeometry: TrackGeometry;
  private readonly trackNavigator: TrackNavigator;
  private missileSequence = 0;
  private readonly spinStates: Map<string, SpinState> = new Map();

  constructor(public readonly roomId: string, public readonly track: TrackData) {
    this.trackGeometry = new TrackGeometry(track);
    this.trackNavigator = new TrackNavigator(track.centerline);
    this.initializeNpc("Garburator",0,1,0);
    this.initializeNpc("Petrucci",0,-1,0.5);
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
    this.missileCharges.set(playerId, { charges: MISSILE_MAX_CHARGES, rechargeProgress: 0 });
    this.updateCarMissileTelemetry(playerId, car);
    return car;
  }

  removePlayer(playerId: string): string | undefined {
    if (this.npcIds.has(playerId)) {
      this.cars.delete(playerId);
      this.latestInputs.delete(playerId);
      this.spawnPoints.delete(playerId);
      this.turboStates.delete(playerId);
      this.missileCharges.delete(playerId);
      this.npcIds.delete(playerId);
      this.npcStates.delete(playerId);
      return undefined;
    }

    this.cars.delete(playerId);
    this.latestInputs.delete(playerId);
    this.spawnPoints.delete(playerId);
    this.turboStates.delete(playerId);
    this.missileCharges.delete(playerId);
    this.removeMissilesForPlayer(playerId);
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
    if (actions.shoot) {
      this.fireMissile(playerId);
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
    this.spinStates.delete(playerId);

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

  private updateMissileCharges(dt: number): void {
    for (const [playerId, car] of this.cars.entries()) {
      if (car.isNpc) {
        continue;
      }
      const state = this.ensureMissileChargeState(playerId);
      if (state.charges < MISSILE_MAX_CHARGES) {
        state.rechargeProgress += dt;
        if (state.rechargeProgress >= MISSILE_RECHARGE_SECONDS) {
          const recovered = Math.floor(state.rechargeProgress / MISSILE_RECHARGE_SECONDS);
          state.charges = Math.min(MISSILE_MAX_CHARGES, state.charges + recovered);
          state.rechargeProgress -= recovered * MISSILE_RECHARGE_SECONDS;
        }
      } else {
        state.rechargeProgress = 0;
      }

      this.updateCarMissileTelemetry(playerId, car, state);
    }
  }

  private fireMissile(playerId: string): void {
    const car = this.cars.get(playerId);
    if (!car) {
      return;
    }

    const charges = this.ensureMissileChargeState(playerId);
    if (charges.charges <= 0) {
      return;
    }

    const progress = this.trackNavigator.project(car);
    const missileId = `${playerId}-m${this.missileSequence++}`;

    charges.charges -= 1;
    this.updateCarMissileTelemetry(playerId, car, charges);

    const missile: MissileRuntime = {
      id: missileId,
      ownerId: playerId,
      x: car.x,
      z: car.z,
      angle: car.angle,
      speed: Math.max(MISSILE_MIN_SPEED, car.speed * MISSILE_SPEED_MULTIPLIER),
      targetId: undefined,
      progress: { segmentIndex: progress.segmentIndex, distanceAlongSegment: progress.distanceAlongSegment },
      distanceTravelled: 0,
      onTrack: false
    };

    this.missiles.set(missileId, missile);
  }

  private updateMissiles(dt: number): void {
    if (this.missiles.size === 0) {
      return;
    }

    const removals: string[] = [];
    const maxRange = this.trackNavigator.getTotalLength() * MISSILE_MAX_RANGE_FACTOR;
    const acquisitionRadiusSq = MISSILE_ACQUISITION_RADIUS * MISSILE_ACQUISITION_RADIUS;

    for (const missile of this.missiles.values()) {
      const travel = missile.speed * dt;

      if (missile.targetId && !this.cars.has(missile.targetId)) {
        missile.targetId = undefined;
      }

      if (!missile.targetId) {
        const nearbyTarget = this.findNearbyTarget(missile, acquisitionRadiusSq);
        if (nearbyTarget) {
          missile.targetId = nearbyTarget;
        }
      }

      const activeTarget = missile.targetId ? this.cars.get(missile.targetId) : undefined;
      if (activeTarget) {
        const dx = activeTarget.x - missile.x;
        const dz = activeTarget.z - missile.z;
        const distance = Math.hypot(dx, dz);

        if (distance <= MISSILE_HIT_RADIUS) {
          this.applyMissileImpact(activeTarget);
          removals.push(missile.id);
          continue;
        }

        const dirX = distance > 0 ? dx / distance : Math.cos(missile.angle);
        const dirZ = distance > 0 ? dz / distance : Math.sin(missile.angle);
        missile.x += dirX * travel;
        missile.z += dirZ * travel;
        const desiredAngle = Math.atan2(dirZ, dirX);
        missile.angle = normalizeAngle(missile.angle + normalizeAngle(desiredAngle - missile.angle));
      } else {
        let remaining = travel;

        if (!missile.onTrack) {
          const snap = this.trackNavigator.project({ x: missile.x, z: missile.z });
          const dx = snap.position.x - missile.x;
          const dz = snap.position.z - missile.z;
          const distanceToTrack = Math.hypot(dx, dz);

          if (distanceToTrack > 0) {
            if (distanceToTrack >= remaining) {
              const dirX = dx / distanceToTrack;
              const dirZ = dz / distanceToTrack;
              missile.x += dirX * remaining;
              missile.z += dirZ * remaining;
              const desiredAngle = Math.atan2(dirZ, dirX);
              missile.angle = normalizeAngle(missile.angle + normalizeAngle(desiredAngle - missile.angle));
              remaining = 0;
            } else {
              missile.x = snap.position.x;
              missile.z = snap.position.z;
              missile.progress = {
                segmentIndex: snap.segmentIndex,
                distanceAlongSegment: snap.distanceAlongSegment
              };
              missile.onTrack = true;
              const desiredAngle = Math.atan2(snap.direction.z, snap.direction.x);
              missile.angle = normalizeAngle(missile.angle + normalizeAngle(desiredAngle - missile.angle));
              remaining -= distanceToTrack;
            }
          } else {
            missile.onTrack = true;
          }
        }

        if (remaining > 0) {
          const progress = this.trackNavigator.advance(missile.progress, remaining);
          missile.progress = {
            segmentIndex: progress.segmentIndex,
            distanceAlongSegment: progress.distanceAlongSegment
          };
          missile.x = progress.position.x;
          missile.z = progress.position.z;
          const desiredAngle = Math.atan2(progress.direction.z, progress.direction.x);
          missile.angle = normalizeAngle(missile.angle + normalizeAngle(desiredAngle - missile.angle));
        }
      }

      missile.distanceTravelled += travel;

      if (maxRange > 0 && missile.distanceTravelled >= maxRange) {
        removals.push(missile.id);
      }
    }

    for (const id of removals) {
      this.missiles.delete(id);
    }
  }

  private findNearbyTarget(missile: MissileRuntime, acquisitionRadiusSq: number): string | null {
    let closestId: string | null = null;
    let closestDistance = acquisitionRadiusSq;
    const forwardX = Math.cos(missile.angle);
    const forwardZ = Math.sin(missile.angle);

    for (const [playerId, car] of this.cars.entries()) {
      if (playerId === missile.ownerId) {
        continue;
      }
      const dx = car.x - missile.x;
      const dz = car.z - missile.z;
      const forwardDot = dx * forwardX + dz * forwardZ;
      if (forwardDot <= 0) {
        continue;
      }
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq <= closestDistance) {
        closestDistance = distanceSq;
        closestId = playerId;
      }
    }

    return closestId;
  }

  private applyMissileImpact(car: CarState): void {
    car.speed = 0;
    const angularVelocity = (MISSILE_IMPACT_SPIN_TURNS * Math.PI * 2) / Math.max(0.01, MISSILE_IMPACT_SPIN_DURATION);
    this.spinStates.set(car.playerId, {
      timeLeft: MISSILE_IMPACT_SPIN_DURATION,
      angularVelocity
    });
  }

  private updateSpinEffects(dt: number): void {
    if (this.spinStates.size === 0) {
      return;
    }

    const removals: string[] = [];
    for (const [playerId, spin] of this.spinStates.entries()) {
      const car = this.cars.get(playerId);
      if (!car) {
        removals.push(playerId);
        continue;
      }

      car.speed = 0;
      car.angle = normalizeAngle(car.angle + spin.angularVelocity * dt);
      spin.timeLeft -= dt;
      if (spin.timeLeft <= 0) {
        removals.push(playerId);
      }
    }

    for (const id of removals) {
      this.spinStates.delete(id);
    }
  }

  private updateCarMissileTelemetry(
    playerId: string,
    car?: CarState,
    missileState?: MissileChargeState
  ): void {
    const targetCar = car ?? this.cars.get(playerId);
    const charges = missileState ?? this.missileCharges.get(playerId);
    if (!targetCar || !charges) {
      return;
    }

    targetCar.missileCharges = charges.charges;
    targetCar.missileRecharge = charges.charges >= MISSILE_MAX_CHARGES
      ? 0
      : Math.max(0, MISSILE_RECHARGE_SECONDS - charges.rechargeProgress);
  }

  private ensureMissileChargeState(playerId: string): MissileChargeState {
    let state = this.missileCharges.get(playerId);
    if (!state) {
      state = {
        charges: this.npcIds.has(playerId) ? 0 : MISSILE_MAX_CHARGES,
        rechargeProgress: 0
      };
      this.missileCharges.set(playerId, state);
    }
    return state;
  }

  private removeMissilesForPlayer(playerId: string): void {
    for (const [id, missile] of this.missiles.entries()) {
      if (missile.ownerId === playerId) {
        this.missiles.delete(id);
      }
    }
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
    this.updateMissileCharges(dt);
    updateNpcControllers(this, this.npcStates, dt);
    updateCarsForRoom(this, dt);
    this.updateMissiles(dt);
    this.updateSpinEffects(dt);
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
      cars: Array.from(this.cars.values()).map((car) => ({ ...car })),
      missiles: Array.from(this.missiles.values()).map((missile) => ({
        id: missile.id,
        ownerId: missile.ownerId,
        x: missile.x,
        z: missile.z,
        angle: missile.angle,
        speed: missile.speed,
        targetId: missile.targetId
      }))
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

  private initializeNpc(name:string, mistakeCooldown:number,mistakeDirection:number, mistakeDuration:number): void {
    if (this.track.centerline.length < 2) {
      return;
    }

    const npcId = name;
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
      mistakeCooldown: mistakeCooldown,
      mistakeDuration: mistakeDuration,
      mistakeDirection: mistakeDirection
    });
  }
}
