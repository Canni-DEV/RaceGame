import { PROCEDURAL_TRACK_SETTINGS, TRACK_ASSET_LIBRARY } from "../config";
import { InstancedDecoration, TrackObjectInstance, Vec2 } from "../types/trackTypes";
import { AssetDescriptor, loadAssetDescriptors } from "./TrackAssetManifestReader";

type PlacementMode = "fixed" | "repeat" | "scatter";
type DecorationCategory = "required" | "optional" | "filler";

interface SegmentInfo {
  start: Vec2;
  direction: Vec2;
  length: number;
  curvature: number;
}

interface PlanningContext {
  width: number;
  centerline: Vec2[];
  segments: SegmentInfo[];
  occupied: Vec2[];
  baseSeed: number;
}

interface DescriptorPlanConfig {
  descriptor: AssetDescriptor;
  placement: PlacementMode;
  category: DecorationCategory;
  random: () => number;
}

export function planAssetDecorations(centerline: Vec2[], width: number, seed: number): InstancedDecoration[] {
  if (centerline.length === 0) {
    return [];
  }

  const descriptors = withDefaultTreeDescriptor(loadAssetDescriptors(TRACK_ASSET_LIBRARY));
  if (descriptors.length === 0) {
    return [];
  }

  const workingCenterline = maybeSmoothCenterline(centerline);
  const segments = buildSegments(workingCenterline);
  const context: PlanningContext = {
    width,
    centerline: workingCenterline,
    segments,
    occupied: [],
    baseSeed: seed ^ 0x9e3779b9
  };
  const decorations: InstancedDecoration[] = [];

  const sorted = descriptors.slice().sort((a, b) => categoryPriority(resolveCategory(a)) - categoryPriority(resolveCategory(b)));

  for (const descriptor of sorted) {
    const placement = resolvePlacement(descriptor);
    const category = resolveCategory(descriptor);
    const random = createDescriptorRandom(context.baseSeed, descriptor);
    const probability = resolveProbability(descriptor, category);
    if (category !== "required" && random() > probability) {
      continue;
    }

    const config: DescriptorPlanConfig = { descriptor, placement, category, random };
    const instances = planDescriptorInstances(config, context);

    if (instances.length === 0 && category === "required") {
      const fallback = planFallbackInstance(config, context);
      if (fallback.length === 0) {
        continue;
      }
      instances.push(...fallback);
    }

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
      placement: "scatter",
      category: "filler",
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

function planDescriptorInstances(config: DescriptorPlanConfig, context: PlanningContext): TrackObjectInstance[] {
  const { descriptor, placement, random } = config;
  const debug = descriptor.anchor === "center" || !!descriptor.allowOnTrack;
  switch (placement) {
    case "fixed":
      return planFixedInstances(descriptor, context, random, debug);
    case "repeat":
      return planRepeatInstances(descriptor, context, random);
    case "scatter":
    default:
      return planScatterInstances(descriptor, context, random);
  }
}

function planFixedInstances(
  descriptor: AssetDescriptor,
  context: PlanningContext,
  random: () => number,
  debug: boolean
): TrackObjectInstance[] {
  const { centerline, segments, width, occupied } = context;
  const nodes = descriptor.nodes ?? (descriptor.nodeIndex !== undefined ? [descriptor.nodeIndex] : []);
  if (!nodes || nodes.length === 0) {
    return [];
  }

  const limit = descriptor.maxInstances ?? Number.POSITIVE_INFINITY;
  const instances: TrackObjectInstance[] = [];
  if (debug) {
    console.log(`[DecorPlanner] fixed placement id=${descriptor.id} anchor=${descriptor.anchor} width=${width} nodes=${nodes.join(",")}`);
  }
  for (const nodeIndex of nodes) {
    if (instances.length >= limit) {
      break;
    }
    const targetIndex = clamp(nodeIndex, 0, centerline.length - 1);
    const segment = segments[targetIndex % segments.length];
    const anchor = centerline[targetIndex];
    const candidates = buildInstancesForAnchor(descriptor, anchor, segment, width, random, debug);
    for (const candidate of candidates) {
      tryAddInstance(candidate, descriptor, instances, occupied, segments, width, limit);
    }
  }

  return instances;
}

function planRepeatInstances(
  descriptor: AssetDescriptor,
  context: PlanningContext,
  random: () => number
): TrackObjectInstance[] {
  const { centerline, segments, width, occupied } = context;
  const totalSegments = segments.length;
  const step = Math.max(1, descriptor.every ?? 1);
  const offset = clamp(descriptor.repeatOffset ?? 0, 0, totalSegments - 1);
  const limit = descriptor.maxInstances ?? Number.POSITIVE_INFINITY;
  const inRange = createRangeCheck(totalSegments, descriptor.startNode, descriptor.endNode);
  const instances: TrackObjectInstance[] = [];

  for (let counter = offset; counter < offset + totalSegments && instances.length < limit; counter += step) {
    const index = counter % totalSegments;
    if (!inRange(index)) {
      continue;
    }

    const segment = segments[index];
    if (!segmentMatches(descriptor, segment, index)) {
      continue;
    }

    const anchor = centerline[index];
    const candidates = buildInstancesForAnchor(descriptor, anchor, segment, width, random);
    for (const candidate of candidates) {
      tryAddInstance(candidate, descriptor, instances, occupied, segments, width, limit);
    }
  }

  return instances;
}

function planScatterInstances(
  descriptor: AssetDescriptor,
  context: PlanningContext,
  random: () => number
): TrackObjectInstance[] {
  const { segments, centerline, width, occupied } = context;
  const spacing = resolveSpacing(descriptor, width);
  const limit = descriptor.maxInstances ?? Number.POSITIVE_INFINITY;
  const inRange = createRangeCheck(segments.length, descriptor.startNode, descriptor.endNode);
  const instances: TrackObjectInstance[] = [];
  let distanceToNext = spacing * random();

  for (let i = 0; i < segments.length && instances.length < limit; i++) {
    const segment = segments[i];
    if (!inRange(i) || !segmentMatches(descriptor, segment, i)) {
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
      const candidates = buildInstancesForAnchor(descriptor, anchor, segment, width, random);
      for (const candidate of candidates) {
        tryAddInstance(candidate, descriptor, instances, occupied, segments, width, limit);
      }

      travelled = distanceAlong;
      distanceToNext = spacingWithJitter(spacing, random);
    }

    distanceToNext = Math.max(0, distanceToNext - (segment.length - travelled));
  }

  return instances;
}

function planFallbackInstance(config: DescriptorPlanConfig, context: PlanningContext): TrackObjectInstance[] {
  const { descriptor, random } = config;
  const anchor = context.centerline[0];
  const segment = context.segments[0];
  const candidates = buildInstancesForAnchor(descriptor, anchor, segment, context.width, random);
  const placed: TrackObjectInstance[] = [];
  for (const candidate of candidates) {
    tryAddInstance(candidate, descriptor, placed, context.occupied, context.segments, context.width, descriptor.maxInstances ?? 1, true);
  }
  return placed;
}

function buildInstancesForAnchor(
  descriptor: AssetDescriptor,
  anchor: Vec2,
  segment: SegmentInfo,
  width: number,
  random: () => number,
  debug = false
): TrackObjectInstance[] {
  const anchorMode = resolveAnchor(descriptor);
  const normal = leftNormal(segment.direction);
  const sides = resolveSides(descriptor, segment, random);
  const candidates: TrackObjectInstance[] = [];

  for (const side of sides) {
    const position = resolvePosition(descriptor, anchorMode, anchor, normal, width, random, side);
    const rotation = resolveRotation(descriptor, segment, random, side, normal);
    const scale = resolveScale(descriptor, random);
    if (debug) {
      console.log(
        `[DecorPlanner] place id=${descriptor.id} anchor=${anchorMode} side=${side} anchorPoint=(${anchor.x.toFixed(2)},${anchor.z.toFixed(2)}) ` +
          `normal=(${normal.x.toFixed(3)},${normal.z.toFixed(3)}) width=${width} offset=${descriptor.offset ?? 0} ` +
          `offsetFromCenter=${descriptor.offsetFromCenter ?? "none"} position=(${position.x.toFixed(2)},${position.z.toFixed(2)})`
      );
    }

    if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) {
      continue;
    }

    candidates.push({ position, rotation, scale });
  }

  return candidates;
}

function tryAddInstance(
  candidate: TrackObjectInstance,
  descriptor: AssetDescriptor,
  instances: TrackObjectInstance[],
  occupied: Vec2[],
  segments: SegmentInfo[],
  width: number,
  limit: number,
  force = false
): void {
  if (instances.length >= limit) {
    return;
  }

  if (!force && !hasTrackClearance(candidate.position, descriptor, segments, width)) {
    return;
  }
  if (!force && !canPlace(candidate.position, descriptor, occupied)) {
    return;
  }

  instances.push(candidate);
  occupied.push(candidate.position);
}

function resolvePlacement(descriptor: AssetDescriptor): PlacementMode {
  if (descriptor.placement) {
    return descriptor.placement;
  }
  if (descriptor.nodes && descriptor.nodes.length > 0) {
    return "fixed";
  }
  if (descriptor.nodeIndex !== undefined) {
    return "fixed";
  }
  if (descriptor.every !== undefined || descriptor.repeatOffset !== undefined) {
    return "repeat";
  }
  return "scatter";
}

function resolveCategory(descriptor: AssetDescriptor): DecorationCategory {
  if (descriptor.category) {
    return descriptor.category;
  }
  const placement = resolvePlacement(descriptor);
  if (placement === "fixed" || placement === "repeat") {
    return "required";
  }
  return "filler";
}

function resolveProbability(descriptor: AssetDescriptor, category: DecorationCategory): number {
  if (descriptor.probability !== undefined) {
    return descriptor.probability;
  }
  return category === "optional" ? 0.5 : 1;
}

function categoryPriority(category: DecorationCategory): number {
  switch (category) {
    case "required":
      return 0;
    case "optional":
      return 1;
    case "filler":
    default:
      return 2;
  }
}

function resolveAnchor(descriptor: AssetDescriptor): "edge" | "center" {
  return descriptor.anchor ?? (descriptor.allowOnTrack ? "center" : "edge");
}

function resolveSides(descriptor: AssetDescriptor, segment: SegmentInfo, random: () => number): (1 | -1 | 0)[] {
  if (resolveAnchor(descriptor) === "center") {
    return [0];
  }
  if (descriptor.bothSides) {
    return [1, -1];
  }
  return [resolveSide(descriptor, segment, random)];
}

function resolveOffset(
  descriptor: AssetDescriptor,
  width: number,
  random: () => number,
  anchor: "edge" | "center"
): number {
  // Center handled separately; here we return a magnitude
  if (anchor === "center") {
    return descriptor.offsetFromCenter !== undefined ? Math.max(0, descriptor.offsetFromCenter) : 0;
  }

  const userOffset = Math.max(0, descriptor.offset ?? 0);
  const effectiveOffset = width * 0.5 + userOffset;

  if (descriptor.mesh === "procedural-tree") {
    const min = (descriptor.minDistance ?? PROCEDURAL_TRACK_SETTINGS.treeMinDistanceFactor) * width;
    const max = (descriptor.maxDistance ?? PROCEDURAL_TRACK_SETTINGS.treeMaxDistanceFactor) * width;
    const distance = randomRange(min, max, random);
    return Math.max(effectiveOffset, distance);
  }

  return effectiveOffset;
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
      return curvature > 0 ? 1 : -1;
    }
  }

  return random() > 0.5 ? 1 : -1;
}

