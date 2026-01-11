import path from "path";

export const PORT = 4000;
export const PROTOCOL_VERSION = clamp(Number(process.env.PROTOCOL_VERSION ?? 2), 1, 1000);
export const SERVER_VERSION = process.env.SERVER_VERSION ?? "1";
export const TICK_RATE = 60; // ticks per second
export const STATE_BROADCAST_RATE = 20; // snapshots per second
export const STATE_NUMBER_PRECISION = clamp(Number(process.env.STATE_NUMBER_PRECISION ?? 3), 0, 10);
export const RADIO_STATION_COUNT = clamp(Number(process.env.RADIO_STATION_COUNT ?? 5), 0, 20);
export const STATE_DELTA_MAX_RATIO = clamp(Number(process.env.STATE_DELTA_MAX_RATIO ?? 0.6), 0, 1);
export const STATE_DELTA_MIN_CHANGES = clamp(Number(process.env.STATE_DELTA_MIN_CHANGES ?? 24), 1, 100000);
export const INPUT_BURST_WINDOW_MS = clamp(Number(process.env.INPUT_BURST_WINDOW_MS ?? 50), 10, 1000);
export const INPUT_BURST_LIMIT = clamp(Number(process.env.INPUT_BURST_LIMIT ?? 8), 1, 500);
export const CHAT_MESSAGE_MAX_LENGTH = clamp(Number(process.env.CHAT_MESSAGE_MAX_LENGTH ?? 140), 1, 500);
export const CHAT_MESSAGE_BURST_WINDOW_MS = clamp(
  Number(process.env.CHAT_MESSAGE_BURST_WINDOW_MS ?? 4000),
  200,
  60000,
);
export const CHAT_MESSAGE_BURST_LIMIT = clamp(Number(process.env.CHAT_MESSAGE_BURST_LIMIT ?? 4), 1, 100);
export const MAX_PLAYERS_PER_ROOM = 8;
export const RACE_COUNTDOWN_SECONDS = clamp(Number(process.env.RACE_COUNTDOWN_SECONDS ?? 5), 1, 120);
export const RACE_LAPS = clamp(Number(process.env.RACE_LAPS ?? 3), 1, 99);
export const RACE_START_SEGMENT_INDEX = clamp(Number(process.env.RACE_START_SEGMENT_INDEX ?? 3), 0, 100000);
export const RACE_GRID_SPACING = clamp(Number(process.env.RACE_GRID_SPACING ?? 10), 2, 200);
export const RACE_LATERAL_SPACING = clamp(Number(process.env.RACE_LATERAL_SPACING ?? 5), 1, 100);
export const RACE_FINISH_TIMEOUT = clamp(Number(process.env.RACE_FINISH_TIMEOUT ?? 25), 5, 600);
export const RACE_POST_DURATION = clamp(Number(process.env.RACE_POST_DURATION ?? 8), 2, 300);
export const RACE_SHORTCUT_MAX_RATIO = clamp(Number(process.env.RACE_SHORTCUT_MAX_RATIO ?? 2.8), 1, 10);
export const RACE_SHORTCUT_MIN_DISTANCE = clamp(Number(process.env.RACE_SHORTCUT_MIN_DISTANCE ?? 25), 0, 500);
export const RACE_BACKTRACK_TOLERANCE = clamp(Number(process.env.RACE_BACKTRACK_TOLERANCE ?? 12), 0, 300);
export const RACE_MIN_FORWARD_ADVANCE = clamp(Number(process.env.RACE_MIN_FORWARD_ADVANCE ?? 1), 0, 100);

