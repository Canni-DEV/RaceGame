import { MAX_SPEED } from "../config";
import { Room, PlayerInput } from "./Room";

export interface NpcBehaviorConfig {
  minTargetThreshold: number;
  targetThresholdFactor: number;
  minLookahead: number;
  maxLookahead: number;
  lookaheadSpeedFactor: number;
  baseThrottle: number;
  minThrottle: number;
  throttleCornerPenalty: number;
  recoveryBrakeAngle: number;
  offTrackThrottleScale: number;
  offTrackBrake: number;
  steerResponse: number;
  mistakeSteerBias: number;
  mistakeTriggerChance: number;
  mistakeDurationRange: [number, number];
  mistakeCooldownRange: [number, number];
  approachThrottleScale: number;
  approachBrake: number;
  approachDistanceRatio: number;
}

export interface NpcControllerState {
  targetIndex: number;
  closestIndex: number;
  mistakeCooldown: number;
  mistakeDuration: number;
  mistakeDirection: number;
  config: NpcBehaviorConfig;
}

const DEFAULT_NPC_CONFIG: NpcBehaviorConfig = {
  minTargetThreshold: 4,
  targetThresholdFactor: 0.3,
  minLookahead: 6,
  maxLookahead: 48,
  lookaheadSpeedFactor: 0.7,
  baseThrottle: 0.82,
  minThrottle: 0.32,
  throttleCornerPenalty: 0.55,
  recoveryBrakeAngle: (Math.PI * 3) / 4,
  offTrackThrottleScale: 0.65,
  offTrackBrake: 0.35,
  steerResponse: Math.PI / 3,
  mistakeSteerBias: Math.PI / 12,
  mistakeTriggerChance: 0.35,
  mistakeDurationRange: [0.35, 0.95],
  mistakeCooldownRange: [1.5, 5.5],
  approachThrottleScale: 0.65,
  approachBrake: 0.2,
  approachDistanceRatio: 0.75
};

const MAX_SPEED_SAFE = Math.max(1, MAX_SPEED);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface CenterlineSpatialIndex {
  cellSize: number;
  cells: Map<string, number[]>;
  minCellX: number;
  maxCellX: number;
  minCellZ: number;
  maxCellZ: number;
}

const centerlineIndexCache = new WeakMap<ReadonlyArray<{ x: number; z: number }>, CenterlineSpatialIndex>();

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function squaredDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function getCenterlineIndex(centerline: { x: number; z: number }[]): CenterlineSpatialIndex {
  const cached = centerlineIndexCache.get(centerline);
  if (cached) {
    return cached;
  }

  const cellSize = resolveCenterlineCellSize(centerline);
  const cells = new Map<string, number[]>();
  let minCellX = Number.POSITIVE_INFINITY;
  let maxCellX = Number.NEGATIVE_INFINITY;
  let minCellZ = Number.POSITIVE_INFINITY;
  let maxCellZ = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < centerline.length; i++) {
    const point = centerline[i];
    const cellX = Math.floor(point.x / cellSize);
    const cellZ = Math.floor(point.z / cellSize);
    const key = `${cellX},${cellZ}`;
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = [];
      cells.set(key, bucket);
    }
    bucket.push(i);
    if (cellX < minCellX) minCellX = cellX;
    if (cellX > maxCellX) maxCellX = cellX;
    if (cellZ < minCellZ) minCellZ = cellZ;
    if (cellZ > maxCellZ) maxCellZ = cellZ;
  }

  if (!Number.isFinite(minCellX)) {
    minCellX = 0;
    maxCellX = 0;
    minCellZ = 0;
    maxCellZ = 0;
  }

  const built = { cellSize, cells, minCellX, maxCellX, minCellZ, maxCellZ };
  centerlineIndexCache.set(centerline, built);
  return built;
}

function resolveCenterlineCellSize(centerline: { x: number; z: number }[]): number {
  if (centerline.length < 2) {
    return 1;
  }
  let total = 0;
  for (let i = 0; i < centerline.length; i++) {
    const current = centerline[i];
    const next = centerline[(i + 1) % centerline.length];
    total += Math.max(0.001, Math.hypot(next.x - current.x, next.z - current.z));
  }
  const average = total / centerline.length;
  return Math.max(1, average);
}

