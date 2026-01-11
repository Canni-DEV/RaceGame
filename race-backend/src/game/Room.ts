import {
  CarState,
  LeaderboardEntry,
  ItemType,
  TrackItemSpawn,
  MissileState,
  RacePhase,
  RaceState,
  RoomRadioState,
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
  ITEM_PICKUP_RADIUS,
  ITEM_PROB_NITRO,
  ITEM_PROB_SHOOT,
  ITEM_RESPAWN_SECONDS,
  TURBO_ACCELERATION_MULTIPLIER,
  TURBO_DURATION,
  TURBO_MAX_CHARGES,
  TURBO_MAX_SPEED_MULTIPLIER,
  TURBO_RECHARGE_SECONDS,
  RACE_BACKTRACK_TOLERANCE,
  RACE_COUNTDOWN_SECONDS,
  RACE_FINISH_TIMEOUT,
  RACE_GRID_SPACING,
  RACE_LAPS,
  RACE_LATERAL_SPACING,
  RACE_MIN_FORWARD_ADVANCE,
  RACE_POST_DURATION,
  RACE_SHORTCUT_MAX_RATIO,
  RACE_SHORTCUT_MIN_DISTANCE,
  RACE_START_SEGMENT_INDEX,
  RADIO_STATION_COUNT
} from "../config";
import { updateCarsForRoom } from "./Physics";
import {
  NpcControllerState,
  createNpcState,
  updateNpcControllers
} from "./NpcController";
import { NpcManager, NpcProfile } from "./NpcManager";
import { TrackBoundaryCollision, TrackGeometry } from "./TrackGeometry";
import { ProjectedProgress, TrackNavigator } from "./TrackNavigator";
import { SpatialHash } from "./SpatialHash";

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

interface PlayerRaceProgress {
  playerId: string;
  lap: number;
  totalDistance: number;
  progress: ProjectedProgress;
  lastWorldPosition: Vec2;
  ready: boolean;
  isFinished: boolean;
  isNpc: boolean;
  finishTime?: number;
}

const NEUTRAL_INPUT: PlayerInput = { steer: 0, throttle: 0, brake: 0 };

function normalizeAngle(angle: number): number {
  const tau = Math.PI * 2;
  return ((angle + Math.PI) % tau + tau) % tau - Math.PI;
}

interface SpinState {
  timeLeft: number;
  angularVelocity: number;
}

interface ItemRuntime {
  spawn: TrackItemSpawn;
  type: ItemType;
  active: boolean;
  respawnTimer: number;
}

function createRandom(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x9e3779b9) | 0;
    let t = seed ^ (seed >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return (t >>> 0) / 0x100000000;
  };
}

