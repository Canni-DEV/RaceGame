import {
  ACCELERATION,
  BRAKE_DECELERATION,
  FRICTION,
  MAX_SPEED,
  OFF_TRACK_SPEED_MULTIPLIER,
  STEER_SENSITIVITY
} from "../config";
import { Room, PlayerInput } from "./Room";

const NEUTRAL_INPUT: PlayerInput = { steer: 0, throttle: 0, brake: 0 };
const TAU = Math.PI * 2;

// Tamaño aproximado del modelo (ver CarModelLoader en el cliente).
const CAR_LENGTH = 4.6;
const CAR_WIDTH = 2.0;
const HALF_LENGTH = CAR_LENGTH * 0.5;
const HALF_WIDTH = CAR_WIDTH * 0.5;
const COLLISION_RESTITUTION = 0.35;

interface Vec2 {
  x: number;
  z: number;
}

interface CollisionBody {
  playerId: string;
  car: { x: number; z: number; angle: number; speed: number };
  forward: Vec2;
  right: Vec2;
  velocity: Vec2;
}

function normalizeAngle(angle: number): number {
  return ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

export function updateCarsForRoom(room: Room, dt: number): void {
  const collisionBodies: CollisionBody[] = [];

  for (const [playerId, car] of room.cars.entries()) {
    const input = room.latestInputs.get(playerId) ?? NEUTRAL_INPUT;

    const throttleAccel = Math.max(0, Math.min(1, input.throttle)) * ACCELERATION;
    const brakeForce = Math.max(0, Math.min(1, input.brake)) * BRAKE_DECELERATION;

    car.speed += (throttleAccel - brakeForce) * dt;

    if (car.speed > 0) {
      car.speed = Math.max(0, car.speed - FRICTION * dt);
    } else {
      car.speed = Math.min(0, car.speed + FRICTION * dt);
    }

    const trackSpeedMultiplier = room.isOnTrack(car) ? 1 : OFF_TRACK_SPEED_MULTIPLIER;
    const maxSpeed = MAX_SPEED * trackSpeedMultiplier;
    car.speed = Math.min(maxSpeed, Math.max(0, car.speed));

    const steerValue = Math.max(-1, Math.min(1, input.steer));
    const speedFactor = car.speed / MAX_SPEED;
    car.angle += steerValue * STEER_SENSITIVITY * speedFactor * dt;
    car.angle = normalizeAngle(car.angle);

    const forward = { x: Math.cos(car.angle), z: Math.sin(car.angle) };
    const right = { x: -forward.z, z: forward.x };
    const velocity = { x: forward.x * car.speed, z: forward.z * car.speed };

    car.x += velocity.x * dt;
    car.z += velocity.z * dt;

    collisionBodies.push({
      playerId,
      car,
      forward,
      right,
      velocity
    });
  }

  resolveCarCollisions(room, collisionBodies);
}

function resolveCarCollisions(room: Room, bodies: CollisionBody[]): void {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const first = bodies[i];
      const second = bodies[j];
      const collision = detectCollision(first, second);
      if (!collision) {
        continue;
      }

      const { normal, penetration } = collision;
      const separationX = normal.x * (penetration * 0.5);
      const separationZ = normal.z * (penetration * 0.5);

      first.car.x -= separationX;
      first.car.z -= separationZ;
      second.car.x += separationX;
      second.car.z += separationZ;

      applyImpulse(first, second, normal);
    }
  }

  for (const body of bodies) {
    const speed = Math.hypot(body.velocity.x, body.velocity.z);
    if (speed > 1e-3) {
      const trackMultiplier = room.isOnTrack(body.car) ? 1 : OFF_TRACK_SPEED_MULTIPLIER;
      const maxSpeed = MAX_SPEED * trackMultiplier;
      body.car.angle = normalizeAngle(Math.atan2(body.velocity.z, body.velocity.x));
      body.car.speed = Math.min(maxSpeed, speed);
    } else {
      body.car.speed = 0;
    }
  }
}

function detectCollision(a: CollisionBody, b: CollisionBody): { normal: Vec2; penetration: number } | null {
  const delta = { x: b.car.x - a.car.x, z: b.car.z - a.car.z };
  const axes = [a.forward, a.right, b.forward, b.right];

  let minimumPenetration = Number.POSITIVE_INFINITY;
  let bestAxis: Vec2 | null = null;

  for (const axis of axes) {
    const axisLength = Math.hypot(axis.x, axis.z);
    if (axisLength < 1e-6) {
      continue;
    }
    const normal = { x: axis.x / axisLength, z: axis.z / axisLength };
    const distance = Math.abs(delta.x * normal.x + delta.z * normal.z);
    const projectionA = projectExtent(a, normal);
    const projectionB = projectExtent(b, normal);
    const overlap = projectionA + projectionB - distance;

    if (overlap <= 0) {
      return null;
    }

    if (overlap < minimumPenetration) {
      minimumPenetration = overlap;
      bestAxis = normal;
    }
  }

  if (!bestAxis) {
    return null;
  }

  const direction = delta.x * bestAxis.x + delta.z * bestAxis.z;
  const finalNormal = direction >= 0 ? bestAxis : { x: -bestAxis.x, z: -bestAxis.z };

  return { normal: finalNormal, penetration: minimumPenetration };
}

function projectExtent(body: CollisionBody, axis: Vec2): number {
  const forwardContribution = HALF_LENGTH * Math.abs(axis.x * body.forward.x + axis.z * body.forward.z);
  const sideContribution = HALF_WIDTH * Math.abs(axis.x * body.right.x + axis.z * body.right.z);
  return forwardContribution + sideContribution;
}

function applyImpulse(a: CollisionBody, b: CollisionBody, normal: Vec2): void {
  const relativeVelocity = {
    x: b.velocity.x - a.velocity.x,
    z: b.velocity.z - a.velocity.z
  };
  const velAlongNormal = relativeVelocity.x * normal.x + relativeVelocity.z * normal.z;

  if (velAlongNormal > 0) {
    return;
  }

  const impulseMagnitude = (-(1 + COLLISION_RESTITUTION) * velAlongNormal) / 2;
  const impulseX = normal.x * impulseMagnitude;
  const impulseZ = normal.z * impulseMagnitude;

  a.velocity.x -= impulseX;
  a.velocity.z -= impulseZ;
  b.velocity.x += impulseX;
  b.velocity.z += impulseZ;
}