function findClosestIndex(
  centerline: { x: number; z: number }[],
  position: { x: number; z: number },
  hintIndex?: number
): number {
  if (centerline.length === 0) {
    return 0;
  }

  const index = getCenterlineIndex(centerline);
  const cellSize = index.cellSize;
  const cellX = Math.floor(position.x / cellSize);
  const cellZ = Math.floor(position.z / cellSize);
  const fallbackHint = hintIndex ?? 0;
  let bestIndex = clamp(Math.floor(fallbackHint), 0, centerline.length - 1);
  let bestDistanceSq = squaredDistance(centerline[bestIndex], position);

  const maxRadius = Math.max(
    Math.max(Math.abs(cellX - index.minCellX), Math.abs(cellX - index.maxCellX)),
    Math.max(Math.abs(cellZ - index.minCellZ), Math.abs(cellZ - index.maxCellZ))
  );

  const updateFromCell = (key: string): void => {
    const indices = index.cells.get(key);
    if (!indices) {
      return;
    }
    for (const candidateIndex of indices) {
      const distance = squaredDistance(centerline[candidateIndex], position);
      if (distance < bestDistanceSq || (distance === bestDistanceSq && candidateIndex < bestIndex)) {
        bestDistanceSq = distance;
        bestIndex = candidateIndex;
      }
    }
  };

  for (let radius = 0; radius <= maxRadius; radius++) {
    if (radius === 0) {
      updateFromCell(`${cellX},${cellZ}`);
    } else {
      const minX = cellX - radius;
      const maxX = cellX + radius;
      const minZ = cellZ - radius;
      const maxZ = cellZ + radius;

      for (let x = minX; x <= maxX; x++) {
        updateFromCell(`${x},${minZ}`);
        updateFromCell(`${x},${maxZ}`);
      }
      for (let z = minZ + 1; z <= maxZ - 1; z++) {
        updateFromCell(`${minX},${z}`);
        updateFromCell(`${maxX},${z}`);
      }
    }

    if (bestDistanceSq === 0) {
      break;
    }

    const boundaryDistance = distanceToBoundary(position, cellX, cellZ, radius, cellSize);
    if (boundaryDistance * boundaryDistance > bestDistanceSq) {
      break;
    }
  }

  return bestIndex;
}

function distanceToBoundary(
  position: { x: number; z: number },
  cellX: number,
  cellZ: number,
  radius: number,
  cellSize: number
): number {
  const minX = (cellX - radius) * cellSize;
  const maxX = (cellX + radius + 1) * cellSize;
  const minZ = (cellZ - radius) * cellSize;
  const maxZ = (cellZ + radius + 1) * cellSize;
  const dx = Math.min(position.x - minX, maxX - position.x);
  const dz = Math.min(position.z - minZ, maxZ - position.z);
  return Math.max(0, Math.min(dx, dz));
}

function pickTargetIndex(
  centerline: { x: number; z: number }[],
  startIndex: number,
  lookaheadDistance: number
): number {
  let remaining = lookaheadDistance;
  let index = startIndex;
  while (remaining > 0) {
    const nextIndex = (index + 1) % centerline.length;
    const dx = centerline[nextIndex].x - centerline[index].x;
    const dz = centerline[nextIndex].z - centerline[index].z;
    const segmentLength = Math.max(0.001, Math.hypot(dx, dz));
    if (segmentLength >= remaining) {
      return nextIndex;
    }
    remaining -= segmentLength;
    index = nextIndex;
  }
  return index;
}