const MAX_USERNAME_LENGTH = 24;
const ITEM_PICKUP_RADIUS_SQ = ITEM_PICKUP_RADIUS * ITEM_PICKUP_RADIUS;
const npcManager = new NpcManager();

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
  private readonly items: Map<string, ItemRuntime> = new Map();
  private npcIds: Set<string> = new Set();
  private npcStates: Map<string, NpcControllerState> = new Map();
  private playerProfiles: Map<string, { username: string }> = new Map();
  private readonly trackGeometry: TrackGeometry;
  private readonly trackNavigator: TrackNavigator;
  private readonly trackLength: number;
  private readonly startDistance: number;
  private raceProgress: Map<string, PlayerRaceProgress> = new Map();
  private raceParticipants: Set<string> = new Set();
  private racePhase: RacePhase = "lobby";
  private countdownRemaining = 0;
  private countdownTotal = 0;
  private finishTimeoutRemaining = 0;
  private postRaceRemaining = 0;
  private raceStartTime: number | null = null;
  private firstFinishTime: number | null = null;
  private readonly lapsRequired = RACE_LAPS;
  private readonly startSegmentIndex = Math.max(0, Math.floor(RACE_START_SEGMENT_INDEX));
  private missileSequence = 0;
  private radioState: RoomRadioState = { enabled: false, stationIndex: -1 };
  private readonly spinStates: Map<string, SpinState> = new Map();
  private readonly itemRandom: () => number;
  private readonly carSpatial = new SpatialHash(1);
  private readonly carSpatialCandidates: number[] = [];
  private readonly itemSpatial = new SpatialHash(1);
  private readonly itemSpatialCandidates: number[] = [];

  constructor(public readonly roomId: string, public readonly track: TrackData) {
    this.trackGeometry = new TrackGeometry(track);
    this.trackNavigator = new TrackNavigator(track.centerline);
    this.trackLength = this.trackNavigator.getTotalLength();
    this.startDistance = track.centerline.length > 0
      ? this.trackNavigator.project(track.centerline[this.startSegmentIndex % track.centerline.length]).distanceAlongTrack
      : 0;
    this.countdownTotal = RACE_COUNTDOWN_SECONDS;
    this.itemRandom = createRandom(this.track.seed ^ 0x5a18c3);
    this.resetItems();

    npcManager.getActiveProfiles().forEach((profile) => this.initializeNpc(profile));
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

  private sanitizeUsername(username: string, fallback: string): string {
    const normalized = username.trim().slice(0, MAX_USERNAME_LENGTH);
    return normalized.length > 0 ? normalized : fallback;
  }

  private setUsername(playerId: string, username: string): string {
    const normalized = this.sanitizeUsername(username, playerId);
    this.playerProfiles.set(playerId, { username: normalized });
    return normalized;
  }

  getUsername(playerId: string): string {
    return this.playerProfiles.get(playerId)?.username ?? playerId;
  }

  updateUsername(playerId: string, username: string): string {
    const normalized = this.setUsername(playerId, username);
    const car = this.cars.get(playerId);
    if (car) {
      car.username = normalized;
    }
    return normalized;
  }

  isPlayerIdTaken(playerId: string): boolean {
    return this.cars.has(playerId) || this.hasViewerForPlayer(playerId);
  }

  addPlayer(playerId: string): CarState {
    const spawnIndex = this.cars.size % this.track.centerline.length;
    const spawnPoint = this.track.centerline[spawnIndex];
    const nextPoint = this.track.centerline[(spawnIndex + 1) % this.track.centerline.length];
    const angle = Math.atan2(nextPoint.z - spawnPoint.z, nextPoint.x - spawnPoint.x);

    const username = this.setUsername(playerId, playerId);

    const spawn: SpawnPoint = {
      position: { x: spawnPoint.x, z: spawnPoint.z },
      angle
    };

    const car: CarState = {
      playerId,
      username,
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
    this.ensureRaceProgress(playerId, car);
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
      this.playerProfiles.delete(playerId);
      return undefined;
    }

    this.cars.delete(playerId);
    this.latestInputs.delete(playerId);
    this.spawnPoints.delete(playerId);
    this.turboStates.delete(playerId);
    this.missileCharges.delete(playerId);
    this.raceProgress.delete(playerId);
    this.raceParticipants.delete(playerId);
    this.removeMissilesForPlayer(playerId);
    this.playerProfiles.delete(playerId);
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
    const isHuman = !this.npcIds.has(playerId);
    const readyCombo = Boolean(input.actions?.turbo && input.actions?.shoot);
    if (isHuman && readyCombo && this.racePhase === "lobby") {
      this.toggleReady(playerId);
      return;
    }

    const controlLocked = this.isControlLocked(playerId);
    const effectiveInput = controlLocked
      ? NEUTRAL_INPUT
      : {
          steer: input.steer,
          throttle: input.throttle,
          brake: input.brake
        };

    this.latestInputs.set(playerId, effectiveInput);
    if (!controlLocked) {
      this.handleActions(playerId, input.actions);
    }
  }

  setNpcInput(playerId: string, input: PlayerInput): void {
    if (!this.npcIds.has(playerId)) {
      return;
    }
    const controlLocked = this.isControlLocked(playerId);
    if (controlLocked) {
      this.latestInputs.set(playerId, NEUTRAL_INPUT);
      return;
    }
    this.latestInputs.set(playerId, {
      steer: input.steer,
      throttle: input.throttle,
      brake: input.brake
    });
  }

  getMovementMultipliers(playerId: string): MovementMultipliers {
    if (this.isControlLocked(playerId)) {
      return {
        accelerationMultiplier: 0,
        maxSpeedMultiplier: 0,
        turboActive: false
      };
    }

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

  private isControlLocked(playerId: string): boolean {
    if (this.racePhase === "countdown" || this.racePhase === "postrace") {
      return true;
    }
    if (this.racePhase === "race") {
      const progress = this.raceProgress.get(playerId);
      if (progress?.isFinished) {
        return true;
      }
    }
    return false;
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

    const previousProgress = this.raceProgress.get(playerId)?.progress;
    const progress = this.trackNavigator.project(car, previousProgress);
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
    const maxRange = this.trackLength * MISSILE_MAX_RANGE_FACTOR;
    const acquisitionRadius = MISSILE_ACQUISITION_RADIUS;
    const acquisitionRadiusSq = acquisitionRadius * acquisitionRadius;
    const carEntries = Array.from(this.cars.entries());
    const useSpatial = carEntries.length > 1;
    if (useSpatial) {
      this.carSpatial.reset(acquisitionRadius);
      for (let i = 0; i < carEntries.length; i++) {
        const car = carEntries[i][1];
        this.carSpatial.insert(i, car.x, car.z);
      }
    }

    for (const missile of this.missiles.values()) {
      const travel = missile.speed * dt;

      if (missile.targetId && !this.cars.has(missile.targetId)) {
        missile.targetId = undefined;
      }

      if (!missile.targetId) {
        const nearbyTarget = this.findNearbyTarget(
          missile,
          acquisitionRadius,
          acquisitionRadiusSq,
          carEntries,
          useSpatial ? this.carSpatial : null
        );
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
        const angleDelta = normalizeAngle(desiredAngle - missile.angle);
        missile.angle = normalizeAngle(missile.angle + angleDelta);
      } else {
        let remaining = travel;

        if (!missile.onTrack) {
          const snap = this.trackNavigator.project(missile, missile.progress);
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
              const angleDelta = normalizeAngle(desiredAngle - missile.angle);
              missile.angle = normalizeAngle(missile.angle + angleDelta);
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
              const angleDelta = normalizeAngle(desiredAngle - missile.angle);
              missile.angle = normalizeAngle(missile.angle + angleDelta);
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
          const angleDelta = normalizeAngle(desiredAngle - missile.angle);
          missile.angle = normalizeAngle(missile.angle + angleDelta);
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

  private findNearbyTarget(
    missile: MissileRuntime,
    acquisitionRadius: number,
    acquisitionRadiusSq: number,
    carEntries: Array<[string, CarState]>,
    spatial: SpatialHash | null
  ): string | null {
    let closestId: string | null = null;
    let closestDistance = acquisitionRadiusSq;
    const forwardX = Math.cos(missile.angle);
    const forwardZ = Math.sin(missile.angle);

    if (!spatial) {
      for (const [playerId, car] of carEntries) {
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

    spatial.queryIndices(missile.x, missile.z, acquisitionRadius, this.carSpatialCandidates);
    for (const index of this.carSpatialCandidates) {
      const [playerId, car] = carEntries[index];
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
    car.impactSpinTimeLeft = MISSILE_IMPACT_SPIN_DURATION;
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
      car.impactSpinTimeLeft = Math.max(spin.timeLeft, 0);
      if (spin.timeLeft <= 0) {
        delete car.impactSpinTimeLeft;
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

  private resetItems(): void {
    this.items.clear();
    for (const spawn of this.track.itemSpawns) {
      this.items.set(spawn.id, {
        spawn,
        type: this.rollItemType(),
        active: true,
        respawnTimer: 0
      });
    }
  }

  private rollItemType(): ItemType {
    const total = Math.max(ITEM_PROB_NITRO + ITEM_PROB_SHOOT, 0.0001);
    const nitroChance = ITEM_PROB_NITRO / total;
    return this.itemRandom() < nitroChance ? "nitro" : "shoot";
  }

  private updateItems(dt: number): void {
    for (const item of this.items.values()) {
      if (item.active) {
        continue;
      }

      if (item.respawnTimer > 0) {
        item.respawnTimer = Math.max(0, item.respawnTimer - dt);
      }

      if (item.respawnTimer <= 0) {
        item.type = this.rollItemType();
        item.active = true;
      }
    }
  }

  private handleItemPickups(): void {
    if (this.items.size === 0 || this.cars.size === this.npcIds.size) {
      return;
    }

    const activeItems: ItemRuntime[] = [];
    for (const item of this.items.values()) {
      if (item.active) {
        activeItems.push(item);
      }
    }
    if (activeItems.length === 0) {
      return;
    }

    this.itemSpatial.reset(ITEM_PICKUP_RADIUS);
    for (let i = 0; i < activeItems.length; i++) {
      const item = activeItems[i];
      this.itemSpatial.insert(i, item.spawn.position.x, item.spawn.position.z);
    }

    for (const [playerId, car] of this.cars.entries()) {
      if (car.isNpc) {
        continue;
      }

      this.itemSpatial.queryIndices(car.x, car.z, ITEM_PICKUP_RADIUS, this.itemSpatialCandidates);
      for (const index of this.itemSpatialCandidates) {
        const item = activeItems[index];
        if (!item.active) {
          continue;
        }
        const dx = car.x - item.spawn.position.x;
        const dz = car.z - item.spawn.position.z;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq <= ITEM_PICKUP_RADIUS_SQ) {
          this.applyItemPickup(playerId, car, item);
        }
      }
    }
  }

  private applyItemPickup(playerId: string, car: CarState, item: ItemRuntime): void {
    if (!item.active) {
      return;
    }

    if (item.type === "nitro") {
      const turbo = this.ensureTurboState(playerId);
      turbo.charges = Math.min(TURBO_MAX_CHARGES, turbo.charges + 1);
      this.updateCarTurboTelemetry(playerId, car, turbo);
    } else {
      const missiles = this.ensureMissileChargeState(playerId);
      missiles.charges = Math.min(MISSILE_MAX_CHARGES, missiles.charges + 1);
      this.updateCarMissileTelemetry(playerId, car, missiles);
    }

    item.active = false;
    item.respawnTimer = Math.max(0, ITEM_RESPAWN_SECONDS);
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
    this.advanceCountdown(dt);
    this.updateItems(dt);
    this.updateTurboStates(dt);
    this.updateMissileCharges(dt);
    updateNpcControllers(this, this.npcStates, dt);
    this.applyLockedInputs();
    updateCarsForRoom(this, dt);
    this.handleItemPickups();
    this.updateMissiles(dt);
    this.updateSpinEffects(dt);
    this.updateRaceProgress();
    this.updateRaceEndTimers(dt);
    this.serverTime += dt;
  }

  private advanceCountdown(dt: number): void {
    if (this.racePhase === "countdown") {
      this.countdownRemaining = Math.max(0, this.countdownRemaining - dt);
      if (this.countdownRemaining <= 0) {
        this.startRace();
      }
      return;
    }

    if (this.racePhase === "postrace") {
      this.postRaceRemaining = Math.max(0, this.postRaceRemaining - dt);
      if (this.postRaceRemaining <= 0) {
        this.resetToLobby();
      }
    }
  }

  private applyLockedInputs(): void {
    if (this.racePhase === "lobby") {
      return;
    }
    for (const playerId of this.cars.keys()) {
      if (this.isControlLocked(playerId)) {
        this.latestInputs.set(playerId, NEUTRAL_INPUT);
      }
    }
  }

  private updateRaceProgress(): void {
    if (this.trackLength <= 0) {
      return;
    }

    const finishDistance = this.trackLength * this.lapsRequired;

    for (const [playerId, car] of this.cars.entries()) {
      const progress = this.ensureRaceProgress(playerId, car);
      const projection = this.trackNavigator.project(car, progress.progress);
      const previousDistance = this.normalizeDistance(progress.progress.distanceAlongTrack);
      const currentDistance = this.normalizeDistance(projection.distanceAlongTrack);
      const delta = this.computeSignedDelta(previousDistance, currentDistance);
      const worldDistance = Math.hypot(car.x - progress.lastWorldPosition.x, car.z - progress.lastWorldPosition.z);
      const acceptsAdvance = this.shouldAcceptAdvance(delta, worldDistance);

      progress.progress = projection;
      progress.lastWorldPosition = { x: car.x, z: car.z };

      if (!acceptsAdvance || progress.isFinished) {
        continue;
      }

      const clampedDelta = delta >= 0 ? delta : Math.max(delta, -RACE_BACKTRACK_TOLERANCE);
      progress.totalDistance += clampedDelta;
      const lapsCompleted = Math.floor(Math.max(0, progress.totalDistance) / this.trackLength);
      progress.lap = Math.max(progress.lap, lapsCompleted);

      if (this.racePhase === "race" && !progress.isFinished && progress.lap >= this.lapsRequired) {
        progress.isFinished = true;
        progress.lap = this.lapsRequired;
        progress.totalDistance = finishDistance;
        progress.finishTime = this.serverTime - (this.raceStartTime ?? 0);
        if (this.firstFinishTime === null) {
          this.firstFinishTime = this.serverTime;
          this.finishTimeoutRemaining = RACE_FINISH_TIMEOUT;
        }
      }
    }
  }

  private updateRaceEndTimers(dt: number): void {
    if (this.racePhase !== "race") {
      return;
    }

    if (this.firstFinishTime !== null && this.finishTimeoutRemaining > 0) {
      this.finishTimeoutRemaining = Math.max(0, this.finishTimeoutRemaining - dt);
    }

    if (this.shouldEndRace()) {
      this.enterPostRace();
      return;
    }
  }

  private beginCountdown(): void {
    if (this.track.centerline.length < 2) {
      return;
    }
    this.racePhase = "countdown";
    this.countdownTotal = RACE_COUNTDOWN_SECONDS;
    this.countdownRemaining = this.countdownTotal;
    this.raceStartTime = null;
    this.firstFinishTime = null;
    this.finishTimeoutRemaining = 0;
    this.postRaceRemaining = 0;
    this.raceParticipants = new Set(this.cars.keys());
    this.placeCarsOnGrid();
  }

  private startRace(): void {
    this.racePhase = "race";
    this.countdownRemaining = 0;
    this.raceStartTime = this.serverTime;
    this.firstFinishTime = null;
    this.finishTimeoutRemaining = 0;
  }

  private enterPostRace(): void {
    this.racePhase = "postrace";
    this.postRaceRemaining = RACE_POST_DURATION;
    this.finishTimeoutRemaining = 0;
    this.countdownRemaining = 0;
  }

  private resetToLobby(): void {
    this.racePhase = "lobby";
    this.postRaceRemaining = 0;
    this.finishTimeoutRemaining = 0;
    this.countdownRemaining = 0;
    this.raceStartTime = null;
    this.firstFinishTime = null;
    this.raceParticipants.clear();
    this.resetItems();
    for (const progress of this.raceProgress.values()) {
      progress.ready = progress.isNpc;
      progress.isFinished = false;
      progress.finishTime = undefined;
      progress.lap = 0;
      progress.totalDistance = this.initialTotalDistance(progress.progress);
    }
  }

  private shouldEndRace(): boolean {
    if (this.raceParticipants.size === 0) {
      return true;
    }
    if (this.allParticipantsFinished()) {
      return true;
    }
    if (this.firstFinishTime !== null && this.finishTimeoutRemaining <= 0) {
      return true;
    }
    return false;
  }

  private allParticipantsFinished(): boolean {
    if (this.raceParticipants.size === 0) {
      return false;
    }
    for (const playerId of this.raceParticipants) {
      const progress = this.raceProgress.get(playerId);
      if (!progress?.isFinished) {
        return false;
      }
    }
    return true;
  }

  private placeCarsOnGrid(): void {
    if (this.track.centerline.length < 2) {
      return;
    }

    const startPoint = this.track.centerline[this.startSegmentIndex % this.track.centerline.length];
    const nextPoint = this.track.centerline[(this.startSegmentIndex + 1) % this.track.centerline.length];
    const dirX = nextPoint.x - startPoint.x;
    const dirZ = nextPoint.z - startPoint.z;
    const length = Math.max(0.001, Math.hypot(dirX, dirZ));
    const forward = { x: dirX / length, z: dirZ / length };
    const right = { x: -forward.z, z: forward.x };
    const sortedCars = Array.from(this.cars.values()).sort((a, b) => {
      const aNpc = a.isNpc ? 1 : 0;
      const bNpc = b.isNpc ? 1 : 0;
      return aNpc - bNpc;
    });

    const lateralSpacing = Math.min(RACE_LATERAL_SPACING, this.track.width * 0.8);

    sortedCars.forEach((car, index) => {
      const row = Math.floor(index / 2);
      const side = index % 2 === 0 ? -1 : 1;
      const forwardOffset = -row * RACE_GRID_SPACING;
      const lateralOffset = side * lateralSpacing * 0.5;
      const position = {
        x: startPoint.x + forward.x * forwardOffset + right.x * lateralOffset,
        z: startPoint.z + forward.z * forwardOffset + right.z * lateralOffset
      };
      const angle = Math.atan2(forward.z, forward.x);

      car.x = position.x;
      car.z = position.z;
      car.angle = angle;
      car.speed = 0;

      this.spawnPoints.set(car.playerId, { position: { ...position }, angle });
      this.latestInputs.set(car.playerId, NEUTRAL_INPUT);
      const progress = this.ensureRaceProgress(car.playerId, car);
      progress.lap = 0;
      progress.progress = this.trackNavigator.project(position, progress.progress);
      progress.totalDistance = this.initialTotalDistance(progress.progress);
      progress.lastWorldPosition = { ...position };
      progress.isFinished = false;
      progress.finishTime = undefined;
    });

    this.spinStates.clear();
    this.missiles.clear();
    this.resetPowerups();
  }

  private resetPowerups(): void {
    for (const [playerId, car] of this.cars.entries()) {
      const turbo = this.ensureTurboState(playerId);
      turbo.charges = this.npcIds.has(playerId) ? 0 : TURBO_MAX_CHARGES;
      turbo.activeTime = 0;
      turbo.rechargeProgress = 0;
      this.updateCarTurboTelemetry(playerId, car, turbo);

      const missiles = this.ensureMissileChargeState(playerId);
      missiles.charges = this.npcIds.has(playerId) ? 0 : MISSILE_MAX_CHARGES;
      missiles.rechargeProgress = 0;
      this.updateCarMissileTelemetry(playerId, car, missiles);
    }

    this.resetItems();
  }

  private toggleReady(playerId: string): void {
    const car = this.cars.get(playerId);
    if (!car || this.npcIds.has(playerId)) {
      return;
    }
    const progress = this.ensureRaceProgress(playerId, car);
    progress.ready = !progress.ready;

    if (this.racePhase === "lobby" && this.areAllHumansReady()) {
      this.beginCountdown();
    }
  }

  private areAllHumansReady(): boolean {
    let humanCount = 0;
    for (const [playerId, car] of this.cars.entries()) {
      if (this.npcIds.has(playerId)) {
        continue;
      }
      humanCount += 1;
      const progress = this.ensureRaceProgress(playerId, car);
      if (!progress.ready) {
        return false;
      }
    }
    return humanCount > 0;
  }

  private ensureRaceProgress(playerId: string, car?: CarState): PlayerRaceProgress {
    let progress = this.raceProgress.get(playerId);
    if (!progress) {
      const reference = car ?? this.cars.get(playerId);
      const projection = reference
        ? this.trackNavigator.project(reference)
        : this.trackNavigator.project({ x: 0, z: 0 });
      progress = {
        playerId,
        lap: 0,
        totalDistance: this.initialTotalDistance(projection),
        progress: projection,
        lastWorldPosition: reference ? { x: reference.x, z: reference.z } : { x: 0, z: 0 },
        ready: this.npcIds.has(playerId),
        isFinished: false,
        isNpc: this.npcIds.has(playerId)
      };
      this.raceProgress.set(playerId, progress);
    } else {
      progress.isNpc = this.npcIds.has(playerId);
      if (progress.isNpc) {
        progress.ready = true;
      }
    }
    return progress;
  }

  private normalizeDistance(distance: number): number {
    if (this.trackLength <= 0) {
      return 0;
    }
    const wrapped = (distance - this.startDistance) % this.trackLength;
    return wrapped < 0 ? wrapped + this.trackLength : wrapped;
  }

  private computeSignedDelta(previous: number, next: number): number {
    if (this.trackLength <= 0) {
      return 0;
    }
    let delta = next - previous;
    const half = this.trackLength * 0.5;
    if (delta > half) {
      delta -= this.trackLength;
    } else if (delta < -half) {
      delta += this.trackLength;
    }
    return delta;
  }

  private shouldAcceptAdvance(delta: number, worldDistance: number): boolean {
    if (Math.abs(delta) < RACE_MIN_FORWARD_ADVANCE) {
      return true;
    }

    if (delta < 0) {
      return Math.abs(delta) <= RACE_BACKTRACK_TOLERANCE * 2;
    }

    if (worldDistance < 0.001) {
      return delta <= RACE_MIN_FORWARD_ADVANCE;
    }

    const allowedAdvance = worldDistance * RACE_SHORTCUT_MAX_RATIO + RACE_MIN_FORWARD_ADVANCE;
    if (delta > allowedAdvance && delta > RACE_SHORTCUT_MIN_DISTANCE) {
      return false;
    }

    return true;
  }

  private initialTotalDistance(projection: ProjectedProgress): number {
    const offset = this.computeSignedDelta(this.startDistance, projection.distanceAlongTrack);
    return Math.abs(offset) < this.trackLength * 0.5 ? offset : 0;
  }

  private compareRaceProgress(
    a: PlayerRaceProgress,
    b: PlayerRaceProgress,
    lapLength: number
  ): number {
    if (a.isFinished && b.isFinished) {
      const timeA = a.finishTime ?? Number.POSITIVE_INFINITY;
      const timeB = b.finishTime ?? Number.POSITIVE_INFINITY;
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      return a.playerId.localeCompare(b.playerId);
    }

    if (a.isFinished !== b.isFinished) {
      return a.isFinished ? -1 : 1;
    }

    const clampedLapA = Math.min(a.lap, this.lapsRequired);
    const clampedLapB = Math.min(b.lap, this.lapsRequired);
    if (clampedLapA !== clampedLapB) {
      return clampedLapB - clampedLapA;
    }

    const progressA = lapLength > 0 ? a.totalDistance % lapLength : 0;
    const progressB = lapLength > 0 ? b.totalDistance % lapLength : 0;
    if (progressA !== progressB) {
      return progressB - progressA;
    }

    if (a.totalDistance !== b.totalDistance) {
      return b.totalDistance - a.totalDistance;
    }

    return a.playerId.localeCompare(b.playerId);
  }

  getPlayers(): { playerId: string; username: string; isNpc: boolean }[] {
    const ids = new Set<string>();
    for (const playerId of this.cars.keys()) {
      ids.add(playerId);
    }
    for (const playerId of this.viewerPlayers.values()) {
      ids.add(playerId);
    }

    return Array.from(ids).map((playerId) => ({
      playerId,
      username: this.getUsername(playerId),
      isNpc: this.npcIds.has(playerId)
    }));
  }

  private toRaceState(): RaceState {
    const lapLength = this.trackLength > 0 ? this.trackLength : 1;
    const finishDistance = lapLength * this.lapsRequired;
    const entries = Array.from(this.raceProgress.values()).filter((entry) => this.cars.has(entry.playerId));
    entries.sort((a, b) => this.compareRaceProgress(a, b, lapLength));

    const leader = entries[0];
    const leaderDistance = leader
      ? leader.isFinished
        ? finishDistance
        : leader.totalDistance
      : 0;
    const leaderFinishTime = leader?.finishTime;

    const leaderboard: LeaderboardEntry[] = entries.map((entry, index) => {
      const clampedLap = Math.min(entry.lap, this.lapsRequired);
      const distanceForGap = entry.isFinished ? finishDistance : entry.totalDistance;
      let gapToFirst: number | null = null;

      if (index > 0) {
        if (leader?.isFinished && entry.isFinished && leaderFinishTime !== undefined && entry.finishTime !== undefined) {
          gapToFirst = Math.max(0, entry.finishTime - leaderFinishTime);
        } else {
          gapToFirst = Math.max(0, leaderDistance - distanceForGap);
        }
      }

      return {
        playerId: entry.playerId,
        username: this.getUsername(entry.playerId),
        position: index + 1,
        lap: clampedLap,
        totalDistance: entry.totalDistance,
        gapToFirst,
        isFinished: entry.isFinished,
        isNpc: entry.isNpc,
        ready: entry.ready,
        finishTime: entry.finishTime
      };
    });

    return {
      phase: this.racePhase,
      lapsRequired: this.lapsRequired,
      countdownRemaining: this.racePhase === "countdown" ? this.countdownRemaining : null,
      countdownTotal: this.racePhase === "countdown" ? this.countdownTotal : null,
      finishTimeoutRemaining: this.firstFinishTime !== null && this.racePhase === "race"
        ? this.finishTimeoutRemaining
        : null,
      postRaceRemaining: this.racePhase === "postrace" ? this.postRaceRemaining : null,
      startSegmentIndex: this.startSegmentIndex,
      leaderboard,
      players: entries.map((entry) => ({
        playerId: entry.playerId,
        username: this.getUsername(entry.playerId),
        lap: Math.min(entry.lap, this.lapsRequired),
        progressOnLap: lapLength > 0 ? Math.max(0, entry.totalDistance) % lapLength : 0,
        totalDistance: entry.totalDistance,
        ready: entry.ready,
        isFinished: entry.isFinished,
        isNpc: entry.isNpc,
        finishTime: entry.finishTime
      }))
    };
  }

  toRoomState(): RoomState {
    const cars: CarState[] = [];
    for (const car of this.cars.values()) {
      cars.push({
        ...car,
        username: this.getUsername(car.playerId)
      });
    }

    const missiles: MissileState[] = [];
    for (const missile of this.missiles.values()) {
      missiles.push({
        id: missile.id,
        ownerId: missile.ownerId,
        x: missile.x,
        z: missile.z,
        angle: missile.angle,
        speed: missile.speed,
        targetId: missile.targetId
      });
    }

    const items: RoomState["items"] = [];
    for (const item of this.items.values()) {
      if (!item.active) {
        continue;
      }
      items.push({
        id: item.spawn.id,
        type: item.type,
        x: item.spawn.position.x,
        z: item.spawn.position.z,
        angle: item.spawn.rotation
      });
    }

    return {
      roomId: this.roomId,
      trackId: this.track.id,
      serverTime: this.serverTime,
      cars,
      missiles,
      items,
      radio: this.radioState,
      race: this.toRaceState()
    };
  }

  isEmpty(): boolean {
    return this.viewers.size === 0 && this.controllers.size === 0;
  }

  getRacePhase(): RacePhase {
    return this.racePhase;
  }

  isJoinOpen(): boolean {
    return this.racePhase === "lobby";
  }

  getHumanPlayerCount(): number {
    return Math.max(0, this.cars.size - this.npcIds.size);
  }

  cycleRadio(): void {
    if (RADIO_STATION_COUNT <= 0) {
      this.radioState = { enabled: false, stationIndex: -1 };
      return;
    }

    const currentIndex = this.radioState.enabled ? this.radioState.stationIndex : -1;
    const nextIndex = currentIndex + 1;
    if (nextIndex >= RADIO_STATION_COUNT) {
      this.radioState = { enabled: false, stationIndex: -1 };
      return;
    }

    this.radioState = { enabled: true, stationIndex: nextIndex };
  }

  isOnTrack(position: { x: number; z: number }): boolean {
    return this.trackGeometry.isPointOnTrack(position);
  }

  resolveTrackBoundaryCollision(position: Vec2, radius: number, offset: number): TrackBoundaryCollision | null {
    return this.trackGeometry.resolveBoundaryCollision(position, radius, offset);
  }

  private initializeNpc(profile: NpcProfile): void {
    if (this.track.centerline.length < 2) {
      return;
    }

    const npcId = profile.name;
    const spawnPoint = this.track.centerline[0];
    const nextPoint = this.track.centerline[1 % this.track.centerline.length];
    const angle = Math.atan2(nextPoint.z - spawnPoint.z, nextPoint.x - spawnPoint.x);

    const username = this.setUsername(npcId, npcId);

    const car: CarState = {
      playerId: npcId,
      username,
      x: spawnPoint.x,
      z: spawnPoint.z,
      angle,
      speed: 0,
      isNpc: true
    };

    this.cars.set(npcId, car);
    this.latestInputs.set(npcId, { steer: 0, throttle: 1, brake: 0 });
    this.npcIds.add(npcId);
    this.npcStates.set(npcId, createNpcState(profile.behavior, 1 % this.track.centerline.length));
    this.ensureRaceProgress(npcId, car);
  }
}
