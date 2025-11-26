import path from "path";

export const PORT = 4000;
export const TICK_RATE = 60; // ticks per second
export const STATE_BROADCAST_RATE = 20; // snapshots per second
export const MAX_PLAYERS_PER_ROOM = 8;

// Physics configuration
export const MAX_SPEED = 65; // units per second
export const ACCELERATION = 50; // units per second^2
export const BRAKE_DECELERATION = 50; // units per second^2
export const FRICTION = 10; // passive deceleration per second
export const STEER_SENSITIVITY = 2.5; // radians per second at full steer and 1 unit of normalized speed
export const TURBO_MAX_CHARGES = clamp(Number(process.env.TURBO_MAX_CHARGES ?? 3), 0, 99);
export const TURBO_DURATION = clamp(Number(process.env.TURBO_DURATION ?? 2), 0.1, 30);
export const TURBO_RECHARGE_SECONDS = clamp(
  Number(process.env.TURBO_RECHARGE_SECONDS ?? 60),
  1,
  3600,
);
export const TURBO_ACCELERATION_MULTIPLIER = clamp(
  Number(process.env.TURBO_ACCELERATION_MULTIPLIER ?? 2.4),
  1,
  25,
);
export const TURBO_MAX_SPEED_MULTIPLIER = clamp(
  Number(process.env.TURBO_MAX_SPEED_MULTIPLIER ?? 1.25),
  1,
  10,
);
export const OFF_TRACK_SPEED_PENALTY = clamp(
  Number(process.env.OFF_TRACK_SPEED_PENALTY ?? 0.5),
  0,
  0.95
);
export const OFF_TRACK_SPEED_MULTIPLIER = 1 - OFF_TRACK_SPEED_PENALTY;
export const MISSILE_MAX_CHARGES = clamp(Number(process.env.MISSILE_MAX_CHARGES ?? 3), 0, 99);
export const MISSILE_RECHARGE_SECONDS = clamp(Number(process.env.MISSILE_RECHARGE_SECONDS ?? 60), 1, 3600);
export const MISSILE_SPEED_MULTIPLIER = clamp(Number(process.env.MISSILE_SPEED_MULTIPLIER ?? 2), 0.1, 20);
export const MISSILE_MIN_SPEED = clamp(Number(process.env.MISSILE_MIN_SPEED ?? 20), 0, 500);
export const MISSILE_ACQUISITION_RADIUS = clamp(Number(process.env.MISSILE_ACQUISITION_RADIUS ?? 15), 1, 250);
export const MISSILE_HIT_RADIUS = clamp(Number(process.env.MISSILE_HIT_RADIUS ?? 4), 0.1, 50);
export const MISSILE_MAX_RANGE_FACTOR = clamp(Number(process.env.MISSILE_MAX_RANGE_FACTOR ?? 0.5), 0.05, 2);

export const DEFAULT_ROOM_PREFIX = "room";

export type TrackGenerationMode = "debug" | "daily" | "seed";

export interface TrackGenerationOptions {
  mode: TrackGenerationMode;
  seedOverride?: number;
  debugTrackId: string;
}

export const TRACK_GENERATION: TrackGenerationOptions = {
  mode: (process.env.TRACK_MODE as TrackGenerationMode) ?? "daily", //set en daily
  seedOverride: process.env.TRACK_SEED ? Number(process.env.TRACK_SEED) : undefined, //set en undefined
  debugTrackId: "sample-track"
};

export interface ProceduralTrackSettings {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  targetCoverage: number;
  minLoopLength: number;
  maxAttempts: number;
  directionBias: number;
  turnBias: number;
  smoothingPasses: number;
  cornerSubdivisions: number;
  cornerRoundness: number;
  widthRange: [number, number];
  treeDensity: number;
  treeMinDistanceFactor: number;
  treeMaxDistanceFactor: number;
}

export const PROCEDURAL_TRACK_SETTINGS: ProceduralTrackSettings = {
  gridWidth: Number(process.env.TRACK_GRID_WIDTH ?? 24),
  gridHeight: Number(process.env.TRACK_GRID_HEIGHT ?? 16),
  cellSize: Number(process.env.TRACK_CELL_SIZE ?? 100),
  targetCoverage: Number(process.env.TRACK_TARGET_COVERAGE ?? 0.65),
  minLoopLength: Number(process.env.TRACK_MIN_LOOP_LENGTH ?? 16),
  maxAttempts: Number(process.env.TRACK_MAX_ATTEMPTS ?? 256),
  directionBias: Number(process.env.TRACK_DIRECTION_BIAS ?? 1.5),
  turnBias: Number(process.env.TRACK_TURN_BIAS ?? 1.1),
  smoothingPasses: Number(process.env.TRACK_SMOOTHING_PASSES ?? 3),
  cornerSubdivisions: Number(process.env.TRACK_CORNER_SUBDIVISIONS ?? 2),
  cornerRoundness: Number(process.env.TRACK_CORNER_ROUNDNESS ?? 0.32),
  widthRange: [
    Number(process.env.TRACK_MIN_WIDTH ?? 24),
    Number(process.env.TRACK_MAX_WIDTH ?? 32)
  ],
  treeDensity: Number(process.env.TRACK_TREE_DENSITY ?? 6),
  treeMinDistanceFactor: Number(process.env.TRACK_TREE_MIN_DIST ?? 0.7),
  treeMaxDistanceFactor: Number(process.env.TRACK_TREE_MAX_DIST ?? 2.6)
};

export interface TrackAssetLibraryConfig {
  directory: string;
  route: string;
  publicUrl: string;
  size: number;
  offset: number;
  manifestPath?: string;
}

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_ASSET_DIR = process.env.TRACK_ASSET_DIR
  ? path.resolve(process.env.TRACK_ASSET_DIR)
  : path.join(PROJECT_ROOT, "assets");

function normalizeRoute(value: string): string {
  if (!value || value === "/") {
    return "/assets";
  }
  return value.startsWith("/") ? value : `/${value}`;
}

function normalizePublicUrl(route: string, override?: string): string {
  if (override && override.trim().length > 0) {
    const trimmed = override.trim();
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  }
  return route;
}

function normalizeManifestPath(directory: string, override?: string): string | undefined {
  if (!override) {
    return undefined;
  }

  const trimmed = override.trim();
  if (!trimmed) {
    return undefined;
  }

  return path.isAbsolute(trimmed) ? trimmed : path.join(directory, trimmed);
}

const assetRoute = normalizeRoute(process.env.TRACK_ASSET_ROUTE ?? "/assets");
const manifestPath = normalizeManifestPath(DEFAULT_ASSET_DIR, process.env.TRACK_ASSET_MANIFEST);

export const TRACK_ASSET_LIBRARY: TrackAssetLibraryConfig = {
  directory: DEFAULT_ASSET_DIR,
  route: assetRoute,
  publicUrl: normalizePublicUrl(assetRoute, process.env.TRACK_ASSET_URL),
  size: Number(process.env.TRACK_ASSET_SIZE ?? 1),
  offset: Number(process.env.TRACK_ASSET_OFFSET ?? 12),
  manifestPath
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
