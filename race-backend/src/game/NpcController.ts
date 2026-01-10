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

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function squaredDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function findClosestIndex(
  centerline: { x: number; z: number }[],
  position: { x: number; z: number }
): number {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < centerline.length; i++) {
    const distance = squaredDistance(centerline[i], position);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = i;
    }
  }
  return closestIndex;
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
    const closestIndex = findClosestIndex(centerline, car);
    const lookahead = clamp(
      thresholdBase + config.minLookahead + car.speed * config.lookaheadSpeedFactor,
      config.minLookahead,
      config.maxLookahead
    );
    const targetIndex = pickTargetIndex(centerline, closestIndex, lookahead);
    const targetPoint = centerline[targetIndex];
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
