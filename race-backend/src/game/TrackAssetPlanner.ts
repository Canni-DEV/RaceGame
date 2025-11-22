import { PROCEDURAL_TRACK_SETTINGS, TRACK_ASSET_LIBRARY } from "../config";
import { InstancedDecoration, TrackObjectInstance, Vec2 } from "../types/trackTypes";
import { AssetDescriptor, loadAssetDescriptors } from "./TrackAssetManifestReader";

interface SegmentInfo {
  start: Vec2;
  direction: Vec2;
  length: number;
  curvature: number;
}

interface PlanningContext {
  width: number;
  random: () => number;
  occupied: Vec2[];
}

export function planAssetDecorations(centerline: Vec2[], width: number, seed: number): InstancedDecoration[] {
  if (centerline.length === 0) {
    return [];
  }

  const random = createRandom(seed ^ 0x9e3779b9);
  const descriptors = withDefaultTreeDescriptor(loadAssetDescriptors(TRACK_ASSET_LIBRARY));
  if (descriptors.length === 0) {
    return [];
  }

  const segments = buildSegments(centerline);
  const occupied: Vec2[] = [];
  const decorations: InstancedDecoration[] = [];

  for (const descriptor of descriptors) {
    const instances = planInstances(descriptor, segments, centerline, { width, random, occupied });
    if (instances.length === 0) {
      continue;
    }

    decorations.push({
      type: "instanced-decoration",
      mesh: descriptor.mesh,
      ...(descriptor.fileName ? { assetUrl: buildAssetUrl(TRACK_ASSET_LIBRARY.publicUrl, descriptor.fileName) } : {}),
      instances
    });
  }

  return decorations;
}

function withDefaultTreeDescriptor(descriptors: AssetDescriptor[]): AssetDescriptor[] {
  const hasProcedural = descriptors.some((descriptor) => descriptor.mesh === "procedural-tree");
  if (hasProcedural) {
    return descriptors;
  }

  return [
    {
      id: "default-trees",
      mesh: "procedural-tree",
      side: 0,
      density: PROCEDURAL_TRACK_SETTINGS.treeDensity,
      minSpacing: 4,
      minDistance: PROCEDURAL_TRACK_SETTINGS.treeMinDistanceFactor,
      maxDistance: PROCEDURAL_TRACK_SETTINGS.treeMaxDistanceFactor,
      segment: "any",
      zone: "outer"
    },
    ...descriptors
  ];
}

function planInstances(
  descriptor: AssetDescriptor,
  segments: SegmentInfo[],
  centerline: Vec2[],
  context: PlanningContext
): TrackObjectInstance[] {
  const { random, occupied, width } = context;
  const instances: TrackObjectInstance[] = [];
  const spacing = resolveSpacing(descriptor, width);
  const limit = descriptor.maxInstances ?? Number.POSITIVE_INFINITY;
  let distanceToNext = spacing * random();

  if (descriptor.nodeIndex !== undefined) {
    const targetIndex = clamp(descriptor.nodeIndex, 0, centerline.length - 1);
    const segment = segments[targetIndex % segments.length];
    const anchor = centerline[targetIndex];
    const instance = buildInstance(descriptor, anchor, segment, width, random);
    if (instance && isOutsideTrack(instance.position, segments, width) && canPlace(instance.position, descriptor, occupied)) {
      instances.push(instance);
      occupied.push(instance.position);
    }
    return instances;
  }

  for (let i = 0; i < segments.length && instances.length < limit; i++) {
    const segment = segments[i];
    if (!segmentMatches(descriptor, segment, i)) {
      distanceToNext = Math.max(0, distanceToNext - segment.length);
      continue;
    }

    let travelled = 0;
    while (travelled + distanceToNext <= segment.length && instances.length < limit) {
      const distanceAlong = travelled + distanceToNext;
      const anchor = {
        x: segment.start.x + segment.direction.x * distanceAlong,
        z: segment.start.z + segment.direction.z * distanceAlong
      };
      const instance = buildInstance(descriptor, anchor, segment, width, random);
      if (instance && isOutsideTrack(instance.position, segments, width) && canPlace(instance.position, descriptor, occupied)) {
        instances.push(instance);
        occupied.push(instance.position);
      }

      travelled = distanceAlong;
      distanceToNext = spacingWithJitter(spacing, random);
    }

    distanceToNext = Math.max(0, distanceToNext - (segment.length - travelled));
  }

  return instances;
}

function buildSegments(centerline: Vec2[]): SegmentInfo[] {
  const segments: SegmentInfo[] = [];
  for (let i = 0; i < centerline.length; i++) {
    const current = centerline[i];
    const next = centerline[(i + 1) % centerline.length];
    const direction = normalize({ x: next.x - current.x, z: next.z - current.z });
    const length = Math.max(0.001, distance(current, next));
    const prev = centerline[(i - 1 + centerline.length) % centerline.length];
    const prevDir = normalize({ x: current.x - prev.x, z: current.z - prev.z });
    const curvature = angleBetween(prevDir, direction);
    segments.push({ start: current, direction, length, curvature });
  }
  return segments;
}

