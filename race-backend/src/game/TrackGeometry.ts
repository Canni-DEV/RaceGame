import { TrackData, Vec2 } from "../types/trackTypes";

interface TrackSegment {
  start: Vec2;
  direction: Vec2;
  length: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
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
    const closest = findClosestSegment(position, this.segments);
    if (!closest) {
      return false;
    }
    const minDistanceSq = closest.distanceSq;
    return minDistanceSq < clearance * clearance;
  }

  resolveBoundaryCollision(position: Vec2, radius: number, offset: number): TrackBoundaryCollision | null {
    if (this.segments.length === 0 || this.halfWidth === 0) {
      return null;
    }

    const targetDistance = this.halfWidth + Math.max(0, offset);

    const closest = findClosestSegment(position, this.segments);
    if (!closest) {
      return null;
    }

    const distance = Math.sqrt(closest.distanceSq);
    const effectiveDistance = distance + radius;
    if (effectiveDistance <= targetDistance) {
      return null;
    }

    const penetration = effectiveDistance - targetDistance;
    const baseNormal = distance > 1e-6
      ? { x: closest.deltaX / distance, z: closest.deltaZ / distance }
      : closest.direction
        ? { x: -closest.direction.z, z: closest.direction.x }
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
    const minX = Math.min(current.x, next.x);
    const maxX = Math.max(current.x, next.x);
    const minZ = Math.min(current.z, next.z);
    const maxZ = Math.max(current.z, next.z);
    segments.push({ start: current, direction, length, minX, maxX, minZ, maxZ });
  }
  return segments;
}

function findClosestSegment(
  point: Vec2,
  segments: TrackSegment[]
): { distanceSq: number; deltaX: number; deltaZ: number; direction: Vec2 | null } | null {
  if (segments.length === 0) {
    return null;
  }

  let bestDistanceSq = Number.POSITIVE_INFINITY;
  let bestDeltaX = 0;
  let bestDeltaZ = 0;
  let bestDirection: Vec2 | null = null;

  for (const segment of segments) {
    if (bestDistanceSq !== Number.POSITIVE_INFINITY) {
      const aabbDistanceSq = distanceToAabbSq(point, segment);
      if (aabbDistanceSq > bestDistanceSq) {
        continue;
      }
    }

    const result = distanceToSegmentSq(point, segment);
    if (result.distanceSq < bestDistanceSq) {
      bestDistanceSq = result.distanceSq;
      bestDeltaX = result.deltaX;
      bestDeltaZ = result.deltaZ;
      bestDirection = segment.direction;
    }
  }

  return { distanceSq: bestDistanceSq, deltaX: bestDeltaX, deltaZ: bestDeltaZ, direction: bestDirection };
}

function distanceToSegmentSq(
  point: Vec2,
  segment: TrackSegment
): { distanceSq: number; deltaX: number; deltaZ: number } {
  const dx = point.x - segment.start.x;
  const dz = point.z - segment.start.z;
  const projection = dx * segment.direction.x + dz * segment.direction.z;
  const clamped = clamp(projection, 0, segment.length);
  const closestX = segment.start.x + segment.direction.x * clamped;
  const closestZ = segment.start.z + segment.direction.z * clamped;
  const offsetX = point.x - closestX;
  const offsetZ = point.z - closestZ;
  return { distanceSq: offsetX * offsetX + offsetZ * offsetZ, deltaX: offsetX, deltaZ: offsetZ };
}

function distanceToAabbSq(point: Vec2, segment: TrackSegment): number {
  const dx = point.x < segment.minX ? segment.minX - point.x : point.x > segment.maxX ? point.x - segment.maxX : 0;
  const dz = point.z < segment.minZ ? segment.minZ - point.z : point.z > segment.maxZ ? point.z - segment.maxZ : 0;
  return dx * dx + dz * dz;
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
