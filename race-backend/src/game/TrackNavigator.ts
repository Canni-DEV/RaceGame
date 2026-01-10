import { Vec2 } from "../types/trackTypes";

export interface TrackProgress {
  segmentIndex: number;
  distanceAlongSegment: number;
}

export interface ProjectedProgress extends TrackProgress {
  position: Vec2;
  direction: Vec2;
  distanceAlongTrack: number;
}

interface TrackSegment {
  start: Vec2;
  direction: Vec2;
  length: number;
  cumulativeDistance: number;
}

export class TrackNavigator {
  private readonly segments: TrackSegment[];
  private readonly totalLength: number;
  private readonly testedMarkers: Uint32Array;
  private testMarkerId = 0;

  constructor(centerline: Vec2[]) {
    this.segments = this.buildSegments(centerline);
    this.totalLength = this.segments.length > 0
      ? this.segments[this.segments.length - 1].cumulativeDistance + this.segments[this.segments.length - 1].length
      : 0;
    this.testedMarkers = new Uint32Array(this.segments.length);
  }

  project(point: Vec2, hint?: TrackProgress): ProjectedProgress {
    if (this.segments.length === 0) {
      return this.resolveProgress(0, 0, point, { x: 1, z: 0 });
    }

    let bestIndex = 0;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    let bestDistanceAlong = 0;
    const tested = this.testedMarkers;
    const marker = this.nextTestMarker();

    const checkSegment = (index: number): void => {
      if (tested[index] === marker) {
        return;
      }
      tested[index] = marker;
      const segment = this.segments[index];
      const px = point.x - segment.start.x;
      const pz = point.z - segment.start.z;
      const projection = px * segment.direction.x + pz * segment.direction.z;
      const clamped = clamp(projection, 0, segment.length);
      const closestX = segment.start.x + segment.direction.x * clamped;
      const closestZ = segment.start.z + segment.direction.z * clamped;
      const dx = point.x - closestX;
      const dz = point.z - closestZ;
      const distanceSq = dx * dx + dz * dz;

      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestIndex = index;
        bestDistanceAlong = clamped;
      }
    };

    const hintIndex = hint ? clamp(Math.floor(hint.segmentIndex), 0, this.segments.length - 1) : undefined;
    if (hintIndex !== undefined) {
      checkSegment(hintIndex);
      checkSegment((hintIndex + this.segments.length - 1) % this.segments.length);
      checkSegment((hintIndex + 1) % this.segments.length);
    }

    if (bestDistanceSq !== 0) {
      for (let i = 0; i < this.segments.length; i++) {
        if (tested[i] === marker) {
          continue;
        }
        checkSegment(i);
      }
    }

    return this.composeProgress(bestIndex, bestDistanceAlong);
  }

  advance(progress: TrackProgress, distance: number): ProjectedProgress {
    if (this.segments.length === 0 || this.totalLength === 0) {
      return this.resolveProgress(0, 0, { x: 0, z: 0 }, { x: 1, z: 0 });
    }

    let remaining = Math.max(0, distance);
    let index = clamp(Math.floor(progress.segmentIndex), 0, this.segments.length - 1);
    let distanceAlong = clamp(progress.distanceAlongSegment, 0, this.segments[index].length);

    while (remaining > 0) {
      const segment = this.segments[index];
      const available = segment.length - distanceAlong;
      if (remaining <= available) {
        distanceAlong += remaining;
        remaining = 0;
      } else {
        remaining -= available;
        index = (index + 1) % this.segments.length;
        distanceAlong = 0;
      }
    }

    return this.composeProgress(index, distanceAlong);
  }

  distanceAhead(from: ProjectedProgress, to: ProjectedProgress): number {
    if (this.totalLength === 0) {
      return 0;
    }
    const delta = to.distanceAlongTrack - from.distanceAlongTrack;
    return delta >= 0 ? delta : delta + this.totalLength;
  }

  getTotalLength(): number {
    return this.totalLength;
  }

  private composeProgress(segmentIndex: number, distanceAlongSegment: number): ProjectedProgress {
    const segment = this.segments[segmentIndex];
    const clampedDistance = clamp(distanceAlongSegment, 0, segment.length);
    const position = {
      x: segment.start.x + segment.direction.x * clampedDistance,
      z: segment.start.z + segment.direction.z * clampedDistance
    };
    return this.resolveProgress(segmentIndex, clampedDistance, position, segment.direction);
  }

  private resolveProgress(
    segmentIndex: number,
    distanceAlongSegment: number,
    position: Vec2,
    direction: Vec2
  ): ProjectedProgress {
    const baseDistance = this.segments[segmentIndex]?.cumulativeDistance ?? 0;
    const distanceAlongTrack = baseDistance + distanceAlongSegment;
    return {
      segmentIndex,
      distanceAlongSegment,
      position,
      direction,
      distanceAlongTrack
    };
  }

  private buildSegments(centerline: Vec2[]): TrackSegment[] {
    if (centerline.length < 2) {
      return [];
    }
    const segments: TrackSegment[] = [];
    let cumulative = 0;
    for (let i = 0; i < centerline.length; i++) {
      const start = centerline[i];
      const end = centerline[(i + 1) % centerline.length];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.max(0.001, Math.hypot(dx, dz));
      const direction = { x: dx / length, z: dz / length };
      segments.push({ start, direction, length, cumulativeDistance: cumulative });
      cumulative += length;
    }
    return segments;
  }

  private nextTestMarker(): number {
    let next = (this.testMarkerId + 1) >>> 0;
    if (next === 0) {
      this.testedMarkers.fill(0);
      next = 1;
    }
    this.testMarkerId = next;
    return next;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
