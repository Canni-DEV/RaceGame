import { Room, PlayerInput } from "./Room";

export interface NpcControllerState {
  targetIndex: number;
}

const MIN_TARGET_THRESHOLD = 4;
const TARGET_THRESHOLD_FACTOR = 0.3;
const BASE_THROTTLE = 0.8;
const STEER_RESPONSE = Math.PI / 3; // radians for full steer input

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function updateNpcControllers(
  room: Room,
  npcStates: Map<string, NpcControllerState>,
  _dt: number
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

    const targetIndex = controller.targetIndex % centerline.length;
    const targetPoint = centerline[targetIndex];
    const dx = targetPoint.x - car.x;
    const dz = targetPoint.z - car.z;
    const distance = Math.hypot(dx, dz);

    const desiredAngle = Math.atan2(dz, dx);
    const angleDiff = normalizeAngle(desiredAngle - car.angle);
    const steer = clamp(angleDiff / STEER_RESPONSE, -1, 1);

    const input: PlayerInput = {
      steer,
      throttle: BASE_THROTTLE,
      brake: 0
    };

    room.setNpcInput(npcId, input);

    const threshold = Math.max(
      MIN_TARGET_THRESHOLD,
      room.track.width * TARGET_THRESHOLD_FACTOR
    );
    if (distance < threshold) {
      controller.targetIndex = (controller.targetIndex + 1) % centerline.length;
    }
  }
}
