export const PORT = 4000;
export const TICK_RATE = 60; // ticks per second
export const STATE_BROADCAST_RATE = 20; // snapshots per second
export const MAX_PLAYERS_PER_ROOM = 8;

// Physics configuration
export const MAX_SPEED = 40; // units per second
export const ACCELERATION = 30; // units per second^2
export const BRAKE_DECELERATION = 50; // units per second^2
export const FRICTION = 10; // passive deceleration per second
export const STEER_SENSITIVITY = 2.5; // radians per second at full steer and 1 unit of normalized speed

export const DEFAULT_ROOM_PREFIX = "room";

export type TrackGenerationMode = "debug" | "daily" | "seed";

export interface TrackGenerationOptions {
  mode: TrackGenerationMode;
  seedOverride?: number;
  debugTrackId: string;
}

export const TRACK_GENERATION: TrackGenerationOptions = {
  mode: (process.env.TRACK_MODE as TrackGenerationMode) ?? "daily",
  seedOverride: process.env.TRACK_SEED ? Number(process.env.TRACK_SEED) : undefined,
  debugTrackId: "sample-track"
};

export interface ProceduralTrackSettings {
  minPoints: number;
  maxPoints: number;
  minRadius: number;
  maxRadius: number;
  smoothingPasses: number;
  angleJitter: number;
  widthRange: [number, number];
  treeDensity: number;
  treeMinDistanceFactor: number;
  treeMaxDistanceFactor: number;
  startBuildingOffset: number;
}

export const PROCEDURAL_TRACK_SETTINGS: ProceduralTrackSettings = {
  minPoints: Number(process.env.TRACK_MIN_POINTS ?? 12),
  maxPoints: Number(process.env.TRACK_MAX_POINTS ?? 18),
  minRadius: Number(process.env.TRACK_MIN_RADIUS ?? 40),
  maxRadius: Number(process.env.TRACK_MAX_RADIUS ?? 75),
  smoothingPasses: Number(process.env.TRACK_SMOOTHING_PASSES ?? 2),
  angleJitter: Number(process.env.TRACK_ANGLE_JITTER ?? 0.8),
  widthRange: [
    Number(process.env.TRACK_MIN_WIDTH ?? 24),
    Number(process.env.TRACK_MAX_WIDTH ?? 32)
  ],
  treeDensity: Number(process.env.TRACK_TREE_DENSITY ?? 6),
  treeMinDistanceFactor: Number(process.env.TRACK_TREE_MIN_DIST ?? 0.7),
  treeMaxDistanceFactor: Number(process.env.TRACK_TREE_MAX_DIST ?? 2.6),
  startBuildingOffset: Number(process.env.TRACK_BUILDING_OFFSET ?? 12)
};