function resolveMistakeBias(state: NpcControllerState, dt: number): number {
  const config = state.config;
  if (state.mistakeDuration > 0) {
    state.mistakeDuration = Math.max(0, state.mistakeDuration - dt);
    return state.mistakeDirection * config.mistakeSteerBias;
  }

  state.mistakeCooldown -= dt;
  if (state.mistakeCooldown <= 0) {
    const shouldSlip = Math.random() < config.mistakeTriggerChance;
    if (shouldSlip) {
      state.mistakeDirection = Math.random() < 0.5 ? -1 : 1;
      state.mistakeDuration = randomInRange(...config.mistakeDurationRange);
    }
    state.mistakeCooldown = randomInRange(...config.mistakeCooldownRange);
  }

  return 0;
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function createNpcBehaviorConfig(overrides: Partial<NpcBehaviorConfig> = {}): NpcBehaviorConfig {
  return {
    ...DEFAULT_NPC_CONFIG,
    ...overrides,
    mistakeDurationRange: overrides.mistakeDurationRange ?? [...DEFAULT_NPC_CONFIG.mistakeDurationRange],
    mistakeCooldownRange: overrides.mistakeCooldownRange ?? [...DEFAULT_NPC_CONFIG.mistakeCooldownRange]
  };
}

export function createNpcState(config: NpcBehaviorConfig, startIndex: number): NpcControllerState {
  return {
    targetIndex: startIndex,
    closestIndex: startIndex,
    mistakeCooldown: randomInRange(...config.mistakeCooldownRange),
    mistakeDuration: 0,
    mistakeDirection: 0,
    config
  };
}

export function updateNpcControllers(
  room: Room,
  npcStates: Map<string, NpcControllerState>,
  dt: number
): void {
  const centerline = room.track.centerline;
  if (centerline.length === 0) {
    return;
  }

  for (const [npcId, controller] of npcStates.entries()) {
    const car = room.cars.get(npcId);
    if (!car) {
      continue;
    }

    const config = controller.config ?? DEFAULT_NPC_CONFIG;
    const trackWidth = room.track.width;
    const thresholdBase = trackWidth * config.targetThresholdFactor;

    const onTrack = room.isOnTrack(car);
    const closestIndex = findClosestIndex(centerline, car, controller.closestIndex);
    const lookahead = clamp(
      thresholdBase + config.minLookahead + car.speed * config.lookaheadSpeedFactor,
      config.minLookahead,
      config.maxLookahead
    );
    const targetIndex = pickTargetIndex(centerline, closestIndex, lookahead);
    const targetPoint = centerline[targetIndex];
    controller.closestIndex = closestIndex;
    controller.targetIndex = targetIndex;

    const dx = targetPoint.x - car.x;
    const dz = targetPoint.z - car.z;
    const desiredAngle = Math.atan2(dz, dx);
    let angleDiff = normalizeAngle(desiredAngle - car.angle);
    angleDiff += resolveMistakeBias(controller, dt);

    const steer = clamp(angleDiff / config.steerResponse, -1, 1);

    const steeringDemand = Math.min(1, Math.abs(angleDiff) / Math.PI);
    const speedRatio = car.speed / MAX_SPEED_SAFE;
    let throttle = clamp(
      config.baseThrottle * (1 - config.throttleCornerPenalty * steeringDemand) + (1 - speedRatio) * 0.25,
      config.minThrottle,
      1
    );
    let brake = 0;

    if (Math.abs(angleDiff) > config.recoveryBrakeAngle && car.speed > MAX_SPEED * 0.35) {
      brake = 0.6;
      throttle *= 0.6;
    }

    if (!onTrack) {
      throttle *= config.offTrackThrottleScale;
      if (car.speed > MAX_SPEED * 0.25) {
        brake = Math.max(brake, config.offTrackBrake);
      }
    }

    const distance = Math.hypot(dx, dz);
    const threshold = Math.max(config.minTargetThreshold, thresholdBase);
    if (distance < threshold * config.approachDistanceRatio && car.speed > MAX_SPEED * 0.6) {
      throttle = Math.min(throttle, config.baseThrottle * config.approachThrottleScale);
      brake = Math.max(brake, config.approachBrake);
    }

    const input: PlayerInput = {
      steer,
      throttle,
      brake
    };

    room.setNpcInput(npcId, input);
  }
}