function resolvePosition(
  descriptor: AssetDescriptor,
  anchorMode: "edge" | "center",
  anchor: Vec2,
  normal: Vec2,
  width: number,
  random: () => number,
  side: 1 | -1 | 0
): Vec2 {
  if (anchorMode === "center") {
    const offset = descriptor.offsetFromCenter ?? 0;
    if (offset === 0) {
      return { ...anchor };
    }
    const sign = side === -1 ? -1 : 1;
    return {
      x: anchor.x + normal.x * offset * sign,
      z: anchor.z + normal.z * offset * sign
    };
  }

  const magnitude = resolveOffset(descriptor, width, random, anchorMode);
  return {
    x: anchor.x + normal.x * magnitude * side,
    z: anchor.z + normal.z * magnitude * side
  };
}

function resolveRotation(
  descriptor: AssetDescriptor,
  segment: SegmentInfo,
  random: () => number,
  side: 1 | -1 | 0,
  normal: Vec2
): number {
  let baseRotation: number;

  if (descriptor.mesh !== "gltf") {
    baseRotation = random() * Math.PI * 2;
  } else if (descriptor.faceTrack && side !== 0) {
    baseRotation = Math.atan2(-normal.z * side, -normal.x * side);
  } else if (descriptor.alignToTrack === false) {
    baseRotation = random() * Math.PI * 2;
  } else {
    baseRotation = Math.atan2(segment.direction.z, segment.direction.x);
  }

  const offset = descriptor.rotationOffset ?? 0;
  return baseRotation + offset;
}

