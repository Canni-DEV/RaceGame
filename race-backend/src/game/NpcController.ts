import { MAX_SPEED } from "../config";
import { Room, PlayerInput } from "./Room";

export interface NpcControllerState {
  targetIndex: number;
  mistakeCooldown: number;
  mistakeDuration: number;
  mistakeDirection: number;
}

const MIN_TARGET_THRESHOLD = 4;
const TARGET_THRESHOLD_FACTOR = 0.3;
const MIN_LOOKAHEAD = 6;
const MAX_LOOKAHEAD = 48;
const LOOKAHEAD_SPEED_FACTOR = 0.7;
const BASE_THROTTLE = 0.82;
const MIN_THROTTLE = 0.32;
const THROTTLE_CORNER_PENALTY = 0.55;
const RECOVERY_BRAKE_ANGLE = (Math.PI * 3) / 4;
const OFF_TRACK_THROTTLE_SCALE = 0.65;
const OFF_TRACK_BRAKE = 0.35;
const STEER_RESPONSE = Math.PI / 3; // radians for full steer input
const MISTAKE_STEER_BIAS = Math.PI / 12;
const MISTAKE_TRIGGER_CHANCE = 0.35;
const MISTAKE_DURATION_RANGE: [number, number] = [0.35, 0.95];
const MISTAKE_COOLDOWN_RANGE: [number, number] = [2.5, 5.5];

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
  let remaining = Math.max(lookaheadDistance, MIN_LOOKAHEAD);
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
  if (state.mistakeDuration > 0) {
    state.mistakeDuration = Math.max(0, state.mistakeDuration - dt);
    return state.mistakeDirection * MISTAKE_STEER_BIAS;
  }

  state.mistakeCooldown -= dt;
  if (state.mistakeCooldown <= 0) {
    const shouldSlip = Math.random() < MISTAKE_TRIGGER_CHANCE;
    if (shouldSlip) {
      state.mistakeDirection = Math.random() < 0.5 ? -1 : 1;
      state.mistakeDuration = randomInRange(...MISTAKE_DURATION_RANGE);
    }
    state.mistakeCooldown = randomInRange(...MISTAKE_COOLDOWN_RANGE);
  }

  return 0;
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
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

    const onTrack = room.isOnTrack(car);
    const closestIndex = findClosestIndex(centerline, car);
    const lookahead = clamp(
      room.track.width * TARGET_THRESHOLD_FACTOR + MIN_LOOKAHEAD + car.speed * LOOKAHEAD_SPEED_FACTOR,
      MIN_LOOKAHEAD,
      MAX_LOOKAHEAD
    );
    const targetIndex = pickTargetIndex(centerline, closestIndex, lookahead);
    const targetPoint = centerline[targetIndex];
    controller.targetIndex = targetIndex;

    const dx = targetPoint.x - car.x;
    const dz = targetPoint.z - car.z;
    const desiredAngle = Math.atan2(dz, dx);
    let angleDiff = normalizeAngle(desiredAngle - car.angle);
    angleDiff += resolveMistakeBias(controller, dt);

    const steer = clamp(angleDiff / STEER_RESPONSE, -1, 1);

    const steeringDemand = Math.min(1, Math.abs(angleDiff) / Math.PI);
    const speedRatio = car.speed / Math.max(1, MAX_SPEED);
    let throttle = clamp(
      BASE_THROTTLE * (1 - THROTTLE_CORNER_PENALTY * steeringDemand) + (1 - speedRatio) * 0.25,
      MIN_THROTTLE,
      1
    );
    let brake = 0;

    if (Math.abs(angleDiff) > RECOVERY_BRAKE_ANGLE && car.speed > MAX_SPEED * 0.35) {
      brake = 0.6;
      throttle *= 0.6;
    }

    if (!onTrack) {
      throttle *= OFF_TRACK_THROTTLE_SCALE;
      if (car.speed > MAX_SPEED * 0.25) {
        brake = Math.max(brake, OFF_TRACK_BRAKE);
      }
    }

    const distance = Math.hypot(dx, dz);
    const threshold = Math.max(MIN_TARGET_THRESHOLD, room.track.width * TARGET_THRESHOLD_FACTOR);
    if (distance < threshold * 0.75 && car.speed > MAX_SPEED * 0.6) {
      throttle = Math.min(throttle, BASE_THROTTLE * 0.65);
      brake = Math.max(brake, 0.2);
    }

    const input: PlayerInput = {
      steer,
      throttle,
      brake
    };

    room.setNpcInput(npcId, input);
  }
}