function segmentMatches(descriptor: AssetDescriptor, segment: SegmentInfo, index: number): boolean {
  if (descriptor.every && index % descriptor.every !== 0) {
    return false;
  }

  const isStraight = Math.abs(segment.curvature) < 0.35;
  if (descriptor.segment === "straight" && !isStraight) {
    return false;
  }
  if (descriptor.segment === "curve" && isStraight) {
    return false;
  }

  return true;
}

function buildInstance(
  descriptor: AssetDescriptor,
  anchor: Vec2,
  segment: SegmentInfo,
  width: number,
  random: () => number
): TrackObjectInstance | null {
  const side = resolveSide(descriptor, segment, random);
  const normal = leftNormal(segment.direction);
  const offset = resolveOffset(descriptor, width, random);
  const position = {
    x: anchor.x + normal.x * offset * side,
    z: anchor.z + normal.z * offset * side
  };
  const rotation = descriptor.mesh === "gltf"
    ? Math.atan2(segment.direction.z, segment.direction.x) + (descriptor.alignToTrack === false ? random() * Math.PI * 2 : 0)
    : random() * Math.PI * 2;
  const scale = descriptor.size ?? TRACK_ASSET_LIBRARY.size;

  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) {
    return null;
  }

  return { position, rotation, scale };
}

function resolveOffset(descriptor: AssetDescriptor, width: number, random: () => number): number {
  if (descriptor.mesh === "procedural-tree") {
    const min = (descriptor.minDistance ?? PROCEDURAL_TRACK_SETTINGS.treeMinDistanceFactor) * width;
    const max = (descriptor.maxDistance ?? PROCEDURAL_TRACK_SETTINGS.treeMaxDistanceFactor) * width;
    return randomRange(min, max, random);
  }

  const base = width * 0.5 + (descriptor.offset ?? TRACK_ASSET_LIBRARY.offset);
  return base;
}

function resolveSpacing(descriptor: AssetDescriptor, width: number): number {
  const minSpacing = descriptor.minSpacing ?? Math.max(4, width * 0.75);
  if (descriptor.density && descriptor.density > 0) {
    const spacingFromDensity = 1000 / descriptor.density;
    return Math.max(minSpacing, spacingFromDensity);
  }
  return minSpacing;
}

function spacingWithJitter(spacing: number, random: () => number): number {
  const jitter = 0.25 + random() * 0.5;
  return spacing * jitter;
}

function resolveSide(descriptor: AssetDescriptor, segment: SegmentInfo, random: () => number): 1 | -1 {
  if (descriptor.side !== 0) {
    return descriptor.side;
  }

  if (descriptor.zone === "outer") {
    const curvature = segment.curvature;
    if (Math.abs(curvature) > 0.05) {
      return curvature > 0 ? -1 : 1;
    }
  }

  return random() > 0.5 ? 1 : -1;
}

function canPlace(position: Vec2, descriptor: AssetDescriptor, occupied: Vec2[]): boolean {
  const minSpacing = descriptor.minSpacing ?? 0;
  if (minSpacing <= 0 || occupied.length === 0) {
    return true;
  }
  const minDistanceSq = minSpacing * minSpacing;
  return occupied.every((item) => squaredDistance(item, position) > minDistanceSq);
}

function isOutsideTrack(position: Vec2, segments: SegmentInfo[], width: number): boolean {
  if (segments.length === 0) {
    return true;
  }
  const halfWidth = width * 0.5;
  const clearance = halfWidth + 0.25;
  const minDistanceSq = minimumDistanceToSegmentsSq(position, segments);
  return minDistanceSq >= clearance * clearance;
}

function minimumDistanceToSegmentsSq(point: Vec2, segments: SegmentInfo[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const candidate = distanceToSegmentSq(point, segment);
    if (candidate < best) {
      best = candidate;
    }
  }
  return best;
}

function distanceToSegmentSq(point: Vec2, segment: SegmentInfo): number {
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

function buildAssetUrl(base: string, fileName: string): string {
  if (!base) {
    return `/${fileName}`;
  }
  return `${base}/${fileName}`;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function squaredDistance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function normalize(vec: Vec2): Vec2 {
  const length = Math.hypot(vec.x, vec.z);
  if (length === 0) {
    return { x: 0, z: 0 };
  }
  return { x: vec.x / length, z: vec.z / length };
}

function leftNormal(vec: Vec2): Vec2 {
  return { x: -vec.z, z: vec.x };
}

function angleBetween(a: Vec2, b: Vec2): number {
  const dot = a.x * b.x + a.z * b.z;
  const det = a.x * b.z - a.z * b.x;
  return Math.atan2(det, dot);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randomRange(min: number, max: number, random: () => number): number {
  if (min >= max) {
    return min;
  }
  return min + (max - min) * random();
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

