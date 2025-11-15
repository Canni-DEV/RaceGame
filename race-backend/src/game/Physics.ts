import {
  ACCELERATION,
  BRAKE_DECELERATION,
  FRICTION,
  MAX_SPEED,
  STEER_SENSITIVITY
} from "../config";
import { Room, PlayerInput } from "./Room";

const NEUTRAL_INPUT: PlayerInput = { steer: 0, throttle: 0, brake: 0 };

export function updateCarsForRoom(room: Room, dt: number): void {
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

    car.speed = Math.min(MAX_SPEED, Math.max(0, car.speed));

    const steerValue = Math.max(-1, Math.min(1, input.steer));
    const speedFactor = car.speed / MAX_SPEED;
    car.angle += steerValue * STEER_SENSITIVITY * speedFactor * dt;

    const dx = Math.cos(car.angle) * car.speed * dt;
    const dz = Math.sin(car.angle) * car.speed * dt;

    car.x += dx;
    car.z += dz;
  }
}
