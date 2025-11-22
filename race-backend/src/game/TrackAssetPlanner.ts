import { TRACK_ASSET_LIBRARY } from "../config";
import { TrackAssetDecoration, Vec2 } from "../types/trackTypes";
import { AssetDescriptor, loadAssetDescriptors } from "./TrackAssetManifestReader";

export function planAssetDecorations(centerline: Vec2[], width: number): TrackAssetDecoration[] {
  if (centerline.length === 0) {
    return [];
  }

  const files = loadAssetDescriptors(TRACK_ASSET_LIBRARY);
  if (files.length === 0) {
    return [];
  }

  const offsetDistance = Math.max(0, width) + TRACK_ASSET_LIBRARY.offset;
  const baseUrl = sanitizeBaseUrl(TRACK_ASSET_LIBRARY.publicUrl);
  const decorations: TrackAssetDecoration[] = [];

  for (const descriptor of files) {
    const nodeIndex = clamp(descriptor.nodeIndex, 0, centerline.length - 1);
    const anchor = centerline[nodeIndex];
    const direction = resolveDirection(centerline, nodeIndex);
    if (!direction) {
      continue;
    }
    const normal = leftNormal(direction);
    const sideMultiplier = descriptor.side;
    const position = {
      x: anchor.x + normal.x * offsetDistance * sideMultiplier,
      z: anchor.z + normal.z * offsetDistance * sideMultiplier
    };
    const rotation = Math.atan2(direction.z, direction.x);
    const assetUrl = buildAssetUrl(baseUrl, descriptor.fileName);

    decorations.push({
      type: "track-asset",
      assetUrl,
      position,
      rotation,
      size: TRACK_ASSET_LIBRARY.size
    });
  }

  return decorations;
}

function resolveDirection(points: Vec2[], index: number): Vec2 | null {
  const curr = points[index];
  const next = points[(index + 1) % points.length];
  let direction = normalize({ x: next.x - curr.x, z: next.z - curr.z });
  if (direction.x === 0 && direction.z === 0) {
    const prev = points[(index - 1 + points.length) % points.length];
    direction = normalize({ x: curr.x - prev.x, z: curr.z - prev.z });
  }
  if (direction.x === 0 && direction.z === 0) {
    return null;
  }
  return direction;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sanitizeBaseUrl(base: string): string {
  if (!base) {
    return "";
  }
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function buildAssetUrl(base: string, fileName: string): string {
  if (!base) {
    return `/${fileName}`;
  }
  return `${base}/${fileName}`;
}