function resolveScale(descriptor: AssetDescriptor, random: () => number): number {
  const minSize = descriptor.minSize ?? descriptor.size ?? TRACK_ASSET_LIBRARY.size;
  const maxSize = descriptor.maxSize ?? descriptor.size ?? minSize;
  const safeMin = Math.max(0.01, minSize);
  const safeMax = Math.max(safeMin, maxSize);
  if (Math.abs(safeMax - safeMin) < 1e-6) {
    return safeMin;
  }
  return randomRange(safeMin, safeMax, random);
}

function canPlace(position: Vec2, descriptor: AssetDescriptor, occupied: Vec2[]): boolean {
  const minSpacing = descriptor.minSpacing ?? 0;
  if (minSpacing <= 0 || occupied.length === 0) {
    return true;
  }
  const minDistanceSq = minSpacing * minSpacing;
  return occupied.every((item) => squaredDistance(item, position) > minDistanceSq);
}

function hasTrackClearance(
  position: Vec2,
  descriptor: AssetDescriptor,
  segments: SegmentInfo[],
  width: number
): boolean {
  const allowOnTrack = descriptor.allowOnTrack ?? resolveAnchor(descriptor) === "center";
  if (allowOnTrack) {
    return true;
  }
  const halfWidth = width * 0.5;
  const clearance = descriptor.clearance ?? halfWidth + 0.25;
  const minDistanceSq = minimumDistanceToSegmentsSq(position, segments);
  return minDistanceSq >= clearance * clearance;
}

