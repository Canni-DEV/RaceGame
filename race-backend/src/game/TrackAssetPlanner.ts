import { PROCEDURAL_TRACK_SETTINGS, TRACK_ASSET_LIBRARY } from "../config";
import { InstancedDecoration, TrackObjectInstance, Vec2 } from "../types/trackTypes";
import { AssetDescriptor, loadAssetDescriptors } from "./TrackAssetManifestReader";

interface TrackFrame {
  tangent: Vec2;
  normal: Vec2;
  curvature: number;
}

interface SegmentInfo {
  startIndex: number;
  start: Vec2;
  end: Vec2;
  direction: Vec2;
  length: number;
  curvature: number;
  frameStart: TrackFrame;
  frameEnd: TrackFrame;
}

interface PlanningContext {
  width: number;
  occupied: Vec2[];
  windingOrder: 1 | -1; // 1 for CW, -1 for CCW
}

export function planAssetDecorations(centerline: Vec2[], width: number, seed: number): InstancedDecoration[] {
  if (centerline.length === 0) {
    return [];
  }

  const baseSeed = seed ^ 0x9e3779b9;
  const descriptors = withDefaultTreeDescriptor(loadAssetDescriptors(TRACK_ASSET_LIBRARY)).sort(
    (a, b) => (a.placementTier ?? 0) - (b.placementTier ?? 0)
  );
  if (descriptors.length === 0) {
    return [];
  }

  const primaryDescriptors: AssetDescriptor[] = [];
  const gapFillDescriptors: AssetDescriptor[] = [];
  for (const descriptor of descriptors) {
    if (descriptor.fillEmpty) {
      gapFillDescriptors.push(descriptor);
    } else {
      primaryDescriptors.push(descriptor);
    }
  }

  const frames = buildFrames(centerline);
  const segments = buildSegments(centerline, frames);
  const occupied: Vec2[] = [];
  const decorations: InstancedDecoration[] = [];
  const windingOrder = calculateWindingOrder(centerline);

  for (const descriptor of primaryDescriptors) {
    const descriptorSeed = mixSeeds(baseSeed, descriptor.seedOffset ?? 0, descriptor.id);
    const descriptorRandom = createRandom(descriptorSeed);
    const chance = descriptor.chance ?? 1;
    if (chance < 1 && descriptorRandom() > chance && descriptor.placement !== "required") {
      continue;
    }

    const instances = planInstances(descriptor, segments, centerline, frames, {
      width,
      occupied,
      windingOrder,
      random: descriptorRandom
    });
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

  if (gapFillDescriptors.length > 0) {
    for (const descriptor of gapFillDescriptors) {
      const descriptorSeed = mixSeeds(baseSeed, descriptor.seedOffset ?? 0x73fa142d, descriptor.id);
      const descriptorRandom = createRandom(descriptorSeed);
      const instances = planGapFillInstances(descriptor, segments, centerline, frames, {
        width,
        occupied,
        windingOrder,
        random: descriptorRandom
      });
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
  frames: TrackFrame[],
  context: PlanningContext & { random: () => number }
): TrackObjectInstance[] {
  const { random, occupied, width, windingOrder } = context;
  const instances: TrackObjectInstance[] = [];
  const spacing = resolveSpacing(descriptor, width);
  const limit = descriptor.maxInstances ?? Number.POSITIVE_INFINITY;
  const minInstances = descriptor.minInstances ?? (descriptor.placement === "required" ? 1 : 0);
  let distanceToNext = spacing * random();
  const allowOnTrack = descriptor.allowOnTrack === true;

  const targetNodes = collectTargetNodes(descriptor, centerline.length);
  if (targetNodes.length > 0) {
    for (const targetIndex of targetNodes) {
      const anchor = centerline[targetIndex];
      const frame = frames[targetIndex % frames.length];
      const instanceSet = buildInstance(descriptor, anchor, frame, width, random, segments, occupied, windingOrder);
      if (!instanceSet) {
        continue;
      }
      for (const instance of instanceSet) {
        if (
          (allowOnTrack || isOutsideTrack(instance.position, segments, width, descriptor)) &&
          canPlace(instance.position, descriptor, occupied)
        ) {
          instances.push(instance);
          occupied.push(instance.position);
          if (instances.length >= limit) {
            break;
          }
        }
      }
      if (instances.length >= limit) {
        break;
      }
    }
    return ensureMinimumInstances(instances, descriptor, segments, centerline, frames, context, minInstances, spacing);
  }

  if (descriptor.nodeIndex !== undefined) {
    const targetIndex = clamp(descriptor.nodeIndex, 0, centerline.length - 1);
    const anchor = centerline[targetIndex];
    const frame = frames[targetIndex % frames.length];
    const instanceSet = buildInstance(descriptor, anchor, frame, width, random, segments, occupied, windingOrder);
    if (instanceSet) {
      for (const instance of instanceSet) {
        if (
          (allowOnTrack || isOutsideTrack(instance.position, segments, width, descriptor)) &&
          canPlace(instance.position, descriptor, occupied)
        ) {
          instances.push(instance);
          occupied.push(instance.position);
          if (instances.length >= limit) {
            break;
          }
        }
      }
      if (instances.length >= limit) {
        return ensureMinimumInstances(
          instances,
          descriptor,
          segments,
          centerline,
          frames,
          context,
          minInstances,
          spacing
        );
      }
    }
    return ensureMinimumInstances(instances, descriptor, segments, centerline, frames, context, minInstances, spacing);
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
      const offsetAlong = clamp(
        distanceAlong + sampleLongitudinalJitter(descriptor, spacing, random),
        0,
        segment.length
      );
      const jitteredAnchor = {
        x: segment.start.x + segment.direction.x * offsetAlong,
        z: segment.start.z + segment.direction.z * offsetAlong
      };
      const frame = interpolateFrame(segment.frameStart, segment.frameEnd, segment.length === 0 ? 0 : distanceAlong / segment.length);
      const instanceSet = buildInstance(descriptor, jitteredAnchor, frame, width, random, segments, occupied, windingOrder);
      if (instanceSet) {
        for (const instance of instanceSet) {
          if (
            (allowOnTrack || isOutsideTrack(instance.position, segments, width, descriptor)) &&
            canPlace(instance.position, descriptor, occupied)
          ) {
            instances.push(instance);
            occupied.push(instance.position);
            if (instances.length >= limit) {
              break;
            }
          }
        }
        if (descriptor.oncePerSegment) {
          distanceToNext = Number.POSITIVE_INFINITY;
        }
      }

      travelled = distanceAlong;
      distanceToNext = spacingWithJitter(spacing, random);
    }

    distanceToNext = Math.max(0, distanceToNext - (segment.length - travelled));
  }

  return ensureMinimumInstances(instances, descriptor, segments, centerline, frames, context, minInstances, spacing);
}

function collectTargetNodes(descriptor: AssetDescriptor, nodeCount: number): number[] {
  const result: number[] = [];
  if (descriptor.nodeIndices && descriptor.nodeIndices.length > 0) {
    result.push(...descriptor.nodeIndices.map((index) => clamp(index, 0, nodeCount - 1)));
  }
  if (descriptor.nodeIndex !== undefined) {
    result.push(clamp(descriptor.nodeIndex, 0, nodeCount - 1));
  }
  return result;
}

function ensureMinimumInstances(
  instances: TrackObjectInstance[],
  descriptor: AssetDescriptor,
  segments: SegmentInfo[],
  centerline: Vec2[],
  frames: TrackFrame[],
  context: PlanningContext & { random: () => number },
  minInstances: number,
  spacing: number
): TrackObjectInstance[] {
  if (instances.length >= minInstances || minInstances <= 0) {
    return instances;
  }

  const { random, width, occupied, windingOrder } = context;
  const allowOnTrack = descriptor.allowOnTrack === true;
  let searchIndex = 0;
  while (instances.length < minInstances && searchIndex < centerline.length) {
    const idx = searchIndex % centerline.length;
    const anchor = centerline[idx];
    const frame = frames[idx % frames.length];
    const instanceSet = buildInstance(descriptor, anchor, frame, width, random, segments, occupied, windingOrder);
    if (instanceSet) {
      for (const instance of instanceSet) {
        if (
          (allowOnTrack || isOutsideTrack(instance.position, segments, width, descriptor)) &&
          canPlace(instance.position, descriptor, occupied)
        ) {
          instances.push(instance);
          occupied.push(instance.position);
          if (instances.length >= minInstances) {
            break;
          }
        }
      }
      if (instances.length >= minInstances) {
        break;
      }
      searchIndex += Math.max(1, Math.round(spacing));
      continue;
    }
    searchIndex++;
  }

  return instances;
}

function planGapFillInstances(
  descriptor: AssetDescriptor,
  segments: SegmentInfo[],
  centerline: Vec2[],
  frames: TrackFrame[],
  context: PlanningContext & { random: () => number }
): TrackObjectInstance[] {
  const { random, width, occupied, windingOrder } = context;
  const instances: TrackObjectInstance[] = [];
  const spacing = resolveSpacing(descriptor, width);
  const limit = descriptor.maxInstances ?? Number.POSITIVE_INFINITY;
  const minInstances = descriptor.minInstances ?? 0;
  const chance = descriptor.chance ?? 1;
  const allowOnTrack = descriptor.allowOnTrack === true;
  if (chance < 1 && descriptor.placement !== "required" && random() > chance) {
    return instances;
  }

  const bounds = computeBounds(centerline);
  const margin = width + Math.max(descriptor.offset ?? 0, 12);
  const cellSize = descriptor.fillCellSize ?? Math.max(10, width * 0.6);
  const startX = bounds.min.x - margin;
  const endX = bounds.max.x + margin;
  const startZ = bounds.min.z - margin;
  const endZ = bounds.max.z + margin;
  const clearance = width * 0.5 + 0.25;

  for (let x = startX; x <= endX && instances.length < limit; x += cellSize) {
    for (let z = startZ; z <= endZ && instances.length < limit; z += cellSize) {
      const sample = {
        x: x + (random() - 0.5) * cellSize,
        z: z + (random() - 0.5) * cellSize
      };
      const distanceSq = minimumDistanceToSegmentsSq(sample, segments);
      if (!allowOnTrack && distanceSq < clearance * clearance) {
        continue;
      }
      if (!canPlace(sample, descriptor, occupied)) {
        continue;
      }
      const nearest = closestTrackPoint(sample, segments);
      const frame: TrackFrame = {
        tangent: nearest.direction,
        normal: leftNormal(nearest.direction),
        curvature: 0
      };
      const instanceSet = buildInstance(descriptor, nearest.point, frame, width, random, segments, occupied, windingOrder);
      if (instanceSet) {
        for (const instance of instanceSet) {
          if (
            (allowOnTrack || isOutsideTrack(instance.position, segments, width, descriptor)) &&
            canPlace(instance.position, descriptor, occupied)
          ) {
            instances.push(instance);
            occupied.push(instance.position);
            if (instances.length >= limit) {
              break;
            }
          }
        }
      }
    }
  }

  if (instances.length < minInstances) {
    return ensureMinimumInstances(instances, descriptor, segments, centerline, frames, context, minInstances, spacing);
  }

  return instances;
}

function buildFrames(centerline: Vec2[]): TrackFrame[] {
  const frames: TrackFrame[] = [];
  const count = centerline.length;
  for (let i = 0; i < count; i++) {
    const prev = centerline[(i - 1 + count) % count];
    const curr = centerline[i];
    const next = centerline[(i + 1) % count];
    const tangent = normalize({ x: next.x - prev.x, z: next.z - prev.z });
    const incoming = normalize({ x: curr.x - prev.x, z: curr.z - prev.z });
    const outgoing = normalize({ x: next.x - curr.x, z: next.z - curr.z });
    const curvature = angleBetween(incoming, outgoing);
    frames.push({ tangent, normal: leftNormal(tangent), curvature });
  }
  return frames;
}

function interpolateFrame(start: TrackFrame, end: TrackFrame, t: number): TrackFrame {
  const clamped = clamp(t, 0, 1);
  const tangent = normalize({
    x: lerp(start.tangent.x, end.tangent.x, clamped),
    z: lerp(start.tangent.z, end.tangent.z, clamped)
  });
  const rawNormal = normalize({
    x: lerp(start.normal.x, end.normal.x, clamped),
    z: lerp(start.normal.z, end.normal.z, clamped)
  });
  const normal = rawNormal.x === 0 && rawNormal.z === 0 ? leftNormal(tangent) : rawNormal;
  const curvature = lerp(start.curvature, end.curvature, clamped);

  return { tangent, normal, curvature };
}

function buildSegments(centerline: Vec2[], frames: TrackFrame[]): SegmentInfo[] {
  const segments: SegmentInfo[] = [];
  for (let i = 0; i < centerline.length; i++) {
    const current = centerline[i];
    const nextIndex = (i + 1) % centerline.length;
    const next = centerline[nextIndex];
    const direction = normalize({ x: next.x - current.x, z: next.z - current.z });
    const length = Math.max(0.001, distance(current, next));
    const curvature = (frames[i].curvature + frames[nextIndex].curvature) * 0.5;
    segments.push({
      startIndex: i,
      start: current,
      end: next,
      direction,
      length,
      curvature,
      frameStart: frames[i],
      frameEnd: frames[nextIndex]
    });
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
  frame: TrackFrame,
  width: number,
  random: () => number,
  segments: SegmentInfo[],
  occupied: Vec2[],
  windingOrder: 1 | -1
): TrackObjectInstance[] | null {
  const side = resolveSide(descriptor, frame, random, windingOrder);
  const offset = resolveOffset(descriptor, width, random);
  const offsetMode = descriptor.offsetMode ?? "edge";
  const signedOffset = offsetMode === "centerline" ? (descriptor.offset ?? 0) : offset;
  const lateralBase = side === 0 ? 0 : signedOffset * -side;
  const lateral = lateralBase + sampleOffsetJitter(descriptor, random);
  const position = {
    x: anchor.x + frame.normal.x * lateral,
    z: anchor.z + frame.normal.z * lateral
  };

  const rotation = resolveRotation(descriptor, frame, position, anchor, side, segments, random);
  const scale = resolveScale(descriptor, random);

  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) {
    return null;
  }

  const instances: TrackObjectInstance[] = [{ position, rotation, scale }];
  const clusterSize = Math.max(1, descriptor.clusterSize ?? 1);
  const clusterRadius = descriptor.clusterRadius ?? Math.max(0.5, (descriptor.minSpacing ?? 0) * 0.5);
  if (clusterSize > 1 && clusterRadius > 0) {
    for (let i = 1; i < clusterSize; i++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * clusterRadius;
      const offsetX = Math.cos(angle) * radius;
      const offsetZ = Math.sin(angle) * radius;
      const clusterPos = { x: position.x + offsetX, z: position.z + offsetZ };
      const clusterRotation = resolveRotation(descriptor, frame, clusterPos, anchor, side, segments, random);
      const clusterInstance: TrackObjectInstance = { position: clusterPos, rotation: clusterRotation, scale };
      if (canPlace(clusterPos, descriptor, occupied)) {
        instances.push(clusterInstance);
      }
    }
  }

  return instances;
}

function resolveOffset(descriptor: AssetDescriptor, width: number, random: () => number): number {
  const mode = descriptor.offsetMode ?? "edge";
  const userOffset = Math.max(0, descriptor.offset ?? 0);
  const baseEdge = width * 0.5;
  const libraryOffset = Math.max(0, TRACK_ASSET_LIBRARY.offset);
  const edgeOffset = baseEdge + libraryOffset + userOffset;
  const spreadMode = descriptor.spreadMode ?? "edge";

  if (mode === "centerline") {
    return descriptor.offset ?? 0;
  }

  if (mode === "absolute") {
    return userOffset;
  }

  if (descriptor.mesh === "procedural-tree") {
    const min = (descriptor.minDistance ?? PROCEDURAL_TRACK_SETTINGS.treeMinDistanceFactor) * width;
    const max = (descriptor.maxDistance ?? PROCEDURAL_TRACK_SETTINGS.treeMaxDistanceFactor) * width;
    const distance =
      spreadMode === "band"
        ? randomRange(min, max, random)
        : spreadMode === "random-outer"
          ? randomRange(Math.max(edgeOffset, min), max, random)
          : randomRange(min, max, random);
    return Math.max(edgeOffset, distance);
  }

  if (spreadMode === "band") {
    const minBand = edgeOffset;
    const maxBand = edgeOffset + Math.max(userOffset, width * 0.2);
    return randomRange(minBand, maxBand, random);
  }

  if (spreadMode === "random-outer") {
    const outer = edgeOffset + Math.max(width, userOffset);
    return randomRange(edgeOffset, outer, random);
  }

  return edgeOffset;
}

function resolveRotation(
  descriptor: AssetDescriptor,
  frame: TrackFrame,
  position: Vec2,
  anchor: Vec2,
  side: 1 | -1 | 0,
  segments: SegmentInfo[],
  random: () => number
): number {
  const baseRotation = descriptor.baseRotation ?? 0;
  const rotationOffset = descriptor.rotationOffset ?? 0;
  const jitter = sampleRotationJitter(descriptor, random);

  if (descriptor.lookAtTrack) {
    // Look straight to the anchor used for placement (centerline point of the segment).
    const primary = { x: anchor.x - position.x, z: anchor.z - position.z };
    let desired = primary;
    let magnitudeSq = primary.x * primary.x + primary.z * primary.z;

    // If degenerate (very rare), fall back to the true nearest track point.
    if (magnitudeSq < 1e-9 && segments.length > 0) {
      const closest = closestTrackPoint(position, segments).point;
      desired = { x: closest.x - position.x, z: closest.z - position.z };
      magnitudeSq = desired.x * desired.x + desired.z * desired.z;
    }

    // Final fallback: push toward the lane center based on the sampled frame/side.
    if (magnitudeSq < 1e-9) {
      desired = {
        x: frame.normal.x * (side === 0 ? -1 : side),
        z: frame.normal.z * (side === 0 ? -1 : side)
      };
    }

    const desiredDir = normalize(desired);
    const desiredAngle = Math.atan2(desiredDir.z, desiredDir.x);
    return normalizeAngle(desiredAngle + baseRotation + rotationOffset + jitter);
  }

  if (descriptor.mesh === "gltf" && descriptor.alignToTrack !== false) {
    const forwardRotation = Math.atan2(frame.tangent.z, frame.tangent.x);
    return normalizeAngle(forwardRotation + baseRotation + rotationOffset + jitter);
  }

  const randomRotation = random() * Math.PI * 2;
  return normalizeAngle(randomRotation + baseRotation + rotationOffset + jitter);
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

function sampleLongitudinalJitter(descriptor: AssetDescriptor, spacing: number, random: () => number): number {
  const jitter = descriptor.longitudinalJitter ?? 0;
  if (!Number.isFinite(jitter) || jitter === 0) {
    return 0;
  }
  const magnitude = Math.abs(jitter) < 1 ? spacing * Math.abs(jitter) : Math.abs(jitter);
  const sign = random() > 0.5 ? 1 : -1;
  return magnitude * sign * random();
}

function sampleOffsetJitter(descriptor: AssetDescriptor, random: () => number): number {
  const jitter = descriptor.offsetJitter ?? 0;
  if (!Number.isFinite(jitter) || jitter === 0) {
    return 0;
  }
  const sign = random() > 0.5 ? 1 : -1;
  return jitter * sign * random();
}

function sampleRotationJitter(descriptor: AssetDescriptor, random: () => number): number {
  const jitter = descriptor.rotationJitter ?? 0;
  if (!Number.isFinite(jitter) || jitter === 0) {
    return 0;
  }
  const sign = random() > 0.5 ? 1 : -1;
  return jitter * sign * random();
}

function resolveSide(
  descriptor: AssetDescriptor,
  frame: TrackFrame,
  random: () => number,
  windingOrder: 1 | -1
): 1 | -1 | 0 {
  if (descriptor.side === -1 || descriptor.side === 1) {
    return descriptor.side;
  }

  if (descriptor.offsetMode === "centerline") {
    return 0;
  }

  if (descriptor.zone === "outer") {
    // If winding is CW (1), outer is Left (-1)
    // If winding is CCW (-1), outer is Right (1)
    // So outer = -windingOrder
    return windingOrder === 1 ? -1 : 1;
  }

  if (descriptor.zone === "inner") {
    // Inner is opposite of outer
    return windingOrder;
  }

  return random() > 0.5 ? 1 : -1;
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

function isOutsideTrack(position: Vec2, segments: SegmentInfo[], width: number, descriptor: AssetDescriptor): boolean {
  if (descriptor.allowOnTrack) {
    return true;
  }
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

function closestTrackPoint(point: Vec2, segments: SegmentInfo[]): { point: Vec2; direction: Vec2 } {
  let best: { point: Vec2; direction: Vec2; distSq: number } | null = null;
  for (const segment of segments) {
    const candidate = distanceToSegment(point, segment);
    if (!best || candidate.distSq < best.distSq) {
      best = candidate;
    }
  }
  if (best) {
    return { point: best.point, direction: best.direction };
  }
  return { point, direction: { x: 1, z: 0 } };
}

function distanceToSegment(point: Vec2, segment: SegmentInfo): { point: Vec2; direction: Vec2; distSq: number } {
  const dx = point.x - segment.start.x;
  const dz = point.z - segment.start.z;
  const projection = dx * segment.direction.x + dz * segment.direction.z;
  const clamped = clamp(projection, 0, segment.length);
  const closestX = segment.start.x + segment.direction.x * clamped;
  const closestZ = segment.start.z + segment.direction.z * clamped;
  const offsetX = point.x - closestX;
  const offsetZ = point.z - closestZ;
  return {
    point: { x: closestX, z: closestZ },
    direction: segment.direction,
    distSq: offsetX * offsetX + offsetZ * offsetZ
  };
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

function computeBounds(points: Vec2[]): { min: Vec2; max: Vec2 } {
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.z > maxZ) maxZ = p.z;
  }
  if (!Number.isFinite(minX)) {
    return { min: { x: 0, z: 0 }, max: { x: 0, z: 0 } };
  }
  return { min: { x: minX, z: minZ }, max: { x: maxX, z: maxZ } };
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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = ((angle % twoPi) + twoPi) % twoPi;
  return wrapped > Math.PI ? wrapped - twoPi : wrapped;
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

function mixSeeds(base: number, offset: number, id: string): number {
  let hash = base ^ Math.trunc(offset) ^ 0x9e3779b9;
  for (let i = 0; i < id.length; i++) {
    hash ^= (id.charCodeAt(i) + i) * 0x45d9f3b;
    hash = (hash << 13) | (hash >>> 19);
  }
  return hash >>> 0;
}

function calculateWindingOrder(points: Vec2[]): 1 | -1 {
  if (points.length < 3) return 1;

  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += (p2.x - p1.x) * (p2.z + p1.z);
  }

  // Shoelace formula: positive sum = CW, negative = CCW
  return sum >= 0 ? 1 : -1;
}
