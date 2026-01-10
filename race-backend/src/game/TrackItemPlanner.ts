import {
  ITEM_LATERAL_SPREAD,
  ITEM_SPACING_JITTER,
  ITEM_SPAWN_COUNT,
} from "../config";
import { TrackItemSpawn, Vec2 } from "../types/trackTypes";
import { TrackNavigator, TrackProgress } from "./TrackNavigator";

export function planTrackItems(centerline: Vec2[], width: number, seed: number): TrackItemSpawn[] {
  if (centerline.length < 2 || ITEM_SPAWN_COUNT <= 0) {
    return [];
  }

  const navigator = new TrackNavigator(centerline);
  const totalLength = navigator.getTotalLength();
  if (totalLength <= 0) {
    return [];
  }

  const random = createRandom(seed ^ 0x6d0f1b);
  const spacing = totalLength / ITEM_SPAWN_COUNT;
  const maxLateral = Math.max(0, Math.min(width * 0.5, ITEM_LATERAL_SPREAD));
  const start: TrackProgress = { segmentIndex: 0, distanceAlongSegment: 0 };
  let lastTargetDistance = 0;
  let lastProgress: TrackProgress = start;

  const spawns: TrackItemSpawn[] = [];
  for (let i = 0; i < ITEM_SPAWN_COUNT; i++) {
    const jitter = (random() * 2 - 1) * (ITEM_SPACING_JITTER * 0.5);
    const targetDistance = (i + 0.5) * spacing + jitter;
    const useIncremental = targetDistance >= lastTargetDistance;
    let progress = useIncremental
      ? navigator.advance(lastProgress, targetDistance - lastTargetDistance)
      : navigator.advance(start, targetDistance);
    if (useIncremental && totalLength > 0) {
      const clampedTarget = Math.max(0, targetDistance);
      const expected = clampedTarget % totalLength;
      if (Math.abs(progress.distanceAlongTrack - expected) > 1e-6) {
        progress = navigator.advance(start, targetDistance);
      }
    }
    lastTargetDistance = targetDistance;
    lastProgress = { segmentIndex: progress.segmentIndex, distanceAlongSegment: progress.distanceAlongSegment };
    const normal = { x: -progress.direction.z, z: progress.direction.x };
    const lateralOffset = maxLateral > 0 ? (random() * 2 - 1) * maxLateral : 0;
    const position = {
      x: progress.position.x + normal.x * lateralOffset,
      z: progress.position.z + normal.z * lateralOffset
    };

    spawns.push({
      id: `item-${i}`,
      position,
      rotation: Math.atan2(progress.direction.z, progress.direction.x)
    });
  }

  return spawns;
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
