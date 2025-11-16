import fs from "fs";
import path from "path";
import { TRACK_ASSET_LIBRARY } from "../config";
import { TrackAssetDecoration, Vec2 } from "../types/trackTypes";

interface AssetDescriptor {
  fileName: string;
  nodeIndex: number;
  side: 1 | -1;
}

export function planAssetDecorations(centerline: Vec2[], width: number): TrackAssetDecoration[] {
  if (centerline.length === 0) {
    return [];
  }

  const files = readAssetFiles(TRACK_ASSET_LIBRARY.directory);
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

function readAssetFiles(directory: string): AssetDescriptor[] {
  try {
    if (!fs.existsSync(directory)) {
      return [];
    }
    const entries = fs.readdirSync(directory).filter((file) => file.toLowerCase().endsWith(".glb"));
    entries.sort((a, b) => a.localeCompare(b));
    const descriptors: AssetDescriptor[] = [];
    for (const file of entries) {
      const placement = parsePlacement(file);
      if (placement) {
        descriptors.push({ fileName: file, ...placement });
      }
    }
    return descriptors;
  } catch (error) {
    console.warn(`[TrackAssetPlanner] Unable to read asset directory "${directory}"`, error);
    return [];
  }
}

function parsePlacement(fileName: string): Omit<AssetDescriptor, "fileName"> | null {
  const name = path.parse(fileName).name;
  const digitsMatch = name.match(/(\d+)$/);
  if (!digitsMatch) {
    return null;
  }
  const indexPart = digitsMatch[1];
  const prefix = name.slice(0, name.length - indexPart.length);
  const nodeNumber = Number.parseInt(indexPart, 10);
  if (!Number.isFinite(nodeNumber) || nodeNumber <= 0) {
    return null;
  }
  const isOppositeSide = prefix.endsWith("-");
  return {
    nodeIndex: nodeNumber - 1,
    side: isOppositeSide ? -1 : 1
  };
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
