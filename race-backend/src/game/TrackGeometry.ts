import { TrackData, Vec2 } from "../types/trackTypes";

interface TrackSegment {
  start: Vec2;
  direction: Vec2;
  length: number;
}

const DEFAULT_TOLERANCE = 0.25;

export class TrackGeometry {
  private readonly segments: TrackSegment[];
  private readonly halfWidth: number;

  constructor(track: TrackData) {
    this.segments = buildSegments(track.centerline);
    this.halfWidth = Math.max(0, track.width * 0.5);
  }

  isPointOnTrack(position: Vec2): boolean {
    if (this.segments.length === 0 || this.halfWidth === 0) {
      return false;
    }

    const clearance = this.halfWidth + DEFAULT_TOLERANCE;
    const minDistanceSq = minimumDistanceToSegmentsSq(position, this.segments);
    return minDistanceSq < clearance * clearance;
  }

  resolveSpeedMultiplier(position: Vec2, offTrackPenalty: number): number {
    return this.isPointOnTrack(position) ? 1 : Math.max(0, 1 - offTrackPenalty);
  }

  resolveBoundaryCollision(position: Vec2, radius: number, offset: number): TrackBoundaryCollision | null {
    if (this.segments.length === 0 || this.halfWidth === 0) {
      return null;
    }

    const targetDistance = this.halfWidth + Math.max(0, offset);

    let bestDistanceSq = Number.POSITIVE_INFINITY;
    let bestDeltaX = 0;
    let bestDeltaZ = 0;
    let bestDirection: Vec2 | null = null;

    for (const segment of this.segments) {
      const dx = position.x - segment.start.x;
      const dz = position.z - segment.start.z;
      const projection = dx * segment.direction.x + dz * segment.direction.z;
      const clamped = clamp(projection, 0, segment.length);
      const closestX = segment.start.x + segment.direction.x * clamped;
      const closestZ = segment.start.z + segment.direction.z * clamped;
      const offsetX = position.x - closestX;
      const offsetZ = position.z - closestZ;
      const distanceSq = offsetX * offsetX + offsetZ * offsetZ;

      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestDeltaX = offsetX;
        bestDeltaZ = offsetZ;
        bestDirection = segment.direction;
      }
    }

    const distance = Math.sqrt(bestDistanceSq);
    const effectiveDistance = distance + radius;
    if (effectiveDistance <= targetDistance) {
      return null;
    }

    const penetration = effectiveDistance - targetDistance;
    const baseNormal = distance > 1e-6
      ? { x: bestDeltaX / distance, z: bestDeltaZ / distance }
      : bestDirection
        ? { x: -bestDirection.z, z: bestDirection.x }
        : { x: 1, z: 0 };

    return { normal: baseNormal, penetration };
  }
}

export interface TrackBoundaryCollision {
  normal: Vec2;
  penetration: number;
}

function buildSegments(centerline: Vec2[]): TrackSegment[] {
  if (centerline.length === 0) {
    return [];
  }

  const segments: TrackSegment[] = [];
  for (let i = 0; i < centerline.length; i++) {
    const current = centerline[i];
    const next = centerline[(i + 1) % centerline.length];
    const direction = normalize({ x: next.x - current.x, z: next.z - current.z });
    const length = Math.max(0.001, distance(current, next));
    segments.push({ start: current, direction, length });
  }
  return segments;
}

function minimumDistanceToSegmentsSq(point: Vec2, segments: TrackSegment[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const candidate = distanceToSegmentSq(point, segment);
    if (candidate < best) {
      best = candidate;
    }
  }
  return best;
}

function distanceToSegmentSq(point: Vec2, segment: TrackSegment): number {
  const dx = point.x - segment.start.x;
  const dz = point.z - segment.start.z;
  const projection = dx * segment.direction.x + dz * segment.direction.z;
  const clamped = clamp(projection, 0, segment.length);
  const closestX = segment.start.x + segment.direction.x * clamped;
  const closestZ = segment.start.z + segment.direction.z * clamped;
  const offsetX = point.x - closestX;
  const offsetZ = point.z - closestZ;
  return offsetX * offsetX + offsetZ * offsetZ;
}

function normalize(vec: Vec2): Vec2 {
  const length = Math.hypot(vec.x, vec.z);
  if (length === 0) {
    return { x: 0, z: 0 };
  }
  return { x: vec.x / length, z: vec.z / length };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