// Physics configuration
export const MAX_SPEED = 55; // units per second
export const ACCELERATION = 45; // units per second^2
export const BRAKE_DECELERATION = 75; // units per second^2
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
export const TRACK_BOUNDARY_OFFSET = clamp(Number(process.env.TRACK_BOUNDARY_OFFSET ?? 12), 0, 200);
export const TRACK_BOUNDARY_RESTITUTION = clamp(
  Number(process.env.TRACK_BOUNDARY_RESTITUTION ?? 0.25),
  0,
  1,
);
export const MISSILE_MAX_CHARGES = clamp(Number(process.env.MISSILE_MAX_CHARGES ?? 3), 0, 99);
export const MISSILE_RECHARGE_SECONDS = clamp(Number(process.env.MISSILE_RECHARGE_SECONDS ?? 30), 1, 3600);
export const MISSILE_SPEED_MULTIPLIER = clamp(Number(process.env.MISSILE_SPEED_MULTIPLIER ?? 3), 0.1, 20);
export const MISSILE_MIN_SPEED = clamp(Number(process.env.MISSILE_MIN_SPEED ?? 120), 0, 500);
export const MISSILE_ACQUISITION_RADIUS = clamp(Number(process.env.MISSILE_ACQUISITION_RADIUS ?? 25), 1, 250);
export const MISSILE_HIT_RADIUS = clamp(Number(process.env.MISSILE_HIT_RADIUS ?? 4), 0.1, 50);
export const MISSILE_MAX_RANGE_FACTOR = clamp(Number(process.env.MISSILE_MAX_RANGE_FACTOR ?? 0.5), 0.05, 2);
export const MISSILE_IMPACT_SPIN_TURNS = clamp(Number(process.env.MISSILE_IMPACT_SPIN_TURNS ?? 3), 0, 50);
export const MISSILE_IMPACT_SPIN_DURATION = clamp(
  Number(process.env.MISSILE_IMPACT_SPIN_DURATION ?? 1.5),
  0.1,
  30,
);
export const ITEM_SPAWN_COUNT = clamp(Number(process.env.ITEM_SPAWN_COUNT ?? 14), 0, 500);
export const ITEM_RESPAWN_SECONDS = clamp(Number(process.env.ITEM_RESPAWN_SECONDS ?? 15), 0, 3600);
export const ITEM_PICKUP_RADIUS = clamp(Number(process.env.ITEM_PICKUP_RADIUS ?? 4), 0, 100);
export const ITEM_LATERAL_SPREAD = clamp(Number(process.env.ITEM_LATERAL_SPREAD ?? 8), 0, 500);
export const ITEM_SPACING_JITTER = clamp(Number(process.env.ITEM_SPACING_JITTER ?? 12), 0, 1000);
export const ITEM_PROB_NITRO = clamp(Number(process.env.ITEM_PROB_NITRO ?? 0.6), 0, 1);
export const ITEM_PROB_SHOOT = clamp(Number(process.env.ITEM_PROB_SHOOT ?? 0.4), 0, 1);

export const DEFAULT_ROOM_PREFIX = "room";

export type TrackGenerationMode = "debug" | "daily" | "seed";

export interface TrackGenerationOptions {
  mode: TrackGenerationMode;
  seedOverride?: number;
  debugTrackId: string;
  dailyVariance: number;
}

export const TRACK_GENERATION: TrackGenerationOptions = {
  mode: (process.env.TRACK_MODE as TrackGenerationMode) ?? "daily", //set en daily
  seedOverride: process.env.TRACK_SEED ? Number(process.env.TRACK_SEED) : undefined, //set en undefined
  debugTrackId: "sample-track",
  dailyVariance: 5
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
  startStraightMinCells: number;
  startStraightMaxCells: number;
}

export const PROCEDURAL_TRACK_SETTINGS: ProceduralTrackSettings = {
  gridWidth: Number(process.env.TRACK_GRID_WIDTH ?? 12),
  gridHeight: Number(process.env.TRACK_GRID_HEIGHT ?? 8),
  cellSize: Number(process.env.TRACK_CELL_SIZE ?? 100),
  targetCoverage: Number(process.env.TRACK_TARGET_COVERAGE ?? 0.1),
  minLoopLength: Number(process.env.TRACK_MIN_LOOP_LENGTH ?? 16),
  maxAttempts: Number(process.env.TRACK_MAX_ATTEMPTS ?? 128),
  directionBias: Number(process.env.TRACK_DIRECTION_BIAS ?? 1.5),
  turnBias: Number(process.env.TRACK_TURN_BIAS ?? 1.1),
  smoothingPasses: Number(process.env.TRACK_SMOOTHING_PASSES ?? 3),
  cornerSubdivisions: Number(process.env.TRACK_CORNER_SUBDIVISIONS ?? 2),
  cornerRoundness: Number(process.env.TRACK_CORNER_ROUNDNESS ?? 0.32),
  widthRange: [
    Number(process.env.TRACK_MIN_WIDTH ?? 30),
    Number(process.env.TRACK_MAX_WIDTH ?? 32)
  ],
  treeDensity: Number(process.env.TRACK_TREE_DENSITY ?? 16),
  treeMinDistanceFactor: Number(process.env.TRACK_TREE_MIN_DIST ?? 0.7),
  treeMaxDistanceFactor: Number(process.env.TRACK_TREE_MAX_DIST ?? 2.6),
  startStraightMinCells: Number(process.env.TRACK_START_STRAIGHT_MIN_CELLS ?? 5),
  startStraightMaxCells: Number(process.env.TRACK_START_STRAIGHT_MAX_CELLS ?? 6)
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