function createRangeCheck(total: number, startNode?: number, endNode?: number): (index: number) => boolean {
  if (total === 0) {
    return () => false;
  }
  const start = clamp(startNode ?? 0, 0, total - 1);
  const end = clamp(endNode ?? total - 1, 0, total - 1);
  if (start <= end) {
    return (index: number) => index >= start && index <= end;
  }
  return (index: number) => index >= start || index <= end;
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

function maybeSmoothCenterline(centerline: Vec2[]): Vec2[] {
  if (centerline.length > 32) {
    return centerline;
  }
  const smoothed: Vec2[] = [];
  const count = centerline.length;
  const subdivisions = 8;

  for (let i = 0; i < count; i++) {
    const p0 = centerline[(i - 1 + count) % count];
    const p1 = centerline[i];
    const p2 = centerline[(i + 1) % count];
    const p3 = centerline[(i + 2) % count];
    for (let j = 0; j < subdivisions; j++) {
      const t = j / subdivisions;
      smoothed.push(catmullRom(p0, p1, p2, p3, t));
    }
  }

  return smoothed;
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
  return { x: vec.z, z: -vec.x };
}

function angleBetween(a: Vec2, b: Vec2): number {
  const dot = a.x * b.x + a.z * b.z;
  const det = a.x * b.z - a.z * b.x;
  return Math.atan2(det, dot);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const z =
    0.5 *
    (2 * p1.z +
      (-p0.z + p2.z) * t +
      (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
      (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
  return { x, z };
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

function randomRange(min: number, max: number, random: () => number): number {
  if (min >= max) {
    return min;
  }
  return min + (max - min) * random();
}

function hashString(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createDescriptorRandom(baseSeed: number, descriptor: AssetDescriptor): () => number {
  const offset = descriptor.seedOffset ?? 0;
  const seed = (baseSeed ^ hashString(descriptor.id) ^ Math.floor(Math.abs(offset) * 9973)) >>> 0;
  return createRandom(seed);
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
